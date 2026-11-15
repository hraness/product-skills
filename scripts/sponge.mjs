import { readFileSync } from 'node:fs';

export const SPONGE_MCP_FILES = Object.freeze(['scripts/cli.mjs', 'scripts/mcp.mjs', 'scripts/requirements.json', 'mcp.codex.json']);
export function spongeSupportPath(path) { return path.startsWith('plugins/sponge/') && SPONGE_MCP_FILES.includes(path.slice('plugins/sponge/'.length)); }
export function spongeRequirements(manifest) {
  if (manifest.product.id !== 'sponge' || manifest.runtime.install.type !== 'npm' || manifest.runtime.install.package !== '@hraness/sponge') throw new Error('The released Sponge CLI is required');
  return { schemaVersion: 1, command: manifest.runtime.command, package: manifest.runtime.install.package, version: manifest.runtime.version, node: manifest.runtime.node, homepage: manifest.product.url };
}
export function spongeModule(file) {
  if (!['cli.mjs', 'mcp.mjs', 'raycast.mjs'].includes(file)) throw new Error('Unknown Sponge integration module');
  return readFileSync(new URL('./sponge/' + file, import.meta.url), 'utf8');
}
export function renderSpongeSupport(manifest) {
  return { 'scripts/cli.mjs': spongeModule('cli.mjs'), 'scripts/mcp.mjs': spongeModule('mcp.mjs'), 'scripts/requirements.json': JSON.stringify(spongeRequirements(manifest), null, 2) + '\n' };
}
export const spongePortableServer = () => ({ type: 'stdio', command: 'node', args: ['./scripts/mcp.mjs'], cwd: './' });
export const spongeClaudeServer = () => ({ type: 'stdio', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs'] });
