import { appendPublications, compareVersion, digest, MCP_REGISTRY, MCP_REGISTRY_SERVERS, mcpRegistryPublicationId, mcpRegistryPublicationUrl, parseUnique, PRODUCTS, REPOSITORY, validateLedger, version } from './distribution.mjs';

const SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
const OFFICIAL = 'io.modelcontextprotocol.registry/official';
const NPM = 'https://registry.npmjs.org';
const PACKAGE = '@hraness/sponge';
const MAX_PAGES = 20;
const GITHUB_API = 'https://api.github.com/repos/hraness/product-skills';
const BUNDLE_ASSET = /^https:\/\/github\.com\/hraness\/product-skills\/releases\/download\/(integrations-[a-f0-9]{16})\/yaptake-((?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8}))\.mcpb$/;
const need = (condition, message) => { if (!condition) throw new Error(message); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, required, optional = []) {
  need(object(value) && required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => [...required, ...optional].includes(key)), 'Unexpected registry metadata fields');
}
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const registryContentHash = (server) => digest(JSON.stringify(canonical(server)));

function publishedTimestamp(value, now) {
  need(typeof value === 'string' && value.length <= 40, 'Invalid registry publication timestamp');
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  need(parts && Number(parts[1]) >= 1970 && Number(parts[2]) >= 1 && Number(parts[2]) <= 12 && Number(parts[3]) >= 1 && Number(parts[3]) <= new Date(Date.UTC(Number(parts[1]), Number(parts[2]), 0)).getUTCDate() && Number(parts[4]) <= 23 && Number(parts[5]) <= 59 && Number(parts[6]) <= 59, 'Invalid registry publication timestamp');
  const timestamp = Date.parse(value);
  need(Number.isFinite(timestamp) && timestamp <= now(), 'Registry publication time is invalid or in the future'); return new Date(timestamp).toISOString();
}
function prose(value, limit) {
  need(typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim() === value && value.isWellFormed() && !/[\x00-\x1f\x7f]/.test(value), 'Invalid public registry prose');
}
function officialRecord(record, name = MCP_REGISTRY.name) {
  keys(record, ['server', '_meta']); keys(record._meta, [OFFICIAL]);
  const official = record._meta[OFFICIAL];
  keys(official, ['status', 'statusChangedAt', 'publishedAt', 'isLatest'], ['updatedAt', 'statusMessage']);
  need(['active', 'deprecated', 'deleted'].includes(official.status) && typeof official.isLatest === 'boolean', 'Invalid official registry status');
  need(typeof official.statusChangedAt === 'string' && official.statusChangedAt.length <= 40 && Number.isFinite(Date.parse(official.statusChangedAt)) && (official.updatedAt === undefined || typeof official.updatedAt === 'string' && official.updatedAt.length <= 40 && Number.isFinite(Date.parse(official.updatedAt))) && (official.statusMessage === undefined || typeof official.statusMessage === 'string'), 'Invalid official registry metadata');
  need(object(record.server) && record.server.name === name, 'Unexpected registry server identity'); version(record.server.version);
  return official;
}
function activeIdentity(record, now) {
  const official = officialRecord(record); need(official.status === 'active', 'Registry version is not active');
  const server = record.server;
  keys(server, ['$schema', 'name', 'title', 'description', 'version', 'websiteUrl', 'packages']);
  need(server.$schema === SCHEMA && server.title === PRODUCTS.sponge.name, 'Unexpected registry schema or product name'); prose(server.description, 100);
  need(Array.isArray(server.packages) && server.packages.length === 1, 'Registry entry must contain only the local npm package');
  const pkg = server.packages[0]; keys(pkg, ['registryType', 'registryBaseUrl', 'identifier', 'version', 'runtimeHint', 'transport', 'packageArguments']);
  need(pkg.registryType === 'npm' && pkg.registryBaseUrl === NPM && pkg.identifier === PACKAGE && pkg.version === server.version && pkg.runtimeHint === 'npx', 'Registry package or version differs');
  keys(pkg.transport, ['type']); need(pkg.transport.type === 'stdio', 'Only the local stdio server may be recorded');
  need(Array.isArray(pkg.packageArguments) && pkg.packageArguments.length > 0 && pkg.packageArguments.length <= 8, 'Invalid registry package arguments');
  for (const argument of pkg.packageArguments) { keys(argument, ['type', 'value']); need(argument.type === 'positional' && typeof argument.value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(argument.value), 'Invalid registry package arguments'); }
  return { id: mcpRegistryPublicationId(server.version), product: MCP_REGISTRY.product, channel: 'mcp-registry', publishedAt: publishedTimestamp(official.publishedAt, now), url: mcpRegistryPublicationUrl(server.version), version: server.version, contentHash: registryContentHash(server) };
}

export function registryPublication(record, published, { now = Date.now } = {}) {
  const entry = activeIdentity(record, now); const server = record.server;
  need(object(published) && published.name === PACKAGE && published.version === entry.version && published.mcpName === MCP_REGISTRY.name && published.homepage === PRODUCTS.sponge.url && published.bin?.sponge === 'bin/sponge.js' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(published.dist?.integrity ?? ''), 'Exact public npm release identity differs');
  const mcp = published.mcp; keys(mcp, ['command', 'args', 'guideUrl']);
  need(mcp.command === 'sponge' && Array.isArray(mcp.args) && mcp.args.length === 1 && mcp.args[0] === 'mcp', 'Published npm MCP command differs');
  need(typeof mcp.guideUrl === 'string' && mcp.guideUrl.length <= 200, 'Published npm MCP guide is missing');
  const guide = new URL(mcp.guideUrl);
  need(guide.origin === PRODUCTS.sponge.url && !guide.username && !guide.password && !guide.port && !guide.search && !guide.hash && /^\/docs\/[a-z][a-z0-9-]*$/.test(guide.pathname) && guide.href === mcp.guideUrl, 'Published npm MCP guide is not a public product document');
  need(server.websiteUrl === mcp.guideUrl && server.packages[0].packageArguments.length === mcp.args.length && server.packages[0].packageArguments.every((argument, index) => argument.value === mcp.args[index]), 'Registry command or guide differs from its exact npm release');
  return entry;
}

// Yaptake's listing names one MCP bundle in an immutable release of this
// repository. The release readback must show that exact file and SHA-256.
function bundleIdentity(record, now) {
  const official = officialRecord(record, MCP_REGISTRY_SERVERS.yaptake); need(official.status === 'active', 'Registry version is not active');
  const server = record.server;
  keys(server, ['$schema', 'name', 'title', 'description', 'version', 'websiteUrl', 'packages']);
  need(server.$schema === SCHEMA && server.title === PRODUCTS.yaptake.name, 'Unexpected registry schema or product name'); prose(server.description, 100);
  need(server.websiteUrl === `${PRODUCTS.yaptake.url}/docs/agents`, 'Registry guide is not the public Yaptake agent guide');
  need(Array.isArray(server.packages) && server.packages.length === 1, 'Registry entry must contain only the MCP bundle');
  const pkg = server.packages[0]; keys(pkg, ['registryType', 'identifier', 'fileSha256', 'transport']);
  const asset = typeof pkg.identifier === 'string' ? BUNDLE_ASSET.exec(pkg.identifier) : null;
  need(pkg.registryType === 'mcpb' && asset && asset[2] === server.version && /^[a-f0-9]{64}$/.test(pkg.fileSha256 ?? ''), 'Registry bundle address, version or hash differs');
  keys(pkg.transport, ['type']); need(pkg.transport.type === 'stdio', 'Only the local stdio server may be recorded');
  return { entry: { id: mcpRegistryPublicationId(server.version, 'yaptake'), product: 'yaptake', channel: 'mcp-registry', publishedAt: publishedTimestamp(official.publishedAt, now), url: mcpRegistryPublicationUrl(server.version, 'yaptake'), version: server.version, contentHash: registryContentHash(server) }, tag: asset[1], file: `yaptake-${server.version}.mcpb`, sha256: pkg.fileSha256 };
}
export function bundlePublication(record, release, { now = Date.now } = {}) {
  const listed = bundleIdentity(record, now);
  need(object(release) && release.tag_name === listed.tag && release.draft === false && release.prerelease === false && release.immutable === true && release.html_url === `${REPOSITORY}/releases/tag/${listed.tag}` && Array.isArray(release.assets), 'The MCP bundle release is not an immutable public publication');
  const assets = release.assets.filter((asset) => asset?.name === listed.file);
  need(assets.length === 1 && assets[0].digest === `sha256:${listed.sha256}` && assets[0].browser_download_url === record.server.packages[0].identifier, 'The released MCP bundle differs from its registry hash');
  return listed.entry;
}
async function publicJson(url, { fetchImpl, limit = 512 * 1024 }) {
  const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
  if (!response.ok || response.redirected) { await response.body?.cancel().catch(() => {}); throw new Error(`Public registry observation dependency returned HTTP ${response.status}`); }
  need(response.body, 'Public registry observation response has no body');
  const chunks = []; let length = 0;
  try { for await (const chunk of response.body) { length += chunk.length; need(length <= limit, 'Public registry response exceeds its byte limit'); chunks.push(Buffer.from(chunk)); } }
  catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
  return parseUnique(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function observeMcpRegistry(ledger, { fetchImpl = fetch, now = Date.now, product = MCP_REGISTRY.product } = {}) {
  need(Object.hasOwn(MCP_REGISTRY_SERVERS, product), 'Unknown MCP Registry server'); const name = MCP_REGISTRY_SERVERS[product];
  validateLedger(ledger); const records = [], versions = new Set(), cursors = new Set(); let cursor = null, pages = 0, complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${MCP_REGISTRY.origin}/v0.1/servers`); url.searchParams.set('search', name); url.searchParams.set('limit', '100'); url.searchParams.set('include_deleted', 'true');
    if (cursor) url.searchParams.set('cursor', cursor);
    const result = await publicJson(url.href, { fetchImpl }); keys(result, ['servers', 'metadata']); keys(result.metadata, ['count'], ['nextCursor']);
    const servers = result.servers === null && result.metadata.count === 0 ? [] : result.servers;
    need(Array.isArray(servers) && servers.length <= 100 && result.metadata.count === servers.length, 'Invalid registry page inventory'); pages++;
    for (const record of servers) {
      need(object(record) && object(record.server) && typeof record.server.name === 'string', 'Invalid registry search record');
      if (record.server.name !== name) continue;
      officialRecord(record, name); need(!versions.has(record.server.version), 'Duplicate registry version in pagination'); versions.add(record.server.version); records.push(record);
    }
    const next = result.metadata.nextCursor;
    if (next === undefined || next === '') { complete = true; break; }
    need(typeof next === 'string' && next.length <= 1024 && !/[\x00-\x1f\x7f]/.test(next) && !cursors.has(next), 'Invalid or repeated registry pagination cursor'); cursors.add(next); cursor = next;
  }
  need(complete, 'Registry pagination exceeds its reviewed read bound');
  records.sort((left, right) => compareVersion(left.server.version, right.server.version));
  const entries = [], outcomes = [];
  for (const record of records) {
    const value = record.server.version; const official = officialRecord(record, name);
    if (official.status !== 'active') { outcomes.push({ version: value, status: 'inactive' }); continue; }
    const listed = product === 'yaptake' ? bundleIdentity(record, now).entry : activeIdentity(record, now); const previous = ledger.publications.find((entry) => entry.id === listed.id);
    if (previous) { appendPublications({ schemaVersion: 1, publications: [previous] }, [listed]); outcomes.push({ version: value, status: 'unchanged' }); continue; }
    const exact = await publicJson(`${mcpRegistryPublicationUrl(value, product)}?include_deleted=true`, { fetchImpl });
    let entry;
    if (product === 'yaptake') { const { tag } = bundleIdentity(exact, now); entry = bundlePublication(exact, await publicJson(`${GITHUB_API}/releases/tags/${tag}`, { fetchImpl, limit: 256 * 1024 }), { now }); }
    else entry = registryPublication(exact, await publicJson(`${NPM}/@hraness%2fsponge/${value}`, { fetchImpl, limit: 128 * 1024 }), { now });
    appendPublications({ schemaVersion: 1, publications: [listed] }, [entry]); entries.push(entry); outcomes.push({ version: value, status: 'recorded' });
  }
  // Every page, exact listing and npm fact verifies before the caller can write.
  const updated = appendPublications(ledger, entries);
  return { ledger: updated, report: { schemaVersion: 1, source: 'official-mcp-registry', server: name, status: records.length ? 'observed' : 'not_listed', pages, outcomes } };
}
