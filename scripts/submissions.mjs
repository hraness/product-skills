import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseUnique } from './distribution.mjs';

export const SUBMISSIONS_FILE = 'catalog/submissions.json';
export const SUBMISSIONS_INDEX = 'docs/SUBMISSIONS.md';
const ids = ['dawn', 'sponge', 'textmock', 'yaptake'];
const apiOrigin = 'https://api.github.com';
const need = (value, message) => { if (!value) throw new Error(message); };
const exact = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') === [...fields].sort().join('\0');
const canonical = (value) => JSON.stringify(Array.isArray(value) ? value.map((row) => JSON.parse(canonical(row))) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, JSON.parse(canonical(value[key]))])) : value);
const same = (a, b) => canonical(a) === canonical(b);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const text = (value, max = 1000) => typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed() && !/[\x00-\x1f\x7f<>`]/.test(value);
const repo = (value) => typeof value === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(value) && !value.endsWith('/.') && !value.endsWith('/..');
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const products = (value) => Array.isArray(value) && value.length > 0 && value.length <= ids.length && new Set(value).size === value.length && value.every((id) => ids.includes(id));
const snapshot = (value) => exact(value, ['state', 'updatedAt', 'mergedAt']) && ['open', 'closed'].includes(value.state) && date(value.updatedAt) && (value.mergedAt === null || date(value.mergedAt) && value.state === 'closed' && Date.parse(value.mergedAt) <= Date.parse(value.updatedAt));
const immutable = (row) => canonical(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'github')));
const md = (value) => String(value).replaceAll('&', '&amp;').replaceAll('|', '\\|').replaceAll('[', '\\[').replaceAll(']', '\\]');

export function validateSubmissions(value, { now = Date.now } = {}) {
  need(exact(value, ['schemaVersion', 'searches', 'targets', 'submissions']) && value.schemaVersion === 1, 'Invalid submission catalog');
  need(Array.isArray(value.searches) && value.searches.length === ids.length && Array.isArray(value.targets) && value.targets.length <= 100 && Array.isArray(value.submissions) && value.submissions.length <= 50, 'Submission catalog exceeds its supported shape');
  const seenProducts = new Set();
  for (const search of value.searches) {
    need(exact(search, ['product', 'intent', 'queries']) && ids.includes(search.product) && !seenProducts.has(search.product) && text(search.intent) && Array.isArray(search.queries) && search.queries.length >= 1 && search.queries.length <= 4, 'Invalid saved product search');
    seenProducts.add(search.product);
    for (const query of search.queries) need(text(typeof query === 'string' ? query.replaceAll('>', '').replaceAll('<', '') : query, 300) && query.includes('is:public') && query.includes('archived:false') && query.includes('stars:>=') && !/(?:https?:|is:private|user:|org:|repo:|fork:true|[{}])/i.test(query.replaceAll('{recent}', '')), 'Saved searches must select public, active repositories and a popularity floor');
  }
  const seenTargets = new Set();
  for (const target of value.targets) {
    need(exact(target, ['repository', 'products', 'decision', 'reason', 'rulesUrl', 'reviewedAt', 'sourceCommit', 'reach']) && repo(target.repository) && products(target.products) && !seenTargets.has(target.repository.toLowerCase()), 'Invalid reviewed collection');
    need(['eligible', 'deferred', 'ineligible'].includes(target.decision) && text(target.reason) && date(target.reviewedAt) && Date.parse(target.reviewedAt) <= now(), 'Invalid collection review');
    need(exact(target.reach, ['stars', 'forks', 'watchers', 'pushedAt', 'archived']) && [target.reach.stars, target.reach.forks, target.reach.watchers].every((n) => Number.isSafeInteger(n) && n >= 0) && date(target.reach.pushedAt) && Date.parse(target.reach.pushedAt) <= now() && typeof target.reach.archived === 'boolean', 'Invalid public activity snapshot');
    need(target.sourceCommit === null && target.rulesUrl === null && target.reach.archived && target.decision === 'ineligible' || typeof target.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(target.sourceCommit) && typeof target.rulesUrl === 'string' && target.rulesUrl.startsWith(`https://github.com/${target.repository}/blob/${target.sourceCommit}/`) && target.rulesUrl.length <= 500 && !/[?#\s]/.test(target.rulesUrl), 'Collection rules must link to the reviewed source');
    seenTargets.add(target.repository.toLowerCase());
  }
  const seenIds = new Set(); const seenPulls = new Set();
  for (const row of value.submissions) {
    need(exact(row, ['id', 'products', 'channel', 'repository', 'repositoryId', 'number', 'url', 'author', 'submittedAt', 'github']) && typeof row.id === 'string' && /^[a-z0-9][a-z0-9-]{1,100}$/.test(row.id) && !seenIds.has(row.id), 'Invalid submission identity');
    need(products(row.products) && ['github-collection', 'homebrew'].includes(row.channel) && repo(row.repository) && positive(row.repositoryId) && positive(row.number) && row.url === `https://github.com/${row.repository}/pull/${row.number}` && !seenPulls.has(row.url.toLowerCase()), 'Invalid or duplicate pull request');
    need(exact(row.author, ['login', 'id']) && typeof row.author.login === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(row.author.login) && positive(row.author.id), 'Invalid submission author');
    need(date(row.submittedAt) && Date.parse(row.submittedAt) <= now() && snapshot(row.github) && Date.parse(row.github.updatedAt) <= now() && Date.parse(row.github.updatedAt) >= Date.parse(row.submittedAt) && (row.github.mergedAt === null || Date.parse(row.github.mergedAt) >= Date.parse(row.submittedAt)), 'Invalid submission dates or provider state');
    seenIds.add(row.id); seenPulls.add(row.url.toLowerCase());
  }
  return value;
}

export async function readSubmissions(root) {
  const path = join(root, SUBMISSIONS_FILE); const info = await lstat(path);
  need(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 256 * 1024, 'Submission catalog must be a regular bounded file');
  return validateSubmissions(parseUnique(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path))));
}

function mergeSnapshot(previous, next) {
  need(snapshot(previous) && snapshot(next), 'Invalid provider state');
  if (Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)) return previous;
  if (previous.mergedAt !== null) need(next.mergedAt === previous.mergedAt, 'A verified merge time cannot be removed or replaced');
  if (next.updatedAt === previous.updatedAt) need(same(next, previous), 'Conflicting provider states have the same update time');
  return next;
}

export function checkSubmissionHistory(previous, current) {
  validateSubmissions(previous); validateSubmissions(current);
  for (const before of previous.submissions) {
    const after = current.submissions.find((row) => row.id === before.id);
    need(after && immutable(after) === immutable(before), 'An existing submission identity or first submission date changed');
    need(same(mergeSnapshot(before.github, after.github), after.github), 'A submission provider state moved backward');
  }
}

export async function readGovernedSubmissions(root, sha) {
  need(typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha), 'Invalid governed submission SHA');
  const exec = promisify(execFile); await exec('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root });
  const entry = (await exec('git', ['ls-tree', sha, '--', SUBMISSIONS_FILE], { cwd: root })).stdout.trim();
  if (!entry) return null;
  need(new RegExp(`^100644 blob [a-f0-9]{40}\\t${SUBMISSIONS_FILE.replaceAll('.', '\\.')}$`).test(entry), 'Governed submissions must be a regular Git blob');
  return validateSubmissions(parseUnique((await exec('git', ['show', `${sha}:${SUBMISSIONS_FILE}`], { cwd: root, maxBuffer: 256 * 1024 })).stdout));
}

export function mergePendingSubmissions(pending, desired, baseline) {
  validateSubmissions(pending); validateSubmissions(desired); validateSubmissions(baseline);
  checkSubmissionHistory(baseline, desired);
  // Main owns the search strategy, target decisions and submission identities.
  // Only a newer verified provider state can survive from the pending proposal.
  const output = structuredClone(desired);
  for (const row of pending.submissions) {
    const base = baseline.submissions.find((entry) => entry.id === row.id);
    need(base && immutable(base) === immutable(row), 'Pending automation changed a submission identity');
    const next = output.submissions.find((entry) => entry.id === row.id);
    next.github = mergeSnapshot(mergeSnapshot(base.github, row.github), next.github);
  }
  return output;
}

export async function readPendingSubmissions(head, read) {
  need(typeof head === 'string' && /^[a-f0-9]{40}$/.test(head), 'Invalid pending submission SHA');
  const prefix = 'repos/hraness/product-skills/';
  const commit = await read(`${prefix}git/commits/${head}`); need(commit.sha === head && /^[a-f0-9]{40}$/.test(commit.tree?.sha), 'Pending submission commit differs');
  const tree = await read(`${prefix}git/trees/${commit.tree.sha}?recursive=1`);
  need(tree.sha === commit.tree.sha && tree.truncated === false && Array.isArray(tree.tree) && tree.tree.length <= 5000, 'Cannot inspect pending submissions');
  const entries = tree.tree.filter((entry) => entry.path === SUBMISSIONS_FILE);
  need(entries.length === 1 && entries[0].type === 'blob' && entries[0].mode === '100644' && positive(entries[0].size) && entries[0].size <= 256 * 1024 && /^[a-f0-9]{40}$/.test(entries[0].sha), 'Pending submissions must be a regular bounded Git blob');
  const blob = await read(`${prefix}git/blobs/${entries[0].sha}`);
  need(blob.encoding === 'base64' && typeof blob.content === 'string' && blob.content.length <= 512 * 1024 && blob.size === entries[0].size, 'Pending submissions are unavailable');
  const bytes = Buffer.from(blob.content, 'base64');
  need(bytes.length === blob.size && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === entries[0].sha, 'Pending submission bytes differ');
  return validateSubmissions(parseUnique(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

async function publicJson(path, { fetchImpl = fetch } = {}) {
  need(typeof path === 'string' && (path.startsWith('/repos/') || path.startsWith('/search/repositories?')), 'Unsupported public GitHub read');
  const url = `${apiOrigin}${path}`; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(url, { redirect: 'error', credentials: 'omit', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' }, signal: controller.signal });
    need(response.ok && (response.url === '' || response.url === url) && /^(?:application\/json|application\/[^;]+\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? ''), 'Public GitHub response did not verify');
    const declared = response.headers.get('content-length'); need(declared === null || /^\d+$/.test(declared) && Number(declared) <= 512 * 1024, 'Public GitHub response exceeds its limit');
    need(response.body, 'Public GitHub response is empty'); const chunks = []; let length = 0;
    for await (const bytes of response.body) { length += bytes.length; need(length <= 512 * 1024, 'Public GitHub response exceeds its limit'); chunks.push(bytes); }
    return parseUnique(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { clearTimeout(timer); }
}

export function pullSnapshot(row, pull) {
  need(pull?.number === row.number && pull.html_url === row.url && pull.base?.repo?.full_name === row.repository && pull.base.repo.id === row.repositoryId && pull.base.repo.private === false && pull.user?.login === row.author.login && pull.user.id === row.author.id, 'Pull request repository, author or URL changed');
  const iso = (value) => { need(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Invalid GitHub timestamp'); return new Date(value).toISOString(); };
  need(iso(pull.created_at) === row.submittedAt && typeof pull.merged === 'boolean' && pull.merged === (pull.merged_at !== null) && (!pull.merged || pull.state === 'closed'), 'Pull request creation or merge identity changed');
  const result = { state: pull.state, updatedAt: iso(pull.updated_at), mergedAt: pull.merged_at === null ? null : iso(pull.merged_at) };
  need(snapshot(result), 'Invalid GitHub pull request state'); return mergeSnapshot(row.github, result);
}

export async function observeSubmissions(previous, options = {}) {
  validateSubmissions(previous); const output = structuredClone(previous); const outcomes = [];
  // At most four in flight; the catalog admits at most 50 fixed public PRs.
  for (let start = 0; start < output.submissions.length; start += 4) {
    const batch = output.submissions.slice(start, start + 4);
    const results = await Promise.allSettled(batch.map(async (row) => pullSnapshot(row, await publicJson(`/repos/${row.repository}/pulls/${row.number}`, options))));
    results.forEach((result, index) => { const row = batch[index]; if (result.status === 'fulfilled') { row.github = result.value; outcomes.push({ id: row.id, status: 'verified' }); } else outcomes.push({ id: row.id, status: 'pending' }); });
  }
  // A partial or failed read cannot rewrite even one saved provider state.
  need(outcomes.every((row) => row.status === 'verified'), 'Not all saved public submissions verified; earlier records were preserved');
  checkSubmissionHistory(previous, output); return { catalog: output, outcomes };
}

export async function recordSubmissions({ root = process.cwd(), ...options } = {}) {
  await mkdir(join(root, 'dist'), { recursive: true });
  try {
    const result = await observeSubmissions(await readSubmissions(root), options);
    const { updateSubmissionCatalog } = await import('./distribution.mjs'); await updateSubmissionCatalog(root, result.catalog);
    const report = { schemaVersion: 1, status: 'verified', outcomes: result.outcomes };
    await writeFile(join(root, 'dist/submission-observation.json'), json(report)); return report;
  } catch (error) {
    await writeFile(join(root, 'dist/submission-observation.json'), json({ schemaVersion: 1, status: 'pending', reason: 'Public submission states could not all be verified. Earlier records remain available.' })); throw error;
  }
}

export function renderSubmissions(catalog, { ledger, directories, stores, names }) {
  validateSubmissions(catalog); need(ids.every((id) => typeof names?.[id] === 'string'), 'Each product needs its portfolio name');
  const label = (row) => row.products.map((id) => names[id]).join(', ');
  const channel = { github: 'GitHub package', 'mcp-registry': 'MCP Registry', homebrew: 'Homebrew cask', clawhub: 'ClawHub skill', chatgpt: 'OpenAI directory', claude: 'Claude directory', cursor: 'Cursor directory' };
  const hostStatus = (value) => value === 'published' ? 'Published' : value === 'eligibility_and_review_required' ? 'Eligibility and review required' : 'Review required';
  const state = (row) => row.github.mergedAt ? `Merged ${row.github.mergedAt.slice(0, 10)}` : row.github.state === 'open' ? 'Submitted; open' : 'Closed; no merge';
  let body = `# Submissions and listings\n\nThis index records proposed collection entries and links the existing publication and listing records. A submitted PR, a merged PR, a published package and a host directory approval describe different events. A merged PR does not prove that a listing remains available.\n\nThe [submission catalog](../${SUBMISSIONS_FILE}) owns saved searches, reviewed collection decisions and PR identities. The [15 November history audit](../catalog/submission-audit-2026-11-15.json) records the initial backfill. This page is generated; edit its source or the [publication ledger](../publication-ledger.json) and [directory observations](../catalog/directory-observations.json) through their documented checks.\n\n## GitHub proposals\n\n| Products | Collection or channel | Submitted | Provider state |\n| --- | --- | --- | --- |\n`;
  for (const row of [...catalog.submissions].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id))) body += `| ${label(row)} | [${md(row.repository)} #${row.number}](${row.url}) | ${row.submittedAt.slice(0, 10)} | ${state(row)} |\n`;
  if (!catalog.submissions.length) body += '| None recorded | | | |\n';
  body += '\n## Published packages and verified listings\n\nThese rows come from the existing records. The ledger keeps every earlier publication; a skills.sh first-verification date is not a publisher timestamp.\n\n| Product | Channel | Record | Date |\n| --- | --- | --- | --- |\n';
  for (const row of ledger.publications) {
    const formula = row.channel === 'homebrew' && row.product === 'oh-router';
    const name = formula ? row.product : names[row.product];
    const source = formula ? 'Homebrew formula' : channel[row.channel];
    body += `| ${name} | ${source} | [${row.version}](${row.url}) | Published ${row.publishedAt.slice(0, 10)} |\n`;
  }
  for (const row of directories.observations) body += `| ${names[row.product]} | skills.sh | [${stores[row.product]?.skillsSh === 'listed' ? 'Listed' : 'Earlier listing; verification required'}](${row.url}) | First verified ${row.firstVerifiedAt.slice(0, 10)} |\n`;
  body += '\n## Host directories\n\n| Product | OpenAI | Claude | Cursor |\n| --- | --- | --- | --- |\n';
  for (const id of ids) { const row = stores[id]; if (!row) continue; body += `| ${names[id]} | ${hostStatus(row.chatgpt)} | ${hostStatus(row.claude)} | ${hostStatus(row.cursor)} |\n`; }
  body += `\n${ledger.publications.some((row) => ['chatgpt', 'claude', 'cursor'].includes(row.channel)) ? 'Verified host directory publications appear in the table above.' : 'No host directory submission URL has been verified for these packages.'}`;
  body += ' Sponge’s packaged Raycast Script Commands require manual import; they are not a Raycast Store listing. Follow [directory submission instructions](DIRECTORY_SUBMISSIONS.md) for account, demonstration and product requirements. Record a real provider acknowledgement before adding a submission claim.\n\n## Repeat the collection searches\n\nUse Node.js 24 and run `node scripts/submissions.mjs search PRODUCT` for one saved strategy. Each query requests the first 20 public results, sorted by stars. `{recent}` becomes the date 180 days before the run. The report identifies limited or incomplete results; it does not infer visitors or search traffic. Stars, forks and watchers describe public activity. Check subject fit and contribution rules before proposing an entry.\n';
  for (const search of catalog.searches) body += `\n### ${names[search.product]}\n\n${md(search.intent)}\n\n${search.queries.map((query) => `- \`${query}\``).join('\n')}\n`;
  body += '\n## Reviewed collections\n\nStars are dated public popularity counts, not traffic measurements. Review decisions come before those counts.\n\n| Repository | Products | Stars at review | Decision | Review source |\n| --- | --- | --- | --- | --- |\n';
  for (const target of catalog.targets) body += `| [${md(target.repository)}](https://github.com/${target.repository}) | ${label(target)} | ${target.reach.stars.toLocaleString('en-US')} | ${target.decision}: ${md(target.reason)} | [${target.rulesUrl ? 'Rules' : 'Archived repository'}; ${target.reviewedAt.slice(0, 10)}](${target.rulesUrl ?? `https://github.com/${target.repository}`}) |\n`;
  body += '\n## Maintain the records\n\nRun `node scripts/submissions.mjs refresh` to read only the saved public PRs and prepare a local status update. A failed read preserves all earlier states and first dates. The daily workflow proposes changes through the existing App-owned protected PR checks. It sends no comments, opens no external PRs and does not submit directory forms. An unchanged response creates no timestamp-only commit.\n\nBefore a new proposal, check existing rows and search the target’s issues and PRs for the product name and canonical URL. Save the exact target rules and review decision, use the maintained product skill or guide link, and record the returned PR URL once. Keep a shared PR as one record containing all affected products. Record a closed PR as closed unless the provider confirms a merge; do not infer rejection or acceptance from inactivity.\n\nDrafted by Codex, an AI agent. Independent review is recorded in the delivery change.\n';
  return body;
}

export async function searchCollections(catalog, product, { now = Date.now, ...options } = {}) {
  validateSubmissions(catalog); need(ids.includes(product), 'Choose dawn, sponge, textmock or yaptake');
  const recent = new Date(now() - 180 * 86400000).toISOString().slice(0, 10); const results = [];
  for (const saved of catalog.searches.find((row) => row.product === product).queries) {
    const query = saved.replaceAll('{recent}', recent);
    const value = await publicJson(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=20`, options);
    need(Number.isSafeInteger(value.total_count) && value.total_count >= 0 && typeof value.incomplete_results === 'boolean' && Array.isArray(value.items) && value.items.length <= 20 && value.items.length <= value.total_count, 'Invalid collection search response');
    const items = value.items.map((item) => {
      need(repo(item.full_name) && item.html_url === `https://github.com/${item.full_name}` && positive(item.id) && item.private === false && item.archived === false && item.fork === false && [item.stargazers_count, item.forks_count, item.watchers_count].every((n) => Number.isSafeInteger(n) && n >= 0) && typeof item.pushed_at === 'string' && Number.isFinite(Date.parse(item.pushed_at)), 'Collection search returned an unsupported repository');
      return { repository: item.full_name, repositoryId: item.id, url: item.html_url, stars: item.stargazers_count, forks: item.forks_count, pushedAt: new Date(item.pushed_at).toISOString(), decisionRequired: !catalog.targets.some((target) => target.repository.toLowerCase() === item.full_name.toLowerCase()), priorSubmissions: catalog.submissions.filter((row) => row.repository.toLowerCase() === item.full_name.toLowerCase()).map((row) => row.url) };
    });
    results.push({ query, totalCount: value.total_count, incomplete: value.incomplete_results, limited: value.total_count > items.length, items });
  }
  return { schemaVersion: 1, product, scope: 'public-collection-discovery', results };
}

async function main() {
  const [command, product, ...rest] = process.argv.slice(2); need(rest.length === 0 && ['check', 'refresh', 'search'].includes(command) && (command === 'search' ? product : product === undefined), 'Use check, refresh or search PRODUCT');
  const catalog = await readSubmissions(process.cwd());
  if (command === 'refresh') process.stdout.write(json(await recordSubmissions()));
  else if (command === 'search') process.stdout.write(json(await searchCollections(catalog, product)));
  else process.stdout.write(`${catalog.submissions.length} submission records checked.\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
