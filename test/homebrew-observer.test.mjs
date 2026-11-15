import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOMEBREW_TAP as TAP, homebrewPublicationId, homebrewPublicationUrl, validateLedger, main } from '../scripts/distribution.mjs';
import { homebrewContentHash, initialHomebrewCursor, validateHomebrewCursor, readHomebrewCursor, observeHomebrew, mergePendingHomebrewCursor, publicTapJSON } from '../scripts/homebrew-observer.mjs';
import { mergePendingPublications } from '../scripts/refresh.mjs';
import { validateUpdateFiles } from '../scripts/github.mjs';

const template = await readFile(new URL('./fixtures/yaptake-homebrew.rb', import.meta.url), 'utf8');
const prefix = `repos/${TAP.repository}`; const now = () => Date.parse('2026-11-14T20:00:00Z');
const empty = () => ({ schemaVersion: 1, publications: [] });
const gitHash = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
function record(build = '17', hash = '1'.repeat(64)) { return { schemaVersion: 1, product: 'yaptake', version: '1.2.3', build, sha256: hash, url: `https://yaptake.com/downloads/${hash}/Yaptake-1.2.3-private.zip`, length: 1000, architecture: 'arm64', minimumMacOS: '26.0', edSignature: 'a'.repeat(86) + '==' }; }
function cask(value = record()) { return template.replaceAll('__VERSION__', value.version).replaceAll('__BUILD__', value.build).replaceAll('__SHA__', value.sha256); }
const id = (letter) => letter.repeat(40);
function server(states = [{}, { record: record() }]) {
  const calls = []; const blobs = new Map(); const rows = states.map((state, index) => ({ ...state, sha: id(String.fromCharCode(97 + index)), parents: index ? [{ sha: id(String.fromCharCode(96 + index)) }] : [], number: index + 1, mergedAt: `2026-11-14T18:${String(index).padStart(2, '0')}:00Z` }));
  const trees = new Map(rows.map((row) => {
    const tree = [];
    if (row.record) {
      for (const directory of ['catalog', 'Casks']) tree.push({ path: directory, type: 'tree', mode: '040000', sha: id('0') });
      for (const [path, value] of [[TAP.catalog, JSON.stringify(row.record)], [TAP.cask, row.cask ?? cask(row.record)]]) { const bytes = Buffer.from(value); const sha = gitHash(bytes); blobs.set(sha, { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }); tree.push({ path, sha, size: bytes.length, type: 'blob', mode: '100644' }); }
    }
    return [row.sha, { truncated: false, tree }];
  }));
  let main = rows.at(-1).sha;
  const pull = (row) => ({ number: row.number, state: 'closed', merged: true, merged_at: row.mergedAt, base: { ref: 'main', repo: { id: TAP.repositoryId, full_name: TAP.repository } } });
  const read = async (path) => {
    calls.push(path);
    if (path === prefix) return { id: TAP.repositoryId, full_name: TAP.repository, owner: { id: TAP.ownerId, login: 'hraness' }, private: false, visibility: 'public', default_branch: 'main' };
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: main } };
    if (path.endsWith('/actions/workflows/ci.yml')) return { id: 7, name: 'CI', path: '.github/workflows/ci.yml' };
    if (path.includes('/commits?')) {
      const history = rows.filter((row, index) => index && trees.get(row.sha).tree.find((entry) => entry.path === TAP.cask)?.sha !== trees.get(rows[index - 1].sha).tree.find((entry) => entry.path === TAP.cask)?.sha).reverse();
      const page = Number(new URL(`https://example.test/${path}`).searchParams.get('page'));
      return history.slice((page - 1) * 100, page * 100).map(({ sha, parents }) => ({ sha, parents }));
    }
    const tree = /\/git\/trees\/([a-f0-9]{40})\?/.exec(path); if (tree) return structuredClone(trees.get(tree[1]));
    const blob = /\/git\/blobs\/([a-f0-9]{40})$/.exec(path); if (blob) return structuredClone(blobs.get(blob[1]));
    const commit = /\/git\/commits\/([a-f0-9]{40})$/.exec(path); if (commit) { const row = rows.find((row) => row.sha === commit[1]); return { sha: row.sha, parents: row.parents }; }
    const compare = /\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})\?/.exec(path);
    if (compare) { const base = rows.findIndex((row) => row.sha === compare[1]); const end = rows.findIndex((row) => row.sha === compare[2]); assert(base >= 0 && end >= 0); const commits = rows.slice(base + 1, end + 1).map(({ sha, parents }) => ({ sha, parents })); return { base_commit: { sha: compare[1] }, merge_base_commit: { sha: base <= end ? compare[1] : compare[2] }, behind_by: Math.max(0, base - end), total_commits: commits.length, commits }; }
    const associated = /\/commits\/([a-f0-9]{40})\/pulls\?/.exec(path); if (associated) return [pull(rows.find((row) => row.sha === associated[1]))];
    const detail = /\/pulls\/(\d+)$/.exec(path); if (detail) return pull(rows.find((row) => row.number === Number(detail[1])));
    const timeline = /\/issues\/(\d+)\/timeline\?/.exec(path); if (timeline) { const row = rows.find((row) => row.number === Number(timeline[1])); return [{ event: 'merged', commit_id: row.sha, created_at: row.mergedAt }]; }
    if (path.includes('/actions/workflows/ci.yml/runs?')) { const sha = new URL(`https://example.test/${path}`).searchParams.get('head_sha'); return { total_count: 1, workflow_runs: [{ id: 50, workflow_id: 7, name: 'CI', head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', head_repository: { id: TAP.repositoryId, full_name: TAP.repository }, check_suite_id: 88 }] }; }
    const checks = /\/commits\/([a-f0-9]{40})\/check-runs\?/.exec(path); if (checks) return { total_count: 3, check_runs: ['Required', 'Yaptake cask', 'mirror'].map((name, index) => ({ id: index + 1, name, head_sha: checks[1], app: { id: 15368 }, check_suite: { id: name === 'mirror' ? 99 : 88 }, status: 'completed', conclusion: name === 'mirror' ? 'failure' : 'success' })) };
    throw new Error(`Unexpected synthetic public path ${path}`);
  };
  return { read, calls, rows, trees, blobs, now, setMain: (value) => { main = value; } };
}

test('cask semantic identity ignores comments, presentation and formatting while preserving install/update guards', () => {
  const value = record(); const original = cask(value); const expected = homebrewContentHash(value, original);
  const changed = original.replace('  name "Yaptake"', " name 'Yaptake preview'").replace('  desc "Video editor with transcript cuts, captions and a timeline"', " desc 'A new description'").replace('  sha256 ', '    sha256    ').replace('  auto_updates true', ' auto_updates   true # inline explanation').replace('  depends_on arch: :arm64', ' depends_on   arch:  :arm64').replace('  livecheck do', '# Updated comment\n livecheck   do');
  assert.equal(homebrewContentHash(value, changed), expected);
  for (const form of ['#{1 + 1}', '#@instance', '#$global']) for (const count of [0, 1, 2, 3, 4]) {
    const presentation = original.replace('name "Yaptake"', `name "A ${'\\'.repeat(count)}${form}"`);
    if (count % 2 === 0) assert.throws(() => homebrewContentHash(value, presentation), /presentation/);
    else assert.equal(homebrewContentHash(value, presentation), expected);
  }
  for (const changed of [original.replace('auto_updates true', 'auto_updates false'), original.replace(':arm64', ':x86_64'), original.replace(':tahoe', ':sequoia'), original.replace('  app "Yaptake.app"', '  app "Another.app"'), original.replace('  app "Yaptake.app"', '  preflight do\n    system "whoami"\n  end\n  app "Yaptake.app"'), original.replace('  app "Yaptake.app"', '  zap trash: "~/Documents"\n  app "Yaptake.app"'), original.replace('auto_updates true', 'auto_updates\n true'), original.replace('sparkle:version', 'unknown:version')]) assert.throws(() => homebrewContentHash(value, changed));
  assert.throws(() => homebrewContentHash({ ...value, architecture: 'x86_64' }, original));
});

test('oldest-first batches recover missed cask versions, preserve formatting/revert dates and then cost only two reads', async () => {
  const first = record(); const newer = record('18', '2'.repeat(64));
  const current = server([{}, { record: first }, { record: first, cask: cask(first).replace('# Synthetic', '# Formatting only\n# Synthetic') }, { record: newer }, { record: first }]);
  const firstBatch = await observeHomebrew(empty(), initialHomebrewCursor(), current); assert.equal(firstBatch.report.caughtUp, false); assert.equal(firstBatch.cursor.throughCommit, id('c')); assert.equal(firstBatch.ledger.publications.length, 1);
  const introduction = firstBatch.ledger.publications[0]; assert.equal(introduction.id, 'yaptake-homebrew-1-2-3-17'); assert.equal(introduction.publishedAt, '2026-11-14T18:01:00.000Z'); assert.equal(introduction.url, homebrewPublicationUrl(id('b')));
  const secondBatch = await observeHomebrew(firstBatch.ledger, firstBatch.cursor, current); assert.equal(secondBatch.ledger.publications.length, 2); assert.equal(secondBatch.report.caughtUp, true); assert.deepEqual(secondBatch.ledger.publications[0], introduction);
  current.calls.length = 0; const unchanged = await observeHomebrew(secondBatch.ledger, secondBatch.cursor, current); assert.equal(unchanged.report.status, 'unchanged'); assert.equal(current.calls.length, 2);
  assert(!current.calls.some((path) => path.includes('/releases')));
});

test('changed archive/platform/guard identity or conflicting prior records never replace a published version/build', async () => {
  const initial = server(); const previous = await observeHomebrew(empty(), initialHomebrewCursor(), initial);
  const changed = server([{}, { record: record() }, { record: record('17', '2'.repeat(64)) }]);
  await assert.rejects(observeHomebrew(previous.ledger, previous.cursor, changed), /semantic identity/);
  const wrongDate = structuredClone(previous.ledger); wrongDate.publications[0].publishedAt = '2026-11-14T19:00:00.000Z'; await assert.rejects(observeHomebrew(wrongDate, initialHomebrewCursor(), initial), /first date/);
  const pending = structuredClone(previous.ledger); pending.publications[0].publishedAt = '2026-11-14T18:02:00.000Z'; assert.throws(() => mergePendingPublications(pending, previous.ledger, empty()));
});

test('partial histories, unmerged proposals, wrong CI suites and raced main preserve both input objects', async () => {
  const change = (target) => async (path, value) => {
    if (target === 'partial' && path.includes('/compare/')) return { ...value, total_commits: value.total_commits + 1 };
    if (target === 'unmerged' && /\/pulls\/\d+$/.test(path)) return { ...value, merged: false };
    if (target === 'suite' && path.includes('/check-runs?')) return { ...value, check_runs: value.check_runs.map((row) => row.name === 'Yaptake cask' ? { ...row, check_suite: { id: 77 } } : row) };
    if (target === 'missing' && path.includes('/check-runs?')) return { ...value, total_count: 4 };
    if (target === 'timeline' && path.includes('/timeline?')) return [...value, ...value];
    return value;
  };
  for (const target of ['partial', 'unmerged', 'suite', 'missing', 'timeline']) {
    const current = server(); const ledger = empty(); const cursor = initialHomebrewCursor(); const mutate = change(target);
    await assert.rejects(observeHomebrew(ledger, cursor, { ...current, read: async (path) => mutate(path, await current.read(path)) })); assert.deepEqual(ledger, empty()); assert.deepEqual(cursor, initialHomebrewCursor());
  }
  const future = server(); future.rows[1].mergedAt = '2099-01-01T00:00:00Z'; await assert.rejects(observeHomebrew(empty(), initialHomebrewCursor(), future), /future/);
  const raced = server(); let refs = 0;
  await assert.rejects(observeHomebrew(empty(), initialHomebrewCursor(), { ...raced, read: async (path) => { const value = await raced.read(path); if (path.endsWith('/git/ref/heads/main') && ++refs > 1) return { object: { sha: id('f') } }; return value; } }), /changed during/);
});

test('complete comparison pagination follows only actual first-parent main states and history bounds fail closed', async () => {
  const current = server(); const base = id('a'); const published = id('b');
  const branches = Array.from({ length: 100 }, (_, index) => ({ sha: 'f' + index.toString(16).padStart(39, '0'), parents: [{ sha: index ? 'f' + (index - 1).toString(16).padStart(39, '0') : base }] }));
  const read = async (path) => {
    if (path.includes('/compare/')) {
      current.calls.push(path); const page = Number(new URL(`https://example.test/${path}`).searchParams.get('page'));
      return { base_commit: { sha: base }, merge_base_commit: { sha: base }, behind_by: 0, total_commits: 101, commits: page === 1 ? branches : [{ sha: published, parents: [{ sha: base }, { sha: branches.at(-1).sha }] }] };
    }
    return current.read(path);
  };
  const result = await observeHomebrew(empty(), initialHomebrewCursor(), { ...current, read }); assert.equal(result.ledger.publications.length, 1); assert.equal(current.calls.filter((path) => path.includes('/compare/')).length, 2);
  assert(!current.calls.some((path) => path.includes(`/git/trees/${branches[0].sha}`)));
  const bounded = server(); let pages = 0;
  await assert.rejects(observeHomebrew(empty(), initialHomebrewCursor(), { ...bounded, read: (path) => {
    if (!path.includes('/commits?')) return bounded.read(path);
    pages++; return Array.from({ length: 100 }, (_, index) => ({ sha: (pages * 100 + index).toString(16).padStart(40, '0') }));
  } }), /read bound/); assert.equal(pages, 5);
});

test('cursor merging retains the furthest verified ancestry and refuses rollback or divergence', async () => {
  const current = server([{}, { record: record() }, { record: record('18', '2'.repeat(64)) }]);
  const at = (letter) => ({ ...initialHomebrewCursor(), throughCommit: id(letter) });
  assert.deepEqual(await mergePendingHomebrewCursor(at('c'), at('b'), at('a'), current), at('c'));
  assert.deepEqual(await mergePendingHomebrewCursor(at('b'), at('c'), at('a'), current), at('c'));
  await assert.rejects(mergePendingHomebrewCursor(at('a'), at('c'), at('b'), current), /backward/);
  await assert.rejects(mergePendingHomebrewCursor(at('b'), at('c'), at('a'), { read: async () => ({ behind_by: 1 }) }), /backward/);
  await assert.rejects(mergePendingHomebrewCursor(at('b'), at('c'), at('a'), { read: async (path) => { const [base, head] = /compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})/.exec(path).slice(1); return { base_commit: { sha: base }, merge_base_commit: { sha: base }, behind_by: base === id('a') ? 0 : 1 }; } }), /diverged/);
  validateUpdateFiles('publications', [TAP.cursor]); assert.throws(() => validateUpdateFiles('publications', ['catalog/other-tap.json']));
  assert.throws(() => validateHomebrewCursor({ ...at('a'), observations: [] }));
});

test('Homebrew ledger records bind one product, version/build ID, immutable cask URL and actual date', async () => {
  const current = server(); const entry = (await observeHomebrew(empty(), initialHomebrewCursor(), current)).ledger.publications[0];
  validateLedger({ schemaVersion: 1, publications: [entry] });
  for (const change of [{ product: 'sponge' }, { id: `${entry.id}-other` }, { version: '1.2.4' }, { url: `https://github.com/${TAP.repository}/blob/main/Casks/yaptake.rb` }, { url: `https://github.com/${TAP.repository}/releases/tag/archive` }, { publishedAt: '2099-01-01T00:00:00.000Z' }]) assert.throws(() => validateLedger({ schemaVersion: 1, publications: [{ ...entry, ...change }] }));
  assert.throws(() => homebrewPublicationId('1.2.3', '017'));
});

test('public transport is bounded GET-only without credentials or redirects', async () => {
  const seen = []; await publicTapJSON(prefix, { fetchImpl: async (url, options) => { seen.push({ url, options }); return new Response('{}'); } });
  assert.equal(seen[0].url, `https://api.github.com/${prefix}`); assert.equal(seen[0].options.method, 'GET'); assert.equal(seen[0].options.redirect, 'error'); assert(!seen[0].options.headers.authorization); assert(!seen[0].options.headers.cookie);
  for (const response of [() => new Response('', { status: 302 }), () => new Response('x'.repeat(1024 * 1024 + 1)), () => new Response('{"a":1,"a":2}')]) await assert.rejects(publicTapJSON(prefix, { fetchImpl: async () => response() }));
});

test('the CLI persists ledger and cursor together and preserves both plus rendered output after source failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'homebrew-ledger-test-')); const prior = globalThis.fetch; t.after(async () => { globalThis.fetch = prior; await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, 'catalog')); await writeFile(join(root, 'catalog/admitted.json'), JSON.stringify({ schemaVersion: 1, products: {} })); await writeFile(join(root, 'catalog/portfolio.json'), await readFile(new URL('../catalog/portfolio.json', import.meta.url))); await writeFile(join(root, 'publication-ledger.json'), JSON.stringify(empty())); await writeFile(join(root, TAP.cursor), JSON.stringify(initialHomebrewCursor()));
  await writeFile(join(root, 'catalog/directory-observations.json'), JSON.stringify({ schemaVersion: 1, scope: 'listing-presence', observations: [] }));
  const current = server(); globalThis.fetch = async (url) => new Response(JSON.stringify(await current.read(url.replace('https://api.github.com/', '')))); await main(['record-homebrew'], root);
  const files = ['publication-ledger.json', TAP.cursor, 'README.md']; const before = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readFile(join(root, file), 'utf8')])));
  assert.equal(JSON.parse(before['publication-ledger.json']).publications.length, 1); assert((await readHomebrewCursor(root)).throughCommit);
  const later = server([{}, { record: record() }, { record: record('18', '2'.repeat(64)) }, { record: record('19', '3'.repeat(64)) }]);
  globalThis.fetch = async (url) => url.includes(`/commits/${id('d')}/check-runs?`) ? new Response('{}', { status: 503 }) : new Response(JSON.stringify(await later.read(url.replace('https://api.github.com/', '')))); await assert.rejects(main(['record-homebrew'], root));
  assert(later.calls.some((path) => path.includes(`/commits/${id('c')}/check-runs?`)));
  for (const file of files) assert.equal(await readFile(join(root, file), 'utf8'), before[file]); assert.equal(JSON.parse(await readFile(join(root, 'dist/homebrew-observation.json'), 'utf8')).status, 'pending');
  const outside = join(root, 'outside.json'); await writeFile(outside, JSON.stringify(initialHomebrewCursor())); await rm(join(root, TAP.cursor)); await symlink(outside, join(root, TAP.cursor)); await assert.rejects(readHomebrewCursor(root), /regular/);
});
