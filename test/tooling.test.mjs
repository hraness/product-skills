import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../scripts/distribution.mjs';
import { publishTooling, toolingPlan, verifyToolingRelease } from '../scripts/tooling.mjs';

const repository = 'hraness/product-skills'; const origin = `https://github.com/${repository}`;
const source = 'a'.repeat(40); const toolkitHash = 'b'.repeat(64);
const missing = () => Object.assign(new Error('Missing provider object'), { status: 404 });
function server({ candidate = source, hash = toolkitHash, ordinal = 8, main = candidate, failed = false } = {}) {
  const releases = new Map(); const refs = new Map(); const assetBytes = new Map(); const local = new Map(); const requests = []; const gitCalls = []; let assetId = 1;
  const releaseShape = (tag, target, draft) => ({ tag_name: tag, target_commitish: target, draft, prerelease: false, immutable: !draft, html_url: `${origin}/releases/tag/${tag}`, assets: [] });
  const upload = (release, name, bytes) => { const id = assetId++; const asset = { id, name, size: bytes.length, digest: `sha256:${digest(bytes)}`, browser_download_url: `${origin}/releases/download/${release.tag_name}/${name}` }; release.assets.push(asset); assetBytes.set(id, bytes); };
  const read = async (path) => {
    if (path === `repos/${repository}`) return { full_name: repository, private: false };
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: main } };
    if (path.includes('/check-runs?')) return { check_runs: [{ id: 1, name: 'Required', head_sha: candidate, status: 'completed', conclusion: failed ? 'failure' : 'success', app: { id: 15368 } }] };
    if (path.includes('/releases?')) return [...releases.values()];
    if (path.includes('/releases/tags/')) { const tag = path.split('/releases/tags/')[1]; if (!releases.has(tag)) throw missing(); return releases.get(tag); }
    if (path.includes('/git/ref/tags/')) { const tag = path.split('/git/ref/tags/')[1]; if (!refs.has(tag)) throw missing(); return { object: { type: 'commit', sha: refs.get(tag) } }; }
    throw new Error(`Unexpected provider read ${path}`);
  };
  const request = async (args) => {
    requests.push(args); const command = args[1]; const tag = args[2];
    if (command === 'create') releases.set(tag, releaseShape(tag, args[args.indexOf('--target') + 1], true));
    else if (command === 'upload') { const path = args[3]; upload(releases.get(tag), path.split('/').at(-1), local.get(path)); }
    else if (command === 'edit') { const release = releases.get(tag); release.draft = false; release.immutable = true; refs.set(tag, release.target_commitish); }
    else throw new Error('Unexpected release mutation');
  };
  const git = async (args) => { gitCalls.push(args); if (args[0] === 'fetch') return ''; if (args[1] === 'HEAD') return candidate; if (args[1] === '--is-shallow-repository') return 'true'; if (args[0] === 'rev-list') return String(ordinal); throw new Error('Unexpected Git operation'); };
  const writeArtifacts = async (artifacts) => Object.fromEntries(Object.entries(artifacts).map(([name, bytes]) => { const path = `/synthetic/tooling/${name}`; local.set(path, bytes); return [name, path]; }));
  const downloadAsset = async (asset) => assetBytes.get(asset.id);
  const seed = (plan, { draft = false, partial = false } = {}) => { const release = releaseShape(plan.tag, plan.metadata.sourceCommit, draft); for (const [name, bytes] of Object.entries(plan.assets)) if (!partial || name === 'toolkit.json') upload(release, name, bytes); releases.set(plan.tag, release); if (!draft) refs.set(plan.tag, plan.metadata.sourceCommit); return release; };
  return { sourceCommit: candidate, toolkitHash: hash, packageVersion: '0.1.0', read, request, git, downloadAsset, writeArtifacts, seed, refs, releases, requests, gitCalls, assetBytes };
}
test('tooling versions derive only their patch from governed main history', () => {
  const plan = toolingPlan({ packageVersion: '0.1.0', sourceCommit: source, toolkitHash, ordinal: 8 });
  assert.equal(plan.tag, 'v0.1.8'); assert.equal(plan.metadata.version, '0.1.8');
  assert.equal(plan.assets.SHA256SUMS.toString(), `${digest(plan.assets['toolkit.json'])}  toolkit.json\n`);
  for (const change of [{ ordinal: 0 }, { ordinal: -1 }, { ordinal: 1.5 }, { sourceCommit: 'short' }, { toolkitHash: 'bad' }, { packageVersion: 'latest' }]) assert.throws(() => toolingPlan({ packageVersion: '0.1.0', sourceCommit: source, toolkitHash, ordinal: 8, ...change }));
});
test('the first tooling version publishes without a product package and verifies its immutable readback', async () => {
  const current = server(); const result = await publishTooling(current);
  assert.equal(result.status, 'published'); assert.equal(result.tag, 'v0.1.8');
  assert.deepEqual(current.gitCalls.find((args) => args[0] === 'fetch'), ['fetch', '--no-tags', '--unshallow', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  assert.deepEqual(current.gitCalls.find((args) => args[0] === 'rev-list'), ['rev-list', '--first-parent', '--count', source]);
  assert.deepEqual(current.requests.map((args) => args[1]), ['create', 'upload', 'upload', 'edit']);
  assert.equal(current.releases.get(result.tag).immutable, true);
  const again = await publishTooling(current); assert.equal(again.status, 'unchanged'); assert.equal(current.requests.length, 4);
});
test('an unchanged toolkit hash keeps its first verified version even after another main commit', async () => {
  const current = server({ candidate: 'c'.repeat(40), ordinal: 9 });
  current.seed(toolingPlan({ packageVersion: '0.1.0', sourceCommit: source, toolkitHash, ordinal: 8 }));
  const result = await publishTooling(current); assert.equal(result.status, 'unchanged'); assert.equal(result.tag, 'v0.1.8');
  assert.equal(current.requests.length, 0); assert.equal(current.gitCalls.length, 0);
});
test('a changed toolkit gets a later version while an old head or failed current check cannot publish', async () => {
  const current = server({ candidate: 'c'.repeat(40), hash: 'd'.repeat(64), ordinal: 10 });
  current.seed(toolingPlan({ packageVersion: '0.1.0', sourceCommit: source, toolkitHash, ordinal: 8 }));
  assert.equal((await publishTooling(current)).tag, 'v0.1.10');
  for (const options of [{ main: 'f'.repeat(40) }, { failed: true }]) { const refused = server(options); await assert.rejects(publishTooling(refused)); assert.equal(refused.requests.length, 0); }
});
test('an interrupted matching draft resumes; conflicting metadata, target or tag is never overwritten', async () => {
  const plan = toolingPlan({ packageVersion: '0.1.0', sourceCommit: source, toolkitHash, ordinal: 8 });
  const draft = server(); draft.seed(plan, { draft: true, partial: true });
  assert.equal((await publishTooling(draft)).status, 'published'); assert.deepEqual(draft.requests.map((args) => args[1]), ['upload', 'edit']);
  for (const change of [
    (current, release) => { release.target_commitish = 'e'.repeat(40); },
    (current, release) => { release.assets[0].digest = `sha256:${'f'.repeat(64)}`; },
    (current) => { current.refs.set(plan.tag, 'e'.repeat(40)); },
  ]) { const refused = server(); const release = refused.seed(plan, { draft: true, partial: true }); change(refused, release); await assert.rejects(publishTooling(refused)); assert.equal(refused.requests.length, 0); }
});
test('published tooling verifies downloaded bytes, source target and immutable tag identity', async () => {
  const plan = toolingPlan({ packageVersion: '0.1.0', sourceCommit: source, toolkitHash, ordinal: 8 });
  for (const change of [
    (current, release) => { release.immutable = false; },
    (current, release) => { current.assetBytes.set(release.assets[0].id, Buffer.from('changed')); },
    (current) => { current.refs.set(plan.tag, 'e'.repeat(40)); },
  ]) { const current = server(); const release = current.seed(plan); change(current, release); await assert.rejects(verifyToolingRelease(release, current)); }
});
