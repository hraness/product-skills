import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, main as distribution } from './distribution.mjs';
import { updateOwnedBranch, validateUpdateFiles } from './github.mjs';
const exec = promisify(execFile);
const REPO = 'hraness/product-skills';
const need = (v, message) => { if (!v) throw new Error(message); };
async function gh(args) { const { stdout } = await exec('gh', args, { maxBuffer: 1048576, timeout: 60000 }); return stdout.trim(); }
async function api(path) { return JSON.parse(await gh(['api', path])); }
async function git(args) { const { stdout } = await exec('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...args], { maxBuffer: 1048576, timeout: 60000 }); return stdout.trim(); }
async function identity() { need(process.env.GITHUB_REPOSITORY === REPO && process.env.GH_TOKEN, 'The repository workflow identity is required'); const repo = await api(`repos/${REPO}`); need(repo.full_name === REPO, 'Repository identity mismatch'); return repo; }
export async function propose(kind) {
  await identity(); need(['products', 'publications'].includes(kind), 'Unknown update kind');
  const pending = await api(`repos/${REPO}/pulls?state=open&base=main&per_page=100`);
  const existing = pending.find((pr) => pr.user.login === 'github-actions[bot]' && pr.head.repo?.full_name === REPO && pr.head.ref.startsWith(`automation/${kind}-`));
  if (existing) { validateUpdateFiles(kind, (await api(`repos/${REPO}/pulls/${existing.number}/files?per_page=100`)).map((file) => file.filename)); const base = await api(`repos/${REPO}/git/ref/heads/main`); await gh(['workflow', 'run', 'check.yml', '--repo', REPO, '--ref', existing.head.ref, '-f', `base_sha=${base.object.sha}`]); process.stdout.write('An owned update is open; its check was requested explicitly.\n'); return; }
  const changed = (await git(['status', '--porcelain'])).trim(); if (!changed) { process.stdout.write('No source change.\n'); return; }
  const paths = new Set([...(await git(['diff', '--name-only', 'HEAD'])).split('\n'), ...(await git(['ls-files', '--others', '--exclude-standard'])).split('\n')]); paths.delete(''); validateUpdateFiles(kind, [...paths]);
  const branch = `automation/${kind}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  need(/^automation\/(products|publications)-\d+-\d+$/.test(branch), 'Invalid update branch');
  await git(['checkout', '-b', branch]); await git(['add', '-A']);
  await git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', kind === 'products' ? 'Refresh released product skills' : 'Record verified GitHub publications']);
  const sha = await git(['rev-parse', 'HEAD']); await git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  await writeFile('/tmp/product-skills-pr.md', kind === 'products' ? 'Refresh product packages from validated public sources. Runtime qualification and generated-copy checks run on this commit before integration.\n' : 'Append publication records from an immutable public GitHub Release after asset digest readback. Preserve prior ledger entries.\n');
  await gh(['pr', 'create', '--repo', REPO, '--base', 'main', '--head', branch, '--title', kind === 'products' ? 'Refresh released product skills' : 'Record verified product publications', '--body-file', '/tmp/product-skills-pr.md']);
  // GITHUB_TOKEN-generated pull_request events do not start CI. Dispatch is explicit.
  const base = await api(`repos/${REPO}/git/ref/heads/main`);
  await gh(['workflow', 'run', 'check.yml', '--repo', REPO, '--ref', branch, '-f', `base_sha=${base.object.sha}`]);
  process.stdout.write(`Requested protected checks for ${sha}.\n`);
}
async function deliver() {
  await identity(); const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')); const run = event.workflow_run;
  need(run?.conclusion === 'success' && run.head_repository?.full_name === REPO && /^automation\/(products|publications)-\d+-\d+$/.test(run.head_branch), 'Only successful owned update checks can integrate');
  const prs = await api(`repos/${REPO}/pulls?state=open&head=hraness:${run.head_branch}&base=main`);
  if (prs.length === 0) {
    const closed = await api(`repos/${REPO}/pulls?state=closed&head=hraness:${run.head_branch}&base=main`);
    need(closed.some((pr) => pr.merged_at && pr.user.login === 'github-actions[bot]' && pr.head.sha === run.head_sha && pr.head.repo?.full_name === REPO), 'No matching owned update remains');
    await gh(['workflow', 'run', 'check.yml', '--repo', REPO, '--ref', 'main']); process.stdout.write('The owned update already merged; main validation was requested.\n'); return;
  }
  need(prs.length === 1, 'Expected one open owned update'); const pr = prs[0];
  need(pr.user.login === 'github-actions[bot]' && pr.head.sha === run.head_sha && pr.head.repo.full_name === REPO, 'Update identity changed');
  const kind = /^automation\/(products|publications)-/.exec(run.head_branch)[1];
  validateUpdateFiles(kind, (await api(`repos/${REPO}/pulls/${pr.number}/files?per_page=100`)).map((file) => file.filename));
  const checks = await api(`repos/${REPO}/commits/${run.head_sha}/check-runs?per_page=100`);
  const required = checks.check_runs.filter((check) => check.name === 'Required' && check.app.slug === 'github-actions').sort((a, b) => b.id - a.id)[0]; need(required?.conclusion === 'success', 'The current-head Required check must pass');
  const detail = await api(`repos/${REPO}/pulls/${pr.number}`);
  if (detail.mergeable_state === 'behind') { const updated = await updateOwnedBranch({ repository: REPO, number: pr.number, expected: run.head_sha, request: gh, read: api }); await gh(['workflow', 'run', 'check.yml', '--repo', REPO, '--ref', run.head_branch, '-f', `base_sha=${updated.base.sha}`]); process.stdout.write('Updated the owned branch and requested its new check.\n'); return; }
  await gh(['pr', 'merge', String(pr.number), '--repo', REPO, '--squash', '--match-head-commit', run.head_sha]);
  const merged = await api(`repos/${REPO}/pulls/${pr.number}`); need(merged.merged === true && merged.merge_commit_sha, 'Protected merge did not complete');
  // A merge performed with GITHUB_TOKEN needs its own explicit main check.
  await gh(['workflow', 'run', 'check.yml', '--repo', REPO, '--ref', 'main']);
  process.stdout.write(`Merged the checked update at ${merged.merge_commit_sha}; requested main validation.\n`);
}
async function publish() {
  const repo = await identity(); need(repo.private === false, 'Publication waits for source admission and public repository visibility');
  const sha = await git(['rev-parse', 'HEAD']); const main = await api(`repos/${REPO}/git/ref/heads/main`); need(main.object.sha === sha, 'Publication candidate is no longer main');
  const checks = await api(`repos/${REPO}/commits/${sha}/check-runs?per_page=100`);
  const required = checks.check_runs.filter((c) => c.name === 'Required' && c.app.slug === 'github-actions').sort((a, b) => b.id - a.id)[0]; need(required?.conclusion === 'success', 'The exact main Required check has not passed');
  await distribution(['check']); await distribution(['package']);
  const plan = JSON.parse(await readFile('dist/release.json', 'utf8')); if (!plan.products.length) { process.stdout.write('No admitted product package to publish.\n'); return; }
  need(/^integrations-[a-f0-9]{16}$/.test(plan.tag), 'Invalid release plan');
  let release;
  try { release = await api(`repos/${REPO}/releases/tags/${plan.tag}`); } catch (e) { if (!String(e.stderr).includes('404')) throw e; }
  if (!release) {
    await writeFile('/tmp/product-skills-release.md', `Product skills and local integration packages. Read each product README for runtime requirements and the first task.\n\n${plan.products.map((p) => `- ${p.id} ${p.version}: \`${p.file}\``).join('\n')}\n\nVerify archives with the attached SHA256SUMS. Directory approval and native client qualification are separate from this package release.\n`);
    await gh(['release', 'create', plan.tag, '--repo', REPO, '--target', sha, '--title', 'Hraness product skills', '--notes-file', '/tmp/product-skills-release.md', '--draft']);
    release = await api(`repos/${REPO}/releases/tags/${plan.tag}`);
  }
  const files = [...plan.products.map((p) => p.file), 'SHA256SUMS', 'release.json'];
  const existing = release.assets ?? [];
  need(existing.every((a) => files.includes(a.name)), 'Unexpected asset already exists on this release');
  for (const file of files) {
    const hash = digest(await readFile(`dist/${file}`)); const asset = existing.find((a) => a.name === file);
    if (asset) need(asset.digest === `sha256:${hash}`, 'Existing release asset differs; no overwrite is allowed');
    else { need(release.draft === true, 'An immutable publication cannot gain another asset'); await gh(['release', 'upload', plan.tag, `dist/${file}`, '--repo', REPO]); }
  }
  if (release.draft) await gh(['release', 'edit', plan.tag, '--repo', REPO, '--draft=false']);
  await distribution(['record-github']); await propose('publications');
}
const command = process.argv[2];
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const action = command === 'propose-products' ? () => propose('products') : command === 'deliver' ? deliver : command === 'publish' ? publish : null;
  if (!action) { process.stderr.write('Use propose-products, deliver or publish.\n'); process.exitCode = 1; }
  else action().catch(() => { process.stderr.write('Repository automation stopped. No gate was bypassed; inspect the run and reconcile remote state before retrying.\n'); process.exitCode = 1; });
}
