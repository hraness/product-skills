import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDependabotPins } from '../scripts/github.mjs';
import { deliverDependabot } from '../scripts/dependabot.mjs';

const base = 'a'.repeat(40); const head = 'b'.repeat(40); const refreshed = 'c'.repeat(40);
const defaultRepository = 'hraness/product-skills'; const branch = 'dependabot/github_actions/actions-update-1';
const file = () => ({ filename: '.github/workflows/check.yml', status: 'modified', additions: 1, deletions: 1, patch: `@@ -1,1 +1,1 @@\n-      - uses: actions/checkout@${base} # v7.0.0\n+      - uses: actions/checkout@${head} # v7.0.1` });
test('Dependabot may change existing SHA pins while preserving action identities and other YAML', () => {
  assert.doesNotThrow(() => validateDependabotPins([file()]));
  assert.doesNotThrow(() => validateDependabotPins([{ ...file(), filename: 'actions/sync-profile/action.yml' }]));
  for (const change of [
    { status: 'added' }, { filename: 'scripts/private.mjs' }, { additions: 2 }, { patch: undefined },
    { patch: file().patch.replace(`actions/checkout@${head}`, `other-owner/checkout@${head}`) },
    { patch: file().patch.replace(`@${head}`, '@v7') },
    { patch: `${file().patch}\n+permissions: write-all`, additions: 2 },
    { patch: file().patch.replace(head, base) },
  ]) assert.throws(() => validateDependabotPins([{ ...file(), ...change }]));
  assert.throws(() => validateDependabotPins([file(), file()]));
});
function server({ behind = false, failed = false, actor = 'dependabot[bot]', repository = defaultRepository, workflow = 'check.yml', workflowName = 'Check' } = {}) {
  const run = { name: workflowName, conclusion: 'success', workflow_id: 7, head_repository: { full_name: repository }, head_branch: branch, head_sha: head };
  let pull = { number: 4, user: { login: actor }, head: { ref: branch, sha: head, repo: { full_name: repository } }, base: { ref: 'main', sha: base, repo: { full_name: repository } }, changed_files: 1 };
  const requests = [];
  const read = async (path) => {
    if (path.endsWith(`/actions/workflows/${workflow}`)) return { id: 7, name: workflowName, path: `.github/workflows/${workflow}` };
    if (path.includes('/pulls?')) return [pull];
    if (path.endsWith('/pulls/4')) return pull;
    if (path.endsWith('/files?per_page=100')) return [file()];
    if (path.includes('/check-runs?')) return { check_runs: [{ id: 9, name: 'Required', head_sha: head, status: 'completed', conclusion: failed ? 'failure' : 'success', app: { id: 15368 } }] };
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: base } };
    if (path.includes('/compare/')) return { behind_by: behind ? 1 : 0, merge_base_commit: { sha: behind ? 'd'.repeat(40) : base } };
    throw new Error(`Unexpected read ${path}`);
  };
  const request = async (args) => {
    requests.push(args);
    if (args[0] === 'api' && args[3].endsWith('/update-branch')) pull = { ...pull, head: { ...pull.head, sha: refreshed } };
    if (args[0] === 'pr' && args[1] === 'merge') pull = { ...pull, merged: true, merge_commit_sha: 'e'.repeat(40) };
  };
  return { repository, run, read, request, requests, checkWorkflow: workflow };
}
test('only an exact checked Dependabot head reaches protected merge; App writes trigger ordinary CI', async () => {
  const current = server(); await deliverDependabot(current);
  assert.equal(current.requests.length, 1); assert.ok(current.requests[0].includes('--match-head-commit')); assert.ok(current.requests[0].includes(head));
  assert.ok(!current.requests.some((args) => args[0] === 'workflow'));
  for (const options of [{ failed: true }, { actor: 'github-actions[bot]' }]) {
    const refused = server(options); await assert.rejects(deliverDependabot(refused)); assert.equal(refused.requests.length, 0);
  }
  const stale = server(); stale.run.head_sha = 'f'.repeat(40); await assert.rejects(deliverDependabot(stale)); assert.equal(stale.requests.length, 0);
  const behind = server({ behind: true }); await deliverDependabot(behind);
  assert.equal(behind.requests.length, 1); assert.equal(behind.requests[0][0], 'api'); assert.ok(behind.requests[0].includes(`expected_head_sha=${head}`));
  const organization = server({ repository: 'hraness/.github', workflow: 'ci.yml', workflowName: 'CI' });
  await deliverDependabot(organization); assert.equal(organization.requests.length, 1);
});
