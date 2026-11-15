import { readFileSync } from 'node:fs';
import { spongeModule, spongeRequirements } from './sponge.mjs';

// MCP Bundles (https://github.com/modelcontextprotocol/mcpb) for the products
// whose local MCP server is already installed on the user's computer. Each
// bundle holds only a launcher that verifies and starts that installed server.
export const MCPB_ROOT = 'mcpb';
export const MCPB_PRODUCTS = Object.freeze(['sponge', 'yaptake']);
export const MCPB_MANIFEST_VERSION = '0.3';
export const mcpbFile = (id, version) => `${id}-${version}.mcpb`;
export function mcpbPath(path) {
  const match = /^mcpb\/(sponge|yaptake)\/(.+)$/.exec(path);
  return Boolean(match) && mcpbMembers(match[1]).includes(match[2]);
}
export function mcpbMembers(id) {
  const common = ['manifest.json', 'README.md', 'LICENSE', 'assets/icon.png', 'server/index.mjs', 'server/requirements.json'];
  if (id === 'sponge') return [...common, 'server/cli.mjs', 'server/mcp.mjs'];
  if (id === 'yaptake') return common;
  throw new Error('Unknown MCP bundle product');
}
function yaptakeModule() { return readFileSync(new URL('./yaptake/mcp.mjs', import.meta.url), 'utf8'); }
export function yaptakeRequirements(manifest) {
  const r = manifest.runtime;
  if (manifest.product.id !== 'yaptake' || r.install.type !== 'app' || !r.build) throw new Error('The released Yaptake app is required');
  return { schemaVersion: 1, command: 'yaptake', version: r.version, build: r.build, homepage: manifest.product.url };
}
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
function readme(manifest, setup) {
  const { name, url, agentGuideUrl } = manifest.product;
  return `# ${name} MCP bundle\n\n${manifest.product.description}\n\nThis bundle connects an MCP client, such as Claude Desktop, to the ${name} tools already on your computer. It contains a small launcher and no copy of ${name}.\n\n## Before you install\n\n${setup}\n\nSee the [setup guide](${agentGuideUrl}) for the supported connections and the first task.\n\n## License\n\nThe launcher in this bundle uses the MIT license. ${name} has its own terms at ${url}.\n`;
}
// Render the bundle's files. `links` are the product's public listing pages.
export function renderMcpb(manifest, { version, icon, license, links = {}, author, repository }) {
  const id = manifest.product.id;
  if (!MCPB_PRODUCTS.includes(id) || !manifest.mcp) throw new Error('This product has no local MCP server');
  const product = manifest.product;
  const common = {
    manifest_version: MCPB_MANIFEST_VERSION, name: id, display_name: product.name, version, description: product.description,
    author, repository: { type: 'git', url: repository }, homepage: product.url, documentation: product.agentGuideUrl,
    ...(links.supportUrl ? { support: links.supportUrl } : {}), ...(icon ? { icon: 'assets/icon.png' } : {}),
  };
  const server = (env) => ({ type: 'node', entry_point: 'server/index.mjs', mcp_config: { command: 'node', args: ['${__dirname}/server/index.mjs'], ...(env ? { env } : {}) } });
  const policies = links.privacyPolicyUrl ? { privacy_policies: [links.privacyPolicyUrl] } : {};
  let files;
  if (id === 'sponge') {
    const node = manifest.runtime.node;
    files = {
      'manifest.json': json({
        ...common, server: server({ SPONGE_CLI: '${user_config.sponge_cli}', SPONGE_MCP_LIBRARY: '${user_config.library}' }),
        user_config: {
          library: { type: 'directory', title: 'Library folder', description: 'Optional. Leave empty to use your default Sponge library.', required: false },
          sponge_cli: { type: 'file', title: 'Sponge command', description: 'Optional. The installed sponge command, if your MCP client cannot find it.', required: false },
        },
        compatibility: { platforms: ['darwin', 'linux'], runtimes: { node } }, ...policies, keywords: ['reading', 'library', 'articles', 'pdf', 'notes'], license: 'MIT',
      }),
      'server/index.mjs': spongeModule('bundle.mjs'), 'server/mcp.mjs': spongeModule('mcp.mjs'), 'server/cli.mjs': spongeModule('cli.mjs'),
      'server/requirements.json': json(spongeRequirements(manifest)),
      'README.md': readme(manifest, `Install the Sponge command with Node.js ${node.slice(2)} or newer: \`npm install --global ${manifest.runtime.install.package}\`. The launcher checks that the installed command is the official package at version ${manifest.runtime.version} or newer before it starts.`),
    };
  } else {
    const p = manifest.runtime.platform;
    files = {
      'manifest.json': json({
        ...common, server: server(null),
        compatibility: { platforms: ['darwin'], runtimes: { node: '>=20.0.0' } }, ...policies, keywords: ['video', 'editing', 'captions', 'transcript', 'mac'], license: 'MIT',
      }),
      'server/index.mjs': yaptakeModule(), 'server/requirements.json': json(yaptakeRequirements(manifest)),
      'README.md': readme(manifest, `Install [Yaptake](${product.url}) ${manifest.runtime.version} (build ${manifest.runtime.build}) or newer in Applications on a Mac with Apple silicon and macOS ${p.minimumVersion} or newer. Open a saved project in Yaptake before you ask for an edit. The launcher checks the app's identity, version and developer signature before it starts the app's own MCP server.`),
    };
  }
  files.LICENSE = license;
  if (icon) files['assets/icon.png'] = icon;
  return files;
}
