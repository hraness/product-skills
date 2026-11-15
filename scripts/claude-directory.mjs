// Claude directory copies of the product plugins.
//
// The Claude directory accepts only Markdown, text, JSON, YAML and listing
// images from organizations it has not verified, and no MCP server that runs on
// the user's computer. These copies keep each product's skill and drop the local
// MCP configuration, launchers and adapters. The full packages under plugins/
// stay unchanged for Codex, Cursor and repository installs.

export const CLAUDE_DIRECTORY_ROOT = 'directory/claude';
// Textmock's skill depends on its bundled link helper, so it has no directory copy yet.
export const CLAUDE_DIRECTORY_PRODUCTS = Object.freeze(['dawn', 'sponge', 'yaptake']);
const ALLOWED = /\.(?:md|txt|json|ya?ml|png)$|(?:^|\/)LICENSE$/;

/** Files for one product's directory copy, keyed relative to its folder. */
export function claudeDirectoryFiles(id, files, { manifest, icon = null }) {
  if (!CLAUDE_DIRECTORY_PRODUCTS.includes(id)) return null;
  const skill = `skills/${id}/SKILL.md`;
  const out = { '.claude-plugin/plugin.json': manifest, LICENSE: files.LICENSE, 'README.md': files['README.md'], [skill]: files[skill] };
  if (icon) out['assets/icon.png'] = icon;
  if (id === 'dawn') {
    const example = files['skills/dawn/examples/morning-study.ts'];
    out['skills/dawn/examples/morning-study.md'] = `# Morning study\n\nAn original eight-bar Dawn score with synthesized instruments. Copy the code into \`song.ts\` in a new Dawn project.\n\n\`\`\`ts\n${example.trimEnd()}\n\`\`\`\n`;
    // Every reference to the example follows it to its Markdown copy.
    out[skill] = out[skill].replaceAll('examples/morning-study.ts', 'examples/morning-study.md').replace('Copy it to `song.ts`', 'Copy its code to `song.ts`');
    out['README.md'] = out['README.md'].replaceAll('examples/morning-study.ts', 'examples/morning-study.md');
  }
  for (const path of Object.keys(out)) if (!ALLOWED.test(path)) throw new Error(`Claude directory copy refuses ${path}`);
  return out;
}
