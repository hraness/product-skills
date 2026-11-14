import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_BOT } from '../scripts/authority.mjs';
import { captureGenerated, mergePendingPublications, refreshGeneratedPull } from '../scripts/refresh.mjs';

const main = 'a'.repeat(40); const head = 'b'.repeat(40); const tree = 'c'.repeat(40); const mainTree = 'd'.repeat(40); const nextTree = 'e'.repeat(40); const nextHead = 'f'.repeat(40);
const blob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const selected = 'plugins/sponge/README.md'; const before = Buffer.from('Earlier generated instructions.\n'); const after = Buffer.from('Current generated instructions.\n');
function server({ current = head, conflict = false, matchesMain = false } = {}) {
  let actual = current; const writes = [];
  const read = async (path) => {
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: main } };
    if (path.includes('/git/ref/heads/automation/')) return { object: { sha: actual } };
    if (path.endsWith(`/git/commits/${head}`)) return { tree: { sha: tree } };
    if (path.endsWith(`/git/commits/${main}`)) return { tree: { sha: mainTree } };
    if (path.includes('/git/trees/')) return { truncated: false, tree: [{ path: selected, mode: '100644', type: 'blob', sha: blob(before) }, { path: 'unrelated.txt', mode: '100644', type: 'blob', sha: '1'.repeat(40) }] };
    throw new Error(`Unexpected generated-update read ${path}`);
  };
  const write = async (method, path, body) => {
    writes.push({ method, path, body });
    if (path.endsWith('/git/blobs')) return { sha: blob(Buffer.from(body.content, 'base64')) };
    if (path.endsWith('/git/trees')) return { sha: matchesMain ? mainTree : nextTree };
    if (path.endsWith('/git/commits')) return { sha: nextHead };
    if (path.includes('/git/refs/heads/')) { if (conflict) throw new Error('Non-forced concurrent ref update refused'); actual = body.sha; return { object: { sha: actual } }; }
    throw new Error('Unexpected generated-update mutation');
  };
  return { kind: 'products', branch: 'automation/products-1-1', sourceBase: main, head, desired: { [selected]: after }, bot: { login: APP_BOT, id: 12345 }, read, write, writes };
}
test('an open proposal with an older failed generated head receives only the latest desired files', async () => {
  const current = server(); const result = await refreshGeneratedPull(current);
  assert.equal(result.changed, true); assert.equal(result.head, nextHead);
  const treeWrite = current.writes.find((entry) => entry.path.endsWith('/git/trees'));
  assert.equal(treeWrite.body.base_tree, tree); assert.deepEqual(treeWrite.body.tree.map((entry) => entry.path), [selected]);
  assert.deepEqual(current.writes.find((entry) => entry.path.endsWith('/git/commits')).body.parents, [head]);
  assert.deepEqual(current.writes.at(-1).body, { sha: nextHead, force: false });
  const unchanged = server(); unchanged.desired[selected] = before;
  assert.equal((await refreshGeneratedPull(unchanged)).changed, false); assert.equal(unchanged.writes.length, 0);
});
test('generated refresh refuses concurrent heads and retains proposals whose conditional update fails', async () => {
  const changed = server({ current: nextHead }); await assert.rejects(refreshGeneratedPull(changed)); assert.equal(changed.writes.length, 0);
  const conflict = server({ conflict: true }); await assert.rejects(refreshGeneratedPull(conflict)); assert.equal(conflict.writes.at(-1).body.force, false);
  const obsolete = server({ matchesMain: true }); assert.equal((await refreshGeneratedPull(obsolete)).matchesMain, true); assert.ok(!obsolete.writes.some((entry) => entry.path.endsWith('/git/commits')));
});
test('pending publication refresh keeps the first verified timestamp while preserving committed entries', () => {
  const entry = (id, version = '0.1.0') => ({ id, product: 'sponge', channel: 'github', version, contentHash: 'a'.repeat(64), publishedAt: '2026-11-14T18:00:00.000Z', url: 'https://github.com/hraness/product-skills/releases/tag/integrations-aabbccddeeff0011' });
  const baseline = { schemaVersion: 1, publications: [entry('committed')] };
  const pending = { schemaVersion: 1, publications: [...baseline.publications, entry('pending')] };
  const repeated = { ...entry('pending'), publishedAt: '2026-11-14T19:00:00.000Z', url: 'https://github.com/hraness/product-skills/releases/tag/integrations-1122334455667788' };
  const desired = { schemaVersion: 1, publications: [...baseline.publications, repeated, entry('newer', '0.1.1')] };
  const merged = mergePendingPublications(pending, desired, baseline);
  assert.deepEqual(merged.publications.find((item) => item.id === 'pending'), pending.publications[1]); assert.equal(merged.publications.length, 3);
  assert.throws(() => mergePendingPublications(pending, { ...desired, publications: [{ ...repeated, version: '0.9.0' }] }, baseline));
  assert.throws(() => mergePendingPublications({ ...pending, publications: [{ ...baseline.publications[0], publishedAt: repeated.publishedAt }] }, desired, baseline));
});
test('desired file capture uses the closed path set and refuses symlink escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'generated-desired-')); const outside = await mkdtemp(join(tmpdir(), 'generated-outside-'));
  try {
    await mkdir(join(root, 'plugins/sponge'), { recursive: true }); await writeFile(join(root, selected), after);
    const captured = await captureGenerated(root, 'products', [selected, 'plugins/sponge/LICENSE']); assert.deepEqual(captured[selected], await readFile(join(root, selected))); assert.equal(captured['plugins/sponge/LICENSE'], null);
    await assert.rejects(captureGenerated(root, 'products', ['scripts/private.mjs']));
    await rm(join(root, selected)); await symlink(join(outside, 'private.txt'), join(root, selected)); await assert.rejects(captureGenerated(root, 'products', [selected]));
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
