import { digest } from './distribution.mjs';

const REPOSITORY = 'hraness/product-skills';
const ORIGIN = `https://github.com/${REPOSITORY}`;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const need = (condition, message) => { if (!condition) throw new Error(message); };
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

export function toolingPlan({ packageVersion, sourceCommit, toolkitHash, ordinal }) {
  const version = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.exec(packageVersion);
  need(version && SHA.test(sourceCommit) && HASH.test(toolkitHash) && Number.isSafeInteger(ordinal) && ordinal > 0 && ordinal <= 999999999, 'Invalid tooling release identity');
  const releaseVersion = `${version[1]}.${version[2]}.${ordinal}`;
  const metadata = { schemaVersion: 1, version: releaseVersion, sourceCommit, toolkitHash };
  const bytes = json(metadata);
  return { tag: `v${releaseVersion}`, metadata, assets: { 'toolkit.json': bytes, SHA256SUMS: Buffer.from(`${digest(bytes)}  toolkit.json\n`) } };
}

async function optional(read, path) {
  try { return await read(path); }
  catch (error) { if (error.status === 404 || /\bHTTP 404\b/.test(String(error.stderr))) return null; throw error; }
}

export async function verifyToolingRelease(release, { read, downloadAsset }) {
  need(release && /^v(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})$/.test(release.tag_name) && release.draft === false && release.prerelease === false && release.immutable === true && release.html_url === `${ORIGIN}/releases/tag/${release.tag_name}`, 'Tooling release is not an immutable public version');
  need(Array.isArray(release.assets) && release.assets.length === 2, 'Tooling release needs its exact metadata and checksums');
  const files = {};
  for (const name of ['toolkit.json', 'SHA256SUMS']) {
    const found = release.assets.filter((asset) => asset.name === name);
    need(found.length === 1 && Number.isSafeInteger(found[0].id) && found[0].id > 0 && Number.isSafeInteger(found[0].size) && found[0].size > 0 && found[0].size <= 4096 && found[0].browser_download_url === `${ORIGIN}/releases/download/${release.tag_name}/${name}`, 'Tooling asset identity mismatch');
    const bytes = await downloadAsset(found[0]);
    need(Buffer.isBuffer(bytes) && bytes.length === found[0].size && found[0].digest === `sha256:${digest(bytes)}`, 'Tooling asset digest mismatch'); files[name] = bytes;
  }
  const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['toolkit.json']));
  need(Object.keys(metadata).sort().join(',') === 'schemaVersion,sourceCommit,toolkitHash,version' && metadata.schemaVersion === 1 && `v${metadata.version}` === release.tag_name && SHA.test(metadata.sourceCommit) && HASH.test(metadata.toolkitHash) && release.target_commitish === metadata.sourceCommit, 'Tooling metadata or release target mismatch');
  need(files.SHA256SUMS.equals(Buffer.from(`${digest(files['toolkit.json'])}  toolkit.json\n`)), 'Tooling checksums differ from the metadata');
  const ref = await read(`repos/${REPOSITORY}/git/ref/tags/${release.tag_name}`);
  need(ref.object?.type === 'commit' && ref.object.sha === metadata.sourceCommit, 'Tooling tag does not identify the recorded source');
  return metadata;
}

async function latestTooling(read, series) {
  let latest = null;
  for (let page = 1; page <= 20; page++) {
    const releases = await read(`repos/${REPOSITORY}/releases?per_page=100&page=${page}`);
    need(Array.isArray(releases) && releases.length <= 100, 'Invalid release list');
    for (const release of releases) {
      const match = /^v(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.exec(release.tag_name ?? '');
      if (!match || `${match[1]}.${match[2]}` !== series || release.draft) continue;
      need(!latest || latest.tag_name !== release.tag_name, 'Duplicate tooling release version');
      if (!latest || Number(match[3]) > Number(latest.tag_name.split('.')[2])) latest = release;
    }
    if (releases.length < 100) return latest;
  }
  throw new Error('Tooling release history exceeds the reviewed read bound');
}

async function currentCandidate(read, sourceCommit) {
  const repository = await read(`repos/${REPOSITORY}`);
  need(repository.full_name === REPOSITORY && repository.private === false, 'Tooling publication requires the public source repository');
  const main = await read(`repos/${REPOSITORY}/git/ref/heads/main`);
  need(main.object?.sha === sourceCommit, 'The tooling candidate is no longer protected main');
  const checks = await read(`repos/${REPOSITORY}/commits/${sourceCommit}/check-runs?per_page=100`);
  const required = checks.check_runs?.filter((check) => check.name === 'Required' && check.app?.id === 15368 && check.head_sha === sourceCommit).sort((a, b) => b.id - a.id)[0];
  need(required?.status === 'completed' && required.conclusion === 'success', 'The current main tooling candidate needs its exact Required check');
}

export async function publishTooling({ sourceCommit, toolkitHash, packageVersion, read, request, git, downloadAsset, writeArtifacts }) {
  need(SHA.test(sourceCommit) && HASH.test(toolkitHash), 'Invalid tooling source');
  const seriesMatch = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.exec(packageVersion); need(seriesMatch, 'Invalid toolkit package version');
  await currentCandidate(read, sourceCommit);
  const latest = await latestTooling(read, `${seriesMatch[1]}.${seriesMatch[2]}`);
  const previous = latest ? await verifyToolingRelease(latest, { read, downloadAsset }) : null;
  if (previous?.toolkitHash === toolkitHash) return { status: 'unchanged', tag: latest.tag_name, metadata: previous };

  // Complete history comes only from the fully qualified governed main ref.
  // Count the checked-out candidate, even if the remote advances during the read.
  need(await git(['rev-parse', 'HEAD']) === sourceCommit, 'The tooling checkout differs from its candidate');
  const shallow = await git(['rev-parse', '--is-shallow-repository']);
  need(['true', 'false'].includes(shallow), 'Cannot establish governed history depth');
  await git(['fetch', '--no-tags', ...(shallow === 'true' ? ['--unshallow'] : []), 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  const count = await git(['rev-list', '--first-parent', '--count', sourceCommit]);
  need(/^[1-9]\d{0,8}$/.test(count), 'Invalid governed main revision count');
  const plan = toolingPlan({ packageVersion, sourceCommit, toolkitHash, ordinal: Number(count) });
  need(!previous || Number(plan.metadata.version.split('.')[2]) > Number(previous.version.split('.')[2]), 'A tooling release cannot reuse or roll back its sequence');
  await currentCandidate(read, sourceCommit);
  const existingTag = await optional(read, `repos/${REPOSITORY}/git/ref/tags/${plan.tag}`);
  need(!existingTag || existingTag.object?.type === 'commit' && existingTag.object.sha === sourceCommit, 'The tooling version already identifies another source');
  let release = await optional(read, `repos/${REPOSITORY}/releases/tags/${plan.tag}`);
  const files = await writeArtifacts({ ...plan.assets, 'notes.md': Buffer.from(`Shared Hraness distribution tools ${plan.metadata.version}.\n\nThe metadata and checksums identify the source commit used by the profile-link action and package publisher. Product skills have separate integration versions and releases.\n`) });
  if (!release) {
    await request(['release', 'create', plan.tag, '--repo', REPOSITORY, '--target', sourceCommit, '--title', `Hraness distribution tools ${plan.metadata.version}`, '--notes-file', files['notes.md'], '--draft']);
    release = await read(`repos/${REPOSITORY}/releases/tags/${plan.tag}`);
  }
  need(release.tag_name === plan.tag && release.target_commitish === sourceCommit && release.prerelease === false && Array.isArray(release.assets) && release.assets.length <= 2 && release.assets.every((asset) => Object.hasOwn(plan.assets, asset.name)), 'Ambiguous existing tooling release; no overwrite is allowed');
  for (const [name, bytes] of Object.entries(plan.assets)) {
    const found = release.assets.filter((asset) => asset.name === name); need(found.length <= 1, 'Duplicate tooling asset');
    if (found.length) need(found[0].digest === `sha256:${digest(bytes)}` && found[0].size === bytes.length, 'Existing tooling asset differs; no overwrite is allowed');
    else { need(release.draft === true, 'A published tooling release cannot gain another asset'); await request(['release', 'upload', plan.tag, files[name], '--repo', REPOSITORY]); }
  }
  await currentCandidate(read, sourceCommit);
  if (release.draft) await request(['release', 'edit', plan.tag, '--repo', REPOSITORY, '--draft=false']);
  const published = await read(`repos/${REPOSITORY}/releases/tags/${plan.tag}`);
  const verified = await verifyToolingRelease(published, { read, downloadAsset });
  need(JSON.stringify(verified) === JSON.stringify(plan.metadata), 'Published tooling metadata differs from this candidate');
  return { status: 'published', tag: plan.tag, metadata: verified };
}
