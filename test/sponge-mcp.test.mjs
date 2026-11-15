import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSpongeMcp } from '../scripts/sponge/mcp.mjs';
import { renderSpongeSupport, spongeClaudeServer, spongePortableServer, spongeSupportPath } from '../scripts/sponge.mjs';
import { renderRaycast } from '../scripts/raycast.mjs';
import { validateUpdateFiles } from '../scripts/github.mjs';

const requirements = { schemaVersion: 1, command: 'sponge', package: '@hraness/sponge', version: '1.2.3', node: '>=24.20.0', homepage: 'https://sponge.computer' };
async function fixture(t, changes = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sponge-mcp-launcher-'))); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'bin')); await mkdir(join(root, 'library'));
  const entry = join(root, 'bin/sponge.js'); await writeFile(entry, '// An original synthetic CLI fixture.\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@hraness/sponge', version: requirements.version, bin: { sponge: 'bin/sponge.js' }, homepage: requirements.homepage, mcpName: 'io.github.hraness/sponge', engines: { node: requirements.node }, ...changes }));
  return { root, entry, env: { PATH: '', SPONGE_CLI: entry } };
}
function processSpy(version = requirements.version) {
  const calls = [], child = { syntheticChild: true };
  return { calls, child, probe: (program, args, options) => { calls.push({ operation: 'probe', program, args, options }); return { status: 0, stdout: version + '\n' }; }, launch: (program, args, options) => { calls.push({ operation: 'launch', program, args, options }); return child; } };
}

test('the MCP launcher verifies the installed package and read-only version before a single stdio child', async (t) => {
  const current = await fixture(t), processes = processSpy();
  assert.equal(startSpongeMcp({ ...current, ...processes, requirements }), processes.child);
  assert.deepEqual(processes.calls.map(call => call.operation), ['probe', 'launch']);
  assert.equal(processes.calls[0].program, process.execPath); assert.deepEqual(processes.calls[0].args, [current.entry, '--version']);
  assert.equal(processes.calls[1].program, process.execPath); assert.deepEqual(processes.calls[1].args, [current.entry, 'mcp']);
  assert.equal(processes.calls[1].options.stdio, 'inherit'); assert.equal(processes.calls[1].options.shell, undefined);
  assert(!processes.calls.some(call => call.args.some(value => ['init', 'login', 'install', 'npx', 'setup'].includes(value))));
});
test('a moreutils collision cannot execute a probe or launch, or write its positional output file', async (t) => {
  const current = await fixture(t); const sentinel = join(current.root, 'mcp');
  await writeFile(join(current.root, 'bin/sponge'), '#!/bin/sh\nprintf overwritten > mcp\n', { mode: 0o755 });
  const processes = processSpy();
  assert.throws(() => startSpongeMcp({ env: { PATH: join(current.root, 'bin') }, ...processes, requirements }), /@hraness\/sponge/);
  assert.equal(processes.calls.length, 0); await assert.rejects(access(sentinel));
  for (const changes of [{ name: 'moreutils' }, { mcpName: 'io.github.other/sponge' }, { version: '1.2.2' }, { engines: { node: '>=99.0.0' } }]) {
    const wrong = await fixture(t, changes), refused = processSpy(); assert.throws(() => startSpongeMcp({ ...wrong, ...refused, requirements })); assert.equal(refused.calls.length, 0);
  }
});
test('uncertain version probes and missing libraries never start or retry an MCP server', async (t) => {
  const current = await fixture(t);
  for (const result of [{ status: null, error: { code: 'ETIMEDOUT' } }, { status: 1, stderr: 'private-provider-text' }, { status: 0, stdout: '9.9.9\n' }]) {
    const processes = processSpy(); processes.probe = () => { processes.calls.push({ operation: 'probe' }); return result; };
    assert.throws(() => startSpongeMcp({ ...current, ...processes, requirements }), error => !error.message.includes('private-provider-text')); assert.equal(processes.calls.length, 1);
  }
  const processes = processSpy();
  assert.throws(() => startSpongeMcp({ ...current, env: { ...current.env, SPONGE_MCP_LIBRARY: join(current.root, 'missing') }, ...processes, requirements }), /existing absolute/); assert.equal(processes.calls.length, 0);
  startSpongeMcp({ ...current, env: { ...current.env, SPONGE_MCP_LIBRARY: join(current.root, 'library') }, ...processes, requirements });
  assert.deepEqual(processes.calls[1].args, [current.entry, 'mcp', '--library', join(current.root, 'library')]);
});
test('one shared identity module and requirements render for Raycast and MCP with supported host paths', async () => {
  const manifest = { product: { id: 'sponge', url: requirements.homepage, name: 'Sponge' }, runtime: { command: 'sponge', version: requirements.version, node: requirements.node, install: { type: 'npm', package: '@hraness/sponge' } } };
  const support = renderSpongeSupport(manifest), raycast = renderRaycast(manifest, '../../README.md');
  assert.equal(support['scripts/cli.mjs'], raycast['cli.mjs']); assert.equal(support['scripts/requirements.json'], raycast['requirements.json']);
  assert(support['scripts/mcp.mjs'].includes("from './cli.mjs'")); assert(raycast['sponge.mjs'].includes("from './cli.mjs'"));
  assert.deepEqual(JSON.parse(support['scripts/requirements.json']), requirements);
  assert.deepEqual(spongePortableServer(), { type: 'stdio', command: 'node', args: ['./scripts/mcp.mjs'], cwd: './' });
  assert.deepEqual(spongeClaudeServer(), { type: 'stdio', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs'] });
  for (const path of ['plugins/sponge/scripts/cli.mjs', 'plugins/sponge/scripts/mcp.mjs', 'plugins/sponge/scripts/requirements.json', 'plugins/sponge/mcp.codex.json']) { assert(spongeSupportPath(path)); validateUpdateFiles('products', [path]); }
  for (const path of ['plugins/sponge/scripts/private.mjs', 'plugins/yaptake/scripts/mcp.mjs', 'scripts/mcp.mjs']) { assert(!spongeSupportPath(path)); assert.throws(() => validateUpdateFiles('products', [path])); }
});
