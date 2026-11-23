import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { CLAUDE_DIRECTORY_PRODUCTS, CLAUDE_DIRECTORY_ROOT, claudeDirectoryFiles } from '../scripts/claude-directory.mjs';
import { encodeLink } from '../plugins/textmock/skills/textmock/scripts/textmock-link.mjs';

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
test('the withdrawn DAWN skill has no Claude directory copy', () => {
  assert(!CLAUDE_DIRECTORY_PRODUCTS.includes('dawn'));
  assert.equal(claudeDirectoryFiles('dawn', {}, {}), null);
});

test('the Textmock directory copy makes the same links as the bundled helper', async () => {
  const skill = await readFile(new URL(`${CLAUDE_DIRECTORY_ROOT}/textmock/skills/textmock/SKILL.md`, root), 'utf8');
  const readme = await readFile(new URL(`${CLAUDE_DIRECTORY_ROOT}/textmock/README.md`, root), 'utf8');
  assert.ok(!/textmock-link|scripts\//.test(skill + readme) && skill.includes('`textmock render --out`'));
  const [, command, example] = /```sh\n(node -e '.*') <<'JSON'\n(.*)\nJSON\n```/.exec(skill);
  const run = (doc) => execFileSync('sh', ['-c', command], { input: doc, encoding: 'utf8' }).trim();
  const input = { name: 'Mira', messages: [{ from: 'them', text: 'Did you bring the telescope?' }, { from: 'me', text: 'Yes. You bring the clear sky.' }] };
  assert.equal(run(example), encodeLink(input));
  const tricky = { name: "Zoë's \"phone\"", dark: true, clock: '23:59', messages: [{ from: 'me', text: "It's 'quoted' — and\nmultiline 🚀" }] };
  const doc = { v: 6, dark: true, name: tricky.name, clock: '23:59', messages: [{ id: 'm1', from: 'me', text: tricky.messages[0].text }], replies: false };
  assert.equal(run(JSON.stringify(doc, null, 2)), encodeLink(tricky));
});
