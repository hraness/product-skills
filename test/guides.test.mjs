import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GUIDE_FILES, GUIDE_RECORD, repositoryAdditions, mergeGuide, fetchGuideSnapshot, refreshGuides, checkGuides, validateGuideRecord } from '../scripts/guides.mjs';
import { validateUpdateFiles } from '../scripts/github.mjs';

const initial = 'a'.repeat(40); const next = 'b'.repeat(40); const tree = 'c'.repeat(40);
const hash = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
function source({ commit = initial, changed = false, mode = '100644', missingLast = false, large = false } = {}) {
  const files = Object.fromEntries(GUIDE_FILES.map((file) => [file, Buffer.from(large && file === 'STYLE.md' ? '# Shared guide\n\n' + 'x'.repeat(40000) + '\n' : `# ${file}\n\nShared guidance${(changed && file === 'STYLE.md') || large ? ' updated' : ''}.\n`)]));
  const entries = Object.entries(files).map(([path, bytes]) => ({ path, type: 'blob', mode, size: bytes.length, sha: hash(bytes) }));
  const calls = [];
  const read = async (path) => {
    calls.push(path);
    if (path === 'repos/hraness/.github') return { id: 1342874802, full_name: 'hraness/.github', private: false, visibility: 'public', default_branch: 'main', owner: { id: 307125679 } };
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: commit } };
    if (path.endsWith(`/git/commits/${commit}`)) return { sha: commit, tree: { sha: tree } };
    if (path.endsWith(`/git/trees/${tree}?recursive=1`)) return { truncated: false, tree: entries };
    const entry = entries.find((entry) => path.endsWith(`/git/blobs/${entry.sha}`));
    if (entry && !(missingLast && entry.path === GUIDE_FILES.at(-1))) return { sha: entry.sha, encoding: 'base64', size: entry.size, content: files[entry.path].toString('base64') };
    throw new Error('Unavailable public source');
  };
  return { files, read, calls };
}
async function checkout(t) {
  const root = await mkdtemp(join(tmpdir(), 'guides-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'catalog'));
  for (const file of GUIDE_FILES) await writeFile(join(root, file), '# Initial guide\n');
  await writeFile(join(root, 'CONTRIBUTING.md'), 'Local contribution instructions.\n');
  await writeFile(join(root, 'AGENTS.md'), 'Local agent instructions.\n');
  return root;
}

test('shared guide updates preserve the Repository additions text and ignore fenced examples', () => {
  const tail = '## Repository additions\n\nUse the local command.\n\n';
  const example = '# Guide\n\n```md\n## Repository additions\nExample only.\n```\n';
  assert.equal(repositoryAdditions(example), '');
  assert.equal(repositoryAdditions('    ## Repository additions\n    This is indented code.\n'), '');
  assert.equal(mergeGuide('# New shared guide\n', example + '\n' + tail), '# New shared guide\n\n' + tail);
  assert.equal(mergeGuide('# Shared\n\n', '# Old\n\n' + tail), '# Shared\n\n' + tail);
  for (let spaces = 0; spaces <= 3; spaces++) {
    const indented = ' '.repeat(spaces) + tail;
    assert.equal(mergeGuide('# Shared\n', '# Old\n\n' + indented), '# Shared\n\n' + indented);
    assert.throws(() => mergeGuide('# Canonical\n\n' + indented, '# Local\n'), /canonical/);
  }
  assert.throws(() => repositoryAdditions(tail + tail), /multiple/);
  assert.throws(() => repositoryAdditions('```md\nUnclosed.\n'), /closed/);
  assert.throws(() => mergeGuide('# Shared\n\n' + tail, '# Local\n'), /canonical/);
  validateUpdateFiles('guides', [...GUIDE_FILES, GUIDE_RECORD]);
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'scripts/guides.mjs', '../STYLE.md']) assert.throws(() => validateUpdateFiles('guides', [file]));
});

test('one immutable source refresh updates only selected guides and preserves local additions without no-op churn', async (t) => {
  const root = await checkout(t); const current = source(); const tail = '   ## Repository additions\n\nKeep these commands.\n';
  await writeFile(join(root, 'STYLE.md'), '# Initial\n\n' + tail);
  const record = await refreshGuides(root, current); assert.equal(record.sourceCommit, initial);
  assert.equal(await readFile(join(root, 'STYLE.md'), 'utf8'), current.files['STYLE.md'].toString() + '\n' + tail);
  await checkGuides(root);
  assert.equal(await readFile(join(root, 'CONTRIBUTING.md'), 'utf8'), 'Local contribution instructions.\n');
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'Local agent instructions.\n');
  const saved = await readFile(join(root, GUIDE_RECORD), 'utf8');
  await refreshGuides(root, source({ commit: next })); assert.equal(await readFile(join(root, GUIDE_RECORD), 'utf8'), saved);
  const changed = source({ commit: next, changed: true }); await refreshGuides(root, changed); assert.equal((await checkGuides(root)).sourceCommit, next);
  assert((await readFile(join(root, 'STYLE.md'), 'utf8')).endsWith(tail));
  assert.equal(current.calls.filter((path) => path.includes('/git/ref/')).length, 1);
  assert.equal(current.calls.filter((path) => path.includes('/git/blobs/')).length, GUIDE_FILES.length);
});

test('incomplete sources and symlinks cannot partially overwrite selected guides', async (t) => {
  const root = await checkout(t); await refreshGuides(root, source());
  const before = Object.fromEntries(await Promise.all([...GUIDE_FILES, GUIDE_RECORD].map(async (file) => [file, await readFile(join(root, file), 'utf8')])));
  for (const options of [{ missingLast: true }, { mode: '120000' }]) {
    await assert.rejects(refreshGuides(root, source({ commit: next, changed: true, ...options })));
    for (const [file, value] of Object.entries(before)) assert.equal(await readFile(join(root, file), 'utf8'), value);
  }
  const target = join(root, 'outside.md'); await writeFile(target, 'Preserve this target.\n');
  await rm(join(root, 'STYLE.md')); await symlink(target, join(root, 'STYLE.md'));
  await assert.rejects(refreshGuides(root, source()), /regular/); assert.equal(await readFile(target, 'utf8'), 'Preserve this target.\n');
});

test('a shared prefix and preserved tail must fit together before any guide or record is written', async (t) => {
  const root = await checkout(t); await refreshGuides(root, source());
  const style = join(root, 'STYLE.md'); await append(style, '\n## Repository additions\n\n' + 'y'.repeat(30000) + '\n'); await checkGuides(root);
  const before = Object.fromEntries(await Promise.all([...GUIDE_FILES, GUIDE_RECORD].map(async (file) => [file, await readFile(join(root, file), 'utf8')])));
  const larger = source({ commit: next, large: true });
  assert(larger.files['STYLE.md'].length < 65536); assert(Buffer.byteLength(before['STYLE.md']) < 65536);
  await assert.rejects(refreshGuides(root, larger), /limit/);
  for (const [file, value] of Object.entries(before)) assert.equal(await readFile(join(root, file), 'utf8'), value);
});

test('the recorded shared prefix is checked while repository additions remain editable', async (t) => {
  const root = await checkout(t); await refreshGuides(root, source());
  const path = join(root, 'STYLE.md'); await append(path, '\n## Repository additions\n\nA local rule.\n'); await checkGuides(root);
  const original = await readFile(path, 'utf8'); await writeFile(path, original.replace('Shared guidance', 'Changed shared guidance'));
  await assert.rejects(checkGuides(root), /differs/); await assert.rejects(refreshGuides(root, source()), /differs/);
  const record = JSON.parse(await readFile(join(root, GUIDE_RECORD), 'utf8'));
  assert.throws(() => validateGuideRecord({ ...record, privateSource: true }));
  assert.throws(() => validateGuideRecord({ ...record, files: { ...record.files, 'AGENTS.md': record.files['STYLE.md'] } }));
});
async function append(path, value) { await writeFile(path, await readFile(path, 'utf8') + value); }

test('public guide reads are bounded GET requests without credentials or redirect following', async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; }); const current = source(); const seen = [];
  globalThis.fetch = async (url, options) => { seen.push({ url, options }); return new Response(JSON.stringify(await current.read(url.replace('https://api.github.com/', '')))); };
  assert.equal((await fetchGuideSnapshot()).record.sourceCommit, initial);
  for (const { url, options } of seen) { assert(url.startsWith('https://api.github.com/')); assert.equal(options.redirect, 'error'); assert.equal(options.method, undefined); assert(!options.headers.Authorization); assert(!options.headers.Cookie); }
  globalThis.fetch = async () => new Response('', { status: 302, headers: { Location: 'https://another.example/' } }); await assert.rejects(fetchGuideSnapshot(), /unavailable/);
  globalThis.fetch = async () => new Response('x'.repeat(1024 * 1024 + 1)); await assert.rejects(fetchGuideSnapshot(), /limit/);
});
