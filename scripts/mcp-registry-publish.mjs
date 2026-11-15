import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { bundlePublication } from './mcp-registry.mjs';

// Publishes Yaptake's MCP bundle to the official MCP Registry from trusted main.
// GitHub Actions OIDC is the only credential: the registry exchanges it for a
// short-lived token scoped to io.github.hraness/*, and this helper permits only
// the fixed Yaptake name. Sponge publishes from its own npm release workflow.
const repository = 'hraness/product-skills';
const repositoryId = '1458031600';
const ownerId = '307125679';
const subject = `repo:hraness@${ownerId}/product-skills@${repositoryId}:ref:refs/heads/main`;
const workflow = `${repository}/.github/workflows/mcp-registry.yml@refs/heads/main`;
const registry = 'https://registry.modelcontextprotocol.io';
const namespace = 'io.github.hraness/*';
const name = 'io.github.hraness/yaptake';
const schema = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
const origin = `https://github.com/${repository}`;
const stages = new Set(['arguments', 'workflow-identity', 'repository-readback', 'main-readback', 'required-check', 'github-oidc-request', 'github-oidc-claims', 'registry-token-exchange', 'registry-namespace', 'release-metadata', 'registry-version-readback', 'registry-publish', 'registry-publish-readback']);
const checks = new Set(['issuer', 'audience', 'repository', 'repository-id', 'owner', 'owner-id', 'ref', 'source', 'workflow', 'event', 'subject', 'expiry', 'auth-method', 'auth-subject', 'namespace']);
const need = (value, message, check) => { if (!value) throw Object.assign(Error(message), check ? { registryCheck: check } : {}); };
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const stable = (value) => typeof value === 'string' && /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value);

export function failureDiagnostic(error, stage) {
  const status = error?.registryHttpStatus;
  return { code: 'MCP_REGISTRY_STOPPED', stage: stages.has(stage) ? stage : 'unknown', ...(checks.has(error?.registryCheck) ? { check: error.registryCheck } : {}), ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}), server: name, namespace };
}

export async function requestJson(url, { token, body, allowMissing = false } = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (response.status === 404 && allowMissing) { await response.body?.cancel(); return null; }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw Object.assign(Error('Registry dependency request failed'), { registryHttpStatus: response.status }); }
  const chunks = []; let length = 0;
  try { for await (const chunk of response.body) { length += chunk.length; need(length <= 512 * 1024, 'Registry dependency response exceeds its limit'); chunks.push(chunk); } }
  catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function workflowIdentity(env) {
  need(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === repository && env.GITHUB_REPOSITORY_ID === repositoryId && env.GITHUB_REPOSITORY_OWNER_ID === ownerId && sha(env.GITHUB_SHA) && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_WORKFLOW_REF === workflow && ['workflow_dispatch', 'workflow_run'].includes(env.GITHUB_EVENT_NAME), 'Registry work must run from the canonical workflow on trusted main');
  return { sha: env.GITHUB_SHA, ref: env.GITHUB_REF, workflow: env.GITHUB_WORKFLOW_REF, event: env.GITHUB_EVENT_NAME };
}
function claims(token) {
  need(typeof token === 'string' && token.length <= 16384 && token.split('.').length === 3, 'Invalid short-lived registry credential');
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}
export async function namespacePreflight({ env, identity, request, now = Date.now, onStage = () => {} }) {
  onStage('github-oidc-request');
  need(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'GitHub Actions OIDC is required; no personal-token fallback is supported');
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  need(url.protocol === 'https:' && url.hostname.endsWith('.actions.githubusercontent.com') && !url.username && !url.password && !url.port && !url.hash, 'Unexpected GitHub OIDC endpoint');
  url.searchParams.set('audience', registry);
  const githubToken = await request(url.href, { token: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN });
  onStage('github-oidc-claims');
  const github = claims(githubToken?.value); const seconds = Math.floor(now() / 1000);
  for (const [check, matches] of [
    ['issuer', github.iss === 'https://token.actions.githubusercontent.com'], ['audience', github.aud === registry],
    ['repository', github.repository === repository], ['repository-id', String(github.repository_id) === repositoryId],
    ['owner-id', String(github.repository_owner_id) === ownerId], ['owner', github.repository_owner === 'hraness'],
    ['ref', github.ref === identity.ref], ['source', github.sha === identity.sha], ['workflow', github.workflow_ref === identity.workflow],
    ['event', github.event_name === identity.event], ['subject', github.sub === subject],
    ['expiry', Number.isSafeInteger(github.exp) && github.exp > seconds + 30 && github.exp <= seconds + 600],
  ]) need(matches, 'GitHub OIDC claims do not match the selected repository, ref and workflow', check);
  // The registry verifies the GitHub signature during exchange; this readback checks the granted scope.
  onStage('registry-token-exchange');
  const response = await request(`${registry}/v0.1/auth/github-oidc`, { body: { oidc_token: githubToken.value } });
  onStage('registry-namespace');
  const granted = claims(response?.registry_token);
  for (const [check, matches] of [
    ['issuer', granted.iss === 'mcp-registry'], ['auth-method', granted.auth_method === 'github-oidc'], ['auth-subject', granted.auth_method_sub === github.sub],
    ['expiry', Number.isSafeInteger(granted.exp) && granted.exp === response.expires_at && granted.exp > seconds + 30 && granted.exp <= seconds + 600],
    ['namespace', isDeepStrictEqual(granted.permissions, [{ action: 'publish', resource: namespace }])],
  ]) need(matches, 'The registry did not grant the expected Hraness namespace', check);
  return { token: response.registry_token, namespace };
}

// Derive the listing from the checked-out main: its release plan, product
// bundle and portfolio summary, plus the public immutable release readback.
export async function releasedDescriptor({ root, github }) {
  const read = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
  const plan = await read('dist/release.json'); const bundle = await read('bundles/yaptake.json'); const portfolio = await read('catalog/portfolio.json');
  need(plan?.schemaVersion === 1 && /^integrations-[a-f0-9]{16}$/.test(plan.tag) && Array.isArray(plan.products), 'The checked release plan is unavailable');
  const product = plan.products.find((entry) => entry.id === 'yaptake');
  need(product && stable(product.version) && product.mcpb?.file === `yaptake-${product.version}.mcpb` && /^[a-f0-9]{64}$/.test(product.mcpb.sha256), 'The release plan has no Yaptake MCP bundle');
  const bytes = await readFile(join(root, 'dist', product.mcpb.file));
  need(createHash('sha256').update(bytes).digest('hex') === product.mcpb.sha256, 'The rebuilt MCP bundle differs from its plan');
  const summary = portfolio.projects?.find((entry) => entry.id === 'yaptake')?.short;
  need(typeof summary === 'string' && summary.length > 0 && summary.length <= 100 && summary.trim() === summary && !/[\x00-\x1f\x7f]/.test(summary), 'Invalid public Yaptake summary');
  need(bundle?.manifest?.product?.id === 'yaptake' && bundle.manifest.product.agentGuideUrl === 'https://yaptake.com/docs/agents', 'Unexpected Yaptake agent guide');
  const identifier = `${origin}/releases/download/${plan.tag}/${product.mcpb.file}`;
  const descriptor = { $schema: schema, name, title: 'Yaptake', description: summary, version: product.version, websiteUrl: bundle.manifest.product.agentGuideUrl, packages: [{ registryType: 'mcpb', identifier, fileSha256: product.mcpb.sha256, transport: { type: 'stdio' } }] };
  const release = await github(`releases/tags/${plan.tag}`);
  // The same check the publication observer applies before it records a listing.
  bundlePublication({ server: descriptor, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', statusChangedAt: '1970-01-01T00:00:00Z', publishedAt: '1970-01-01T00:00:00Z', isLatest: true } } }, release);
  return descriptor;
}
// A later release may carry the same bundle bytes; the first listed address stays.
export function publicationReadback(record, descriptor) {
  const listed = record?.server; const expected = structuredClone(descriptor); const actual = structuredClone(listed ?? {});
  need(typeof actual.packages?.[0]?.identifier === 'string' && /^https:\/\/github\.com\/hraness\/product-skills\/releases\/download\/integrations-[a-f0-9]{16}\//.test(actual.packages[0].identifier) && actual.packages[0].identifier.endsWith(`/yaptake-${descriptor.version}.mcpb`), 'An existing registry version names another file; no overwrite is allowed');
  actual.packages[0].identifier = expected.packages[0].identifier;
  need(isDeepStrictEqual(actual, expected), 'An existing registry version has different metadata; no overwrite is allowed');
  const official = record._meta?.['io.modelcontextprotocol.registry/official'];
  need(official?.status === 'active' && typeof official.publishedAt === 'string' && Number.isFinite(Date.parse(official.publishedAt)), 'The registry entry is not an active published record');
  return { name, version: descriptor.version, identifier: listed.packages[0].identifier, publishedAt: official.publishedAt, url: `${registry}/v0.1/servers/${encodeURIComponent(name)}/versions/${descriptor.version}` };
}

export async function runRegistry({ mode, env = process.env, root = process.cwd(), request = requestJson, now = Date.now, wait = (ms) => new Promise((done) => setTimeout(done, ms)), onStage = () => {} }) {
  onStage('arguments'); need(['preflight', 'publish'].includes(mode), 'Use preflight or publish');
  onStage('workflow-identity'); const identity = workflowIdentity(env); need(env.GH_TOKEN, 'The read-only repository token is required');
  const github = (path) => request(`https://api.github.com/repos/${repository}${path ? `/${path}` : ''}`, { token: env.GH_TOKEN });
  onStage('repository-readback');
  const repo = await github('');
  need(String(repo.id) === repositoryId && repo.full_name === repository && repo.private === false && repo.default_branch === 'main' && String(repo.owner?.id) === ownerId, 'The canonical public repository readback differs');
  onStage('main-readback'); need((await github('git/ref/heads/main')).object?.sha === identity.sha, 'The selected protected main changed');
  onStage('required-check');
  const runs = await github(`commits/${identity.sha}/check-runs?per_page=100`);
  const required = runs.check_runs?.filter((run) => run.name === 'Required' && run.head_sha === identity.sha && run.app?.id === 15368).sort((a, b) => b.id - a.id)[0];
  need(required?.status === 'completed' && required.conclusion === 'success', 'The current main Required check must pass before registry work');
  const authority = await namespacePreflight({ env, identity, request, now, onStage });
  const receipt = { schemaVersion: 1, repository, sourceCommit: identity.sha, workflow: identity.workflow, namespace: authority.namespace, authentication: 'github-oidc' };
  if (mode === 'preflight') return { ...receipt, status: 'qualified', published: false };
  onStage('release-metadata'); const descriptor = await releasedDescriptor({ root, github });
  const endpoint = `${registry}/v0.1/servers/${encodeURIComponent(name)}/versions/${descriptor.version}?include_deleted=true`;
  onStage('registry-version-readback');
  const existing = await request(endpoint, { allowMissing: true });
  if (existing) return { ...receipt, status: 'already-published', publication: publicationReadback(existing, descriptor) };
  // A timed-out mutation may already have succeeded. Reconcile the exact slot
  // before any retry; never replace an existing version or invent a receipt.
  let publishError;
  onStage('registry-publish');
  try { await request(`${registry}/v0.1/publish`, { token: authority.token, body: descriptor }); } catch (error) { publishError = error; }
  onStage('registry-publish-readback');
  for (let attempt = 0; attempt < 6; attempt++) {
    const record = await request(endpoint, { allowMissing: true });
    if (record) return { ...receipt, status: 'published', publication: publicationReadback(record, descriptor) };
    if (attempt < 5) await wait(5000);
  }
  throw publishError ?? Error('Registry publication has not become visible; reconcile the exact version before retrying');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let stage = 'arguments';
  runRegistry({ mode: process.argv[2], onStage: (value) => { stage = value; } })
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify(failureDiagnostic(error, stage))}\n`);
      process.stderr.write('MCP Registry work stopped. No credential was printed; inspect the workflow and reconcile the exact version before retrying.\n');
      process.exitCode = 1;
    });
}
