import { digest } from './distribution.mjs';
import { httpStatus, stage } from './diagnostics.mjs';

const REPOSITORY = 'hraness/product-skills';
const PREFIX = `repos/${REPOSITORY}/`;
const ORIGIN = `https://github.com/${REPOSITORY}`;
const SHA = /^[a-f0-9]{40}$/;
const TAG = /^(?:v(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})|integrations-[a-f0-9]{16})$/;
const need = (condition, message) => { if (!condition) throw new Error(message); };

export async function optionalReleaseRead(read, path) {
  try { return await read(path); }
  catch (error) { if (httpStatus(error) === 404) return null; throw error; }
}

// The tag endpoint returns published releases. Drafts can be visible only in the
// authenticated list; always reconcile the selected object by numeric release ID.
export async function findRelease({ tag, read }) {
  return stage('release.lookup', async () => {
    need(TAG.test(tag), 'Invalid release tag');
    const published = await optionalReleaseRead(read, `${PREFIX}releases/tags/${tag}`);
    let selected = null;
    for (let page = 1; page <= 20; page++) {
      const releases = await read(`${PREFIX}releases?per_page=100&page=${page}`);
      need(Array.isArray(releases) && releases.length <= 100, 'Invalid release inventory');
      for (const release of releases) if (release.tag_name === tag) {
        need(!selected && Number.isSafeInteger(release.id) && release.id > 0, 'Ambiguous release version'); selected = release;
      }
      if (releases.length === 100) continue;
      need(!published || selected?.id === published.id, 'Published release and inventory disagree');
      if (!selected) return null;
      const release = await read(`${PREFIX}releases/${selected.id}`);
      need(release.id === selected.id && release.tag_name === tag, 'Release ID readback differs'); return release;
    }
    throw new Error('Release inventory exceeds its reviewed read bound');
  });
}

function inspectRelease(release, { tag, target, assets, allowPublishedTargetReuse }) {
  need(Number.isSafeInteger(release?.id) && release.id > 0 && release.tag_name === tag && typeof release.draft === 'boolean' && release.prerelease === false && SHA.test(release.target_commitish) && (release.target_commitish === target || !release.draft && allowPublishedTargetReuse), 'Release source or version differs');
  need(Array.isArray(release.assets) && release.assets.length <= Object.keys(assets).length && new Set(release.assets.map((asset) => asset.name)).size === release.assets.length, 'Unexpected or duplicate release assets');
  for (const asset of release.assets) {
    need(Object.hasOwn(assets, asset.name) && Number.isSafeInteger(asset.id) && asset.id > 0 && asset.size === assets[asset.name].length && asset.digest === `sha256:${digest(assets[asset.name])}`, 'Existing release asset differs; no overwrite is allowed');
  }
}

export async function publishReleaseAssets({ tag, target, assets, paths, title, notesPath, read, request, beforePublish, allowPublishedTargetReuse = false }) {
  return stage('release.prepare', async () => {
    need(TAG.test(tag) && SHA.test(target) && typeof beforePublish === 'function' && typeof allowPublishedTargetReuse === 'boolean', 'Invalid release publication plan');
    const names = Object.keys(assets); let total = 0;
    need(names.length > 0 && names.length <= 16 && names.every((name) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(name)), 'Invalid release asset names');
    for (const name of names) { need(Buffer.isBuffer(assets[name]) && assets[name].length > 0 && typeof paths[name] === 'string' && paths[name].length > 0, 'Release bytes and local paths are required'); total += assets[name].length; }
    need(total <= 64 * 1024 * 1024, 'Release assets exceed their byte bound');
    const expected = { tag, target, assets, allowPublishedTargetReuse };
    let release = await findRelease({ tag, read });
    if (!release) {
      const ref = await optionalReleaseRead(read, `${PREFIX}git/ref/tags/${tag}`);
      need(!ref || ref.object?.type === 'commit' && ref.object.sha === target, 'Release tag already identifies another source');
      let failure;
      try { await stage('release.create', () => request(['release', 'create', tag, '--repo', REPOSITORY, '--target', target, '--title', title, '--notes-file', notesPath, '--draft'])); }
      catch (error) { failure = error; }
      release = await findRelease({ tag, read });
      if (!release) { if (failure) throw failure; throw new Error('Created release did not reconcile'); }
    }
    inspectRelease(release, expected);
    if (release.draft) {
      const ref = await optionalReleaseRead(read, `${PREFIX}git/ref/tags/${tag}`);
      need(!ref || ref.object?.type === 'commit' && ref.object.sha === target, 'Draft release tag identifies another source');
    }
    const id = release.id;
    const refresh = async () => {
      const current = await stage('release.readback', () => read(`${PREFIX}releases/${id}`));
      need(current.id === id, 'Release identity changed'); inspectRelease(current, expected); release = current;
    };
    for (const name of names) {
      if (release.assets.some((asset) => asset.name === name)) continue;
      need(release.draft === true, 'A published release cannot gain another asset');
      let failure;
      try { await stage('release.upload', () => request(['release', 'upload', tag, paths[name], '--repo', REPOSITORY])); }
      catch (error) { failure = error; }
      await refresh();
      if (!release.assets.some((asset) => asset.name === name)) { if (failure) throw failure; throw new Error('Uploaded release asset did not reconcile'); }
    }
    await refresh(); need(release.assets.length === names.length, 'Release asset inventory is incomplete');
    await stage('release.current-head', beforePublish);
    if (release.draft) {
      const ref = await optionalReleaseRead(read, `${PREFIX}git/ref/tags/${tag}`);
      need(!ref || ref.object?.type === 'commit' && ref.object.sha === target, 'Draft release tag changed before publication');
      let failure;
      try { await stage('release.publish', () => request(['release', 'edit', tag, '--repo', REPOSITORY, '--draft=false'])); }
      catch (error) { failure = error; }
      await refresh(); if (release.draft) { if (failure) throw failure; throw new Error('Release publication did not reconcile'); }
    }
    const published = await stage('release.public-readback', () => read(`${PREFIX}releases/tags/${tag}`));
    need(published.id === id && published.draft === false && published.immutable === true && published.html_url === `${ORIGIN}/releases/tag/${tag}`, 'Release is not the expected immutable public publication');
    inspectRelease(published, expected);
    const ref = await stage('release.tag-readback', () => read(`${PREFIX}git/ref/tags/${tag}`));
    need(ref.object?.type === 'commit' && ref.object.sha === published.target_commitish, 'Published release tag differs from its source');
    return published;
  });
}
