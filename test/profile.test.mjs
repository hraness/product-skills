import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { END, START, assertProfileChange, renderProfile, refreshProfile } from '../scripts/profile.mjs';
import { writeRendered } from '../scripts/distribution.mjs';
const portfolio = JSON.parse(await readFile(new URL('../catalog/portfolio.json', import.meta.url), 'utf8'));
test('profile sync preserves every byte outside unique own-line markers', () => {
  const before = `An introduction, preserved.\n\n${START}\nOld product list.\n${END}\n\nPersonal notes, preserved.\n`;
  const after = renderProfile(before, portfolio);
  assert.ok(after.startsWith(`An introduction, preserved.\n\n${START}`));
  assert.ok(after.endsWith(`${END}\n\nPersonal notes, preserved.\n`));
  assert.equal(renderProfile(after, portfolio), after);
  assert.equal((after.match(/^- \[/gm) ?? []).length, 4);
  assert.throws(() => renderProfile(before + `\n${START}\n`, portfolio));
  assert.throws(() => renderProfile(before.replace(START, `inline ${START}`), portfolio));
  assert.throws(() => renderProfile(`${END}\n${START}`, portfolio));
  const crlf = before.replaceAll('\n', '\r\n'); const crlfResult = renderProfile(crlf, portfolio); assert.ok(crlfResult.endsWith(`${END}\r\n\r\nPersonal notes, preserved.\r\n`)); assert.ok(!crlfResult.includes('\r\r')); assert.equal(renderProfile(crlfResult, portfolio), crlfResult);
  assert.doesNotThrow(() => assertProfileChange(before, after, portfolio));
  assert.throws(() => assertProfileChange(before, after.replace('An introduction, preserved.', 'An unrelated profile change.'), portfolio));
  assert.throws(() => assertProfileChange(before, after.replace('Personal notes, preserved.', 'Removed personal notes.'), portfolio));
});
test('new profile destinations require successful reads and unchanged lists do not fetch', async () => {
  const before = `${START}\n${END}\n`; let calls = 0;
  const fetchImpl = async (url, options) => { assert.equal(options.redirect, 'error'); assert.equal(options.method, 'HEAD'); assert.ok(portfolio.projects.some((p) => p.url === url)); calls++; return new Response(null, { status: 200 }); };
  const first = await refreshProfile(before, portfolio, { fetchImpl }); assert.equal(first.changed, true); assert.equal(calls, 4);
  await refreshProfile(first.readme, portfolio, { fetchImpl }); assert.equal(calls, 4);
  await assert.rejects(refreshProfile(before, portfolio, { fetchImpl: async () => new Response(null, { status: 404 }) }));
});
test('generated writes reject symlink escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'product-write-')); const outside = await mkdtemp(join(tmpdir(), 'product-outside-'));
  try { await symlink(outside, join(root, 'plugins')); await assert.rejects(writeRendered(root, { 'plugins/sponge/README.md': 'Do not write outside the repository.' })); }
  finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
