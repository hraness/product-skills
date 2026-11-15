import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIRECTORY_IDS, directoryUrl, initialDirectoryObservations, validateDirectoryObservations, sourceSkillIdentity, readDirectorySources, readDirectoryObservations, verifyDirectoryPage, observeDirectories, mergePendingDirectoryObservations } from '../scripts/skills-sh-observer.mjs';

const now = () => Date.parse('2026-11-16T00:00:00.000Z');
const first = '2026-11-14T23:54:16.409Z';
const text = (id, description = `Use the selected ${id} tool.`) => `---\nname: ${id}\ndescription: ${description}\n---\n\nUse this skill.\n`;
const sources = () => Object.fromEntries(DIRECTORY_IDS.map((id) => [id, sourceSkillIdentity(id, { 'SKILL.md': text(id) })]));
const records = () => ({ schemaVersion: 1, scope: 'listing-presence', observations: DIRECTORY_IDS.map((id) => ({ product: id, url: directoryUrl(id), firstVerifiedAt: first, sourceSkillHash: sources()[id].sourceSkillHash })) });
const application = (source) => ({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: source.name, description: source.description, url: directoryUrl(source.name), publisher: { '@type': 'Organization', name: 'hraness', url: 'https://www.skills.sh/hraness' } });
const script = (value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const page = (source, extra = '') => `<html><head><link rel="canonical" href="${directoryUrl(source.name)}">${script(application(source))}</head><body>${extra}</body></html>`;
function response(url, bytes, options = {}) {
  const result = new Response(bytes, { status: options.status ?? 200, headers: { 'content-type': options.type ?? 'text/html; charset=utf-8' } });
  Object.defineProperty(result, 'url', { value: options.url ?? url });
  if (options.redirected) Object.defineProperty(result, 'redirected', { value: true }); return result;
}
function server(current = sources(), transform = (body) => body) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => { calls.push({ url, options }); const id = DIRECTORY_IDS.find((id) => directoryUrl(id) === url); assert(id); return response(url, transform(page(current[id]), id)); } };
}

test('public first-verification evidence preserves the observed date and only public source facts', async () => {
  const state = JSON.parse(await readFile(new URL('../catalog/directory-observations.json', import.meta.url), 'utf8'));
  const raw = await readFile(new URL('../catalog/directory-verification-2026-11-14.json', import.meta.url), 'utf8'); const proof = JSON.parse(raw);
  validateDirectoryObservations(state, { now }); assert.equal(proof.firstVerifiedAt, first);
  assert.equal(proof.scope, 'listing-presence'); assert.equal(proof.publisherTimestampAvailable, false); assert.equal(proof.remoteDirectoryFileBytesVerified, false);
  assert.deepEqual(proof.source, { repository: 'https://github.com/hraness/product-skills', commit: 'd674880d223e3da7bfe5e804af990057f3aed370' });
  assert.equal(proof.installation.attempts, 1); assert(proof.installation.filesMatchSource && proof.installation.checkedUserConfigurationUnchanged && proof.installation.temporaryProjectRemoved);
  assert.equal(Object.keys(proof.installation.files).length, 6); assert(proof.installation.files['textmock/scripts/textmock-link.mjs']); assert(proof.installation.files['dawn/examples/morning-study.ts']);
  for (const row of state.observations) { assert.equal(row.firstVerifiedAt, proof.firstVerifiedAt); const entry = proof.listings.find((entry) => entry.product === row.product); assert.equal(entry.url, row.url); assert(/^[a-f0-9]{64}$/.test(entry.responseSha256)); }
  assert(!/\/Users\/|\/private\/|file:|PRIVATE KEY|userConfig|npm-cache|config\.toml/.test(raw));
});

test('source hashes include every selected skill file and parse the owned scalar frontmatter', () => {
  const original = sourceSkillIdentity('textmock', { 'SKILL.md': text('textmock'), 'scripts/textmock-link.mjs': 'export const version = 1;\n' });
  const changed = sourceSkillIdentity('textmock', { 'scripts/textmock-link.mjs': 'export const version = 2;\n', 'SKILL.md': text('textmock') });
  assert.notEqual(original.sourceSkillHash, changed.sourceSkillHash); assert.equal(original.description, changed.description);
  assert.deepEqual(sourceSkillIdentity('textmock', { 'scripts/textmock-link.mjs': 'export const version = 1;\n', 'SKILL.md': text('textmock') }), original);
  assert.equal(sourceSkillIdentity('dawn', { 'SKILL.md': text('dawn', '"Write a # section."') }).description, 'Write a # section.');
  assert.equal(sourceSkillIdentity('dawn', { 'SKILL.md': text('dawn', "'A user''s song.'") }).description, "A user's song.");
  for (const files of [{ '../private': 'x', 'SKILL.md': text('dawn') }, { 'SKILL.md': text('sponge') }, { 'SKILL.md': text('dawn').replace('description:', 'name: dawn\ndescription:') }, { 'SKILL.md': text('dawn', '|') }, { 'SKILL.md': text('dawn', 'true') }, { 'SKILL.md': text('dawn'), 'large.md': 'x'.repeat(65536) }, { 'SKILL.md': Buffer.from([255]) }]) assert.throws(() => sourceSkillIdentity('dawn', files));
  for (const description of ['Current description.\n  Additional valid YAML text.', 'Current description.\n"description": Another value.', 'Current description.\n\'name\': dawn']) assert.throws(() => sourceSkillIdentity('dawn', { 'SKILL.md': text('dawn', description) }), /continuation|key form/);
  assert.equal(sourceSkillIdentity('dawn', { 'SKILL.md': text('dawn', 'Current description.\nmetadata:\n  version: "1"') }).description, 'Current description.');
});

test('semantic JSON-LD and canonical identity are independent of layout and tag spelling', () => {
  const source = sources().sponge;
  const app = application(source); delete app['@context']; app['@type'] = ['SoftwareApplication'];
  const html = `<!doctype html><head><LINK HREF='https:&#47;&#47;www.skills.sh/hraness/product-skills/sponge' REL='canonical'><SCRIPT TYPE = 'APPLICATION/LD+JSON'>${JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite', name: 'unrelated' }, app] })}</SCRIPT></head>`;
  assert.deepEqual(verifyDirectoryPage(html, source), { url: directoryUrl('sponge'), name: 'sponge', description: source.description, publisher: 'hraness' });
  assert.deepEqual(verifyDirectoryPage(page(source, '<section class="arbitrary-new-layout">New content</section>'), source).url, directoryUrl('sponge'));
});

test('an HTTP200 error shell or an ambiguous or different identity is not a listing', () => {
  const source = sources().sponge;
  const canonical = `<link rel="canonical" href="${directoryUrl('sponge')}">`;
  assert.throws(() => verifyDirectoryPage(canonical + script({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Skills' }), source), /Missing/);
  for (const change of [{ name: 'dawn' }, { url: directoryUrl('dawn') }, { description: 'Different text.' }, { '@context': 'https://attacker.invalid' }, { publisher: { '@type': 'Organization', name: 'another-owner', url: 'https://www.skills.sh/hraness' } }]) assert.throws(() => verifyDirectoryPage(canonical + script({ ...application(source), ...change }), source));
  assert.throws(() => verifyDirectoryPage(page(source) + canonical, source), /ambiguous/);
  assert.throws(() => verifyDirectoryPage(page(source) + script(application(source)), source), /ambiguous/);
  assert.throws(() => verifyDirectoryPage(page(source).replace('rel="canonical"', 'rel="canonical" rel="canonical"'), source), /Duplicate metadata/);
  assert.throws(() => verifyDirectoryPage(page(source).replace('"name":"sponge"', '"name":"wrong","name":"sponge"'), source), /Duplicate JSON/);
});

test('comments, inert elements and opaque JavaScript cannot supply structured listing data', () => {
  const source = sources().sponge; const canonical = `<link rel="canonical" href="${directoryUrl('sponge')}">`; const payload = script(application(source));
  const wrappers = [`<!--${payload}-->`, `<template><template>${payload}</template></template>`, `<textarea>${payload}</textarea>`, `<style>${payload}</style>`, `<noscript>${payload}</noscript>`, `<svg>${payload}</svg>`, `<script>const data = ${JSON.stringify(payload).replaceAll('</script>', '<\\/script>')};</script>`];
  for (const wrapped of wrappers) assert.throws(() => verifyDirectoryPage(canonical + wrapped, source), /Missing/);
  assert.throws(() => verifyDirectoryPage(canonical + `<template/>${payload}`, source), /Unclosed inert/);
  for (const bogus of [`<!bogus ${payload}]]>`, `<![CDATA[${payload}]]>`, `<?bogus ${payload}>`]) assert.throws(() => verifyDirectoryPage(canonical + bogus, source), /Unsupported HTML/);
  for (const malformed of ['<!-- unclosed', '<script type="application/ld+json">{}', '<template>', '<link href="never-closes>']) assert.throws(() => verifyDirectoryPage(canonical + malformed, source));
});

test('first observation requests exactly four canonical pages with no credentials or redirects', async () => {
  const current = sources(); const remote = server(current); const result = await observeDirectories(initialDirectoryObservations(), current, { ...remote, now });
  assert(result.changed); assert.equal(result.observations.observations.length, 4);
  for (const call of remote.calls) { assert(DIRECTORY_IDS.some((id) => directoryUrl(id) === call.url)); assert.equal(call.options.method, 'GET'); assert.equal(call.options.redirect, 'error'); assert.equal(call.options.credentials, 'omit'); assert.deepEqual(call.options.headers, { accept: 'text/html' }); assert(call.options.signal instanceof AbortSignal); }
  assert.equal(remote.calls.length, 4); assert.equal(result.report.scope, 'listing-presence'); assert.equal(result.report.remoteFileBytesVerified, false);
});

test('unchanged listing presence is a stable no-op despite time and unrelated HTML changes', async () => {
  const current = sources(); const previous = records(); const before = JSON.stringify(previous);
  const remote = server(current, (body) => body + '<aside>Install count changed</aside>');
  const result = await observeDirectories(previous, current, { ...remote, now });
  assert.equal(result.changed, false); assert.equal(JSON.stringify(result.observations), before); assert.equal(JSON.stringify(previous), before);
  assert.equal(result.report.checkedAt, '2026-11-16T00:00:00.000Z'); assert(!JSON.stringify(result.observations).includes('checkedAt'));
});

test('new first verification uses completion time across a day boundary while saved dates stay fixed', async () => {
  const current = sources(); const times = [Date.parse('2026-11-15T23:59:59.000Z'), Date.parse('2026-11-16T00:00:01.000Z')];
  const clock = () => { assert(times.length); return times.shift(); };
  const result = await observeDirectories(initialDirectoryObservations(), current, { ...server(current), now: clock });
  for (const row of result.observations.observations) assert.equal(row.firstVerifiedAt, '2026-11-16T00:00:01.000Z');
  assert.equal(result.report.checkedAt, '2026-11-16T00:00:01.000Z'); assert.equal(times.length, 0);
  const again = [Date.parse('2026-11-16T00:01:00.000Z'), Date.parse('2026-11-16T00:02:00.000Z')];
  const unchanged = await observeDirectories(result.observations, current, { ...server(current), now: () => again.shift() });
  assert.equal(unchanged.changed, false); assert.deepEqual(unchanged.observations, result.observations);
  const backward = [Date.parse('2026-11-16T00:01:00.000Z'), Date.parse('2026-11-16T00:00:00.000Z')];
  await assert.rejects(observeDirectories(result.observations, current, { ...server(current), now: () => backward.shift() }), /clock moved backward/);
});

test('a changed local helper hash keeps the first date without claiming remote helper bytes', async () => {
  const current = sources(); const previous = records(); const remote = server(current); current.textmock.sourceSkillHash = 'a'.repeat(64);
  const result = await observeDirectories(previous, current, { ...remote, now });
  assert(result.changed); assert.equal(result.observations.observations.find((row) => row.product === 'textmock').sourceSkillHash, 'a'.repeat(64));
  for (const row of result.observations.observations) assert.equal(row.firstVerifiedAt, first);
  assert.equal(result.report.remoteFileBytesVerified, false); assert(!JSON.stringify(result.observations).includes('version'));
});

test('all four reads settle before a failed batch preserves the previous records', async () => {
  const current = sources(); const previous = records(); const before = structuredClone(previous); const completed = [];
  await assert.rejects(observeDirectories(previous, current, { now, fetchImpl: async (url) => {
    const id = DIRECTORY_IDS.find((id) => directoryUrl(id) === url);
    if (id === 'sponge') { completed.push(id); throw new Error('offline'); }
    await new Promise((resolve) => setTimeout(resolve, 5)); completed.push(id); return response(url, page(current[id]));
  } }), /all four/);
  assert.deepEqual(completed.sort(), [...DIRECTORY_IDS].sort()); assert.deepEqual(previous, before);
});

test('redirects, URL drift, error shells and wrong response media types preserve every record', async () => {
  const current = sources(); const previous = records(); const before = structuredClone(previous);
  for (const options of [{ status: 308 }, { redirected: true }, { url: 'https://attacker.invalid/page' }, { type: 'application/json' }]) {
    await assert.rejects(observeDirectories(previous, current, { now, fetchImpl: async (url) => { const id = DIRECTORY_IDS.find((id) => directoryUrl(id) === url); return response(url, page(current[id]), id === 'sponge' ? options : {}); } }), /all four/);
    assert.deepEqual(previous, before);
  }
  const shell = server(current, (body, id) => id === 'dawn' ? '<html>404</html>' : body);
  await assert.rejects(observeDirectories(previous, current, { ...shell, now }), /all four/); assert.deepEqual(previous, before);
});

test('page size, UTF-8 and structured-data limits are enforced without accepting partial success', async () => {
  const current = sources(); const previous = records();
  for (const bad of [Buffer.alloc(1024 * 1024 + 1, 32), Buffer.from([255]), page(current.sponge) + script({ '@type': 'Other', data: 'x'.repeat(131072) })]) {
    await assert.rejects(observeDirectories(previous, current, { now, fetchImpl: async (url) => { const id = DIRECTORY_IDS.find((id) => directoryUrl(id) === url); return response(url, id === 'sponge' ? bad : page(current[id])); } }), /all four/);
  }
  assert.throws(() => verifyDirectoryPage(page(current.sponge) + Array.from({ length: 8 }, () => script({ '@type': 'Other' })).join(''), current.sponge), /limit/);
});

test('record validation refuses invented publication fields, partial sets, future dates and foreign URLs', async () => {
  const previous = records();
  for (const change of [{ publishedAt: first }, { firstVerifiedAt: '2099-01-01T00:00:00.000Z' }, { url: 'https://skills.sh/hraness/product-skills/dawn' }, { product: 'other' }, { sourceSkillHash: 'unknown' }]) {
    const bad = structuredClone(previous); Object.assign(bad.observations[0], change); assert.throws(() => validateDirectoryObservations(bad, { now }));
  }
  assert.throws(() => validateDirectoryObservations({ ...previous, observations: previous.observations.slice(1) }, { now }));
  const remote = server(); const missing = sources(); delete missing.dawn;
  await assert.rejects(observeDirectories(previous, missing, { ...remote, now })); assert.equal(remote.calls.length, 0);
});

test('pending merges preserve committed first dates and the earlier uncommitted verified time', () => {
  const baseline = records(); const pending = records(); const desired = records(); desired.observations[0].sourceSkillHash = 'b'.repeat(64);
  const merged = mergePendingDirectoryObservations(pending, desired, baseline, { now }); assert.equal(merged.observations[0].sourceSkillHash, 'b'.repeat(64)); assert.equal(merged.observations[0].firstVerifiedAt, first);
  const changed = structuredClone(desired); changed.observations[0].firstVerifiedAt = '2026-11-15T00:00:00.000Z';
  assert.throws(() => mergePendingDirectoryObservations(pending, changed, baseline, { now }), /first directory/);
  assert.throws(() => mergePendingDirectoryObservations(initialDirectoryObservations(), desired, baseline, { now }), /removed/);
  const later = structuredClone(desired); for (const row of later.observations) row.firstVerifiedAt = '2026-11-15T00:00:00.000Z';
  assert.equal(mergePendingDirectoryObservations(later, desired, initialDirectoryObservations(), { now }).observations[0].firstVerifiedAt, first);
  assert.equal(mergePendingDirectoryObservations(pending, later, initialDirectoryObservations(), { now }).observations[0].firstVerifiedAt, first);
});

test('checkout readers refuse symlinks and keep unrelated icon or catalog fields outside skill hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'directory-observer-'));
  try {
    await mkdir(join(root, 'catalog')); await writeFile(join(root, 'catalog/directory-observations.json'), JSON.stringify(records()));
    for (const id of DIRECTORY_IDS) { await mkdir(join(root, 'skills', id), { recursive: true }); await writeFile(join(root, 'skills', id, 'SKILL.md'), text(id)); }
    const before = await readDirectorySources(root); assert.deepEqual(before, sources()); assert.deepEqual(await readDirectoryObservations(root), records());
    await mkdir(join(root, 'plugins/dawn/assets'), { recursive: true }); await writeFile(join(root, 'plugins/dawn/assets/icon.png'), Buffer.from([137, 80, 78, 71]));
    await writeFile(join(root, 'catalog/admitted.json'), JSON.stringify({ listingIcon: { arbitraryFutureField: true } })); assert.deepEqual(await readDirectorySources(root), before);
    await symlink('/private/tmp', join(root, 'skills/dawn/outside')); await assert.rejects(readDirectorySources(root), /symlink/); await rm(join(root, 'skills/dawn/outside'));
    await rm(join(root, 'catalog/directory-observations.json')); await symlink(join(root, 'skills/dawn/SKILL.md'), join(root, 'catalog/directory-observations.json')); await assert.rejects(readDirectoryObservations(root), /regular/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
