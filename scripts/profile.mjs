import { lstat, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { download, validatePortfolio } from './distribution.mjs';
import { refreshBehindPull, repairMissingCheck, successfulRequired } from './github.mjs';
import { deliverDependabot } from './dependabot.mjs';
import { distributionAuthority, ownedByDistributionApp } from './authority.mjs';
const execute = promisify(execFile);
export const TARGETS = Object.freeze({ 'hraness/.github': 'profile/README.md', '0thernet/0thernet': 'README.md' });
const IDENTITIES = Object.freeze({ 'hraness/.github': { repository: 1342874802, owner: 307125679 }, '0thernet/0thernet': { repository: 1342874174, owner: 894119 } });
export const START = '<!-- hraness-products:start -->';
export const END = '<!-- hraness-products:end -->';
const need = (v, message) => { if (!v) throw new Error(message); };
const escape = (v) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\\\[\]*_`]/g, '\\$&');
export function renderProfile(readme, portfolio) {
  validatePortfolio(portfolio); need(typeof readme === 'string' && Buffer.byteLength(readme) <= 262144, 'Profile README exceeds the limit');
  const locate = (marker) => [...readme.matchAll(new RegExp(`^${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?$`, 'gm'))];
  const starts = locate(START); const ends = locate(END);
  need(starts.length === 1 && ends.length === 1 && starts[0].index < ends[0].index, 'The profile needs one ordered pair of own-line product markers');
  const newline = starts[0][0].endsWith('\r') ? '\r\n' : '\n';
  const begin = starts[0].index + START.length;
  const finish = ends[0].index;
  const body = portfolio.projects.map((p) => `- [${p.name}](${p.url}): ${escape(p.short)}`).join(newline);
  return readme.slice(0, begin) + newline + newline + body + newline + newline + readme.slice(finish);
}
export function assertProfileChange(before, after, portfolio) {
  need(renderProfile(before, portfolio) === renderProfile(after, portfolio), 'An owned profile PR contains changes outside the product markers');
}
export async function refreshProfile(readme, portfolio, { fetchImpl = fetch } = {}) {
  const rendered = renderProfile(readme, portfolio);
  if (rendered === readme) return { changed: false, readme };
  const old = readme.slice(readme.indexOf(START), readme.indexOf(END));
  for (const p of portfolio.projects) if (!old.includes(`](${p.url})`)) {
    const response = await fetchImpl(p.url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(20000) });
    need(response.ok, 'A changed product destination is unavailable');
  }
  return { changed: true, readme: rendered };
}
export async function checkProfile({ repository = process.env.GITHUB_REPOSITORY, root = process.cwd(), fetchImpl = fetch } = {}) {
  need(Object.hasOwn(TARGETS, repository), 'Only the two authorized profile repositories are supported');
  const path = TARGETS[repository]; const file = join(root, path);
  for (const parent of new Set([root, dirname(file)])) { const info = await lstat(parent); need(info.isDirectory() && !info.isSymbolicLink(), 'The profile directory must be regular'); }
  const info = await lstat(file); need(info.isFile() && !info.isSymbolicLink() && info.size <= 262144, 'The profile README must be a bounded regular file');
  const readme = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file));
  // Public facts are read without credentials. This check does not mint an App
  // token, change the checkout, or include personal README text in its result.
  const portfolio = validatePortfolio(JSON.parse((await download('https://hraness.com/portfolio.json', { fetchImpl })).body));
  need(renderProfile(readme, portfolio) === readme, 'The marked product list differs from the current public portfolio');
  return { repository, path, products: portfolio.projects.map((product) => product.id) };
}
async function gh(args) { return (await execute('gh', args, { maxBuffer: 1048576, timeout: 60000 })).stdout.trim(); }
async function api(path) {
  if (/^repos\/(?:hraness\/\.github|0thernet\/0thernet)\/commits\/[a-f0-9]{40}\/check-runs\?per_page=100$/.test(path)) {
    need(process.env.REPORT_GH_TOKEN, 'The read-only check token is required');
    return JSON.parse((await execute('gh', ['api', path], { env: { ...process.env, GH_TOKEN: process.env.REPORT_GH_TOKEN }, maxBuffer: 1048576, timeout: 60000 })).stdout);
  }
  return JSON.parse(await gh(['api', path]));
}
async function git(args) { return (await execute('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...args], { maxBuffer: 1048576, timeout: 60000 })).stdout.trim(); }
export async function profileIdentity({ env = process.env, read = api } = {}) {
  const repo = env.GITHUB_REPOSITORY; need(Object.hasOwn(TARGETS, repo) && env.GH_TOKEN, 'Only the two authorized profile repositories are supported');
  const live = await read(`repos/${repo}`); const expected = IDENTITIES[repo];
  need(live.full_name === repo && live.id === expected.repository && live.owner?.id === expected.owner && live.private === false && live.default_branch === 'main', 'Profile repository or default branch identity mismatch'); return repo;
}
function checkWorkflow() { const workflow = process.env.PROFILE_CHECK_WORKFLOW || 'check.yml'; need(/^[a-zA-Z0-9_-]+\.ya?ml$/.test(workflow), 'Invalid check workflow filename'); return workflow; }
async function validateProfilePullRequest(repo, pr, portfolio) {
  const comparison = await api(`repos/${repo}/compare/${pr.base.sha}...${pr.head.sha}`);
  const original = await api(`repos/${repo}/contents/${TARGETS[repo]}?ref=${comparison.merge_base_commit.sha}`);
  const candidate = await api(`repos/${repo}/contents/${TARGETS[repo]}?ref=${pr.head.sha}`);
  assertProfileChange(Buffer.from(original.content, 'base64').toString('utf8'), Buffer.from(candidate.content, 'base64').toString('utf8'), portfolio);
  return comparison;
}
async function refresh() {
  const repo = await profileIdentity(); const bot = await distributionAuthority(repo, { read: api }); const path = TARGETS[repo]; const before = await readFile(path, 'utf8');
  const portfolio = validatePortfolio(JSON.parse((await download('https://hraness.com/portfolio.json')).body));
  const prs = await api(`repos/${repo}/pulls?state=open&base=main&per_page=100`);
  const existing = prs.find((p) => ownedByDistributionApp(p, bot) && p.head.repo?.full_name === repo && /^automation\/profile-\d+-\d+$/.test(p.head.ref));
  if (existing) {
    const files = await api(`repos/${repo}/pulls/${existing.number}/files?per_page=100`);
    need(files.length === 1 && files[0].filename === path && files[0].status === 'modified', 'An owned profile PR contains unrelated files');
    await validateProfilePullRequest(repo, existing, portfolio);
    const refreshed = await refreshBehindPull({ repository: repo, number: existing.number, head: existing.head.sha, read: api, request: gh });
    await git(['fetch', '--no-tags', 'origin', `refs/heads/${existing.head.ref}`]); await git(['checkout', '-B', existing.head.ref, 'FETCH_HEAD']);
    const result = await refreshProfile(await readFile(path, 'utf8'), portfolio);
    if (result.changed) { await writeFile(path, result.readme); await git(['add', '--', path]); await git(['-c', `user.name=${bot.login}`, '-c', `user.email=${bot.id}+${bot.login}@users.noreply.github.com`, 'commit', '-m', 'Refresh the marked product list']); await git(['push', 'origin', `HEAD:refs/heads/${existing.head.ref}`]); }
    else if (!refreshed.updated) await repairCheck(repo, existing.head.ref, existing.head.sha);
    process.stdout.write('Refreshed the App-owned product-link PR; ordinary checks follow changed commits.\n'); return;
  }
  const result = await refreshProfile(before, portfolio); if (!result.changed) { process.stdout.write('Product links are current.\n'); return; }
  need(!(await git(['status', '--porcelain'])), 'The profile checkout contains unrelated work');
  await writeFile(path, result.readme); const branch = `automation/profile-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  need(/^automation\/profile-\d+-\d+$/.test(branch), 'Invalid profile update branch');
  await git(['checkout', '-b', branch]); await git(['add', '--', path]);
  await git(['-c', `user.name=${bot.login}`, '-c', `user.email=${bot.id}+${bot.login}@users.noreply.github.com`, 'commit', '-m', 'Update current product links']);
  await git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  await writeFile('/tmp/hraness-profile-pr.md', 'Update the marked product links from the public Hraness product directory. Preserve the introduction and all text outside the product markers. Changed destinations answered successfully.\n');
  await gh(['pr', 'create', '--repo', repo, '--base', 'main', '--head', branch, '--title', 'Update current product links', '--body-file', '/tmp/hraness-profile-pr.md']);
  process.stdout.write('Opened the App-owned profile update; ordinary pull-request checks follow.\n');
}
async function repairCheck(repo, ref, sha) {
  return repairMissingCheck({ repository: repo, workflow: checkWorkflow(), ref, sha, read: api, request: gh });
}
async function deliver() {
  const repo = await profileIdentity(); const bot = await distributionAuthority(repo, { read: api }); const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')); const run = event.workflow_run;
  if (run?.head_branch?.startsWith('dependabot/')) { process.stdout.write(`${await deliverDependabot({ repository: repo, run, read: api, request: gh, checkWorkflow: checkWorkflow() })}\n`); return; }
  need(run?.conclusion === 'success' && run.head_repository?.full_name === repo && /^automation\/profile-\d+-\d+$/.test(run.head_branch), 'Only a checked owned profile update can merge');
  const workflow = await api(`repos/${repo}/actions/workflows/${checkWorkflow()}`);
  need(run.workflow_id === workflow.id && workflow.path === `.github/workflows/${checkWorkflow()}` && workflow.name === run.name, 'Profile validation workflow mismatch');
  const prs = await api(`repos/${repo}/pulls?state=open&head=${repo.split('/')[0]}:${run.head_branch}&base=main`);
  if (prs.length === 0) {
    const closed = await api(`repos/${repo}/pulls?state=closed&head=${repo.split('/')[0]}:${run.head_branch}&base=main`);
    if (closed.some((p) => p.merged_at && ownedByDistributionApp(p, bot) && p.head.sha === run.head_sha && p.head.repo?.full_name === repo)) { const main = await api(`repos/${repo}/git/ref/heads/main`); await repairCheck(repo, 'main', main.object.sha); }
    process.stdout.write('No open profile update remains; any completed merge had its main check inspected.\n'); return;
  }
  need(prs.length === 1 && ownedByDistributionApp(prs[0], bot) && prs[0].head.sha === run.head_sha && prs[0].head.repo.full_name === repo, 'Profile update identity changed');
  const files = await api(`repos/${repo}/pulls/${prs[0].number}/files?per_page=100`);
  need(files.length === 1 && files[0].filename === TARGETS[repo] && files[0].status === 'modified', 'A profile update must change only its authorized README');
  await validateProfilePullRequest(repo, prs[0], validatePortfolio(JSON.parse((await download('https://hraness.com/portfolio.json')).body)));
  const checks = await api(`repos/${repo}/commits/${run.head_sha}/check-runs?per_page=100`);
  need(successfulRequired(checks, run.head_sha), 'The current-head Required check must pass');
  const refreshed = await refreshBehindPull({ repository: repo, number: prs[0].number, head: run.head_sha, read: api, request: gh });
  if (refreshed.updated) { process.stdout.write('Updated the App-owned branch; its ordinary checks follow.\n'); return; }
  await gh(['pr', 'merge', String(prs[0].number), '--repo', repo, '--squash', '--match-head-commit', run.head_sha]);
  const merged = await api(`repos/${repo}/pulls/${prs[0].number}`); need(merged.merged === true, 'The protected profile merge did not complete');
  process.stdout.write('The checked App profile update merged; ordinary main checks follow.\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2]; const action = mode === 'check' ? async () => { await checkProfile(); process.stdout.write('Checked the current product links.\n'); } : mode === 'refresh' ? refresh : mode === 'deliver' ? deliver : null;
  if (!action) { process.stderr.write('Use check, refresh or deliver.\n'); process.exitCode = 1; }
  else action().catch(() => { process.stderr.write(mode === 'check' ? 'Profile validation stopped. Inspect the README, product markers and current public portfolio.\n' : 'Profile synchronization stopped; preserve the README and inspect the source, marker or protected-check failure before retrying.\n'); process.exitCode = 1; });
}
