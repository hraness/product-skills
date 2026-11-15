import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_DIRECTORY_PRODUCTS, CLAUDE_DIRECTORY_ROOT, claudeDirectoryFiles } from '../scripts/claude-directory.mjs';

const root = new URL('../', import.meta.url);
const files = async (dir) => { const base = fileURLToPath(new URL(dir, root)); return (await readdir(base, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => relative(base, join(e.parentPath, e.name))); };

test('Claude directory copies ship only file types the directory accepts from any organization', async () => {
  for (const id of CLAUDE_DIRECTORY_PRODUCTS) {
    const listed = await files(`${CLAUDE_DIRECTORY_ROOT}/${id}/`);
    assert.ok(listed.includes('.claude-plugin/plugin.json') && listed.includes(`skills/${id}/SKILL.md`), id);
    for (const path of listed) assert.match(path, /\.(?:md|json|png)$|(?:^|\/)LICENSE$/, `${id}: ${path}`);
    assert.ok(!listed.some((path) => /(?:^|\/)\.?mcp(?:\.codex)?\.json$/.test(path)), `${id} must not carry a local MCP server`);
    const manifest = JSON.parse(await readFile(new URL(`${CLAUDE_DIRECTORY_ROOT}/${id}/.claude-plugin/plugin.json`, root), 'utf8'));
    assert.deepEqual(manifest, JSON.parse(await readFile(new URL(`plugins/${id}/.claude-plugin/plugin.json`, root), 'utf8')));
    assert.ok(!manifest.mcpServers && !manifest.hooks, id);
  }
});
test('the Dawn directory copy carries its example as Markdown and links to it', () => {
  const out = claudeDirectoryFiles('dawn', { LICENSE: 'MIT', 'README.md': 'See [x](skills/dawn/examples/morning-study.ts).', 'skills/dawn/SKILL.md': '[Morning study](examples/morning-study.ts). Copy it to `song.ts` now.', 'skills/dawn/examples/morning-study.ts': 'export default 1;\n' }, { manifest: '{}' });
  assert.equal(out['skills/dawn/examples/morning-study.ts'], undefined);
  assert.match(out['skills/dawn/examples/morning-study.md'], /```ts\nexport default 1;\n```/);
  assert.ok(!out['skills/dawn/SKILL.md'].includes('.ts)') && out['skills/dawn/SKILL.md'].includes('Copy its code to `song.ts`'));
  assert.ok(out['README.md'].includes('examples/morning-study.md'));
  assert.equal(claudeDirectoryFiles('textmock', {}, { manifest: '{}' }), null);
});
