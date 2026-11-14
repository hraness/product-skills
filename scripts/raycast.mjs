import { readFileSync } from 'node:fs';

export const RAYCAST_FILES = Object.freeze(['README.md', 'requirements.json', 'save-url.sh', 'search-library.sh', 'sponge.mjs']);
const commands = new Set(['save-url.sh', 'search-library.sh']);
export function raycastFileMode(path) {
  const prefix = ['adapters/raycast/', 'plugins/sponge/adapters/raycast/'].find((value) => path.startsWith(value));
  return prefix && commands.has(path.slice(prefix.length)) ? '100755' : '100644';
}
export function raycastPath(path) {
  return ['adapters/raycast/', 'plugins/sponge/adapters/raycast/'].some((prefix) => path.startsWith(prefix) && RAYCAST_FILES.includes(path.slice(prefix.length)));
}
export function renderRaycast(manifest, setupLink) {
  if (manifest.product.id !== 'sponge' || manifest.runtime.install.type !== 'npm' || manifest.runtime.install.package !== '@hraness/sponge') throw new Error('Raycast requires the released Sponge CLI');
  const values = { PRODUCT: manifest.product.name, SETUP_LINK: setupLink, VERSION: manifest.runtime.version, NODE: manifest.runtime.node.slice(2) };
  const output = {};
  for (const file of RAYCAST_FILES.filter((value) => value !== 'requirements.json')) {
    const source = readFileSync(new URL('./raycast/' + file, import.meta.url), 'utf8');
    output[file] = source.replace(/\{\{([A-Z_]+)\}\}/g, (_match, name) => {
      if (!Object.hasOwn(values, name)) throw new Error('Unknown Raycast template field');
      return values[name];
    });
  }
  output['requirements.json'] = JSON.stringify({
    schemaVersion: 1, command: manifest.runtime.command, package: manifest.runtime.install.package,
    version: manifest.runtime.version, node: manifest.runtime.node, homepage: manifest.product.url,
  }, null, 2) + '\n';
  return output;
}
