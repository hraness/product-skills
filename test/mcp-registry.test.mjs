import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendPublications, checkLedgerAppendOnly, main, MCP_REGISTRY, mcpRegistryPublicationId, mcpRegistryPublicationUrl, validateLedger } from '../scripts/distribution.mjs';
import { observeMcpRegistry, registryContentHash, registryPublication } from '../scripts/mcp-registry.mjs';
import { mergePendingPublications } from '../scripts/refresh.mjs';

const now = () => Date.parse('2026-11-15T20:00:00Z');
const empty = () => ({ schemaVersion: 1, publications: [] });
const json = (value, init) => new Response(JSON.stringify(value), init);
function npm(value = '0.41.1', guide = 'mcp') {
  return { name: '@hraness/sponge', version: value, mcpName: MCP_REGISTRY.name, homepage: 'https://sponge.computer', bin: { sponge: 'bin/sponge.js' }, dist: { integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}` }, mcp: { command: 'sponge', args: ['mcp'], guideUrl: `https://sponge.computer/docs/${guide}` } };
}
function record(value = '0.41.1', guide = 'mcp') {
  return { server: { $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json', name: MCP_REGISTRY.name, title: 'Sponge', description: 'Local tools for the Sponge reading library.', version: value, websiteUrl: `https://sponge.computer/docs/${guide}`, packages: [{ registryType: 'npm', registryBaseUrl: 'https://registry.npmjs.org', identifier: '@hraness/sponge', version: value, runtimeHint: 'npx', transport: { type: 'stdio' }, packageArguments: [{ type: 'positional', value: 'mcp' }] }] }, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', statusChangedAt: '2026-11-14T20:00:00Z', publishedAt: '2026-11-14T20:00:00.123456Z', isLatest: true } } };
}
function server(records = [record()], { pages = null, exact = new Map(), packages = new Map(), fail = null } = {}) {
  const calls = []; const inventory = pages ?? [records];
  const fetchImpl = async (value, options) => {
    const url = new URL(value); calls.push({ url: value, options });
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.headers.authorization, undefined); assert.equal(options.headers.Authorization, undefined); assert.equal(options.body, undefined);
    if (fail?.(url)) return json({ message: 'Synthetic public dependency failure' }, { status: 503 });
    if (url.origin === MCP_REGISTRY.origin && url.pathname === '/v0.1/servers') {
      if (url.searchParams.get('search') === 'io.github.hraness/yaptake') return json({ servers: [], metadata: { count: 0 } });
      assert.equal(url.searchParams.get('search'), MCP_REGISTRY.name); assert.equal(url.searchParams.get('limit'), '100'); assert.equal(url.searchParams.get('include_deleted'), 'true');
      const page = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor').split(':')[1]) : 0;
      const rows = inventory[page] ?? [];
      return json({ servers: rows, metadata: { count: rows.length, ...(page + 1 < inventory.length ? { nextCursor: `page:${page + 1}` } : {}) } });
    }
    const version = url.pathname.split('/').at(-1);
    if (url.origin === MCP_REGISTRY.origin) { assert.equal(url.searchParams.get('include_deleted'), 'true'); const found = exact.get(version) ?? records.find((entry) => entry.server.version === version); return found ? json(found) : json({}, { status: 404 }); }
    if (url.origin === 'https://registry.npmjs.org') { assert.equal(url.pathname, `/@hraness%2fsponge/${version}`); return json(packages.get(version) ?? npm(version)); }
    throw new Error('Unexpected public observation destination');
  };
  return { fetchImpl, calls, now };
}

test('actual registry records use the exact npm version, declared transport and version-specific guide', () => {
  const actual = record(); const entry = registryPublication(actual, npm(), { now });
  assert.equal(entry.id, 'sponge-mcp-registry-0-41-1'); assert.equal(entry.channel, 'mcp-registry'); assert.equal(entry.publishedAt, '2026-11-14T20:00:00.123Z');
  assert.equal(entry.url, mcpRegistryPublicationUrl('0.41.1')); assert.match(entry.contentHash, /^[a-f0-9]{64}$/);
  const later = registryPublication(record('8.9.10', 'agent-tools'), npm('8.9.10', 'agent-tools'), { now }); assert.equal(later.version, '8.9.10');
  const reordered = structuredClone(actual); reordered.server = Object.fromEntries(Object.entries(reordered.server).reverse()); reordered.server.packages[0].packageArguments = [{ value: 'mcp', type: 'positional' }];
  assert.deepEqual(registryPublication(reordered, npm(), { now }), entry);
  assert.notEqual(registryContentHash(record('0.41.1', 'agent-tools').server), entry.contentHash);
});

test('registry ledger IDs and URLs have one fixed product, server and version', () => {
  const entry = registryPublication(record(), npm(), { now }); assert.doesNotThrow(() => validateLedger({ schemaVersion: 1, publications: [entry] }));
  for (const change of [{ product: 'dawn' }, { id: `${entry.id}-another` }, { version: '0.41.2' }, { url: `${entry.url}?include_deleted=true` }, { url: `${entry.url}#listing` }, { url: entry.url.replace('%2F', '%252F') }, { url: entry.url.replace('io.github.hraness%2Fsponge', 'io.github.someone%2Fsponge') }, { channel: 'registry-submitted' }, { status: 'planned' }]) assert.throws(() => validateLedger({ schemaVersion: 1, publications: [{ ...entry, ...change }] }));
  assert.throws(() => mcpRegistryPublicationId('latest')); assert.throws(() => mcpRegistryPublicationUrl('0.41.1-beta'));
});

test('a complete public observation appends once and survives later mutable registry metadata', async () => {
  const current = server(); const result = await observeMcpRegistry(empty(), current);
  assert.equal(result.ledger.publications.length, 1); assert.equal(result.report.outcomes[0].status, 'recorded'); assert.equal(current.calls.length, 3);
  assert.doesNotThrow(() => checkLedgerAppendOnly(empty(), result.ledger));
  const changed = record(); changed._meta['io.modelcontextprotocol.registry/official'].isLatest = false; changed._meta['io.modelcontextprotocol.registry/official'].updatedAt = '2026-11-15T19:00:00Z';
  const repeated = server([changed]); const again = await observeMcpRegistry(result.ledger, repeated);
  assert.deepEqual(again.ledger, result.ledger); assert.equal(again.report.outcomes[0].status, 'unchanged'); assert.equal(repeated.calls.length, 1);
});

test('absent, deprecated and deleted listings create no publication and preserve earlier history', async () => {
  const initial = await observeMcpRegistry(empty(), server([])); assert.equal(initial.report.status, 'not_listed'); assert.deepEqual(initial.ledger, empty());
  for (const status of ['deprecated', 'deleted']) {
    const inactive = record(); inactive._meta['io.modelcontextprotocol.registry/official'].status = status;
    const current = server([inactive]); const none = await observeMcpRegistry(empty(), current); assert.deepEqual(none.ledger, empty()); assert.equal(current.calls.length, 1);
    const previous = appendPublications(empty(), [registryPublication(record(), npm(), { now })]);
    assert.deepEqual((await observeMcpRegistry(previous, server([inactive]))).ledger, previous);
  }
});

test('divergent package, command, transport, guide, schema and publication times cannot enter the ledger', () => {
  for (const change of [
    (entry) => { entry.server.packages[0].identifier = '@someone/sponge'; },
    (entry) => { entry.server.packages[0].version = '0.41.2'; },
    (entry) => { entry.server.packages[0].transport = { type: 'streamable-http', url: 'https://elsewhere.test' }; },
    (entry) => { entry.server.packages[0].packageArguments[0].value = 'save'; },
    (entry) => { entry.server.websiteUrl = 'https://sponge.computer/docs/another-guide'; },
    (entry) => { entry.server.repository = { url: 'https://github.com/hraness/sponge' }; },
    (entry) => { entry.server.$schema = 'https://elsewhere.test/schema'; },
    (entry) => { entry._meta['io.modelcontextprotocol.registry/official'].publishedAt = '2099-01-01T00:00:00Z'; },
    (entry) => { entry._meta['io.modelcontextprotocol.registry/official'].publishedAt = '2026-02-31T00:00:00Z'; },
    (entry) => { entry._meta['io.modelcontextprotocol.registry/official'].statusChangedAt = {}; },
  ]) { const changed = record(); change(changed); assert.throws(() => registryPublication(changed, npm(), { now })); }
  for (const change of [{ mcpName: 'io.github.someone/sponge' }, { version: '0.41.2' }, { mcp: { ...npm().mcp, guideUrl: 'https://sponge.computer/account' } }, { mcp: { ...npm().mcp, guideUrl: 'https://sponge.computer/docs/mcp?secret=1' } }, { mcp: { ...npm().mcp, args: ['save'] } }, { dist: { integrity: 'unknown' } }]) assert.throws(() => registryPublication(record(), { ...npm(), ...change }, { now }));
});

test('pagination is complete before publication, bounded and independent of neighboring names', async () => {
  const older = record('0.41.1'), newer = record('0.42.0'); const neighbor = record(); neighbor.server.name = 'io.github.hraness/sponge-example';
  const current = server([older, newer], { pages: [[neighbor, newer], [older]] }); const result = await observeMcpRegistry(empty(), current);
  assert.deepEqual(result.ledger.publications.map((entry) => entry.version), ['0.41.1', '0.42.0']); assert.equal(result.report.pages, 2);
  assert.equal(current.calls.slice(0, 2).every((call) => new URL(call.url).pathname === '/v0.1/servers'), true);
  await assert.rejects(observeMcpRegistry(empty(), server([older], { pages: [[older], [older]] })), /Duplicate/);
  let calls = 0;
  await assert.rejects(observeMcpRegistry(empty(), { now, fetchImpl: async () => { calls++; return json({ servers: [], metadata: { count: 0, nextCursor: `page:${calls}` } }); } }), /read bound/); assert.equal(calls, 20);
  await assert.rejects(observeMcpRegistry(empty(), { now, fetchImpl: async () => json({ servers: [], metadata: { count: 0, nextCursor: 'repeated' } }) }), /repeated/);
});

test('dependency failures, redirect responses, incomplete inventories and malformed JSON preserve the input ledger', async () => {
  const previous = appendPublications(empty(), [registryPublication(record('0.40.0'), npm('0.40.0'), { now })]); const saved = structuredClone(previous);
  for (const target of ['registry.modelcontextprotocol.io', 'registry.npmjs.org']) {
    const current = server([record()], { fail: (url) => url.hostname === target }); await assert.rejects(observeMcpRegistry(previous, current), /503/); assert.deepEqual(previous, saved);
  }
  for (const response of [() => json({}, { status: 302, headers: { location: 'https://elsewhere.test' } }), () => new Response('{"servers":[],"servers":[],"metadata":{"count":0}}'), () => json({ servers: [], metadata: { count: 1 } }), () => new Response('x'.repeat(512 * 1024 + 1))]) {
    await assert.rejects(observeMcpRegistry(previous, { now, fetchImpl: async () => response() })); assert.deepEqual(previous, saved);
  }
});

test('registry identity and timestamps cannot overwrite a committed or pending publication', async () => {
  const entry = registryPublication(record(), npm(), { now });
  for (const changed of [{ ...entry, contentHash: 'f'.repeat(64) }, { ...entry, publishedAt: '2026-11-14T19:00:00.000Z' }]) {
    const previous = appendPublications(empty(), [changed]); await assert.rejects(observeMcpRegistry(previous, server()), /overwritten/);
    assert.throws(() => mergePendingPublications(previous, { schemaVersion: 1, publications: [entry] }, empty()), /artifact identity|changed or removed/);
  }
  const changed = record(); changed.server.description = 'A changed public registry description.';
  await assert.rejects(observeMcpRegistry(empty(), server([record()], { exact: new Map([['0.41.1', changed]]) })), /overwritten/);
});

test('the collection command persists actual publications with zero admitted plugins and preserves them on failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'public-registry-ledger-')); const previousFetch = globalThis.fetch;
  try {
    await mkdir(join(root, 'catalog'));
    await writeFile(join(root, 'catalog/admitted.json'), JSON.stringify({ schemaVersion: 1, products: {} }));
    await writeFile(join(root, 'catalog/portfolio.json'), await readFile(new URL('../catalog/portfolio.json', import.meta.url)));
    await writeFile(join(root, 'catalog/directory-observations.json'), JSON.stringify({ schemaVersion: 1, scope: 'listing-presence', observations: [] }));
    await writeFile(join(root, 'publication-ledger.json'), `${JSON.stringify(empty(), null, 2)}\n`);
    globalThis.fetch = server().fetchImpl; await main(['record-registry'], root);
    const recorded = await readFile(join(root, 'publication-ledger.json'), 'utf8');
    assert.equal(JSON.parse(recorded).publications.length, 1);
    const generated = await readFile(join(root, 'README.md'), 'utf8');
    globalThis.fetch = async () => json({}, { status: 503 }); await assert.rejects(main(['record-registry'], root), /503/);
    assert.equal(await readFile(join(root, 'publication-ledger.json'), 'utf8'), recorded);
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), generated);
    assert.equal(JSON.parse(await readFile(join(root, 'dist/registry-observation.json'), 'utf8')).status, 'pending');
  } finally { globalThis.fetch = previousFetch; await rm(root, { recursive: true, force: true }); }
});
