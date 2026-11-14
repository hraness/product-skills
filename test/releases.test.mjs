import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../scripts/distribution.mjs';
import { findRelease, publishReleaseAssets } from '../scripts/releases.mjs';
import { automationFailure, stage } from '../scripts/diagnostics.mjs';

const repository = 'hraness/product-skills', prefix = `repos/${repository}/`, origin = `https://github.com/${repository}`, target = 'a'.repeat(40);
const missing = () => Object.assign(new Error('not found'), { status: 404 });
function server({ uncertain = null } = {}) {
  const assets = { 'textmock-1.0.0.zip': Buffer.from('selected public package'), SHA256SUMS: Buffer.from('synthetic checksums'), 'release.json': Buffer.from('synthetic release plan') };
  const paths = Object.fromEntries(Object.keys(assets).map((name) => [name, `/synthetic/${name}`]));
  const releases = [], refs = new Map(), requests = [], reads = []; let nextId = 1;
  const tag = 'integrations-0123456789abcdef';
  const seed = ({ draft = true, targetCommit = target, partial = true } = {}) => {
    const release = { id: nextId++, tag_name: tag, target_commitish: targetCommit, draft, prerelease: false, immutable: !draft, html_url: `${origin}/releases/tag/${tag}`, assets: [] };
    for (const [name, bytes] of Object.entries(assets)) if (!partial || name === 'release.json') release.assets.push({ id: nextId++, name, size: bytes.length, digest: `sha256:${digest(bytes)}` });
    releases.push(release); if (!draft) refs.set(tag, targetCommit); return release;
  };
  const read = async (path) => {
    reads.push(path);
    if (path.includes('/releases/tags/')) { const release = releases.find((release) => release.tag_name === path.split('/').at(-1) && !release.draft); if (!release) throw missing(); return structuredClone(release); }
    if (path.includes('/releases?')) { const page = Number(new URLSearchParams(path.split('?')[1]).get('page')); return structuredClone(releases.slice((page - 1) * 100, page * 100)); }
    if (/\/releases\/\d+$/.test(path)) { const release = releases.find((release) => release.id === Number(path.split('/').at(-1))); if (!release) throw missing(); return structuredClone(release); }
    if (path.includes('/git/ref/tags/')) { const sha = refs.get(path.split('/').at(-1)); if (!sha) throw missing(); return { object: { type: 'commit', sha } }; }
    throw new Error(`Unexpected read ${path}`);
  };
  const request = async (args) => {
    requests.push(args); const command = args[1];
    if (command === 'create') seed({ partial: true }).assets = [];
    else {
      const release = releases.find((release) => release.tag_name === args[2]);
      if (command === 'upload') { const name = args[3].split('/').at(-1), bytes = assets[name]; assert.equal(release.assets.some((asset) => asset.name === name), false, 'Never overwrite an uploaded asset'); release.assets.push({ id: nextId++, name, size: bytes.length, digest: `sha256:${digest(bytes)}` }); }
      else if (command === 'edit') { release.draft = false; release.immutable = true; refs.set(tag, release.target_commitish); }
      else throw new Error('Unexpected release mutation');
    }
    if (uncertain === command) throw Object.assign(new Error('private provider response with secret'), { code: 1, stderr: 'gh: request interrupted (HTTP 502)' });
  };
  return { tag, target, assets, paths, title: 'Hraness product skills', notesPath: '/synthetic/notes.md', beforePublish: async () => {}, read, request, releases, requests, reads, refs, seed };
}

test('product release resumes an API-visible draft even though published-by-tag returns 404', async () => {
  const current = server(), draft = current.seed();
  await assert.rejects(current.read(`${prefix}releases/tags/${current.tag}`), (error) => error.status === 404);
  assert.equal((await findRelease(current)).id, draft.id);
  const published = await publishReleaseAssets(current); assert.equal(published.id, draft.id); assert.equal(published.immutable, true);
  assert.deepEqual(current.requests.map((args) => args[1]), ['upload', 'upload', 'edit']);
  assert.equal(current.reads.some((path) => path === `${prefix}releases/${draft.id}`), true);
  await publishReleaseAssets(current); assert.equal(current.requests.length, 3);
});

test('uncertain create, upload and publication reconcile the same object without another write', async () => {
  for (const command of ['create', 'upload', 'edit']) {
    const current = server({ uncertain: command }); const result = await publishReleaseAssets(current);
    assert.equal(result.draft, false); assert.equal(current.releases.length, 1);
    assert.equal(current.requests.filter((args) => args[1] === 'create').length, 1);
    assert.equal(current.requests.filter((args) => args[1] === 'edit').length, 1);
    for (const name of Object.keys(current.assets)) assert.equal(current.requests.filter((args) => args[1] === 'upload' && args[3] === current.paths[name]).length, 1);
  }
});

test('duplicate versions, different draft source, wrong assets and changed release IDs fail without overwrite', async () => {
  for (const change of [
    (current) => { current.seed(); },
    (_current, release) => { release.target_commitish = 'b'.repeat(40); },
    (_current, release) => { release.assets[0].digest = `sha256:${'f'.repeat(64)}`; },
    (_current, release) => { release.assets.push({ ...release.assets[0] }); },
    (current) => { current.refs.set(current.tag, 'b'.repeat(40)); },
  ]) {
    const current = server(), release = current.seed(); change(current, release);
    await assert.rejects(publishReleaseAssets(current)); assert.equal(current.requests.length, 0);
  }
  const changed = server(); changed.seed(); const read = changed.read;
  await assert.rejects(publishReleaseAssets({ ...changed, read: async (path) => /^.*\/releases\/\d+$/.test(path) ? { ...await read(path), id: 999 } : read(path) }), /ID readback/);
  assert.equal(changed.requests.length, 0);
});

test('an identical immutable product package can retain its earlier source after a ledger-only main change', async () => {
  const current = server(); current.seed({ draft: false, targetCommit: 'b'.repeat(40), partial: false });
  await assert.rejects(publishReleaseAssets(current), /source or version/);
  const result = await publishReleaseAssets({ ...current, allowPublishedTargetReuse: true }); assert.equal(result.target_commitish, 'b'.repeat(40)); assert.equal(current.requests.length, 0);
});

test('source/check failure prevents publication and an unconfirmed write remains a visible failure', async () => {
  const current = server(); current.seed();
  await assert.rejects(publishReleaseAssets({ ...current, beforePublish: async () => { throw new Error('current check failed'); } }), /current check failed/);
  assert.equal(current.requests.some((args) => args[1] === 'edit'), false);
  const refused = server(); const failure = Object.assign(new Error('private error body'), { status: 503 });
  await assert.rejects(publishReleaseAssets({ ...refused, request: async () => { throw failure; } }), (error) => error === failure);
  assert.equal(refused.releases.length, 0);
});

test('release lookup refuses incomplete inventory and never treats authorization failure as absence', async () => {
  const current = server();
  await assert.rejects(findRelease({ ...current, read: async (path) => path.includes('/tags/') ? Promise.reject(missing()) : Array.from({ length: 100 }, (_, index) => ({ id: index + 1, tag_name: `other-${index}` })) }), /read bound/);
  await assert.rejects(findRelease({ ...current, read: async () => { throw Object.assign(new Error('denied'), { status: 403 }); } }), (error) => error.status === 403);
});

test('automation diagnostics preserve operation, step, error type and status without credentials or response text', async () => {
  const secret = 'ghs_private-value-do-not-print';
  const failure = Object.assign(new Error(`Command failed with ${secret}`), { code: 1, stderr: `${secret}: HTTP 404 private response`, stdout: secret });
  await assert.rejects(stage('release.lookup', () => stage('github.api', async () => { throw failure; })));
  assert.deepEqual(JSON.parse(automationFailure(failure, 'publish')), { event: 'automation_failed', command: 'publish', step: 'release.lookup', errorType: 'HttpError', httpStatus: 404, exitCode: 1 });
  assert.equal(automationFailure(failure, 'publish').includes(secret), false);
  assert.equal(automationFailure({ automationStage: secret, name: secret, code: secret }, secret).includes(secret), false);
  assert.equal(automationFailure({ automationStage: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, 'publish').includes('aaaaaaaa'), false);
  assert.equal(JSON.parse(automationFailure(Object.assign(new Error(secret), { code: 'ETIMEDOUT' }), 'deliver')).errorType, 'TimeoutError');
});
