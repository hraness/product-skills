import { updateOwnedBranch, validateDependabotPins } from './github.mjs';

const TARGETS = new Set(['hraness/product-skills', 'hraness/.github', '0thernet/0thernet']);
const BRANCH = /^dependabot\/github_actions\/[A-Za-z0-9_.\/-]+$/;
const need = (condition, message) => { if (!condition) throw new Error(message); };

export async function deliverDependabot({ repository, run, read, request, checkWorkflow = 'check.yml' }) {
  need(TARGETS.has(repository) && /^[A-Za-z0-9_-]+\.ya?ml$/.test(checkWorkflow) && run?.conclusion === 'success' && run.head_repository?.full_name === repository && BRANCH.test(run.head_branch) && /^[a-f0-9]{40}$/.test(run.head_sha), 'Only an authorized checked dependency update can merge');
  const workflow = await read(`repos/${repository}/actions/workflows/${checkWorkflow}`);
  need(workflow.path === `.github/workflows/${checkWorkflow}` && workflow.id === run.workflow_id && workflow.name === run.name, 'Dependency validation workflow mismatch');
  const pulls = await read(`repos/${repository}/pulls?state=open&head=${repository.split('/')[0]}:${encodeURIComponent(run.head_branch)}&base=main&per_page=2`);
  need(Array.isArray(pulls) && pulls.length <= 1, 'Ambiguous dependency update');
  if (!pulls.length) return 'No open checked dependency update remains.';
  const pull = await read(`repos/${repository}/pulls/${pulls[0].number}`);
  need(pull.user?.login === 'dependabot[bot]' && pull.head?.repo?.full_name === repository && pull.base?.repo?.full_name === repository && pull.base.ref === 'main' && pull.head.ref === run.head_branch && pull.head.sha === run.head_sha, 'Dependency update identity changed');
  const files = await read(`repos/${repository}/pulls/${pull.number}/files?per_page=100`);
  need(Array.isArray(files) && files.length === pull.changed_files, 'Dependency file list is incomplete'); validateDependabotPins(files);
  const checks = await read(`repos/${repository}/commits/${run.head_sha}/check-runs?per_page=100`);
  const required = checks.check_runs?.filter((check) => check.name === 'Required' && check.app?.id === 15368 && check.head_sha === run.head_sha).sort((a, b) => b.id - a.id)[0];
  need(required?.status === 'completed' && required.conclusion === 'success', 'The exact dependency head needs its current Required check');
  const main = await read(`repos/${repository}/git/ref/heads/main`); const base = main.object?.sha;
  need(/^[a-f0-9]{40}$/.test(base), 'Invalid protected main identity');
  const comparison = await read(`repos/${repository}/compare/${base}...${run.head_sha}`);
  need(Number.isSafeInteger(comparison.behind_by) && comparison.behind_by >= 0, 'Invalid dependency branch comparison');
  if (comparison.behind_by !== 0 || comparison.merge_base_commit?.sha !== base) {
    const updated = await updateOwnedBranch({ repository, number: pull.number, expected: run.head_sha, request, read });
    need(updated.head.sha !== run.head_sha, 'Dependency branch refresh did not produce a new head');
    return 'Refreshed the dependency branch with the App; ordinary checks follow its new head.';
  }
  await request(['pr', 'merge', String(pull.number), '--repo', repository, '--squash', '--match-head-commit', run.head_sha]);
  const merged = await read(`repos/${repository}/pulls/${pull.number}`);
  need(merged.merged === true && /^[a-f0-9]{40}$/.test(merged.merge_commit_sha), 'Protected dependency merge did not complete');
  return `Merged the checked dependency update at ${merged.merge_commit_sha}; ordinary main checks follow.`;
}
