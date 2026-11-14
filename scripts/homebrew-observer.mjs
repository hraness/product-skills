import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendPublications, digest, HOMEBREW_TAP as TAP, homebrewPublicationId, homebrewPublicationUrl, parseUnique, validateLedger, version } from './distribution.mjs';

const need = (value, message) => { if (!value) throw new Error(message); };
const sha = (value) => { need(typeof value === 'string' && /^[a-f0-9]{40}$/.test(value), 'Invalid tap Git identity'); return value; };
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') === [...fields].sort().join('\0');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const prefix = `repos/${TAP.repository}`;
export const initialHomebrewCursor = () => ({ schemaVersion: 1, repository: TAP.repository, throughCommit: null });
export function validateHomebrewCursor(value) {
  need(exact(value, ['schemaVersion', 'repository', 'throughCommit']) && value.schemaVersion === 1 && value.repository === TAP.repository && (value.throughCommit === null || /^[a-f0-9]{40}$/.test(value.throughCommit)), 'Invalid Homebrew observation cursor'); return value;
}
export async function readHomebrewCursor(root) {
  for (const [path, directory] of [[root, true], [join(root, 'catalog'), true], [join(root, TAP.cursor), false]]) {
    const info = await lstat(path); need(!info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile() && info.size > 0 && info.size <= 4096), 'Homebrew cursor must be a bounded regular checkout file');
  }
  return validateHomebrewCursor(parseUnique(await readFile(join(root, TAP.cursor), 'utf8')));
}

export async function publicTapJSON(path, { fetchImpl = fetch } = {}) {
  need(path.startsWith(`${prefix}/`) || path === prefix, 'Unexpected tap source path');
  const response = await fetchImpl(`https://api.github.com/${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' } });
  need(response.status === 200 && !response.redirected && response.body, 'Public tap source is unavailable');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; need(size <= 1024 * 1024, 'Public tap response exceeds its limit'); chunks.push(Buffer.from(chunk)); }
  return parseUnique(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

function archiveRecord(record) {
  need(exact(record, ['schemaVersion', 'product', 'version', 'build', 'url', 'sha256', 'length', 'architecture', 'minimumMacOS', 'edSignature']) && record.schemaVersion === 1 && record.product === TAP.product, 'Invalid cask catalog fields'); version(record.version);
  homebrewPublicationId(record.version, record.build);
  need(/^[a-f0-9]{64}$/.test(record.sha256) && record.url === `https://yaptake.com/downloads/${record.sha256}/Yaptake-${record.version}-private.zip` && Number.isSafeInteger(record.length) && record.length > 0 && record.length <= 268435456 && record.architecture === 'arm64' && record.minimumMacOS === '26.0' && /^[A-Za-z0-9+/]{86}==$/.test(record.edSignature), 'Cask archive or platform identity differs'); return record;
}

// This is a reader for the selected cask's small Ruby subset, not an evaluator.
// Preserve physical statement lines: a newline can change Ruby's meaning.
function interpolates(raw) {
  let backslashes = 0;
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === '\\') { backslashes++; continue; }
    if (raw[index] === '#' && /[{@$]/.test(raw[index + 1] ?? '') && backslashes % 2 === 0) return true;
    backslashes = 0;
  }
  return false;
}
function tokens(source) {
  need(typeof source === 'string' && Buffer.byteLength(source) <= 16384 && source.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(source), 'Invalid cask text');
  const output = []; let i = 0; let line = 1;
  while (i < source.length) {
    const c = source[i]; if (/\s/.test(c)) { if (c === '\n') line++; i++; continue; }
    if (c === '#') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c; const start = ++i; let raw = '';
      for (; i < source.length && source[i] !== quote; i++) { need(source[i] !== '\n' && source[i] !== '\r', 'Multiline cask strings are unsupported'); if (source[i] === '\\') { raw += source[i++]; need(i < source.length, 'Unclosed cask string'); } raw += source[i]; }
      need(i < source.length && i >= start, 'Unclosed cask string'); i++;
      output.push({ type: 'string', value: raw.replace(/\\([\\'"])/g, '$1'), interpolate: quote === '"' && interpolates(raw), line }); continue;
    }
    if (c === '/') {
      let raw = '/'; i++;
      for (; i < source.length && source[i] !== '/'; i++) { need(source[i] !== '\n', 'Multiline cask patterns are unsupported'); if (source[i] === '\\') raw += source[i++]; need(i < source.length, 'Unclosed cask pattern'); raw += source[i]; }
      need(source[i] === '/', 'Unclosed cask pattern'); raw += source[i++];
      while (/[a-z]/i.test(source[i] ?? '') && i < source.length) raw += source[i++];
      output.push({ type: 'pattern', value: raw, line }); continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*[!?]?/.exec(source.slice(i));
    if (word) { output.push({ type: 'word', value: word[0], line }); i += word[0].length; continue; }
    const punctuation = /^(?:&\.|<<|[.():,\[\]|=])/.exec(source.slice(i));
    need(punctuation, 'Unsupported Ruby cask syntax'); output.push({ type: 'punctuation', value: punctuation[0], line }); i += punctuation[0].length;
  }
  return output;
}
const valueToken = (token) => ({ type: token.type, value: token.value, ...(token.type === 'string' ? { interpolate: token.interpolate } : {}) });
function statementLines(input) {
  const lines = []; let prior;
  for (const token of input) { if (token.line !== prior) { lines.push([]); prior = token.line; } lines.at(-1).push(valueToken(token)); } return lines;
}
const livecheck = String.raw`livecheck do
  url "https://yaptake.com/appcast.xml"
  strategy :xml do |xml|
    xml.get_elements("rss/channel/item").each_with_object([]) do |item, versions|
      short_version = item.elements["sparkle:shortVersionString"]&.text&.strip
      build = item.elements["sparkle:version"]&.text&.strip
      next unless short_version&.match?(/\A\d+\.\d+\.\d+\z/)
      next unless build&.match?(/\A[1-9]\d*\z/)
      versions << "#{short_version},#{build}"
    end
  end
end`;
const livecheckIdentity = statementLines(tokens(livecheck));

export function homebrewSemanticIdentity(record, cask) {
  archiveRecord(record); const input = tokens(cask); let index = 0; const fields = {};
  const take = (value) => { const token = input[index++]; need(token && (value === undefined || token.value === value), 'Unexpected cask statement'); return token; };
  const literal = () => { const token = take(); need(token.type === 'string', 'Cask statement requires a literal'); return token; };
  const sameLine = (first, last) => need(first.line === last.line && (!input[index] || input[index].line > first.line), 'Cask statement layout changes its meaning');
  const start = take('cask'); const token = literal(); const block = take('do'); need(token.value === 'yaptake' && !token.interpolate, 'Unexpected cask token'); sameLine(start, block);
  while (input[index]?.value !== 'end') {
    const name = take(); need(name.type === 'word', 'Unexpected cask declaration');
    if (name.value === 'livecheck') {
      need(!Object.hasOwn(fields, 'livecheck'), 'Duplicate cask livecheck'); take('do'); let depth = 1;
      const selected = [name, input[index - 1]];
      while (depth && index < input.length) { const token = take(); selected.push(token); if (token.type === 'word' && token.value === 'do') depth++; if (token.type === 'word' && token.value === 'end') depth--; }
      need(depth === 0 && JSON.stringify(statementLines(selected)) === JSON.stringify(livecheckIdentity), 'Cask update guard differs'); fields.livecheck = livecheckIdentity; continue;
    }
    if (name.value === 'depends_on') {
      const property = take(); take(':'); take(':'); const value = take(); sameLine(name, value);
      need(['arch', 'macos'].includes(property.value) && value.type === 'word' && !Object.hasOwn(fields, property.value), 'Unexpected cask platform guard'); fields[property.value] = value.value; continue;
    }
    need(['version', 'sha256', 'url', 'name', 'desc', 'homepage', 'auto_updates', 'app', 'binary'].includes(name.value) && !Object.hasOwn(fields, name.value), 'Unknown or duplicate Ruby cask hook');
    const value = name.value === 'auto_updates' ? take() : literal(); sameLine(name, value); fields[name.value] = value;
  }
  take('end'); need(index === input.length, 'Unexpected code after the cask');
  need(Object.keys(fields).length === 12 && fields.version?.value === `${record.version},${record.build}` && !fields.version.interpolate && fields.sha256?.value === record.sha256 && !fields.sha256.interpolate, 'Cask version/build or checksum differs');
  const url = fields.url; need(url && (!url.interpolate || url.value.includes('#{version.csv.first}')), 'Cask URL interpolation differs');
  need(url.value.replace('#{version.csv.first}', record.version) === record.url && (!url.value.includes('#{') || url.interpolate), 'Cask URL differs from its archive');
  need(fields.name?.value && !fields.name.interpolate && fields.desc?.value && !fields.desc.interpolate && !fields.homepage?.interpolate && ['https://yaptake.com', 'https://yaptake.com/'].includes(fields.homepage?.value), 'Invalid cask presentation metadata');
  need(fields.auto_updates?.type === 'word' && fields.auto_updates.value === 'true' && fields.arch === 'arm64' && fields.macos === 'tahoe' && fields.app?.value === 'Yaptake.app' && !fields.app.interpolate && fields.binary?.value === '#{appdir}/Yaptake.app/Contents/Helpers/yaptake' && fields.binary.interpolate && fields.livecheck, 'Cask install or preservation guards differ');
  return canonical({ archive: record, install: { app: fields.app.value, binary: fields.binary.value, autoUpdates: true, architecture: fields.arch, minimumMacOS: fields.macos }, livecheck: fields.livecheck });
}

export function homebrewContentHash(record, cask) { return digest(JSON.stringify(homebrewSemanticIdentity(record, cask))); }

function mergedTime(value, now) {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value), 'Invalid cask publication timestamp');
  const date = new Date(value); need(Number.isFinite(date.valueOf()) && date.toISOString() === value.replace('Z', '.000Z') && date.valueOf() <= now(), 'Cask publication time is invalid or in the future'); return date.toISOString();
}
async function mergedPull(commit, get) {
  const rows = await get(`${prefix}/commits/${sha(commit)}/pulls?per_page=10`);
  need(Array.isArray(rows) && rows.length < 10, 'Cask publication PR inventory is incomplete');
  const selected = rows.filter((pull) => pull.merged_at && pull.base?.ref === 'main' && pull.base.repo?.id === TAP.repositoryId && pull.base.repo.full_name === TAP.repository);
  need(selected.length === 1 && Number.isSafeInteger(selected[0].number) && selected[0].number > 0, 'Expected one merged main cask publication');
  const pull = await get(`${prefix}/pulls/${selected[0].number}`);
  need(pull.number === selected[0].number && pull.state === 'closed' && pull.merged === true && pull.base?.ref === 'main' && pull.base.repo?.id === TAP.repositoryId && pull.base.repo.full_name === TAP.repository && pull.merged_at === selected[0].merged_at, 'Cask merge identity changed');
  // REST 2026-03-10 removes merge_commit_sha from every PR payload. The server's
  // merged timeline event supplies both the actual commit and matching date.
  const events = []; let complete = false;
  for (let page = 1; page <= 3; page++) {
    const rows = await get(`${prefix}/issues/${pull.number}/timeline?per_page=100&page=${page}`);
    need(Array.isArray(rows) && rows.length <= 100, 'Cask merge timeline is incomplete'); events.push(...rows.filter((event) => event.event === 'merged'));
    if (rows.length < 100) { complete = true; break; }
  }
  need(complete && events.length === 1 && events[0].created_at === pull.merged_at, 'Cask merged event identity or inventory differs');
  return { ...pull, publicationCommit: sha(events[0].commit_id) };
}

async function treeAt(commit, get) {
  const value = await get(`${prefix}/git/trees/${sha(commit)}?recursive=1`);
  need(value.truncated === false && Array.isArray(value.tree) && value.tree.length <= 5000, 'Tap tree inventory is incomplete');
  const paths = {};
  for (const path of [TAP.cask, TAP.catalog]) {
    const matches = value.tree.filter((entry) => entry.path === path); need(matches.length <= 1, 'Duplicate cask path'); const entry = matches[0];
    if (entry) {
      for (const directory of [path.split('/')[0]]) need(value.tree.some((entry) => entry.path === directory && entry.type === 'tree' && entry.mode === '040000'), 'Cask parent must be a regular Git directory');
      need(entry.type === 'blob' && entry.mode === '100644' && Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= 16384, 'Cask source must be a bounded regular Git blob'); sha(entry.sha);
    }
    paths[path] = entry ?? null;
  }
  need(Boolean(paths[TAP.cask]) === Boolean(paths[TAP.catalog]), 'Cask and catalog availability differ'); return paths;
}
async function blobText(entry, get) {
  const blob = await get(`${prefix}/git/blobs/${entry.sha}`);
  need(blob.sha === entry.sha && blob.encoding === 'base64' && blob.size === entry.size && typeof blob.content === 'string' && blob.content.length <= 24000, 'Cask blob identity differs');
  const encoded = blob.content.replaceAll('\n', ''); need(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded), 'Invalid cask blob encoding'); const bytes = Buffer.from(encoded, 'base64');
  need(bytes.length === entry.size && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === entry.sha, 'Cask blob bytes differ'); return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function bootstrap(main, get) {
  const history = []; const seen = new Set(); let complete = false;
  for (let page = 1; page <= 5; page++) {
    const rows = await get(`${prefix}/commits?sha=${main}&path=${encodeURIComponent(TAP.cask)}&per_page=100&page=${page}`);
    need(Array.isArray(rows) && rows.length <= 100, 'Cask history page is invalid');
    for (const row of rows) { sha(row.sha); need(!seen.has(row.sha), 'Cask history repeats a commit'); seen.add(row.sha); history.push(row); }
    if (rows.length < 100) { complete = true; break; }
  }
  need(complete, 'Cask introduction history exceeds the read bound');
  if (!history.length) return main;
  const pull = await mergedPull(history.at(-1).sha, get); const commit = await get(`${prefix}/git/commits/${pull.publicationCommit}`);
  need(commit.sha === pull.publicationCommit && Array.isArray(commit.parents) && commit.parents.length >= 1 && commit.parents.length <= 2, 'Invalid first cask merge ancestry');
  const before = sha(commit.parents[0].sha); need(!(await treeAt(before, get))[TAP.cask], 'Earliest cask history does not establish first availability'); return before;
}

async function mainAncestry(base, main, get) {
  if (base === main) return [];
  const commits = new Map(); let total;
  for (let page = 1; page <= 5; page++) {
    const result = await get(`${prefix}/compare/${base}...${main}?per_page=100&page=${page}`);
    need(result.base_commit?.sha === base && result.merge_base_commit?.sha === base && result.behind_by === 0 && Number.isSafeInteger(result.total_commits) && result.total_commits > 0 && result.total_commits <= 500 && Array.isArray(result.commits) && result.commits.length <= 100 && (total === undefined || total === result.total_commits), 'Tap comparison ancestry or inventory differs'); total = result.total_commits;
    for (const commit of result.commits) { sha(commit.sha); need(!commits.has(commit.sha) && Array.isArray(commit.parents) && commit.parents.length >= 1 && commit.parents.length <= 2, 'Tap comparison repeats or omits ancestry'); commits.set(commit.sha, commit); }
    if (commits.size === total) break;
    need(result.commits.length === 100, 'Tap comparison pagination is incomplete');
  }
  need(commits.size === total, 'Tap comparison exceeds the read bound');
  const chain = []; let current = main;
  while (current !== base) { const commit = commits.get(current); need(commit && chain.length < commits.size, 'Tap first-parent history is incomplete'); chain.push(commit); current = sha(commit.parents[0].sha); }
  return chain.reverse();
}

async function checkedPublication(commit, workflow, get) {
  const runs = await get(`${prefix}/actions/workflows/ci.yml/runs?head_sha=${commit}&event=push&per_page=100`);
  need(Array.isArray(runs.workflow_runs) && Number.isSafeInteger(runs.total_count) && runs.total_count === runs.workflow_runs.length && runs.total_count <= 100, 'Cask CI run inventory is incomplete');
  const run = runs.workflow_runs.filter((run) => run.head_sha === commit && run.head_branch === 'main' && run.head_repository?.id === TAP.repositoryId && run.head_repository.full_name === TAP.repository && run.workflow_id === workflow.id && run.name === workflow.name && run.event === 'push').sort((a, b) => b.id - a.id)[0];
  need(run?.status === 'completed' && run.conclusion === 'success' && Number.isSafeInteger(run.check_suite_id), 'The published cask needs successful canonical main CI');
  const checks = await get(`${prefix}/commits/${commit}/check-runs?per_page=100`);
  need(Array.isArray(checks.check_runs) && checks.total_count === checks.check_runs.length && checks.total_count <= 100, 'Cask check inventory is incomplete');
  for (const name of ['Required', 'Yaptake cask']) {
    const check = checks.check_runs.filter((check) => check.name === name && check.head_sha === commit && check.app?.id === 15368 && check.check_suite?.id === run.check_suite_id).sort((a, b) => b.id - a.id)[0];
    need(check?.status === 'completed' && check.conclusion === 'success', 'The actual cask needs Required and native cask checks from canonical CI');
  }
}

export async function observeHomebrew(ledger, cursor, { fetchImpl = fetch, read, now = Date.now, batchSize = 2 } = {}) {
  validateLedger(ledger); validateHomebrewCursor(cursor); need(Number.isSafeInteger(batchSize) && batchSize >= 1 && batchSize <= 2, 'Invalid Homebrew observation batch');
  let requests = 0; const cache = new Map();
  const get = async (path, fresh = false) => {
    if (!fresh && cache.has(path)) return cache.get(path);
    need(++requests <= 48, 'Homebrew observation exceeds its request bound');
    const result = Promise.resolve(read ? read(path) : publicTapJSON(path, { fetchImpl })); if (!fresh) cache.set(path, result); return result;
  };
  const repo = await get(prefix); need(repo.id === TAP.repositoryId && repo.full_name === TAP.repository && repo.owner?.id === TAP.ownerId && repo.owner.login === 'hraness' && repo.private === false && repo.visibility === 'public' && repo.default_branch === 'main', 'Public tap repository identity differs');
  const main = sha((await get(`${prefix}/git/ref/heads/main`)).object?.sha);
  if (cursor.throughCommit === main) return { ledger, cursor, report: { schemaVersion: 1, source: 'homebrew-tap', status: 'unchanged', throughCommit: main, caughtUp: true, requests, outcomes: [] } };
  const base = cursor.throughCommit ?? await bootstrap(main, get); const chain = await mainAncestry(base, main, get); const batch = chain.slice(0, batchSize);
  const workflow = await get(`${prefix}/actions/workflows/ci.yml`); need(Number.isSafeInteger(workflow.id) && workflow.path === '.github/workflows/ci.yml' && workflow.name === 'CI', 'Canonical tap validation workflow differs');
  let previous = await treeAt(base, get); let updated = structuredClone(ledger); const outcomes = [];
  for (const commit of batch) {
    const current = await treeAt(commit.sha, get);
    if (current[TAP.cask]?.sha !== previous[TAP.cask]?.sha || current[TAP.catalog]?.sha !== previous[TAP.catalog]?.sha) {
      if (current[TAP.cask]) {
        const catalog = parseUnique(await blobText(current[TAP.catalog], get)); const cask = await blobText(current[TAP.cask], get); const contentHash = homebrewContentHash(catalog, cask);
        const pull = await mergedPull(commit.sha, get); need(pull.publicationCommit === commit.sha, 'Only the actual main cask merge can establish availability'); await checkedPublication(commit.sha, workflow, get);
        const id = homebrewPublicationId(catalog.version, catalog.build); const previousEntry = updated.publications.find((entry) => entry.id === id); const publishedAt = mergedTime(pull.merged_at, now);
        if (previousEntry) { need(previousEntry.product === TAP.product && previousEntry.channel === 'homebrew' && previousEntry.contentHash === contentHash && previousEntry.version === catalog.version && previousEntry.publishedAt <= publishedAt, 'A published cask version/build changed its semantic identity or first date'); outcomes.push({ id, status: 'unchanged' }); }
        else { updated = appendPublications(updated, [{ id, product: TAP.product, channel: 'homebrew', version: catalog.version, contentHash, publishedAt, url: homebrewPublicationUrl(commit.sha) }]); outcomes.push({ id, status: 'recorded' }); }
      } else outcomes.push({ status: 'not_available' });
    }
    previous = current;
  }
  need(sha((await get(`${prefix}/git/ref/heads/main`, true)).object?.sha) === main, 'Public tap main changed during observation');
  const throughCommit = batch.at(-1)?.sha ?? base;
  return { ledger: updated, cursor: validateHomebrewCursor({ ...cursor, throughCommit }), report: { schemaVersion: 1, source: 'homebrew-tap', status: 'observed', throughCommit, caughtUp: throughCommit === main, requests, outcomes } };
}

export async function mergePendingHomebrewCursor(pending, desired, baseline, { read = publicTapJSON } = {}) {
  for (const value of [pending, desired, baseline]) validateHomebrewCursor(value);
  const contains = async (base, head) => {
    if (base === null || base === head) return true; if (head === null) return false;
    const result = await read(`${prefix}/compare/${base}...${head}?per_page=1`); return result.base_commit?.sha === base && result.merge_base_commit?.sha === base && result.behind_by === 0;
  };
  need(await contains(baseline.throughCommit, pending.throughCommit) && await contains(baseline.throughCommit, desired.throughCommit), 'Homebrew observation cursor cannot move backward');
  if (await contains(pending.throughCommit, desired.throughCommit)) return desired;
  need(await contains(desired.throughCommit, pending.throughCommit), 'Homebrew observation cursors diverged'); return pending;
}
