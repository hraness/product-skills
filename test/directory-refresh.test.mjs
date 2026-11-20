import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDirectoryDates, digest, packages, readGovernedDirectories, recordDirectories, render, writeRendered } from '../scripts/distribution.mjs';
import { mergePendingDirectories, readPendingDirectories } from '../scripts/refresh.mjs';
import { DIRECTORY_FILE, DIRECTORY_IDS, directoryUrl, initialDirectoryObservations, readDirectorySources, sourceSkillIdentity } from '../scripts/skills-sh-observer.mjs';
import { originalIcon } from './fixtures/listing-icon.mjs';

const first = '2026-11-14T23:54:16.409Z';
const checkedAt = '2026-11-14T23:55:00.000Z';
const now = () => Date.parse(checkedAt);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const canonical = (value) => JSON.stringify(Array.isArray(value) ? value.map((entry) => JSON.parse(canonical(entry))) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, JSON.parse(canonical(value[key]))])) : value);
const read = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const portfolio = await read('catalog/portfolio.json');
const fullState = await read('catalog/admitted.json');
const state = { ...fullState, products: Object.fromEntries(DIRECTORY_IDS.map((id) => [id, fullState.products[id]])) };
const ledger = await read('publication-ledger.json');
const bundles = Object.fromEntries(await Promise.all(DIRECTORY_IDS.map(async (id) => [id, await read(`bundles/${id}.json`)])));
function identities(output) {
  return Object.fromEntries(DIRECTORY_IDS.map((id) => {
    const prefix = `skills/${id}/`;
    return [id, sourceSkillIdentity(id, Object.fromEntries(Object.entries(output).filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) => [path.slice(prefix.length), bytes])))];
  }));
}
const sources = identities(render(state, bundles, portfolio, ledger));
const records = () => ({ schemaVersion: 1, scope: 'listing-presence', observations: DIRECTORY_IDS.map((id) => ({ product: id, url: directoryUrl(id), firstVerifiedAt: first, sourceSkillHash: sources[id].sourceSkillHash })) });
const status = (output) => JSON.parse(output['catalog/store-status.json']).products;
const report = (value) => ({ schemaVersion: 1, scope: 'listing-presence', status: 'verified', checkedAt, remoteFileBytesVerified: false, products: [...DIRECTORY_IDS], observationsHash: digest(canonical(value)) });
function page(source) {
  const application = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: source.name, description: source.description, url: directoryUrl(source.name), publisher: { '@type': 'Organization', name: 'hraness', url: 'https://www.skills.sh/hraness' } };
  return `<link rel="canonical" href="${application.url}"><script type="application/ld+json">${JSON.stringify(application)}</script>`;
}
function remote(current, failedId) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    const id = DIRECTORY_IDS.find((id) => directoryUrl(id) === url); assert(id); calls.push({ url, options });
    const response = new Response(id === failedId ? '<h1>Temporarily unavailable</h1>' : page(current[id]), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    Object.defineProperty(response, 'url', { value: url }); return response;
  } };
}
async function fixture(t, directories = records()) {
  const root = await mkdtemp(join(tmpdir(), 'directory-refresh-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const values = { 'catalog/admitted.json': state, 'catalog/portfolio.json': portfolio, 'publication-ledger.json': ledger, [DIRECTORY_FILE]: directories, ...Object.fromEntries(DIRECTORY_IDS.map((id) => [`bundles/${id}.json`, bundles[id]])) };
  for (const [path, value] of Object.entries(values)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), json(value)); }
  await writeRendered(root, render(state, bundles, portfolio, ledger, directories)); return root;
}

test('listing evidence follows the skill tree while package versions and publisher records stay separate', () => {
  const directories = records(); const output = render(state, bundles, portfolio, ledger, directories);
  for (const id of DIRECTORY_IDS) { assert.equal(status(output)[id].skillsSh, 'listed'); assert.equal(status(output)[id].skillsShFirstVerifiedAt, first); }
  const changed = structuredClone(state); for (const entry of Object.values(changed.products)) entry.revision++;
  const revised = render(changed, bundles, portfolio, ledger, directories);
  for (const id of DIRECTORY_IDS) { assert.notEqual(status(revised)[id].version, status(output)[id].version); assert.equal(status(revised)[id].skillsSh, 'listed'); assert.equal(status(revised)[id].skillsShFirstVerifiedAt, first); }
  const icon = originalIcon({ marker: 79 }); const iconUpdate = structuredClone(changed);
  Object.assign(iconUpdate.products.sponge.listingIcon, { base64: icon.toString('base64'), bytes: icon.length, sha256: digest(icon), etag: '"synthetic-update"' });
  const newIcon = render(iconUpdate, bundles, portfolio, ledger, directories);
  assert.notEqual(status(newIcon).sponge.artifactHash, status(revised).sponge.artifactHash); assert.equal(status(newIcon).sponge.skillsSh, 'listed'); assert.equal(status(newIcon).sponge.skillsShFirstVerifiedAt, first);
  assert.deepEqual(packages(state, output).products, packages(state, render(state, bundles, portfolio, ledger)).products);
  const altered = structuredClone(bundles); altered.textmock.files['scripts/textmock-link.mjs'] += '\n// Synthetic selected helper update.\n';
  const admitted = structuredClone(state); admitted.products.textmock.contentHash = digest(canonical(altered.textmock));
  const pending = render(admitted, altered, portfolio, ledger, directories);
  assert.equal(status(pending).textmock.skillsSh, 'listing_verification_required'); assert.equal(status(pending).textmock.skillsShFirstVerifiedAt, first);
  assert.equal(status(pending).sponge.skillsSh, 'listed');
  const refreshed = structuredClone(directories); refreshed.observations.find((row) => row.product === 'textmock').sourceSkillHash = identities(pending).textmock.sourceSkillHash;
  assert.equal(status(render(admitted, altered, portfolio, ledger, refreshed)).textmock.skillsSh, 'listed');
  assert.deepEqual(status(render({ schemaVersion: 1, products: {} }, {}, portfolio, ledger)), {});
  for (const id of DIRECTORY_IDS) { assert.equal(status(render(state, bundles, portfolio, ledger))[id].skillsSh, 'listing_verification_required'); assert.equal(status(render(state, bundles, portfolio, ledger))[id].skillsShFirstVerifiedAt, null); }
});

test('a complete anonymous refresh updates only directory evidence and generated status, then stays stable', async (t) => {
  const root = await fixture(t, initialDirectoryObservations()); const beforeLedger = await readFile(join(root, 'publication-ledger.json'), 'utf8');
  const current = await readDirectorySources(root); const network = remote(current);
  const result = await recordDirectories({ root, ...network, now });
  assert.equal(network.calls.length, 4); assert.equal(result.status, 'verified'); assert.equal(result.observationsHash, digest(canonical(JSON.parse(await readFile(join(root, DIRECTORY_FILE), 'utf8')))));
  for (const { options } of network.calls) { assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert(!options.headers.authorization); }
  const saved = await readFile(join(root, DIRECTORY_FILE), 'utf8'); const output = await readFile(join(root, 'catalog/store-status.json'), 'utf8');
  for (const row of JSON.parse(saved).observations) assert.equal(row.firstVerifiedAt, checkedAt);
  assert.equal(await readFile(join(root, 'publication-ledger.json'), 'utf8'), beforeLedger);
  assert(Object.values(JSON.parse(output).products).every((row) => row.skillsSh === 'listed'));
  await recordDirectories({ root, ...remote(current), now: () => now() + 1000 });
  assert.equal(await readFile(join(root, DIRECTORY_FILE), 'utf8'), saved); assert.equal(await readFile(join(root, 'catalog/store-status.json'), 'utf8'), output);
  assert.equal(await readFile(join(root, 'publication-ledger.json'), 'utf8'), beforeLedger);
});

test('an error shell waits for all four reads and preserves prior evidence, generated status and publications', async (t) => {
  const root = await fixture(t); const paths = [DIRECTORY_FILE, 'catalog/store-status.json', 'publication-ledger.json', 'README.md'];
  const before = await Promise.all(paths.map((path) => readFile(join(root, path), 'utf8'))); const network = remote(await readDirectorySources(root), 'dawn');
  await assert.rejects(recordDirectories({ root, ...network, now }), /Not all four directory listings verified/); assert.equal(network.calls.length, 4);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), 'utf8'))), before);
  const savedReport = JSON.parse(await readFile(join(root, 'dist/directory-observation.json'), 'utf8'));
  assert.equal(savedReport.status, 'pending'); assert(!Object.hasOwn(savedReport, 'publishedAt')); assert(!Object.hasOwn(savedReport, 'checkedAt'));
});

test('pending proposals keep their successful observation unless a complete report proves the desired records', () => {
  const baseline = records(); const pending = structuredClone(baseline); const desired = structuredClone(baseline);
  pending.observations[0].sourceSkillHash = 'a'.repeat(64); desired.observations[0].sourceSkillHash = 'b'.repeat(64);
  for (const unverified of [null, { status: 'pending' }, { ...report(desired), observationsHash: 'c'.repeat(64) }, { ...report(desired), checkedAt: '2099-01-01T00:00:00.000Z' }]) assert.deepEqual(mergePendingDirectories(pending, desired, baseline, unverified, { now }), pending);
  assert.deepEqual(mergePendingDirectories(pending, desired, baseline, report(desired), { now }), desired);
  const fresh = structuredClone(desired); for (const row of fresh.observations) row.firstVerifiedAt = checkedAt;
  assert.throws(() => mergePendingDirectories(pending, fresh, baseline, report(fresh), { now }), /first directory verification/);
  const uncommitted = structuredClone(baseline); const later = structuredClone(baseline); for (const row of later.observations) row.firstVerifiedAt = checkedAt;
  assert.deepEqual(mergePendingDirectories(uncommitted, later, initialDirectoryObservations(), report(later), { now }).observations.map((row) => row.firstVerifiedAt), DIRECTORY_IDS.map(() => first));
});

test('pending observations come from an exact regular Git blob with matching bytes', async () => {
  const head = 'a'.repeat(40); const tree = 'b'.repeat(40); const bytes = Buffer.from(json(records()));
  const blobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const entry = { path: DIRECTORY_FILE, type: 'blob', mode: '100644', size: bytes.length, sha: blobSha };
  const serve = ({ mode, truncated = false, duplicate = false, corrupt = false, wrongCommit = false, wrongTree = false } = {}) => async (path) => {
    if (path.endsWith(`/git/commits/${head}`)) return { sha: wrongCommit ? 'c'.repeat(40) : head, tree: { sha: tree } };
    if (path.endsWith(`/git/trees/${tree}?recursive=1`)) return { sha: wrongTree ? 'c'.repeat(40) : tree, truncated, tree: [mode ? { ...entry, mode } : entry, ...(duplicate ? [entry] : [])] };
    assert(path.endsWith(`/git/blobs/${blobSha}`)); return { encoding: 'base64', size: bytes.length, content: (corrupt ? Buffer.alloc(bytes.length, 32) : bytes).toString('base64') };
  };
  assert.deepEqual(await readPendingDirectories(head, serve()), records());
  for (const change of [{ mode: '120000' }, { truncated: true }, { duplicate: true }, { corrupt: true }, { wrongCommit: true }, { wrongTree: true }]) await assert.rejects(readPendingDirectories(head, serve(change)));
  await assert.rejects(readPendingDirectories('../main', async () => { assert.fail('Invalid heads must not reach the API'); }));
});

test('governed history permits the initial file and protects every existing first verification date', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'directory-history-')); t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet'); await writeFile(join(root, 'README.md'), 'Fixture\n'); git('add', 'README.md'); git('commit', '--quiet', '-m', 'Initial'); const initial = git('rev-parse', 'HEAD');
  await mkdir(join(root, 'catalog')); await writeFile(join(root, DIRECTORY_FILE), json(records())); git('add', DIRECTORY_FILE); git('commit', '--quiet', '-m', 'Observe');
  assert.deepEqual(await readGovernedDirectories(root, initial), initialDirectoryObservations()); assert.deepEqual(await readGovernedDirectories(root, git('rev-parse', 'HEAD')), records());
  assert.doesNotThrow(() => checkDirectoryDates(initialDirectoryObservations(), records())); assert.doesNotThrow(() => checkDirectoryDates(records(), records()));
  assert.throws(() => checkDirectoryDates(records(), initialDirectoryObservations()), /first directory verification/);
  const changed = records(); changed.observations[0].firstVerifiedAt = checkedAt; assert.throws(() => checkDirectoryDates(records(), changed), /first directory verification/);
  await assert.rejects(readGovernedDirectories(root, 'f'.repeat(40))); await assert.rejects(readGovernedDirectories(root, '--all'));
  await rm(join(root, DIRECTORY_FILE)); await symlink('../README.md', join(root, DIRECTORY_FILE)); git('add', DIRECTORY_FILE); git('commit', '--quiet', '-m', 'Invalid symlink fixture'); await assert.rejects(readGovernedDirectories(root, git('rev-parse', 'HEAD')), /governed directory record/);
});
