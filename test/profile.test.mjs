import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, symlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { END, START, assertProfileChange, checkProfile, profileIdentity, renderProfile, refreshProfile } from '../scripts/profile.mjs';
import { PRODUCTS, writeRendered } from '../scripts/distribution.mjs';
// The four products' facts. The committed catalog may also list profile-only entries.
const catalogPortfolio = JSON.parse(await readFile(new URL('../catalog/portfolio.json', import.meta.url), 'utf8'));
const portfolio = { ...catalogPortfolio, projects: catalogPortfolio.projects.filter((p) => Object.hasOwn(PRODUCTS, p.id)) };
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
test('the profile shows each name as the portfolio spells it', async () => {
  // Both spellings are set here, so the test holds whichever one the catalog has today.
  const spelled = (name) => { const copy = structuredClone(portfolio); copy.projects.find((p) => p.id === 'dawn').name = name; return copy; };
  const today = renderProfile(`${START}\n${END}\n`, spelled('Dawn')); assert.ok(today.includes('- [Dawn](https://dawnav.com): '));
  const after = renderProfile(today, spelled('DAWN'));
  assert.ok(after.includes('- [DAWN](https://dawnav.com): ') && !after.includes('[Dawn]'));
  // The address is unchanged, so the rename needs no destination read.
  const changed = await refreshProfile(today, spelled('DAWN'), { fetchImpl: async () => assert.fail('An unchanged address was read') });
  assert.deepEqual(changed, { changed: true, readme: after });
});
test('new profile destinations require successful reads and unchanged lists do not fetch', async () => {
  const before = `${START}\n${END}\n`; let calls = 0;
  const fetchImpl = async (url, options) => { assert.equal(options.redirect, 'error'); assert.equal(options.method, 'HEAD'); assert.ok(portfolio.projects.some((p) => p.url === url)); calls++; return new Response(null, { status: 200 }); };
  const first = await refreshProfile(before, portfolio, { fetchImpl }); assert.equal(first.changed, true); assert.equal(calls, 4);
  await refreshProfile(first.readme, portfolio, { fetchImpl }); assert.equal(calls, 4);
  await assert.rejects(refreshProfile(before, portfolio, { fetchImpl: async () => new Response(null, { status: 404 }) }));
});
test('profiles link a profile-only portfolio entry after reading its new destination', async () => {
  const listed = { ...portfolio, projects: [...portfolio.projects, { id: 'yiii', name: 'yiii', url: 'https://yiii.io', short: 'Learn languages faster (ZH + EN).', icon: '/products/yiii/icon.png' }] };
  const before = renderProfile(`${START}\n${END}\n`, portfolio); const after = renderProfile(before, listed);
  assert.equal((after.match(/^- \[/gm) ?? []).length, 5); assert.ok(after.includes('\n- [yiii](https://yiii.io): Learn languages faster (ZH + EN).\n'));
  let calls = 0; const fetchImpl = async (url, options) => { assert.equal(url, 'https://yiii.io'); assert.equal(options.method, 'HEAD'); assert.equal(options.redirect, 'error'); calls++; return new Response(null, { status: 200 }); };
  assert.deepEqual(await refreshProfile(before, listed, { fetchImpl }), { changed: true, readme: after }); assert.equal(calls, 1);
  const root = await mkdtemp(join(tmpdir(), 'product-profile-listed-')); const serve = async () => new Response(JSON.stringify(listed));
  try {
    await writeFile(join(root, 'README.md'), before); await assert.rejects(checkProfile({ repository: '0thernet/0thernet', root, fetchImpl: serve }), /differs/);
    await writeFile(join(root, 'README.md'), after);
    assert.deepEqual((await checkProfile({ repository: '0thernet/0thernet', root, fetchImpl: serve })).products, [...portfolio.projects.map((p) => p.id), 'yiii']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('generated writes reject symlink escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'product-write-')); const outside = await mkdtemp(join(tmpdir(), 'product-outside-'));
  try { await symlink(outside, join(root, 'plugins')); await assert.rejects(writeRendered(root, { 'plugins/sponge/README.md': 'Do not write outside the repository.' })); }
  finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test('the read-only profile check follows public facts and preserves personal text without a token', async () => {
  const root = await mkdtemp(join(tmpdir(), 'product-profile-check-'));
  try {
    const original = renderProfile(`Personal introduction.\n\n${START}\n${END}\n\n[Personal stats](https://stats.example.test/)\n`, portfolio);
    await writeFile(join(root, 'README.md'), original); let requests = 0;
    const fetchImpl = async (url, options) => {
      assert.equal(url, 'https://hraness.com/portfolio.json'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, undefined); assert.equal(options.headers.Authorization, undefined); requests++;
      return new Response(JSON.stringify(portfolio));
    };
    const result = await checkProfile({ repository: '0thernet/0thernet', root, fetchImpl });
    assert.deepEqual(result.products, portfolio.projects.map((product) => product.id)); assert.equal(requests, 1);
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original); assert.equal(JSON.stringify(result).includes('Personal'), false);
    await assert.rejects(checkProfile({ repository: 'someone/else', root, fetchImpl })); assert.equal(requests, 1);
    const updated = structuredClone(portfolio); updated.projects[0].short = 'An updated factual description.';
    await assert.rejects(checkProfile({ repository: '0thernet/0thernet', root, fetchImpl: async () => new Response(JSON.stringify(updated)) }), /differs/);
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('profile checks reject missing markers, invalid public facts and unavailable canonical data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'product-profile-facts-')); const path = join(root, 'profile/README.md');
  const fetchImpl = async () => new Response(JSON.stringify(portfolio));
  try {
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'A README without its product markers.\n');
    await assert.rejects(checkProfile({ repository: 'hraness/.github', root, fetchImpl }), /markers/);
    await writeFile(path, renderProfile(`${START}\n${END}\n`, portfolio));
    const unsafe = structuredClone(portfolio); unsafe.projects[0].url = 'https://example.test/private';
    await assert.rejects(checkProfile({ repository: 'hraness/.github', root, fetchImpl: async () => new Response(JSON.stringify(unsafe)) }), /identity/);
    await assert.rejects(checkProfile({ repository: 'hraness/.github', root, fetchImpl: async () => new Response(null, { status: 503 }) }), /503/);
    await writeFile(path, Buffer.from([255])); await assert.rejects(checkProfile({ repository: 'hraness/.github', root, fetchImpl }), /encoded data/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('profile checks refuse a symlinked README or profile directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'product-profile-links-')); const outside = await mkdtemp(join(tmpdir(), 'product-profile-external-'));
  const fetchImpl = async () => { throw new Error('Unsafe local paths must fail before any public read'); };
  try {
    await writeFile(join(outside, 'README.md'), renderProfile(`${START}\n${END}\n`, portfolio));
    await symlink(join(outside, 'README.md'), join(root, 'README.md'));
    await assert.rejects(checkProfile({ repository: '0thernet/0thernet', root, fetchImpl }), /regular file/);
    await symlink(outside, join(root, 'profile'));
    await assert.rejects(checkProfile({ repository: 'hraness/.github', root, fetchImpl }), /directory must be regular/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test('profile writes require the exact public repository, owner and current default main', async () => {
  for (const [repository, id, owner] of [['hraness/.github', 1342874802, 307125679], ['0thernet/0thernet', 1342874174, 894119]]) {
    const env = { GITHUB_REPOSITORY: repository, GH_TOKEN: 'synthetic-app-token' };
    const metadata = { id, full_name: repository, owner: { id: owner }, private: false, default_branch: 'main' };
    const read = async (path) => { assert.equal(path, `repos/${repository}`); return metadata; };
    assert.equal(await profileIdentity({ env, read }), repository);
    for (const change of [{ default_branch: 'another-branch' }, { id: 1 }, { owner: { id: 1 } }, { private: true }, { full_name: 'someone/else' }]) await assert.rejects(profileIdentity({ env, read: async () => ({ ...metadata, ...change }) }), /identity mismatch/);
    await assert.rejects(profileIdentity({ env: { ...env, GH_TOKEN: '', GITHUB_TOKEN: 'no-fallback' }, read }));
  }
});
