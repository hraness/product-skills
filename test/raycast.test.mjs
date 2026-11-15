import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat, symlink, realpath, chmod, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRaycast } from '../scripts/sponge/raycast.mjs';
import { RAYCAST_FILES, raycastFileMode, raycastPath, renderRaycast } from '../scripts/raycast.mjs';
import { checkPackageFingerprints, checkRendered, digest, packages, reconcile as reconcileSources, render, writeRendered, zip } from '../scripts/distribution.mjs';
import { validateUpdateFiles } from '../scripts/github.mjs';
import { withOriginalIcon } from './fixtures/listing-icon.mjs';
const reconcile = (options) => reconcileSources({ ...options, fetchImpl: withOriginalIcon(options.fetchImpl ?? fetch) });


const requirements = { schemaVersion: 1, command: 'sponge', package: '@hraness/sponge', version: '1.2.3', node: '>=24.20.0', homepage: 'https://sponge.computer' };
async function cli(t, changes = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'raycast-cli-'))); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'bin')); await mkdir(join(root, 'library space'));
  const entry = join(root, 'bin/sponge.js'); await writeFile(entry, '// Original synthetic CLI fixture.\n');
  const manifest = { name: requirements.package, version: requirements.version, bin: { sponge: 'bin/sponge.js' }, homepage: requirements.homepage, mcpName: 'io.github.hraness/sponge', engines: { node: requirements.node }, ...changes };
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  return { root, entry, manifest, env: { PATH: '', SPONGE_RAYCAST_CLI: entry, SPONGE_RAYCAST_LIBRARY: join(root, 'library space') } };
}
function runner({ version = requirements.version, result = { ok: true, itemId: 'synthetic-item', jobId: 'synthetic-job' }, text = 'A saved result.\n', failure = null } = {}) {
  const calls = [];
  const run = (executable, args, options) => {
    calls.push({ executable, args, options });
    if (args[1] === '--version') return { status: 0, stdout: version + '\n' };
    if (failure) return failure;
    return { status: 0, stdout: args[1] === 'add' ? JSON.stringify(result) : text };
  };
  return { run, calls };
}

test('save probes the admitted package identity first and queues one literal URL without a shell', async (t) => {
  const current = await cli(t); const child = runner();
  const url = 'https://example.test/article?query=%24%28touch%20x%29';
  assert.equal(runRaycast('save', url, { ...current, ...child, requirements }), 'Queued for capture in Sponge.');
  assert.equal(child.calls.length, 2);
  assert.deepEqual(child.calls[0].args, [current.entry, '--version']);
  assert.deepEqual(child.calls[1].args, [current.entry, 'add', url, '--json', '--library', current.env.SPONGE_RAYCAST_LIBRARY]);
  for (const call of child.calls) { assert.equal(call.executable, process.execPath); assert.equal(call.options.shell, undefined); assert.equal(call.options.input, ''); assert.equal(call.options.timeout, 15000); assert.equal(call.options.maxBuffer, 256 * 1024); }
  const duplicate = runner({ result: { ok: true, itemId: 'synthetic-item', duplicate: true } });
  assert.equal(runRaycast('save', url, { ...current, ...duplicate, requirements }), 'Already in Sponge.');
});
test('lexical search keeps an option-like query after the separator and strips terminal controls', async (t) => {
  const current = await cli(t); const child = runner({ text: '\u001b[31mSaved result\u001b[0m\n\u001b]52;c;not-a-clipboard-value\u0007https://example.test/article\n' });
  const query = '--mode semantic; $(touch x)';
  assert.equal(runRaycast('search', query, { ...current, ...child, requirements }), 'Saved result\nhttps://example.test/article');
  assert.deepEqual(child.calls[1].args, [current.entry, 'search', '--mode', 'lexical', '--limit', '20', '--library', current.env.SPONGE_RAYCAST_LIBRARY, '--', query]);
  assert.equal(runRaycast('search', 'no match', { ...current, ...runner({ text: '' }), requirements }), 'No matching saved text.');
});
test('moreutils and unrelated package executables are refused before any version or write command', async (t) => {
  const current = await cli(t); const collision = join(current.root, 'bin/sponge');
  await writeFile(collision, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const child = runner();
  assert.throws(() => runRaycast('save', 'https://example.test/', { env: { PATH: join(current.root, 'bin') }, ...child, requirements }), /@hraness\/sponge/);
  assert.equal(child.calls.length, 0);
  for (const changes of [{ name: 'moreutils' }, { bin: { sponge: 'other.js' } }, { mcpName: 'io.github.someone/sponge' }, { homepage: 'https://another.example' }, { version: '1.2.2' }, { engines: { node: '>=99.0.0' } }]) {
    const wrong = await cli(t, changes); const blocked = runner();
    assert.throws(() => runRaycast('save', 'https://example.test/', { ...wrong, ...blocked, requirements }));
    assert.equal(blocked.calls.length, 0);
  }
  const wrongVersion = runner({ version: '9.9.9' });
  assert.throws(() => runRaycast('save', 'https://example.test/', { ...current, ...wrongVersion, requirements }), /version differs/);
  assert.equal(wrongVersion.calls.length, 1);
});
test('invalid inputs and library choices cannot reach an executable, and uncertain writes are never retried', async (t) => {
  const current = await cli(t); const child = runner();
  for (const [action, input] of [['setup', 'x'], ['save', 'file:///private'], ['save', 'https://name:secret@example.test/'], ['search', ''], ['search', 'a\nb'], ['search', 'x'.repeat(1001)]]) {
    assert.throws(() => runRaycast(action, input, { ...current, ...child, requirements }));
  }
  for (const path of ['relative', '/', join(current.root, 'missing')]) assert.throws(() => runRaycast('search', 'x', { ...current, ...child, requirements, env: { ...current.env, SPONGE_RAYCAST_LIBRARY: path } }));
  assert.equal(child.calls.length, 0);
  for (const failure of [{ status: null, error: { code: 'ETIMEDOUT', message: 'private-provider-text' } }, { status: 1, stdout: 'private-provider-text', stderr: 'private-provider-text' }, { status: 0, stdout: 'x'.repeat(256 * 1024 + 1) }]) {
    const stopped = runner({ failure });
    assert.throws(() => runRaycast('save', 'https://example.test/', { ...current, ...stopped, requirements }), error => { assert(!error.message.includes('private-provider-text')); return true; });
    assert.equal(stopped.calls.length, 2);
  }
});

const portfolio = JSON.parse(await readFile(new URL('../catalog/portfolio.json', import.meta.url), 'utf8'));
const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
const empty = () => ({ schemaVersion: 1, products: {} });
function bundle() {
  return { schemaVersion: 1, manifest: { schemaVersion: 1, product: { id: 'sponge', name: 'Sponge', url: requirements.homepage, description: 'An original synthetic reading fixture.', agentGuideUrl: requirements.homepage + '/docs/agents' }, runtime: { command: 'sponge', version: requirements.version, node: requirements.node, install: { type: 'npm', package: requirements.package, version: requirements.version } }, mcp: { command: 'sponge', args: ['mcp'] }, license: 'MIT' }, files: {
    LICENSE: license, 'skills/sponge/SKILL.md': '---\nname: sponge\ndescription: Use the original synthetic reading fixture.\n---\n\nGuide: https://sponge.computer/docs/agents\n',
    'README.md': '# Sponge fixture\n\nThis original synthetic package exists for source tests. Read the public product at https://sponge.computer and its setup guide at https://sponge.computer/docs/agents before choosing a local task. The fixture names no private source, real library, account or published application version. It demonstrates a complete generated package.\n',
  } };
}
async function admitted(renderer = render) {
  const b = bundle();
  const fetchImpl = async (url) => {
    if (url.endsWith('/integrations/sponge.json')) return new Response(JSON.stringify(b));
    if (url.endsWith('/docs/agents')) return new Response('Sponge guide');
    return new Response(JSON.stringify({ name: requirements.package, version: requirements.version, engines: { node: requirements.node }, bin: { sponge: 'bin/sponge.js' }, dist: { integrity: 'sha512-' + Buffer.alloc(64).toString('base64'), tarball: 'https://registry.npmjs.org/@hraness/sponge/-/sponge-1.2.3.tgz' } }));
  };
  return reconcile({ state: empty(), bundles: {}, portfolio, selected: ['sponge'], fetchImpl, renderer });
}
function zipEntries(bytes) {
  let offset = bytes.readUInt32LE(bytes.length - 6); const entries = {};
  while (bytes.readUInt32LE(offset) === 0x02014b50) {
    const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    entries[bytes.subarray(offset + 46, offset + 46 + length).toString()] = { platform: bytes.readUInt16LE(offset + 4) >> 8, mode: bytes.readUInt32LE(offset + 38) >>> 16 };
    offset += 46 + length + extra + comment;
  }
  return entries;
}
test('one template source renders the root adapter and immutable Sponge ZIP with current prerequisites and executable modes', async (t) => {
  const first = await admitted(); const output = render(first.state, first.bundles, portfolio);
  assert(output['README.md'].includes('[Raycast commands](adapters/raycast/README.md)'));
  assert(!render(empty(), {}, portfolio)['README.md'].includes('adapters/raycast/README.md'));
  for (const file of RAYCAST_FILES.filter((path) => path !== 'README.md')) assert.equal(output['adapters/raycast/' + file], output['plugins/sponge/adapters/raycast/' + file]);
  assert(output['adapters/raycast/README.md'].includes('../../plugins/sponge/README.md'));
  assert(output['plugins/sponge/adapters/raycast/README.md'].includes('../../README.md'));
  assert.deepEqual(JSON.parse(output['adapters/raycast/requirements.json']), requirements);
  const future = structuredClone(bundle().manifest); future.runtime.version = '8.9.10'; future.runtime.install.version = '8.9.10'; future.runtime.node = '>=26.0.0';
  const changed = renderRaycast(future, '../../README.md'); assert.equal(JSON.parse(changed['requirements.json']).version, '8.9.10'); assert(changed['README.md'].includes('26.0.0'));
  const root = await mkdtemp(join(tmpdir(), 'raycast-render-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeRendered(root, output);
  const plan = packages(first.state, output); const entries = zipEntries(plan.artifacts[plan.products[0].file]);
  for (const file of RAYCAST_FILES) {
    const path = 'adapters/raycast/' + file;
    assert.equal(Boolean((await lstat(join(root, path))).mode & 0o111), file.endsWith('.sh'));
    assert.equal(entries[path].mode, file.endsWith('.sh') ? 0o100755 : 0);
    if (file.endsWith('.sh')) assert.equal(entries[path].platform, 3);
    validateUpdateFiles('products', [path, 'plugins/sponge/' + path]);
  }
  for (const path of ['adapters/raycast/other.sh', 'plugins/dawn/adapters/raycast/save-url.sh', 'adapters/raycast/../private.mjs']) { assert.equal(raycastPath(path), false); assert.throws(() => validateUpdateFiles('products', [path])); assert.equal(raycastFileMode(path), '100644'); }
  assert.equal(digest(zip({ 'README.md': 'An original archive fixture.\\n' })), 'd6de2a316fe6179f155c99766d3210d2f2e34745f56c6ace4603d9e00fe7e959');
});
test('adding the adapter advances its cached Sponge package once without changing the product runtime', async () => {
  const without = (...args) => Object.fromEntries(Object.entries(render(...args)).filter(([path]) => !path.startsWith('adapters/raycast/') && !path.startsWith('plugins/sponge/adapters/raycast/')));
  const first = await admitted(without); const updated = await reconcile({ state: first.state, bundles: first.bundles, portfolio, selected: ['sponge'], fetchImpl: async () => new Response(null, { status: 304 }) });
  assert.equal(updated.state.products.sponge.revision, first.state.products.sponge.revision + 1);
  assert.equal(updated.state.products.sponge.runtimeVersion, first.state.products.sponge.runtimeVersion);
  assert.doesNotThrow(() => checkPackageFingerprints(updated.state, updated.bundles, portfolio));
  const again = await reconcile({ state: updated.state, bundles: updated.bundles, portfolio, selected: ['sponge'], fetchImpl: async () => new Response(null, { status: 304 }) });
  assert.equal(again.changed, false); assert.deepEqual(again.state, updated.state);
});
test('generated checks reject missing executable permissions, unknown adapter files and ancestor symlinks', async (t) => {
  const first = await admitted(); const output = render(first.state, first.bundles, portfolio);
  const root = await mkdtemp(join(tmpdir(), 'raycast-check-')); const outside = await mkdtemp(join(tmpdir(), 'raycast-outside-'));
  t.after(() => rm(root, { recursive: true, force: true })); t.after(() => rm(outside, { recursive: true, force: true }));
  await writeRendered(root, output); await checkRendered(root, output);
  const script = join(root, 'adapters/raycast/save-url.sh'); await chmod(script, 0o644);
  await assert.rejects(checkRendered(root, output), /executable mode/); await chmod(script, 0o755);
  const unknown = join(root, 'adapters/raycast/unreviewed.mjs'); await writeFile(unknown, '// Unreviewed fixture.\n');
  await assert.rejects(checkRendered(root, output), /Unexpected package/); await rm(unknown);
  await cp(join(root, 'adapters'), join(outside, 'copy'), { recursive: true });
  await rm(join(root, 'adapters'), { recursive: true }); await symlink(join(outside, 'copy'), join(root, 'adapters'));
  await assert.rejects(checkRendered(root, output), /regular directories/);
});
