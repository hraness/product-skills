import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSubmissionHistory, mergePendingSubmissions, observeSubmissions, pullSnapshot, readGovernedSubmissions, readPendingSubmissions, readSubmissions, renderSubmissions, searchCollections, SUBMISSIONS_FILE, validateSubmissions } from '../scripts/submissions.mjs';
import { packages, render, toolSourceHash } from '../scripts/distribution.mjs';
import { validateUpdateFiles } from '../scripts/github.mjs';

const read = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const catalog = await read(SUBMISSIONS_FILE);
const copy = () => structuredClone(catalog);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const later = '2026-11-15T09:00:00.000Z';
function pull(row, changes = {}) {
  return { number: row.number, html_url: row.url, base: { repo: { full_name: row.repository, id: row.repositoryId, private: false } }, user: row.author, created_at: row.submittedAt, updated_at: row.github.updatedAt, state: row.github.state, merged: row.github.mergedAt !== null, merged_at: row.github.mergedAt, ...changes };
}
function network(values, failure = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options }); const row = values.submissions.find((row) => url === `https://api.github.com/repos/${row.repository}/pulls/${row.number}`); assert(row);
    const body = failure[row.id] ?? pull(row);
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  } };
}

test('one PR can cover several products while duplicate identities and unsafe searches fail', () => {
  assert.equal(validateSubmissions(copy()).submissions.filter((row) => row.products.length === 4).length, 1);
  const duplicate = copy(); duplicate.submissions.push({ ...duplicate.submissions[0], id: 'different-id' }); assert.throws(() => validateSubmissions(duplicate), /duplicate pull request/);
  for (const mutate of [
    (value) => { value.submissions[0].url += '?token=secret'; },
    (value) => { value.submissions[0].repository = '../private'; },
    (value) => { value.submissions[0].products.push(value.submissions[0].products[0]); },
    (value) => { value.searches[0].queries[0] = 'awesome is:private'; },
    (value) => { value.searches[0].queries[0] += '\nprivate query'; },
    (value) => { value.targets[0].rulesUrl = 'https://github.com/example/unreviewed'; },
  ]) { const value = copy(); mutate(value); assert.throws(() => validateSubmissions(value)); }
});

test('history keeps submission identity, first date and a verified merge without freezing review prose', () => {
  const before = copy(); const changed = copy(); changed.targets[0].reason = 'A reviewed description can be clarified.'; assert.doesNotThrow(() => checkSubmissionHistory(before, changed));
  for (const field of ['id', 'submittedAt', 'products', 'repositoryId', 'url']) {
    const after = copy(); const row = after.submissions[0]; row[field] = field === 'submittedAt' ? later : field === 'products' ? ['sponge'] : field === 'repositoryId' ? 123 : `${row[field]}-changed`;
    assert.throws(() => checkSubmissionHistory(before, after));
  }
  const removed = copy(); removed.submissions.shift(); assert.throws(() => checkSubmissionHistory(before, removed), /submission identity/);
  const unmerged = copy(); unmerged.submissions[0].github = { state: 'open', updatedAt: later, mergedAt: null }; assert.throws(() => checkSubmissionHistory(before, unmerged), /merge time/);
  const older = copy(); older.submissions[0].github.updatedAt = older.submissions[0].github.mergedAt; assert.throws(() => checkSubmissionHistory(before, older), /moved backward/);
});

test('verified public reads preserve exact bytes when unchanged and attach no credentials', async () => {
  const previous = copy(); const service = network(previous);
  const result = await observeSubmissions(previous, service);
  assert.equal(json(result.catalog), json(previous)); assert.equal(service.calls.length, previous.submissions.length);
  for (const { url, options } of service.calls) { assert(url.startsWith('https://api.github.com/repos/')); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert(!options.headers.authorization); }
  const merged = copy(); const row = merged.submissions.find((entry) => entry.github.state === 'open'); row.github = { state: 'closed', updatedAt: later, mergedAt: later };
  const next = await observeSubmissions(previous, network(merged));
  assert.equal(next.catalog.submissions.find((entry) => entry.id === row.id).github.mergedAt, later);
  assert.equal(previous.submissions.find((entry) => entry.id === row.id).github.mergedAt, null);
});

test('a partial network failure or mismatched author cannot change earlier saved states', async () => {
  const previous = copy(); const before = json(previous); const service = network(previous, { [previous.submissions[0].id]: { error: 'temporarily unavailable' } });
  await assert.rejects(observeSubmissions(previous, service), /earlier records were preserved/); assert.equal(service.calls.length, previous.submissions.length); assert.equal(json(previous), before);
  const row = previous.submissions[0];
  for (const change of [{ user: { login: row.author.login, id: 999 } }, { base: { repo: { full_name: row.repository, id: row.repositoryId, private: true } } }, { created_at: later }, { merged: true, merged_at: null }]) assert.throws(() => pullSnapshot(row, pull(row, change)));
  await assert.rejects(observeSubmissions(previous, { fetchImpl: async () => new Response('x'.repeat(512 * 1024 + 1), { headers: { 'content-type': 'application/json' } }) }));
});

test('pending updates retain newer verified states and current-main strategy without inventing submissions', () => {
  const baseline = copy(); const pending = copy(); const desired = copy(); const index = pending.submissions.findIndex((row) => row.github.state === 'open');
  pending.submissions[index].github = { state: 'closed', updatedAt: later, mergedAt: later };
  desired.targets[0].reason = 'Current main has clarified the target fit.';
  const result = mergePendingSubmissions(pending, desired, baseline);
  assert.equal(result.targets[0].reason, desired.targets[0].reason); assert.equal(result.submissions[index].github.mergedAt, later);
  const invented = copy(); invented.submissions.push({ ...invented.submissions[0], id: 'invented-entry', number: 123, url: `https://github.com/${invented.submissions[0].repository}/pull/123` });
  assert.throws(() => mergePendingSubmissions(invented, desired, baseline), /Pending automation changed/);
  const conflict = copy(); conflict.submissions[index].github = { state: 'closed', updatedAt: pending.submissions[index].github.updatedAt, mergedAt: null };
  assert.throws(() => mergePendingSubmissions(pending, conflict, baseline), /merge time|Conflicting/);
});

test('pending catalogs are read from a verified exact regular Git blob', async () => {
  const head = 'a'.repeat(40); const tree = 'b'.repeat(40); const bytes = Buffer.from(json(copy())); const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const serve = (mode = '100644', corrupt = false) => async (path) => path.endsWith(`/git/commits/${head}`) ? { sha: head, tree: { sha: tree } } : path.includes('/git/trees/') ? { sha: tree, truncated: false, tree: [{ path: SUBMISSIONS_FILE, sha, type: 'blob', mode, size: bytes.length }] } : { encoding: 'base64', size: bytes.length, content: (corrupt ? Buffer.alloc(bytes.length) : bytes).toString('base64') };
  assert.deepEqual(await readPendingSubmissions(head, serve()), copy());
  await assert.rejects(readPendingSubmissions(head, serve('120000'))); await assert.rejects(readPendingSubmissions(head, serve('100644', true)));
  await assert.rejects(readPendingSubmissions('--all', async () => assert.fail('Unsafe heads cannot reach the network')));
});

test('governed catalog history permits the initial file and rejects a symlink replacement', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'submission-history-')); t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet'); await writeFile(join(root, 'README.md'), 'Fixture\n'); git('add', 'README.md'); git('commit', '--quiet', '-m', 'Initial'); const base = git('rev-parse', 'HEAD');
  assert.equal(await readGovernedSubmissions(root, base), null);
  await mkdir(join(root, 'catalog')); await writeFile(join(root, SUBMISSIONS_FILE), json(copy())); git('add', SUBMISSIONS_FILE); git('commit', '--quiet', '-m', 'Save'); assert.deepEqual(await readGovernedSubmissions(root, git('rev-parse', 'HEAD')), copy());
  await rm(join(root, SUBMISSIONS_FILE)); await symlink('../README.md', join(root, SUBMISSIONS_FILE)); git('add', SUBMISSIONS_FILE); git('commit', '--quiet', '-m', 'Invalid link'); await assert.rejects(readGovernedSubmissions(root, git('rev-parse', 'HEAD')), /regular Git blob/); await assert.rejects(readSubmissions(root), /regular bounded file/);
});

test('discovery uses each saved public query, labels limited results and points out prior submissions', async () => {
  const catalog = copy(); const known = catalog.submissions[0]; const calls = [];
  const result = await searchCollections(catalog, 'sponge', { now: () => Date.parse(later), fetchImpl: async (url, options) => {
    calls.push({ url, options }); assert(url.startsWith('https://api.github.com/search/repositories?')); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ total_count: 21, incomplete_results: false, items: [{ id: known.repositoryId, full_name: known.repository, html_url: `https://github.com/${known.repository}`, private: false, archived: false, fork: false, stargazers_count: 12, forks_count: 3, watchers_count: 12, pushed_at: later }] }), { headers: { 'content-type': 'application/json' } });
  } });
  assert.equal(calls.length, catalog.searches.find((row) => row.product === 'sponge').queries.length);
  for (const row of result.results) { assert(row.limited); assert(!row.incomplete); assert(!row.query.includes('{recent}')); assert.deepEqual(row.items[0].priorSubmissions, [known.url]); }
  await assert.rejects(searchCollections(catalog, 'private', { fetchImpl: async () => assert.fail() }));
});

test('the index projects existing provider facts and never changes selected product archives', async () => {
  const state = await read('catalog/admitted.json'); const portfolio = await read('catalog/portfolio.json'); const ledger = await read('publication-ledger.json'); const directories = await read('catalog/directory-observations.json');
  const bundles = Object.fromEntries(await Promise.all(Object.keys(state.products).map(async (id) => [id, await read(`bundles/${id}.json`)])));
  const before = render(state, bundles, portfolio, ledger, directories, copy()); const afterCatalog = copy(); afterCatalog.submissions[1].github = { state: 'closed', updatedAt: later, mergedAt: later };
  const after = render(state, bundles, portfolio, ledger, directories, afterCatalog);
  assert.notEqual(before['docs/SUBMISSIONS.md'], after['docs/SUBMISSIONS.md']);
  for (const [name, bytes] of Object.entries(packages(state, before).artifacts)) assert(bytes.equals(packages(state, after).artifacts[name]));
  const page = renderSubmissions(catalog, { ledger, directories, stores: JSON.parse(before['catalog/store-status.json']).products });
  for (const row of ledger.publications) assert(page.includes(row.url));
  for (const row of directories.observations) assert(page.includes(row.firstVerifiedAt.slice(0, 10)));
  assert(page.includes(catalog.submissions[1].url));
  assert.doesNotThrow(() => validateUpdateFiles('submissions', [SUBMISSIONS_FILE, 'docs/SUBMISSIONS.md']));
  for (const path of ['scripts/submissions.mjs', 'publication-ledger.json', '.github/workflows/submissions.yml', 'catalog/submissions.json.bak']) assert.throws(() => validateUpdateFiles('submissions', [path]));
});

test('provider status in the generated index does not create a new tooling source hash', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'submission-tooling-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['config', 'scripts', 'actions', '.github/workflows', 'test', 'docs']) await mkdir(join(root, directory), { recursive: true });
  for (const file of ['package.json', 'AGENTS.md', 'CLAUDE.md', 'LICENSE', 'CONTRIBUTING.md', 'STYLE.md', 'WRITING.md', 'GENERATION_STYLE.md', 'MESSAGING.md', 'DOCUMENTATION_GUIDELINES.md', 'README_GUIDELINES.md', 'config/sources.json', 'scripts/fixture.mjs', 'docs/SUBMISSIONS.md']) await writeFile(join(root, file), 'fixture\n');
  const before = await toolSourceHash(root); await writeFile(join(root, 'docs/SUBMISSIONS.md'), 'provider state changed\n'); assert.equal(await toolSourceHash(root), before);
  await writeFile(join(root, 'scripts/fixture.mjs'), 'source changed\n'); assert.notEqual(await toolSourceHash(root), before);
});
