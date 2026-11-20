import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PRODUCTS, appendPublications, checkLedgerAppendOnly, checkPackageFingerprints, clawhubPublicationId, clawhubPublicationUrl, digest, download, packages, parseUnique, reconcile as reconcileSources, recordGithub, render, renderedPackageFingerprint, validateBundle, validateLedger, validatePortfolio, verifyApp, zip } from '../scripts/distribution.mjs';
import { withOriginalIcon } from './fixtures/listing-icon.mjs';
const reconcile = (options) => reconcileSources({ ...options, fetchImpl: withOriginalIcon(options.fetchImpl ?? fetch) });


const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
// The four products' facts. The committed catalog may also list profile-only entries.
const catalogPortfolio = JSON.parse(await readFile(new URL('../catalog/portfolio.json', import.meta.url), 'utf8'));
const portfolio = { ...catalogPortfolio, projects: catalogPortfolio.projects.filter((p) => Object.hasOwn(PRODUCTS, p.id)) };
const withYiii = (facts) => ({ ...facts, projects: [...structuredClone(facts.projects), { id: 'yiii', name: 'yiii', url: 'https://yiii.io', short: 'Learn languages faster (ZH + EN).', icon: '/products/yiii/icon.png' }] });
const empty = () => ({ schemaVersion: 1, products: {} });
const json = (value, options) => new Response(JSON.stringify(value), options);
function bundle(id = 'sponge', revision = 1) {
  const p = portfolio.projects.find((p) => p.id === id);
  const runtime = id === 'dawn' ? { command: 'dawn', version: '0.1.0', bun: '>=1.3.14', install: { type: 'private-release', url: 'https://dawnav.com/install', requiresAccess: true } } : id === 'textmock' ? { command: 'textmock-link', version: '1.0.0', versionScope: 'helper', install: { type: 'web', url: 'https://textmock.com' }, helper: { path: 'scripts/textmock-link.mjs', node: '>=24.0.0' } } : null;
  const extras = id === 'dawn' ? { 'skills/dawn/examples/morning-study.ts': '// An original synthetic score fixture.\nexport const title = \"Morning study\";\n' } : id === 'textmock' ? { 'scripts/textmock-link.mjs': '// A synthetic encoder fixture, not the product implementation.\nexport const version = \"1.0.0\";\n' } : {};
  return { schemaVersion: 1, manifest: { schemaVersion: 1, product: { id, name: p.name, url: p.url, description: p.short, agentGuideUrl: `${p.url}/docs/agents` }, runtime: runtime ?? (id === 'yaptake' ? { command: id, version: '0.1.0', build: '8', install: { type: 'app', url: p.url }, platform: { os: 'macos', architecture: 'arm64', minimumVersion: '26.0' } } : { command: id, version: '0.1.0', install: { type: 'npm', package: `@hraness/${id}`, version: '0.1.0' }, node: '>=24.20.0' }), ...(['sponge', 'yaptake'].includes(id) ? { mcp: { command: id, args: ['mcp'] } } : {}), license: 'MIT' }, files: { ...extras, [`skills/${id}/SKILL.md`]: `---\nname: ${id}\ndescription: Use ${p.name} for a local product task.\n---\n\nRead the [agent guide](${p.url}/docs/agents). This synthetic fixture is revision ${revision}.\n`, LICENSE: license, 'README.md': `# ${p.name}\n\nThis is a synthetic package fixture for tests. Install the local product from [its site](${p.url}), then read the [agent guide](${p.url}/docs/agents) to choose a project, inspect its current state, complete the requested task and verify its result. The fixture does not claim a published product release.\n` } };
}
function app() {
  const b = bundle('yaptake'); const sha = 'a'.repeat(64); const signature = `${'A'.repeat(86)}==`; const url = `https://yaptake.com/downloads/${sha}/Yaptake-0.1.0.zip`;
  const release = { schemaVersion: 1, release: { version: '0.1.0', architecture: 'arm64', minimumMacOS: '26.0', sha256: sha, url, notarization: { status: 'Accepted', stapleValidated: true, gatekeeperAccepted: true }, sparkle: { length: 12345, edSignature: signature } } };
  const feed = `<rss><channel><item><sparkle:version>8</sparkle:version><sparkle:shortVersionString>0.1.0</sparkle:shortVersionString><sparkle:minimumSystemVersion>26.0</sparkle:minimumSystemVersion><sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements><enclosure url="${url}" length="12345" sparkle:edSignature="${signature}"/></item></channel></rss>`;
  return { b, release, feed };
}
function server(b = bundle(), { unpublished = false, mismatched = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/integrations/sponge.json')) return json(b, { headers: { etag: '"source-1"' } });
    if (url.endsWith('/docs/agents')) return new Response(`<h1>${b.manifest.product.name} agent guide</h1>`);
    if (url.startsWith('https://registry.npmjs.org/')) return unpublished ? json({}, { status: 404 }) : json({ name: '@hraness/sponge', version: mismatched ? '0.0.1' : b.manifest.runtime.version, engines: { node: '>=24.20.0' }, bin: { sponge: 'bin/sponge.js' }, dist: { integrity: `sha512-${Buffer.alloc(64).toString('base64')}`, tarball: 'https://registry.npmjs.org/@hraness/sponge/-/sponge-0.1.0.tgz' } });
    throw new Error('Unexpected test network request');
  };
  return { fetchImpl, calls };
}

test('bounded bundle parsing rejects duplicate fields and malformed JSON', () => {
  assert.deepEqual(parseUnique('{"a":[{"b":1},true,null]}'), { a: [{ b: 1 }, true, null] });
  for (const raw of ['{"a":1,"a":2}', '{"a":{"x":1,"x":2}}', '[1,]', '{"a":1} trailing', '{"a":']) assert.throws(() => parseUnique(raw));
  assert.throws(() => validateBundle(' '.repeat(65537), 'sponge'));
});
test('manifest identity, exact versions, executable and source paths are closed', () => {
  assert.doesNotThrow(() => validateBundle(bundle(), 'sponge'));
  const prose = bundle(); prose.files['skills/sponge/SKILL.md'] += '\nApply the same file:\n'; assert.doesNotThrow(() => validateBundle(prose, 'sponge'));
  for (const mutate of [
    (b) => { b.manifest.product.url = 'https://sponge.computer.evil.test'; },
    (b) => { b.manifest.product.agentGuideUrl = 'https://sponge.computer/library/private'; },
    (b) => { b.manifest.runtime.version = 'latest'; },
    (b) => { b.manifest.runtime.install.version = '0.0.1'; },
    (b) => { b.manifest.mcp.args.push('--unsafe'); },
    (b) => { b.files['../secret'] = 'private'; },
    (b) => { b.files['skills/sponge/run.sh'] = 'echo secret'; },
    (b) => { b.files['skills/sponge/SKILL.md'] += '\n/Users/person/private.txt'; },
    (b) => { b.files['README.md'] += '\nhttps://github.com/hraness/sponge/tree/main'; },
    (b) => { b.files['README.md'] += '\nhttp://127.0.0.1:1234/token'; },
    (b) => { b.files['README.md'] += '\nhttps://sponge.computer/%40person'; },
    (b) => { b.files['README.md'] += '\nfile:///etc/private'; },
  ]) { const b = bundle(); mutate(b); assert.throws(() => validateBundle(b, 'sponge')); }
});
test('portfolio facts require each exact product identity once', () => {
  assert.doesNotThrow(() => validatePortfolio(portfolio)); assert.doesNotThrow(() => validatePortfolio(catalogPortfolio));
  const p = structuredClone(portfolio); p.projects[0].url = 'https://wrong.test'; assert.throws(() => validatePortfolio(p));
});
test('a product name is the portfolio\'s own, so a rename needs no change here', () => {
  // hraness.com spelled it Dawn until DAWN's own manifest reached the portfolio; both are accepted.
  for (const name of ['Dawn', 'DAWN']) {
    const q = structuredClone(withYiii(portfolio)); q.projects.find((p) => p.id === 'dawn').name = name;
    assert.doesNotThrow(() => validatePortfolio(q), name);
  }
  for (const name of ['', ' DAWN', 'DAWN\nnext', 'DAWN\tnext', 'x'.repeat(81), 'DAWN](https://example.test)', '<b>DAWN</b>', 'DAWN | Sponge', 'DAWN_', '/Users/person/DAWN', 'Get DAWN at https://example.test']) {
    const q = structuredClone(portfolio); q.projects.find((p) => p.id === 'dawn').name = name;
    assert.throws(() => validatePortfolio(q), undefined, JSON.stringify(name));
  }
  const b = bundle('dawn'); b.manifest.product.name = 'DAWN'; assert.doesNotThrow(() => validateBundle(b, 'dawn'));
  b.manifest.product.name = 'DAWN\nnext'; assert.throws(() => validateBundle(b, 'dawn'));
});
test('the public aicharts explorer is a known portfolio destination', () => {
  const existing = withYiii(portfolio);
  const chart = { id: 'aicharts', name: 'aicharts', url: 'https://aicharts.io', short: 'Compare coding models.', icon: '/products/aicharts/icon.png' };
  assert.doesNotThrow(() => validatePortfolio({ ...existing, projects: [...existing.projects, chart] }));
  assert.throws(() => validatePortfolio({ ...existing, projects: [...existing.projects, { ...chart, url: 'https://other.example' }] }));
});

test('OH is an admitted product entry with its exact address, listed below DAWN', () => {
  const listed = withYiii(portfolio);
  assert.equal(listed.projects[1].id, 'oh');
  assert.doesNotThrow(() => validatePortfolio(listed));
  for (const mutate of [
    (q) => { q.projects[1].url = 'https://oh.example'; },
    (q) => { q.projects[1].url = 'https://www.oh.computer'; },
    (q) => { q.projects[1].icon = '/products/oh/icon.svg'; },
    (q) => { q.projects.push(structuredClone(q.projects[1])); },
  ]) { const q = structuredClone(listed); mutate(q); assert.throws(() => validatePortfolio(q)); }
});
test('a profile-only portfolio entry needs its exact identity and changes no package', async () => {
  const listed = withYiii(portfolio); assert.doesNotThrow(() => validatePortfolio(listed));
  for (const mutate of [
    (q) => { q.projects.at(-1).url = 'https://yiii.example'; },
    (q) => { q.projects.at(-1).name = 'yiii\nnext'; },
    (q) => { q.projects.at(-1).icon = '/products/yiii/icon.svg'; },
    (q) => { Object.assign(q.projects.at(-1), { id: 'lunar', icon: '/products/lunar/icon.png' }); },
    (q) => { q.projects.push(structuredClone(q.projects.at(-1))); },
    (q) => { q.projects.shift(); },
    (q) => { q.projects.at(-1).short = 'Practice at https://example.test/'; },
    (q) => { q.projects.at(-1).short = 'Export at https://yiii.io/api/export'; },
    (q) => { q.projects[q.projects.length - 1] = { ...q.projects[0], id: [q.projects[0].id] }; },
  ]) { const q = structuredClone(listed); mutate(q); assert.throws(() => validatePortfolio(q)); }
  { const q = structuredClone(listed); q.projects.at(-1).short = 'Practice at https://yiii.io/'; assert.doesNotThrow(() => validatePortfolio(q)); }
  { const q = structuredClone(listed); q.projects.at(-1).name = 'Yiii'; assert.doesNotThrow(() => validatePortfolio(q)); }
  const first = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['sponge'], ...server() });
  const again = await reconcile({ portfolio: listed, state: first.state, bundles: first.bundles, selected: ['sponge'], fetchImpl: async () => new Response(null, { status: 304 }) });
  assert.deepEqual(again.state, first.state);
  assert.deepEqual(render(first.state, first.bundles, listed), render(first.state, first.bundles, portfolio));
});
test('an empty admitted catalog needs no fingerprint migration or product version', () => {
  assert.doesNotThrow(() => checkPackageFingerprints(empty(), {}, portfolio));
  const plan = packages(empty(), render(empty(), {}, portfolio));
  assert.deepEqual(plan.products, []); assert.equal(plan.artifacts.SHA256SUMS.length, 0);
});
test('an unpublished or mismatched exact npm version preserves the working package', async () => {
  const first = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['sponge'], ...server() });
  assert.equal(first.outcomes[0].status, 'updated');
  const next = bundle('sponge', 2); next.manifest.runtime.version = '0.2.0'; next.manifest.runtime.install.version = '0.2.0';
  for (const option of [{ unpublished: true }, { mismatched: true }]) {
    const result = await reconcile({ portfolio, state: first.state, bundles: first.bundles, selected: ['sponge'], ...server(next, option) });
    assert.deepEqual(result.state, first.state); assert.deepEqual(result.bundles, first.bundles); assert.equal(result.outcomes[0].status, 'pending');
  }
  const rollback = bundle('sponge', 3); rollback.manifest.runtime.version = '0.0.9'; rollback.manifest.runtime.install.version = '0.0.9';
  assert.equal((await reconcile({ portfolio, state: first.state, bundles: first.bundles, selected: ['sponge'], ...server(rollback) })).outcomes[0].status, 'pending');
});
test('unchanged source bytes and conditional 304 responses do not bump a package', async () => {
  const first = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['sponge'], ...server() });
  const s = server(); const again = await reconcile({ portfolio, state: first.state, bundles: first.bundles, selected: ['sponge'], ...s });
  assert.deepEqual(again.state, first.state); assert.equal(again.changed, false); assert.equal(s.calls.length, 1);
  const conditional = async (_url, options) => { assert.equal(options.headers['if-none-match'], '"source-1"'); return new Response(null, { status: 304 }); };
  assert.equal((await reconcile({ portfolio, state: first.state, bundles: first.bundles, selected: ['sponge'], fetchImpl: conditional })).outcomes[0].status, 'unchanged');
  await assert.rejects(download('https://sponge.computer/integrations/sponge.json', { fetchImpl: async () => new Response('x'.repeat(65537)) }));
  await assert.rejects(reconcile({ portfolio, state: empty(), bundles: {}, selected: ['sponge', 'sponge'], ...server() }));
});
test('a legacy catalog acquires its rendered fingerprint once without changing its runtime', async () => {
  const first = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['sponge'], ...server() });
  const older = structuredClone(first.state); delete older.products.sponge.packageFingerprint;
  older.products.sponge.integrationFormat = 1; older.products.sponge.presentationHash = 'a'.repeat(64);
  const current = await reconcile({ portfolio, state: older, bundles: first.bundles, selected: ['sponge'], fetchImpl: async () => new Response(null, { status: 304 }) });
  assert.equal(current.outcomes[0].status, 'updated');
  assert.equal(current.state.products.sponge.revision, 2);
  assert.equal(current.state.products.sponge.runtimeVersion, first.state.products.sponge.runtimeVersion);
  assert.equal(current.state.products.sponge.contentHash, first.state.products.sponge.contentHash);
  assert.equal(current.state.products.sponge.packageFingerprint, first.state.products.sponge.packageFingerprint);
  assert.equal(Object.hasOwn(current.state.products.sponge, 'integrationFormat'), false);
  assert.equal(Object.hasOwn(current.state.products.sponge, 'presentationHash'), false);
  assert.throws(() => packages(older, render(older, first.bundles, portfolio)));
  const again = await reconcile({ portfolio, state: current.state, bundles: current.bundles, selected: ['sponge'], fetchImpl: async () => new Response(null, { status: 304 }) });
  assert.deepEqual(again.state, current.state);
});
test('renderer and metadata changes advance a cached package once without version or hash self-reference', async () => {
  const first = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['sponge'], ...server() });
  const renderer = (state, bundles, facts, ledger) => {
    const output = render(state, bundles, facts, ledger); const path = 'plugins/sponge/plugin.json';
    const metadata = JSON.parse(output[path]);
    metadata.extensions['test.fingerprint'] = { renderedMetadata: true, integrationFingerprint: state.products.sponge.packageFingerprint };
    output[path] = `${JSON.stringify(metadata, null, 2)}\n`; return output;
  };
  const options = { portfolio, state: first.state, bundles: first.bundles, selected: ['sponge'], renderer, fetchImpl: async () => new Response(null, { status: 304 }) };
  assert.throws(() => checkPackageFingerprints(first.state, first.bundles, portfolio, { renderer }), /Reconcile/);
  const updated = await reconcile(options); assert.equal(updated.state.products.sponge.revision, 2);
  assert.equal(updated.state.products.sponge.runtimeVersion, first.state.products.sponge.runtimeVersion);
  assert.notEqual(updated.state.products.sponge.packageFingerprint, first.state.products.sponge.packageFingerprint);
  assert.equal(JSON.parse(renderer(updated.state, updated.bundles, portfolio)['plugins/sponge/plugin.json']).version, '0.1.1');
  assert.doesNotThrow(() => checkPackageFingerprints(updated.state, updated.bundles, portfolio, { renderer }));
  const repeated = await reconcile({ ...options, state: updated.state, bundles: updated.bundles }); assert.deepEqual(repeated.state, updated.state);
  const differentDerivedValues = { ...updated.state.products.sponge, revision: 99, packageFingerprint: 'f'.repeat(64) };
  assert.equal(renderedPackageFingerprint('sponge', differentDerivedValues, updated.bundles.sponge, portfolio, { renderer }), updated.state.products.sponge.packageFingerprint);
});
test('ZIP encoding changes advance a cached package while tooling-only release changes preserve it', async () => {
  const first = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['sponge'], ...server() });
  const archive = (files) => Buffer.concat([zip(files), Buffer.from('synthetic archive encoding change')]);
  const options = { portfolio, state: first.state, bundles: first.bundles, selected: ['sponge'], archive, fetchImpl: async () => new Response(null, { status: 304 }) };
  const changed = await reconcile(options); assert.equal(changed.state.products.sponge.revision, 2);
  assert.notEqual(changed.state.products.sponge.packageFingerprint, first.state.products.sponge.packageFingerprint);
  assert.deepEqual((await reconcile({ ...options, state: changed.state, bundles: changed.bundles })).state, changed.state);
  const output = render(first.state, first.bundles, portfolio);
  const oldTools = packages(first.state, output, { toolkitHash: 'a'.repeat(64) });
  const newTools = packages(first.state, output, { toolkitHash: 'b'.repeat(64) });
  assert.notEqual(oldTools.tag, newTools.tag); assert.deepEqual(oldTools.products, newTools.products);
});
test('changed product presentation advances its plugin even when the source returns 304', async () => {
  const first = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['sponge'], ...server() });
  const changed = structuredClone(portfolio); changed.projects.find((p) => p.id === 'sponge').short = 'Save reading and notes.';
  const options = { portfolio: changed, state: first.state, bundles: first.bundles, selected: ['sponge'], fetchImpl: async () => new Response(null, { status: 304 }) };
  const updated = await reconcile(options);
  assert.equal(updated.state.products.sponge.revision, 2);
  assert.equal(updated.state.products.sponge.contentHash, first.state.products.sponge.contentHash);
  const before = packages(first.state, render(first.state, first.bundles, portfolio));
  const after = packages(updated.state, render(updated.state, updated.bundles, changed));
  assert.notEqual(after.products[0].sha256, before.products[0].sha256);
  assert.equal(after.products[0].version, '0.1.1');
  const repeated = await reconcile({ ...options, state: updated.state, bundles: updated.bundles });
  assert.deepEqual(repeated.state, updated.state);
});
test('one product description changes only that product fingerprint and integration version', async () => {
  const first = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['sponge'], ...server() });
  const dawn = bundle('dawn');
  const both = await reconcile({ portfolio, state: first.state, bundles: first.bundles, selected: ['dawn'], fetchImpl: async (url) => url.endsWith('/integrations/dawn.json') ? json(dawn) : new Response(`${dawn.manifest.product.name} private preview setup guide.`) });
  const changed = structuredClone(portfolio); changed.projects.find((product) => product.id === 'sponge').short = 'Read saved sources and notes.';
  const updated = await reconcile({ portfolio: changed, state: both.state, bundles: both.bundles, selected: ['dawn', 'sponge'], fetchImpl: async () => new Response(null, { status: 304 }) });
  assert.ok(both.state.products.dawn, 'Dawn is admitted before the comparison');
  assert.deepEqual(updated.state.products.dawn, both.state.products.dawn);
  assert.equal(updated.state.products.sponge.revision, both.state.products.sponge.revision + 1);
  assert.notEqual(updated.state.products.sponge.packageFingerprint, both.state.products.sponge.packageFingerprint);
});
test('Textmock accepts only its bounded helper and preserves it in standalone skill installs', async () => {
  const b = bundle('textmock'); const helper = b.files['scripts/textmock-link.mjs'];
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/integrations/textmock.json')) return json(b);
    if (url.endsWith('/docs/agents')) return new Response(`${b.manifest.product.name} agent guide`);
    if (url.endsWith('/integrations/textmock-link.mjs')) return new Response(helper);
    throw new Error('The web integration must not request a private runtime');
  };
  const result = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['textmock'], fetchImpl });
  assert.equal(result.outcomes[0].status, 'updated');
  assert.equal(result.state.products.textmock.qualification.helperHash, digest(helper));
  const output = render(result.state, result.bundles, portfolio);
  for (const path of ['plugins/textmock/scripts/textmock-link.mjs', 'plugins/textmock/skills/textmock/scripts/textmock-link.mjs', 'skills/textmock/scripts/textmock-link.mjs']) assert.equal(output[path], helper);
  assert.ok(!Object.keys(output).some((path) => path.includes('/mcp.json') || path.includes('/.mcp.json')));
  assert.deepEqual(calls, ['https://textmock.com/integrations/textmock.json', 'https://textmock.com/docs/agents', 'https://textmock.com/integrations/textmock-link.mjs']);
  for (const mutate of [
    (copy) => { copy.files['scripts/textmock-link.mjs'] = 'x'.repeat(16385); },
    (copy) => { copy.files['scripts/another-helper.mjs'] = helper; },
    (copy) => { copy.manifest.runtime.helper.path = 'https://evil.test/script.mjs'; },
    (copy) => { copy.manifest.mcp = { command: 'textmock', args: ['mcp'] }; },
  ]) { const copy = structuredClone(b); mutate(copy); assert.throws(() => validateBundle(copy, 'textmock')); }
  const changed = structuredClone(b); changed.files['README.md'] += '\nA changed synthetic introduction.\n';
  const mismatch = await reconcile({ portfolio, state: result.state, bundles: result.bundles, selected: ['textmock'], fetchImpl: async (url) => url.endsWith('/integrations/textmock.json') ? json(changed) : url.endsWith('/docs/agents') ? new Response('Textmock guide') : new Response(`${helper}// different public file\n`) });
  assert.equal(mismatch.outcomes[0].status, 'pending'); assert.deepEqual(mismatch.state, result.state);
});
test('the Textmock encoder URL template is allowed only in its exact selected script', () => {
  // This is the literal URL-construction line in the product-owned helper.
  const template = 'return `https://textmock.com/s#${fragment}`;\n';
  const b = bundle('textmock'); b.files['scripts/textmock-link.mjs'] = template;
  assert.doesNotThrow(() => validateBundle(b, 'textmock'));
  for (const value of ['return `https://textmock.com/s#1.eJx_PRIVATE_PAYLOAD`;', 'return `https://textmock.com/s#${other}`;', 'return `https://textmock.com.evil.test/s#${fragment}`;']) {
    const copy = structuredClone(b); copy.files['scripts/textmock-link.mjs'] = value; assert.throws(() => validateBundle(copy, 'textmock'));
  }
  const prose = structuredClone(b); prose.files['README.md'] += template; assert.throws(() => validateBundle(prose, 'textmock'));
  const skill = structuredClone(b); skill.files['skills/textmock/SKILL.md'] += template; assert.throws(() => validateBundle(skill, 'textmock'));
});
test('Dawn publishes only selected skill and original example with private access stated', async () => {
  const b = bundle('dawn'); const calls = [];
  const fetchImpl = async (url) => { calls.push(url); if (url.endsWith('/integrations/dawn.json')) return json(b); if (url.endsWith('/docs/agents')) return new Response(`${b.manifest.product.name} agent guide.`); if (url.endsWith('/install')) return new Response('<title>install dawn</title><p>Private preview access is required.</p>'); throw new Error('Private runtime access is not part of selected-file validation'); };
  const result = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['dawn'], fetchImpl });
  assert.equal(result.outcomes[0].status, 'updated');
  assert.equal(result.state.products.dawn.qualification.scope, 'selected-files-only');
  assert.equal(result.state.products.dawn.qualification.requiresAccess, true);
  const output = render(result.state, result.bundles, portfolio);
  assert.equal(output['skills/dawn/examples/morning-study.ts'], b.files['skills/dawn/examples/morning-study.ts']);
  assert.equal(output['plugins/dawn/skills/dawn/examples/morning-study.ts'], b.files['skills/dawn/examples/morning-study.ts']);
  assert.deepEqual(calls, ['https://dawnav.com/integrations/dawn.json', 'https://dawnav.com/docs/agents', 'https://dawnav.com/install']);
  const unrelated = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['dawn'], fetchImpl: async (url) => url.endsWith('/install') ? new Response('Unrelated setup page.') : fetchImpl(url) });
  assert.equal(unrelated.outcomes[0].status, 'pending'); assert.deepEqual(unrelated.state, empty());
  for (const mutate of [
    (copy) => { copy.manifest.runtime.install.requiresAccess = false; },
    (copy) => { copy.manifest.runtime.install.url = 'https://github.com/hraness/dawn/releases/latest'; },
    (copy) => { copy.files['skills/dawn/examples/morning-study.ts'] = 'x'.repeat(4097); },
    (copy) => { copy.files['src/private-core.ts'] = 'private application implementation'; },
  ]) { const copy = structuredClone(b); mutate(copy); assert.throws(() => validateBundle(copy, 'dawn')); }
});
test('app admission binds version, build, platform, URL, archive hash and Sparkle signature', () => {
  const { b, release, feed } = app(); assert.equal(verifyApp(b, release, feed).sha256, 'a'.repeat(64));
  for (const mutate of [
    (r) => { r.release.version = '0.2.0'; },
    (r) => { r.release.sha256 = 'b'.repeat(64); },
    (r) => { r.release.notarization.stapleValidated = false; },
    (r) => { r.release.sparkle.edSignature = 'B'.repeat(88); },
    (r) => { r.release.sparkle.length = 12344; },
  ]) { const r = structuredClone(release); mutate(r); assert.throws(() => verifyApp(b, r, feed)); }
  assert.throws(() => verifyApp(b, release, feed.replace('<sparkle:version>8', '<sparkle:version>7')));
  assert.throws(() => verifyApp(b, release, '<!DOCTYPE x>' + feed));
});
test('an app source ahead of its published build preserves the working plugin', async () => {
  const { b, release, feed } = app(); let next = b;
  const fetchImpl = async (url) => url.endsWith('/integrations/yaptake.json') ? json(next) : url.endsWith('/docs/agents') ? new Response(`${b.manifest.product.name} agent guide`) : url.endsWith('/release.json') ? json(release) : new Response(feed);
  const first = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['yaptake'], fetchImpl });
  assert.equal(first.outcomes[0].status, 'updated');
  next = structuredClone(b); next.manifest.runtime.build = '9';
  const ahead = await reconcile({ portfolio, state: first.state, bundles: first.bundles, selected: ['yaptake'], fetchImpl });
  assert.equal(ahead.outcomes[0].status, 'pending'); assert.deepEqual(ahead.state, first.state); assert.deepEqual(ahead.bundles, first.bundles);
  next.manifest.runtime.build = '7';
  const rollback = await reconcile({ portfolio, state: first.state, bundles: first.bundles, selected: ['yaptake'], fetchImpl });
  assert.equal(rollback.outcomes[0].status, 'pending'); assert.deepEqual(rollback.state, first.state);
});
test('generated root skills and standalone copies match and client routes stay inside each plugin', async () => {
  const first = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['sponge'], ...server() });
  const output = render(first.state, first.bundles, portfolio);
  assert.equal(output['skills/sponge/SKILL.md'], output['plugins/sponge/skills/sponge/SKILL.md']);
  assert(output['plugins/sponge/README.md'].startsWith(first.bundles.sponge.files['README.md'].trimEnd()));
  assert(output['plugins/sponge/README.md'].includes('/plugin install sponge --marketplace hraness/product-skills'));
  const portable = JSON.parse(output['plugins/sponge/plugin.json']);
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(portable.extensions['com.openai'].requires_local_executor, true);
  const marketplace = JSON.parse(output['.agents/plugins/marketplace.json']);
  assert.equal(marketplace.plugins[0].source.path, './plugins/sponge');
  for (const client of ['claude', 'cursor', 'codex']) assert.equal(JSON.parse(output[`plugins/sponge/.${client}-plugin/plugin.json`]).skills, './skills/');
  assert.deepEqual(JSON.parse(output['plugins/sponge/mcp.json']).mcpServers.sponge.args, ['./scripts/mcp.mjs']);
  const next = bundle('sponge', 2); const updated = await reconcile({ portfolio, state: first.state, bundles: first.bundles, selected: ['sponge'], ...server(next) });
  assert.equal(JSON.parse(render(updated.state, updated.bundles, portfolio)['plugins/sponge/plugin.json']).version, '0.1.1');
  const noMcp = bundle('dawn'); delete noMcp.manifest.mcp; assert.doesNotThrow(() => validateBundle(noMcp, 'dawn'));
});
test('ZIP artifacts are deterministic, independent of file insertion order and reject escapes', async () => {
  assert.deepEqual(zip({ 'b.txt': 'second', 'a.txt': 'first' }), zip({ 'a.txt': 'first', 'b.txt': 'second' }));
  assert.throws(() => zip({ '../secret': 'no' }));
  const first = await reconcile({ portfolio, state: empty(), bundles: {}, selected: ['sponge'], ...server() });
  const plan = packages(first.state, render(first.state, first.bundles, portfolio));
  assert.equal(digest(plan.artifacts['sponge-0.1.0.zip']), plan.products[0].sha256);
  assert.equal(digest(plan.artifacts['sponge-0.1.0.mcpb']), plan.products[0].mcpb.sha256); assert.equal(plan.products[0].mcpb.file, 'sponge-0.1.0.mcpb');
  assert.equal(plan.artifacts.SHA256SUMS.toString(), `${plan.products[0].sha256}  sponge-0.1.0.zip\n${plan.products[0].mcpb.sha256}  sponge-0.1.0.mcpb\n`);
  assert.ok(plan.artifacts['sponge-0.1.0.zip'].includes(Buffer.from('.claude-plugin/plugin.json')));
  const helper = packages(first.state, render(first.state, first.bundles, portfolio), { toolkitHash: 'a'.repeat(64) });
  assert.notEqual(helper.tag, plan.tag); assert.deepEqual(helper.products, plan.products);
});
test('only immutable public GitHub release readback can add an idempotent publication', async () => {
  const entry = { id: 'sponge-github-test', product: 'sponge', channel: 'github', publishedAt: '2026-11-14T20:00:00.000Z', url: 'https://github.com/hraness/product-skills/releases/tag/integrations-test', version: '0.1.0', contentHash: 'a'.repeat(64) };
  const ledger = { schemaVersion: 1, publications: [] }; const appended = appendPublications(ledger, [entry]);
  assert.deepEqual(appendPublications(appended, [entry]), appended);
  assert.throws(() => checkLedgerAppendOnly(appended, ledger));
  assert.doesNotThrow(() => checkLedgerAppendOnly(ledger, appended));
  assert.throws(() => appendPublications(appended, [{ ...entry, version: '0.2.0' }]));
  assert.throws(() => validateLedger({ schemaVersion: 1, publications: [{ ...entry, status: 'planned' }] }));
  const plan = { tag: 'integrations-test', products: [{ id: 'sponge', file: 'sponge-0.1.0.zip', version: '0.1.0', sha256: 'a'.repeat(64) }] };
  const release = { tag_name: plan.tag, draft: false, immutable: true, published_at: '2026-11-14T20:00:00Z', html_url: entry.url, assets: [{ name: plan.products[0].file, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: `https://github.com/hraness/product-skills/releases/download/${plan.tag}/${plan.products[0].file}` }] };
  const fetchImpl = async (url) => json(url.endsWith('/product-skills') ? { full_name: 'hraness/product-skills', private: false } : release);
  const verified = await recordGithub(ledger, plan, { fetchImpl }); assert.equal(verified.publications[0].publishedAt, entry.publishedAt);
  assert.deepEqual(await recordGithub(verified, plan, { fetchImpl }), verified);
  release.immutable = false; await assert.rejects(recordGithub(ledger, plan, { fetchImpl })); release.immutable = true;
  release.assets[0].digest = `sha256:${'b'.repeat(64)}`; await assert.rejects(recordGithub(ledger, plan, { fetchImpl }));
});
test('a ClawHub publication pins its product, version, skill fingerprint and public page', () => {
  const fingerprint = 'a72ab99bd5d23fc589a7519b8e063f4c4fcc0fc825513a8a6f260c73fdfd82ca';
  const entry = { id: clawhubPublicationId('textmock', '0.1.1', fingerprint), product: 'textmock', channel: 'clawhub', publishedAt: '2026-11-15T17:17:19.247Z', url: clawhubPublicationUrl('textmock'), version: '0.1.1', contentHash: fingerprint };
  assert.equal(entry.id, 'textmock-clawhub-0-1-1-a72ab99b'); assert.equal(entry.url, 'https://clawhub.ai/hraness/skills/textmock');
  const ledger = appendPublications({ schemaVersion: 1, publications: [] }, [entry]); assert.deepEqual(appendPublications(ledger, [entry]), ledger);
  for (const change of [{ product: 'sponge' }, { id: `${entry.id}-other` }, { version: '0.1.2' }, { contentHash: 'b'.repeat(64) }, { url: 'https://clawhub.ai/hraness/skills/sponge' }, { url: 'https://clawhub.ai/someone/skills/textmock' }, { url: `${entry.url}?version=0.1.1` }, { url: 'https://github.com/hraness/product-skills' }, { publishedAt: '2999-01-01T00:00:00.000Z' }]) {
    assert.throws(() => validateLedger({ schemaVersion: 1, publications: [{ ...entry, ...change }] }), undefined, JSON.stringify(change));
  }
  assert.throws(() => validateLedger({ schemaVersion: 1, publications: [{ ...entry, id: 'textmock-github-test', channel: 'github' }] }), /public allowlist/);
  assert.throws(() => clawhubPublicationId('textmock', '0.1.1', fingerprint.toUpperCase())); assert.throws(() => clawhubPublicationId('unknown', '0.1.1', fingerprint)); assert.throws(() => clawhubPublicationUrl('unknown'));
});

test('Claude manifests carry only the listing links each product site serves', async () => {
  const { LISTING_LINKS, PRODUCTS } = await import('../scripts/distribution.mjs');
  assert.deepEqual(Object.keys(LISTING_LINKS).sort(), Object.keys(PRODUCTS).sort());
  for (const [id, links] of Object.entries(LISTING_LINKS)) {
    assert.ok(links.privacyPolicyUrl, `${id} needs a privacy policy`);
    for (const url of Object.values(links)) assert.equal(new URL(url).origin, PRODUCTS[id].url);
    const manifest = JSON.parse(await readFile(new URL(`../plugins/${id}/.claude-plugin/plugin.json`, import.meta.url), 'utf8'));
    for (const key of ['privacyPolicyUrl', 'supportUrl', 'termsOfServiceUrl']) assert.equal(manifest[key], links[key]);
  }
});
