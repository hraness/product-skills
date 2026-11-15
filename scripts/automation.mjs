import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as distribution, refreshRendered } from './distribution.mjs';
import { refreshBehindPull, repairMissingCheck, successfulRequired, validateUpdateFiles } from './github.mjs';
import { deliverDependabot } from './dependabot.mjs';
import { distributionAuthority, ownedByDistributionApp } from './authority.mjs';
import { publishTooling } from './tooling.mjs';
import { captureGenerated, mergePendingDirectories, mergePendingPublications, readPendingDirectories, refreshGeneratedPull } from './refresh.mjs';
import { publishReleaseAssets } from './releases.mjs';
import { automationFailure, stage } from './diagnostics.mjs';
import { mergePendingHomebrewCursor, readHomebrewCursor, validateHomebrewCursor } from './homebrew-observer.mjs';
import { SUBMISSIONS_FILE, mergePendingSubmissions, readPendingSubmissions, readSubmissions, validateSubmissions } from './submissions.mjs';
import { DIRECTORY_FILE, readDirectoryObservations, validateDirectoryObservations } from './skills-sh-observer.mjs';
const exec = promisify(execFile);
const REPO = 'hraness/product-skills';
const need = (v, message) => { if (!v) throw new Error(message); };
async function gh(args) { return stage(`github.${['api', 'pr', 'release', 'workflow'].includes(args[0]) ? args[0] : 'command'}`, async () => { const { stdout } = await exec('gh', args, { maxBuffer: 1048576, timeout: 60000 }); return stdout.trim(); }); }
async function api(path) {
  if (/^repos\/hraness\/product-skills\/commits\/[a-f0-9]{40}\/check-runs\?per_page=100$/.test(path)) {
    need(process.env.REPORT_GH_TOKEN, 'The read-only check token is required');
    return stage('checks.read', async () => JSON.parse((await exec('gh', ['api', path], { env: { ...process.env, GH_TOKEN: process.env.REPORT_GH_TOKEN }, maxBuffer: 1048576, timeout: 60000 })).stdout));
  }
  return JSON.parse(await gh(['api', path]));
}
async function git(args) { return stage(`git.${['rev-parse', 'fetch', 'rev-list', 'diff', 'ls-files', 'show', 'checkout', 'add', 'commit', 'push', 'status'].includes(args[0]) ? args[0] : 'command'}`, async () => { const { stdout } = await exec('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...args], { maxBuffer: 1048576, timeout: 60000 }); return stdout.trim(); }); }
async function apiWrite(method, path, body) {
  const directory = await mkdtemp(join(tmpdir(), 'product-skills-request-'));
  try { const file = join(directory, 'request.json'); await writeFile(file, JSON.stringify(body), { mode: 0o600 }); return JSON.parse(await gh(['api', '--method', method, path, '--input', file])); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
async function changedPaths() { const paths = new Set([...(await git(['diff', '--name-only', 'HEAD'])).split('\n'), ...(await git(['ls-files', '--others', '--exclude-standard'])).split('\n')]); paths.delete(''); return [...paths]; }
async function identity() { need(process.env.GITHUB_REPOSITORY === REPO && process.env.GH_TOKEN, 'The repository workflow identity is required'); const repo = await api(`repos/${REPO}`); need(repo.full_name === REPO, 'Repository identity mismatch'); return repo; }
export async function propose(kind) {
  await identity(); const bot = await distributionAuthority(REPO, { read: api }); need(['products', 'publications', 'guides', 'submissions'].includes(kind), 'Unknown update kind');
  const pending = await api(`repos/${REPO}/pulls?state=open&base=main&per_page=100`);
  const existing = pending.find((pr) => ownedByDistributionApp(pr, bot) && pr.head.repo?.full_name === REPO && pr.head.ref.startsWith(`automation/${kind}-`));
  if (existing) {
    const files = (await api(`repos/${REPO}/pulls/${existing.number}/files?per_page=100`)).map((file) => file.filename);
    if (!files.length) { const current = await api(`repos/${REPO}/pulls/${existing.number}`); need(ownedByDistributionApp(current, bot) && current.head.sha === existing.head.sha && current.changed_files === 0, 'Empty owned update changed concurrently'); await gh(['pr', 'close', String(existing.number), '--repo', REPO]); process.stdout.write('Closed the owned update because it has no remaining file change.\n'); return; }
    validateUpdateFiles(kind, files);
    const refreshed = await refreshBehindPull({ repository: REPO, number: existing.number, head: existing.head.sha, read: api, request: gh });
    const sourceBase = await git(['rev-parse', 'HEAD']); need(refreshed.main === sourceBase, 'Protected main changed; rerun generation before refreshing the PR');
    if (kind === 'publications') {
      const pending = await api(`repos/${REPO}/contents/publication-ledger.json?ref=${refreshed.head}`);
      need(pending.type === 'file' && pending.encoding === 'base64' && typeof pending.content === 'string' && pending.size <= 512 * 1024, 'Pending publication ledger is unavailable');
      const previous = JSON.parse(Buffer.from(pending.content, 'base64').toString('utf8')); const desired = JSON.parse(await readFile('publication-ledger.json', 'utf8')); const baseline = JSON.parse(await git(['show', `${sourceBase}:publication-ledger.json`]));
      const cursorFile = await api(`repos/${REPO}/contents/catalog/homebrew-observation.json?ref=${refreshed.head}`);
      need(cursorFile.type === 'file' && cursorFile.encoding === 'base64' && typeof cursorFile.content === 'string' && cursorFile.size <= 4096, 'Pending Homebrew cursor is unavailable');
      const pendingCursor = validateHomebrewCursor(JSON.parse(Buffer.from(cursorFile.content, 'base64').toString('utf8')));
      const baselineCursor = validateHomebrewCursor(JSON.parse(await git(['show', `${sourceBase}:catalog/homebrew-observation.json`])));
      const cursor = await mergePendingHomebrewCursor(pendingCursor, await readHomebrewCursor(process.cwd()), baselineCursor);
      const ledger = mergePendingPublications(previous, desired, baseline);
      await writeFile('publication-ledger.json', `${JSON.stringify(ledger, null, 2)}\n`); await writeFile('catalog/homebrew-observation.json', `${JSON.stringify(cursor, null, 2)}\n`);
    }
    if (['products', 'publications'].includes(kind)) {
      const pendingDirectories = await readPendingDirectories(refreshed.head, api);
      const baselineDirectories = validateDirectoryObservations(JSON.parse(await git(['show', `${sourceBase}:${DIRECTORY_FILE}`])));
      let report = null;
      try {
        const info = await lstat('dist/directory-observation.json'); need(info.isFile() && !info.isSymbolicLink() && info.size <= 8192, 'Directory observation report must be a regular bounded file');
        report = JSON.parse(await readFile('dist/directory-observation.json', 'utf8'));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const directories = mergePendingDirectories(pendingDirectories, await readDirectoryObservations(process.cwd()), baselineDirectories, report);
      await writeFile(DIRECTORY_FILE, `${JSON.stringify(directories, null, 2)}\n`); await refreshRendered();
    }
    if (kind === 'submissions') {
      const pendingCatalog = await readPendingSubmissions(refreshed.head, api);
      const baselineCatalog = validateSubmissions(JSON.parse(await git(['show', `${sourceBase}:${SUBMISSIONS_FILE}`])));
      const catalog = mergePendingSubmissions(pendingCatalog, await readSubmissions(process.cwd()), baselineCatalog);
      await writeFile(SUBMISSIONS_FILE, `${JSON.stringify(catalog, null, 2)}\n`); await refreshRendered();
    }
    const desired = await captureGenerated(process.cwd(), kind, [...new Set([...files, ...await changedPaths()])]);
    const update = await refreshGeneratedPull({ kind, branch: existing.head.ref, head: refreshed.head, sourceBase, desired, bot, read: api, write: apiWrite });
    if (update.matchesMain) { const current = await api(`repos/${REPO}/pulls/${existing.number}`); need(ownedByDistributionApp(current, bot) && current.head.sha === update.head, 'Owned update changed before closure'); await gh(['pr', 'close', String(existing.number), '--repo', REPO]); process.stdout.write('Closed the owned proposal because current generated files match main.\n'); return; }
    if (!refreshed.updated && !update.changed) await repairCheck(existing.head.ref, existing.head.sha);
    process.stdout.write(refreshed.updated || update.changed ? 'Refreshed the owned App branch with current generated files; ordinary checks follow.\n' : 'An owned update is open; its check state was inspected.\n'); return;
  }
  const changed = (await git(['status', '--porcelain'])).trim(); if (!changed) { process.stdout.write('No source change.\n'); return; }
  validateUpdateFiles(kind, await changedPaths());
  const branch = `automation/${kind}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  need(/^automation\/(products|publications|guides|submissions)-\d+-\d+$/.test(branch), 'Invalid update branch');
  await git(['checkout', '-b', branch]); await git(['add', '-A']);
  const title = kind === 'submissions' ? 'Refresh verified submission states' : kind === 'products' ? 'Refresh released product skills' : kind === 'guides' ? 'Refresh shared writing guides' : 'Record verified product publications';
  const body = kind === 'submissions' ? 'Refresh saved public pull requests from exact repository, author and provider identities. Preserve original submission dates, earlier successful states and all publication records; regenerate the shared submission index through ordinary protected checks. No external outreach is sent.\n' : kind === 'products' ? 'Refresh product packages from validated public sources and preserve separately verified directory presence. Runtime qualification and generated-copy checks run on this commit before integration.\n' : kind === 'guides' ? 'Refresh the six writing guides from hraness/.github. Preserve each Repository additions section and keep repository-specific contribution and agent instructions.\n' : 'Record verified product publications from public releases, active registry listings and checked Homebrew casks. Preserve earlier entries and the observed tap history. Keep skills.sh listing observations and first verification dates separate from publisher publication times.\n';
  await git(['-c', `user.name=${bot.login}`, '-c', `user.email=${bot.id}+${bot.login}@users.noreply.github.com`, 'commit', '-m', title]);
  const sha = await git(['rev-parse', 'HEAD']); await git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  await writeFile('/tmp/product-skills-pr.md', body);
  await gh(['pr', 'create', '--repo', REPO, '--base', 'main', '--head', branch, '--title', title, '--body-file', '/tmp/product-skills-pr.md']);
  process.stdout.write(`Opened the App-owned protected update at ${sha}; ordinary pull-request checks follow.\n`);
}
async function repairCheck(ref, sha) {
  const base = await api(`repos/${REPO}/git/ref/heads/main`);
  return repairMissingCheck({ repository: REPO, workflow: 'check.yml', ref, sha, read: api, request: gh, inputs: ['-f', `base_sha=${base.object.sha}`] });
}
async function deliver() {
  await identity(); const bot = await distributionAuthority(REPO, { read: api }); const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')); const run = event.workflow_run;
  if (run?.head_branch?.startsWith('dependabot/')) { process.stdout.write(`${await deliverDependabot({ repository: REPO, run, read: api, request: gh })}\n`); return; }
  need(run?.conclusion === 'success' && run.head_repository?.full_name === REPO && /^automation\/(products|publications|guides|submissions)-\d+-\d+$/.test(run.head_branch), 'Only successful owned update checks can integrate');
  const workflow = await api(`repos/${REPO}/actions/workflows/check.yml`);
  need(run.workflow_id === workflow.id && workflow.path === '.github/workflows/check.yml' && workflow.name === run.name, 'Owned update validation workflow mismatch');
  const prs = await api(`repos/${REPO}/pulls?state=open&head=hraness:${run.head_branch}&base=main`);
  if (prs.length === 0) {
    const closed = await api(`repos/${REPO}/pulls?state=closed&head=hraness:${run.head_branch}&base=main`);
    need(closed.some((pr) => pr.merged_at && ownedByDistributionApp(pr, bot) && pr.head.sha === run.head_sha && pr.head.repo?.full_name === REPO), 'No matching owned update remains');
    const main = await api(`repos/${REPO}/git/ref/heads/main`); await repairCheck('main', main.object.sha); process.stdout.write('The owned update already merged; main validation was inspected.\n'); return;
  }
  need(prs.length === 1, 'Expected one open owned update'); const pr = prs[0];
  need(ownedByDistributionApp(pr, bot) && pr.head.sha === run.head_sha && pr.head.repo.full_name === REPO, 'Update identity changed');
  const kind = /^automation\/(products|publications|guides|submissions)-/.exec(run.head_branch)[1];
  validateUpdateFiles(kind, (await api(`repos/${REPO}/pulls/${pr.number}/files?per_page=100`)).map((file) => file.filename));
  const checks = await api(`repos/${REPO}/commits/${run.head_sha}/check-runs?per_page=100`);
  need(successfulRequired(checks, run.head_sha), 'The current-head Required check must pass');
  const refreshed = await refreshBehindPull({ repository: REPO, number: pr.number, head: run.head_sha, read: api, request: gh });
  if (refreshed.updated) { process.stdout.write('Updated the owned App branch; its ordinary checks follow.\n'); return; }
  await gh(['pr', 'merge', String(pr.number), '--repo', REPO, '--squash', '--match-head-commit', run.head_sha]);
  const merged = await api(`repos/${REPO}/pulls/${pr.number}`); need(merged.merged === true && merged.merge_commit_sha, 'Protected merge did not complete');
  process.stdout.write(`Merged the checked App update at ${merged.merge_commit_sha}; ordinary main checks follow.\n`);
}
async function publish() {
  const repo = await identity(); need(repo.private === false, 'Publication waits for source admission and public repository visibility');
  const sha = await git(['rev-parse', 'HEAD']); const main = await api(`repos/${REPO}/git/ref/heads/main`); need(main.object.sha === sha, 'Publication candidate is no longer main');
  const checks = await api(`repos/${REPO}/commits/${sha}/check-runs?per_page=100`);
  need(successfulRequired(checks, sha), 'The exact main Required check has not passed');
  await stage('package.check', () => distribution(['check'])); await stage('package.build', () => distribution(['package']));
  const plan = JSON.parse(await readFile('dist/release.json', 'utf8'));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const tooling = await publishTooling({ sourceCommit: sha, toolkitHash: plan.toolkitHash, packageVersion: pkg.version, read: api, request: gh, git, downloadAsset: async (asset) => (await exec('gh', ['api', `repos/${REPO}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'], { encoding: 'buffer', maxBuffer: 8192, timeout: 60000 })).stdout, writeArtifacts: async (artifacts) => { await mkdir('dist/tooling', { recursive: true }); const paths = {}; for (const [name, bytes] of Object.entries(artifacts)) { const path = `dist/tooling/${name}`; await writeFile(path, bytes); paths[name] = path; } return paths; } });
  process.stdout.write(`${JSON.stringify({ tooling })}\n`);
  if (!plan.products.length) { process.stdout.write('No admitted product package to publish.\n'); return; }
  need(/^integrations-[a-f0-9]{16}$/.test(plan.tag), 'Invalid release plan');
  await writeFile('/tmp/product-skills-release.md', `Product skills and local integration packages. Read each product README for runtime requirements and the first task.\n\n${plan.products.map((p) => `- ${p.id} ${p.version}: \`${p.file}\`${p.mcpb ? ` and MCP bundle \`${p.mcpb.file}\`` : ''}`).join('\n')}\n\nVerify archives with the attached SHA256SUMS. Directory approval and native client qualification are separate from this package release.\n`);
  const files = [...plan.products.flatMap((p) => [p.file, ...(p.mcpb ? [p.mcpb.file] : [])]), 'SHA256SUMS', 'release.json'];
  const assets = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readFile(`dist/${file}`)])));
  await publishReleaseAssets({ tag: plan.tag, target: sha, assets, paths: Object.fromEntries(files.map((file) => [file, `dist/${file}`])), title: 'Hraness product skills', notesPath: '/tmp/product-skills-release.md', read: api, request: gh, allowPublishedTargetReuse: true, beforePublish: async () => { const current = await api(`repos/${REPO}/git/ref/heads/main`); need(current.object.sha === sha && successfulRequired(await api(`repos/${REPO}/commits/${sha}/check-runs?per_page=100`), sha), 'Product publication candidate changed or lost its Required check'); } });
  await distribution(['record-github']);
}
const command = process.argv[2];
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const action = command === 'propose-submissions' ? () => propose('submissions') : command === 'propose-products' ? () => propose('products') : command === 'propose-publications' ? () => propose('publications') : command === 'propose-guides' ? () => propose('guides') : command === 'deliver' ? deliver : command === 'publish' ? publish : null;
  if (!action) { process.stderr.write('Use propose-products, propose-publications, propose-guides, propose-submissions, deliver or publish.\n'); process.exitCode = 1; }
  else action().catch((error) => { process.stderr.write(`${automationFailure(error, command)}\nRepository automation stopped. Reconcile remote state before retrying.\n`); process.exitCode = 1; });
}
