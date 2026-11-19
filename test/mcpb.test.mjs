import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, realpath, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpbFile, mcpbMembers, mcpbPath, renderMcpb, yaptakeRequirements } from '../scripts/mcpb.mjs';
import { readRequirements, startYaptakeMcp, verifiedYaptakeHelper, YAPTAKE_APP } from '../scripts/yaptake/mcp.mjs';
import { bundleEnvironment } from '../scripts/sponge/bundle.mjs';
import { digest, validateLedger, zip } from '../scripts/distribution.mjs';
import { bundlePublication, observeMcpRegistry } from '../scripts/mcp-registry.mjs';
import { namespacePreflight, publicationReadback, releasedDescriptor, runRegistry, workflowIdentity } from '../scripts/mcp-registry-publish.mjs';

const bundle = async (id) => JSON.parse(await readFile(new URL(`../bundles/${id}.json`, import.meta.url), 'utf8')).manifest;
const options = { version: '0.1.3', icon: await readFile(new URL('../mcpb/yaptake/assets/icon.png', import.meta.url)), license: 'MIT synthetic license\n', links: { supportUrl: 'https://yaptake.com/support', privacyPolicyUrl: 'https://yaptake.com/privacy' }, author: { name: 'Hraness', url: 'https://hraness.com' }, repository: 'https://github.com/hraness/product-skills' };

test('MCP bundles hold only a launcher with the published manifest fields', async () => {
  for (const id of ['sponge', 'yaptake']) {
    const manifest = await bundle(id); const files = renderMcpb(manifest, options);
    assert.deepEqual(Object.keys(files).sort(), [...mcpbMembers(id)].sort());
    const m = JSON.parse(files['manifest.json']);
    assert.equal(m.manifest_version, '0.3'); assert.equal(m.name, id); assert.equal(m.version, '0.1.3'); assert.equal(m.description, manifest.product.description);
    assert.deepEqual(m.server, { type: 'node', entry_point: 'server/index.mjs', mcp_config: { command: 'node', args: ['${__dirname}/server/index.mjs'], ...(id === 'sponge' ? { env: { SPONGE_CLI: '${user_config.sponge_cli}', SPONGE_MCP_LIBRARY: '${user_config.library}' } } : {}) } });
    assert.equal(m.icon, 'assets/icon.png'); assert.equal(m.documentation, manifest.product.agentGuideUrl); assert.equal(m.license, 'MIT');
    assert(!JSON.stringify(m).match(/npx|npm |curl|https?:\/\/(?!(github\.com\/hraness|hraness\.com|sponge\.computer|yaptake\.com))/));
    assert.deepEqual(digest(zip(files)), digest(zip(renderMcpb(manifest, options))));
  }
  const yaptake = await bundle('yaptake'); const m = JSON.parse(renderMcpb(yaptake, options)['manifest.json']);
  assert.deepEqual(m.compatibility.platforms, ['darwin']); assert.equal(m.user_config, undefined);
  assert.deepEqual(yaptakeRequirements(yaptake), { schemaVersion: 1, command: 'yaptake', version: yaptake.runtime.version, build: yaptake.runtime.build, homepage: 'https://yaptake.com' });
  assert.throws(() => renderMcpb({ ...yaptake, product: { ...yaptake.product, id: 'dawn' } }, options));
  assert.throws(() => renderMcpb({ ...yaptake, mcp: undefined }, options));
  assert.equal(mcpbFile('yaptake', '0.1.3'), 'yaptake-0.1.3.mcpb');
  for (const path of ['mcpb/yaptake/manifest.json', 'mcpb/sponge/server/cli.mjs']) assert(mcpbPath(path), path);
  for (const path of ['mcpb/yaptake/server/cli.mjs', 'mcpb/dawn/manifest.json', 'mcpb/sponge/../x', 'mcpb/sponge/extra.js']) assert(!mcpbPath(path), path);
});

test('the Sponge bundle treats unset settings as unset and keeps only absolute PATH entries', () => {
  const env = bundleEnvironment({ HOME: '/home/a', PATH: 'relative:/usr/bin', SPONGE_CLI: '${user_config.sponge_cli}', SPONGE_MCP_LIBRARY: '' });
  assert.equal(env.SPONGE_CLI, undefined); assert.equal(env.SPONGE_MCP_LIBRARY, undefined); assert.equal(env.HOME, '/home/a');
  assert.equal(env.PATH, '/usr/bin:/opt/homebrew/bin:/usr/local/bin');
  assert.equal(bundleEnvironment({ SPONGE_CLI: '/opt/sponge.js', SPONGE_MCP_LIBRARY: '/lib' }).SPONGE_CLI, '/opt/sponge.js');
});

const requirements = { schemaVersion: 1, command: 'yaptake', version: '0.1.0', build: '231', homepage: 'https://yaptake.com' };
const plist = (changes = {}) => { const v = { CFBundleIdentifier: YAPTAKE_APP.bundleIdentifier, CFBundleShortVersionString: '0.1.0', CFBundleVersion: '231', ...changes }; return `<?xml version="1.0"?>\n<plist><dict>${Object.entries(v).map(([k, s]) => `<key>${k}</key><string>${s}</string>`).join('')}</dict></plist>\n`; };
async function app(t, { info = plist(), mode = 0o755 } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'yaptake-mcpb-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'Yaptake.app'); await mkdir(join(path, 'Contents/Helpers'), { recursive: true });
  await writeFile(join(path, YAPTAKE_APP.plist), info); await writeFile(join(path, YAPTAKE_APP.helper), '#!/bin/sh\n'); await chmod(join(path, YAPTAKE_APP.helper), mode);
  return { root, path };
}
function codesign(status = 0) {
  const calls = []; return { calls, run: (program, args) => { calls.push({ program, args }); return { status }; } };
}

test('the Yaptake launcher starts only the signed helper of a current Yaptake app', async (t) => {
  const current = await app(t), signing = codesign(), launched = [];
  const child = startYaptakeMcp({ requirements, candidates: [current.path], platform: 'darwin', run: signing.run, launch: (program, args, opts) => { launched.push({ program, args, opts }); return 'child'; } });
  assert.equal(child, 'child'); assert.deepEqual(launched.map(({ program, args }) => [program, args]), [[join(current.path, YAPTAKE_APP.helper), ['mcp']]]);
  assert.equal(launched[0].opts.stdio, 'inherit'); assert.equal(launched[0].opts.shell, undefined);
  assert.deepEqual(signing.calls.map((call) => call.program), ['/usr/bin/codesign', '/usr/bin/codesign']);
  assert.match(signing.calls[0].args.join(' '), /identifier "com\.yapwing\.app" and certificate leaf\[subject\.OU\] = "8AAP53VTW3"/);
  assert.match(signing.calls[1].args.join(' '), /identifier "yaptake" and/);
  assert.equal(verifiedYaptakeHelper(requirements, { candidates: [current.path], platform: 'darwin', run: codesign().run }).build, '231');
});

test('the Yaptake launcher refuses other platforms, apps, old builds, links and unsigned copies', async (t) => {
  const refuse = async (setup, pattern) => { const s = codesign(); assert.throws(() => verifiedYaptakeHelper(requirements, { platform: 'darwin', run: s.run, ...setup }), pattern); return s; };
  const current = await app(t);
  assert.throws(() => verifiedYaptakeHelper(requirements, { candidates: [current.path], platform: 'linux', run: codesign().run }), /Mac/);
  await refuse({ candidates: [join(current.root, 'missing.app')] }, /Install or update/);
  for (const changes of [{ CFBundleVersion: '230' }, { CFBundleShortVersionString: '0.0.9', CFBundleVersion: '999' }]) assert.equal((await refuse({ candidates: [(await app(t, { info: plist(changes) })).path] }, /Update Yaptake/)).calls.length, 0);
  assert.equal((await refuse({ candidates: [(await app(t, { info: plist({ CFBundleIdentifier: 'com.other.app' }) })).path] }, /not the Yaptake app/)).calls.length, 0);
  await refuse({ candidates: [(await app(t, { info: '<!DOCTYPE x [<!ENTITY a "b">]><plist/>' })).path] }, /Install or update/);
  await refuse({ candidates: [(await app(t, { mode: 0o644 })).path] }, /Install or update/);
  const linked = join(current.root, 'Linked.app'); await symlink(current.path, linked);
  await refuse({ candidates: [linked] }, /Install or update/);
  assert.throws(() => verifiedYaptakeHelper(requirements, { candidates: [current.path], platform: 'darwin', run: codesign(1).run }), /not signed by its developer/);
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'yaptake-req-'))); t.after(() => rm(dir, { recursive: true, force: true }));
  for (const value of [{ ...requirements, homepage: 'https://example.com' }, { ...requirements, build: '0' }, { ...requirements, version: 'latest' }]) {
    const path = join(dir, `${Math.random()}.json`); await writeFile(path, JSON.stringify(value)); assert.throws(() => readRequirements(path));
  }
  const good = join(dir, 'good.json'); await writeFile(good, JSON.stringify(requirements)); assert.deepEqual(readRequirements(good), requirements);
});

const sha = 'c'.repeat(64), tag = 'integrations-0123456789abcdef', file = 'yaptake-0.1.3.mcpb';
const identifier = `https://github.com/hraness/product-skills/releases/download/${tag}/${file}`;
const descriptor = { $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json', name: 'io.github.hraness/yaptake', title: 'Yaptake', description: 'Video editor for Mac.', version: '0.1.3', websiteUrl: 'https://yaptake.com/docs/agents', packages: [{ registryType: 'mcpb', identifier, fileSha256: sha, transport: { type: 'stdio' } }] };
const official = { status: 'active', statusChangedAt: '2026-11-15T20:00:00Z', publishedAt: '2026-11-15T20:00:00Z', isLatest: true };
const listing = (server = descriptor, meta = official) => ({ server, _meta: { 'io.modelcontextprotocol.registry/official': meta } });
const release = (changes = {}) => ({ tag_name: tag, draft: false, prerelease: false, immutable: true, html_url: `https://github.com/hraness/product-skills/releases/tag/${tag}`, assets: [{ name: file, digest: `sha256:${sha}`, browser_download_url: identifier }], ...changes });
const now = () => Date.parse('2026-11-15T21:00:00Z');

test('a Yaptake listing is recorded only for the exact file in an immutable release', () => {
  const entry = bundlePublication(listing(), release(), { now });
  assert.equal(entry.product, 'yaptake'); assert.equal(entry.channel, 'mcp-registry'); assert.equal(entry.version, '0.1.3');
  assert.equal(entry.url, 'https://registry.modelcontextprotocol.io/v0.1/servers/io.github.hraness%2Fyaptake/versions/0.1.3');
  assert.doesNotThrow(() => validateLedger({ schemaVersion: 1, publications: [entry] }));
  assert.throws(() => validateLedger({ schemaVersion: 1, publications: [{ ...entry, product: 'dawn' }] }));
  for (const changes of [{ immutable: false }, { draft: true }, { tag_name: 'integrations-ffffffffffffffff' }, { assets: [] }, { assets: [{ name: file, digest: `sha256:${'d'.repeat(64)}`, browser_download_url: identifier }] }])
    assert.throws(() => bundlePublication(listing(), release(changes), { now }), undefined, JSON.stringify(changes));
  const pkg = descriptor.packages[0];
  for (const changes of [{ registryType: 'npm' }, { identifier: identifier.replace('yaptake-0.1.3', 'yaptake-0.1.4') }, { identifier: identifier.replace('hraness/product-skills', 'other/product-skills') }, { fileSha256: 'x' }, { transport: { type: 'streamable-http' } }, { version: '0.1.3' }])
    assert.throws(() => bundlePublication(listing({ ...descriptor, packages: [{ ...pkg, ...changes }] }), release(), { now }), undefined, JSON.stringify(changes));
  // The title is the product's name as it stands; the server name and the bundle pin the listing.
  assert.doesNotThrow(() => bundlePublication(listing({ ...descriptor, title: 'YAPTAKE' }), release(), { now }));
  for (const title of ['', 'Yaptake\nnext', 'x'.repeat(81)]) assert.throws(() => bundlePublication(listing({ ...descriptor, title }), release(), { now }), undefined, JSON.stringify(title));
  assert.throws(() => bundlePublication(listing({ ...descriptor, websiteUrl: 'https://example.com' }), release(), { now }));
});

test('the Yaptake observer verifies listings through the public release', async () => {
  const calls = [];
  const fetchImpl = async (value) => {
    const url = new URL(value); calls.push(url.href);
    if (url.pathname === '/v0.1/servers') { assert.equal(url.searchParams.get('search'), 'io.github.hraness/yaptake'); return Response.json({ servers: [listing()], metadata: { count: 1 } }); }
    if (url.pathname.startsWith('/v0.1/servers/')) return Response.json(listing());
    if (url.href === `https://api.github.com/repos/hraness/product-skills/releases/tags/${tag}`) return Response.json(release());
    throw new Error(`Unexpected ${value}`);
  };
  const { ledger, report } = await observeMcpRegistry({ schemaVersion: 1, publications: [] }, { fetchImpl, now, product: 'yaptake' });
  assert.equal(report.server, 'io.github.hraness/yaptake'); assert.deepEqual(report.outcomes, [{ version: '0.1.3', status: 'recorded' }]);
  assert.equal(ledger.publications.length, 1); assert(!calls.some((url) => url.includes('npmjs')));
  assert.deepEqual((await observeMcpRegistry(ledger, { fetchImpl, now, product: 'yaptake' })).report.outcomes, [{ version: '0.1.3', status: 'unchanged' }]);
  await assert.rejects(observeMcpRegistry(ledger, { fetchImpl, now, product: 'dawn' }));
});

const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'hraness/product-skills', GITHUB_REPOSITORY_ID: '1458031600', GITHUB_REPOSITORY_OWNER_ID: '307125679', GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: 'hraness/product-skills/.github/workflows/mcp-registry.yml@refs/heads/main', GITHUB_EVENT_NAME: 'workflow_run', GH_TOKEN: 'synthetic-read-token', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/token?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-request-token' };
const jwt = (claims) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const seconds = Math.floor(now() / 1000);
const githubClaims = { iss: 'https://token.actions.githubusercontent.com', aud: 'https://registry.modelcontextprotocol.io', repository: env.GITHUB_REPOSITORY, repository_id: env.GITHUB_REPOSITORY_ID, repository_owner_id: env.GITHUB_REPOSITORY_OWNER_ID, repository_owner: 'hraness', ref: env.GITHUB_REF, sha: env.GITHUB_SHA, workflow_ref: env.GITHUB_WORKFLOW_REF, event_name: env.GITHUB_EVENT_NAME, sub: 'repo:hraness@307125679/product-skills@1458031600:ref:refs/heads/main', exp: seconds + 300 };
const grant = { iss: 'mcp-registry', auth_method: 'github-oidc', auth_method_sub: githubClaims.sub, exp: seconds + 300, permissions: [{ action: 'publish', resource: 'io.github.hraness/*' }] };
async function workspace(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'yaptake-registry-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('synthetic bundle'); const hash = digest(bytes);
  await mkdir(join(root, 'dist')); await mkdir(join(root, 'bundles')); await mkdir(join(root, 'catalog'));
  await writeFile(join(root, 'dist', file), bytes);
  await writeFile(join(root, 'dist/release.json'), JSON.stringify({ schemaVersion: 1, tag, products: [{ id: 'yaptake', version: '0.1.3', mcpb: { file, sha256: hash } }] }));
  await writeFile(join(root, 'bundles/yaptake.json'), JSON.stringify({ manifest: { product: { id: 'yaptake', agentGuideUrl: 'https://yaptake.com/docs/agents' } } }));
  await writeFile(join(root, 'catalog/portfolio.json'), JSON.stringify({ projects: [{ id: 'yaptake', name: 'Yaptake', short: 'Video editor for Mac.' }] }));
  const expected = { ...descriptor, packages: [{ ...descriptor.packages[0], fileSha256: hash }] };
  return { root, hash, expected };
}
function registry({ hash, existing = null, grantClaims = grant, oidc = githubClaims } = {}) {
  const calls = []; let listed = existing;
  const request = async (url, { token, body, allowMissing } = {}) => {
    calls.push({ url, token, body });
    if (url.startsWith('https://pipelines.actions.githubusercontent.com/')) return { value: jwt(oidc) };
    if (url.endsWith('/v0.1/auth/github-oidc')) return { registry_token: jwt(grantClaims), expires_at: grantClaims.exp };
    if (url === 'https://api.github.com/repos/hraness/product-skills') return { id: 1458031600, full_name: 'hraness/product-skills', private: false, default_branch: 'main', owner: { id: 307125679 } };
    if (url.endsWith('/git/ref/heads/main')) return { object: { sha: env.GITHUB_SHA } };
    if (url.includes('/check-runs')) return { check_runs: [{ id: 1, name: 'Required', head_sha: env.GITHUB_SHA, app: { id: 15368 }, status: 'completed', conclusion: 'success' }] };
    if (url.endsWith(`/releases/tags/${tag}`)) return release({ assets: [{ name: file, digest: `sha256:${hash}`, browser_download_url: identifier }] });
    if (url.includes('/versions/0.1.3')) { assert(allowMissing); return listed; }
    if (url.endsWith('/v0.1/publish')) { listed = listing(body); return {}; }
    throw new Error(`Unexpected ${url}`);
  };
  return { calls, request };
}

test('registry publishing runs only from the canonical workflow on main', () => {
  assert.equal(workflowIdentity(env).event, 'workflow_run');
  for (const changes of [{ GITHUB_REF: 'refs/heads/feature' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REPOSITORY_ID: '1' }, { GITHUB_WORKFLOW_REF: 'hraness/product-skills/.github/workflows/other.yml@refs/heads/main' }, { GITHUB_ACTIONS: undefined }])
    assert.throws(() => workflowIdentity({ ...env, ...changes }), undefined, JSON.stringify(changes));
});

test('the namespace preflight checks every OIDC claim and the granted scope', async () => {
  const identity = workflowIdentity(env);
  assert.equal((await namespacePreflight({ env, identity, request: registry().request, now })).namespace, 'io.github.hraness/*');
  for (const changes of [{ repository: 'other/product-skills' }, { sha: 'b'.repeat(40) }, { aud: 'other' }, { sub: 'repo:hraness/product-skills:ref:refs/heads/main' }, { exp: seconds + 3600 }])
    await assert.rejects(namespacePreflight({ env, identity, request: registry({ oidc: { ...githubClaims, ...changes } }).request, now }), undefined, JSON.stringify(changes));
  await assert.rejects(namespacePreflight({ env, identity, request: registry({ grantClaims: { ...grant, permissions: [{ action: 'publish', resource: 'io.github.*' }] } }).request, now }));
  await assert.rejects(namespacePreflight({ env: { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.com/token' }, identity, request: registry().request, now }));
});

test('the publisher lists the released bundle once and never overwrites a version', async (t) => {
  const { root, hash, expected } = await workspace(t);
  assert.deepEqual(await releasedDescriptor({ root, github: async () => release({ assets: [{ name: file, digest: `sha256:${hash}`, browser_download_url: identifier }] }) }), expected);
  await assert.rejects(releasedDescriptor({ root, github: async () => release() }), /differs from its registry hash/);
  const preflight = registry({ hash });
  assert.equal((await runRegistry({ mode: 'preflight', env, root, request: preflight.request, now })).published, false);
  assert(!preflight.calls.some((call) => call.url.endsWith('/v0.1/publish')));
  const fresh = registry({ hash });
  const published = await runRegistry({ mode: 'publish', env, root, request: fresh.request, now, wait: async () => {} });
  assert.equal(published.status, 'published'); assert.equal(published.publication.identifier, identifier);
  const post = fresh.calls.find((call) => call.url.endsWith('/v0.1/publish')); assert.deepEqual(post.body, expected); assert.match(post.token, /^e30\./);
  assert(!JSON.stringify(published).includes(post.token));
  const earlier = identifier.replace(tag, 'integrations-ffffffffffffffff');
  const again = registry({ hash, existing: listing({ ...expected, packages: [{ ...expected.packages[0], identifier: earlier }] }) });
  const result = await runRegistry({ mode: 'publish', env, root, request: again.request, now });
  assert.equal(result.status, 'already-published'); assert.equal(result.publication.identifier, earlier); assert(!again.calls.some((call) => call.url.endsWith('/v0.1/publish')));
  assert.throws(() => publicationReadback(listing({ ...expected, description: 'Changed.' }), expected), /different metadata/);
  assert.throws(() => publicationReadback(listing({ ...expected, packages: [{ ...expected.packages[0], fileSha256: 'd'.repeat(64) }] }), expected), /different metadata/);
  await assert.rejects(runRegistry({ mode: 'publish', env: { ...env, GITHUB_SHA: 'b'.repeat(40) }, root, request: registry({ hash }).request, now }));
});
