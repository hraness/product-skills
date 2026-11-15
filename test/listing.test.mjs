import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { originalIcon } from './fixtures/listing-icon.mjs';
import { MAX_ICON_BYTES, agentInstallInstructions, fetchListingIcon, listingIconBytes, listingIconPath, listingInterface, portfolioIconURL, validateListingPNG } from '../scripts/listing.mjs';

const project = { id: 'sponge', name: 'Sponge', short: 'Reading and notes.', icon: '/products/sponge/icon.png' };
const response = (body = originalIcon(), extras = {}) => new Response(body, { headers: { 'content-type': 'image/png', etag: '"one"', ...extras } });
const snapshot = async () => fetchListingIcon(project, { fetchImpl: async () => response() });

test('a public listing icon must be a complete square PNG with bounded, verified chunks and pixel data', () => {
  const bytes = originalIcon(); assert.deepEqual(validateListingPNG(bytes), { width: 512, height: 512 });
  for (const invalid of [Buffer.from('not a PNG'), bytes.subarray(0, bytes.length - 1), Buffer.concat([bytes, Buffer.from('extra')]), originalIcon({ size: 511 }), Buffer.alloc(MAX_ICON_BYTES + 1)]) assert.throws(() => validateListingPNG(invalid));
  const damaged = Buffer.from(bytes); damaged[32] ^= 1; assert.throws(() => validateListingPNG(damaged), /identity/);
  const unicodeType = Buffer.from(bytes); unicodeType[12] |= 128; assert.throws(() => validateListingPNG(unicodeType), /identity/);
});
test('only the portfolio public origin can supply a listing icon, without auth, redirects or an unbounded response', async () => {
  const seen = []; const first = await fetchListingIcon(project, { fetchImpl: async (url, options) => { seen.push({ url, options }); return response(); } });
  assert.equal(seen[0].url, 'https://hraness.com/products/sponge/icon.png'); assert.equal(seen[0].options.method, 'GET'); assert.equal(seen[0].options.redirect, 'error');
  assert(!seen[0].options.headers.authorization); assert(!seen[0].options.headers.cookie); assert.equal(seen[0].options.headers.accept, 'image/png');
  for (const changed of [{ ...project, icon: 'https://other.test/icon.png' }, { ...project, icon: '/products/sponge/../private.png' }, { ...project, id: 'other' }]) await assert.rejects(fetchListingIcon(changed, { fetchImpl: async () => { throw new Error('Unexpected request'); } }));
  for (const bad of [() => new Response('', { status: 404 }), () => new Response(originalIcon(), { headers: { 'content-type': 'text/html' } }), () => response(Buffer.alloc(MAX_ICON_BYTES + 1)), () => { const value = response(); Object.defineProperty(value, 'redirected', { value: true }); return value; }]) await assert.rejects(fetchListingIcon(project, { fetchImpl: async () => bad() }));
  assert(listingIconBytes(first, 'sponge').equals(originalIcon()));
});
test('admitted icon bytes and conditional transport retain exact identity without same-byte churn', async () => {
  const first = await snapshot(); assert.equal(first.sha256, createHash('sha256').update(originalIcon()).digest('hex'));
  const same = await fetchListingIcon(project, { previous: first, fetchImpl: async () => response(originalIcon(), { etag: '"different"' }) }); assert.deepEqual(same, first);
  const unchanged = await fetchListingIcon(project, { previous: first, fetchImpl: async (_url, options) => { assert.equal(options.headers['if-none-match'], '"one"'); return new Response(null, { status: 304 }); } }); assert.deepEqual(unchanged, first);
  await assert.rejects(fetchListingIcon(project, { fetchImpl: async () => new Response(null, { status: 304 }) }));
  const changed = await fetchListingIcon(project, { previous: first, fetchImpl: async () => response(originalIcon({ marker: 44 })) }); assert.notEqual(changed.sha256, first.sha256);
  for (const change of [{ url: 'https://another.test/icon.png' }, { bytes: first.bytes + 1 }, { sha256: '0'.repeat(64) }, { base64: first.base64 + '===' }, { etag: 'bad\nheader' }, { private: true }]) assert.throws(() => listingIconBytes({ ...first, ...change }, 'sponge'));
});
test('listing asset paths are closed and runtime requirements describe actual separate prerequisites', () => {
  for (const id of ['dawn', 'yaptake', 'textmock', 'sponge']) { assert(listingIconPath(`plugins/${id}/assets/icon.png`)); assert.equal(portfolioIconURL({ id, icon: `/products/${id}/icon.png` }), `https://hraness.com/products/${id}/icon.png`); }
  for (const path of ['plugins/sponge/assets/private.png', 'plugins/sponge/assets/../icon.png', 'skills/sponge/assets/icon.png', 'plugins/other/assets/icon.png']) assert.equal(listingIconPath(path), false);
  const make = (runtime) => listingInterface({ product: { name: 'A product', description: 'An original product description.', url: 'https://example.test' }, runtime }, { short: 'An original subtitle.' }, true);
  const npm = make({ install: { type: 'npm', package: '@hraness/sponge' }, node: '>=24.20.0' }); assert(npm.longDescription.includes('24.20.0')); assert(npm.longDescription.includes('initialized local library')); assert.equal(npm.logo, './assets/icon.png'); assert.equal(npm.composerIcon, npm.logo); assert.deepEqual(npm.capabilities, []);
  assert(make({ install: { type: 'private-release' }, bun: '>=1.3.14' }).longDescription.includes('Requires access'));
  assert(make({ install: { type: 'app' }, platform: { minimumVersion: '26.0' } }).longDescription.includes('Apple silicon'));
  assert(make({ install: { type: 'web' }, helper: { node: '>=24.0.0' } }).longDescription.includes('share-link helper'));
});
test('each generated install section names its actual product and marketplace without claiming a store listing', () => {
  for (const id of ['dawn', 'yaptake', 'textmock', 'sponge']) {
    const text = agentInstallInstructions(id); assert(text.includes(`codex plugin add ${id}@hraness-products`)); assert(text.includes(`/plugin install ${id} --marketplace hraness/product-skills`)); assert(text.includes('team marketplace administrator')); assert(!text.includes('<owner>')); assert(text.includes('separate from public directory approval'));
  }
  assert.throws(() => agentInstallInstructions('unknown'));
});

const { readFile, mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
const { join } = await import('node:path');
const { tmpdir } = await import('node:os');
const { reconcile, render, packages, renderedPackageFingerprint, writeRendered, checkRendered } = await import('../scripts/distribution.mjs');
const { captureGenerated } = await import('../scripts/refresh.mjs');
const portfolio = JSON.parse(await readFile(new URL('../catalog/portfolio.json', import.meta.url), 'utf8'));
const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
const empty = () => ({ schemaVersion: 1, products: {} });
function syntheticBundle() {
  return { schemaVersion: 1, manifest: { schemaVersion: 1, license: 'MIT', product: { id: 'sponge', name: 'Sponge', url: 'https://sponge.computer', description: 'An original synthetic reading fixture.', agentGuideUrl: 'https://sponge.computer/docs/agents' }, runtime: { command: 'sponge', version: '1.2.3', node: '>=24.20.0', install: { type: 'npm', package: '@hraness/sponge', version: '1.2.3' } }, mcp: { command: 'sponge', args: ['mcp'] } }, files: { LICENSE: license, 'README.md': '# Original fixture\n\nThis synthetic fixture demonstrates a complete selected public integration. Install the local command and initialize an owned library before reading saved material. Use https://sponge.computer for product information and https://sponge.computer/docs/agents for setup. No private source, account or real reading library is part of this original test fixture.\n', 'skills/sponge/SKILL.md': '---\nname: sponge\ndescription: Use an original synthetic reading fixture.\n---\n\nRead https://sponge.computer/docs/agents before choosing a local task.\n' } };
}
function sources({ cached = false, icon = () => response(), bundle = syntheticBundle() } = {}) {
  return async (url) => {
    if (url === 'https://hraness.com/products/sponge/icon.png') return icon();
    if (url.endsWith('/integrations/sponge.json')) return cached ? new Response(null, { status: 304 }) : new Response(JSON.stringify(bundle));
    if (url.endsWith('/docs/agents')) return new Response('Sponge setup guide');
    if (url.startsWith('https://registry.npmjs.org/')) return new Response(JSON.stringify({ name: '@hraness/sponge', version: '1.2.3', bin: { sponge: 'bin/sponge.js' }, engines: { node: '>=24.20.0' }, dist: { integrity: 'sha512-' + Buffer.alloc(64).toString('base64'), tarball: 'https://registry.npmjs.org/@hraness/sponge/-/sponge-1.2.3.tgz' } }));
    throw new Error('Unexpected original fixture request');
  };
}
test('a changed public icon advances only its package once, including legacy and cached-source migration', async () => {
  const initial = await reconcile({ state: empty(), bundles: {}, portfolio, selected: ['sponge'], fetchImpl: sources() });
  assert.equal(initial.outcomes[0].status, 'updated');
  const legacy = structuredClone(initial.state); delete legacy.products.sponge.listingIcon;
  legacy.products.sponge.packageFingerprint = renderedPackageFingerprint('sponge', legacy.products.sponge, initial.bundles.sponge, portfolio);
  assert.throws(() => packages(legacy, render(legacy, initial.bundles, portfolio)), /listing icons/);
  const migrated = await reconcile({ state: legacy, bundles: initial.bundles, portfolio, selected: ['sponge'], fetchImpl: sources({ cached: true }) });
  assert.equal(migrated.state.products.sponge.revision, legacy.products.sponge.revision + 1); assert(migrated.state.products.sponge.listingIcon);
  const changed = await reconcile({ state: migrated.state, bundles: migrated.bundles, portfolio, selected: ['sponge'], fetchImpl: sources({ cached: true, icon: () => response(originalIcon({ marker: 99 })) }) });
  assert.equal(changed.state.products.sponge.revision, migrated.state.products.sponge.revision + 1); assert.equal(changed.state.products.sponge.contentHash, migrated.state.products.sponge.contentHash); assert.equal(changed.state.products.sponge.runtimeVersion, '1.2.3');
  const again = await reconcile({ state: changed.state, bundles: changed.bundles, portfolio, selected: ['sponge'], fetchImpl: sources({ cached: true, icon: () => new Response(null, { status: 304 }) }) });
  assert.deepEqual(again.state, changed.state); assert.equal(again.changed, false);
});
test('failed icon reads preserve the complete prior source and package even when new source text qualifies', async () => {
  const initial = await reconcile({ state: empty(), bundles: {}, portfolio, selected: ['sponge'], fetchImpl: sources() });
  const bundle = syntheticBundle(); bundle.files['README.md'] += '\nA new original source paragraph.\n';
  for (const icon of [() => new Response('', { status: 404 }), () => response(Buffer.from('not a PNG')), () => { throw new Error('Public source is unavailable'); }]) {
    const stopped = await reconcile({ state: initial.state, bundles: initial.bundles, portfolio, selected: ['sponge'], fetchImpl: sources({ bundle, icon }) });
    assert.equal(stopped.outcomes[0].status, 'pending'); assert.deepEqual(stopped.state, initial.state); assert.deepEqual(stopped.bundles, initial.bundles);
  }
});
test('binary generation and refresh allow only a validated icon and compare exact bytes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'listing-binary-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = 'plugins/sponge/assets/icon.png', bytes = originalIcon(); const output = { [path]: bytes };
  await writeRendered(root, output); await checkRendered(root, output);
  assert((await captureGenerated(root, 'products', [path]))[path].equals(bytes));
  await writeFile(join(root, path), originalIcon({ marker: 91 })); await assert.rejects(checkRendered(root, output), /stale/);
  await assert.rejects(writeRendered(root, { [path]: Buffer.from('not a PNG') }));
  await assert.rejects(writeRendered(root, { 'plugins/sponge/private.bin': bytes }), /binary/);
});
