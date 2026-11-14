import test from 'node:test';
import assert from 'node:assert/strict';
import { dependencyTarget, deliverDependencyAction } from '../scripts/dependency-action.mjs';
import { deliverDependabot } from '../scripts/dependabot.mjs';

const repository = 'example-owner/example-project'; const repositoryId = 123456; const ownerId = 654321;
const main = 'a'.repeat(40); const head = 'b'.repeat(40); const next = 'c'.repeat(40); const branch = 'dependabot/github_actions/actions-update-1';
const patch = { filename: '.github/workflows/check.yml', status: 'modified', additions: 1, deletions: 1, patch: `@@ -1 +1 @@\n-      - uses: actions/checkout@${main} # v7.0.0\n+      - uses: actions/checkout@${head} # v7.0.1` };
function fixture({ visibility = 'private', behind = false } = {}) {
  const expected = { repositoryId: String(repositoryId), ownerId: String(ownerId), visibility, checkWorkflow: 'check.yml' };
  const repo = { id: repositoryId, full_name: repository, owner: { id: ownerId }, visibility, private: visibility === 'private', default_branch: 'main' };
  const run = { id: 99, workflow_id: 7, name: 'Check', status: 'completed', conclusion: 'success', event: 'pull_request', head_repository: repo, head_sha: head, head_branch: branch };
  const event = { repository: structuredClone(repo), workflow_run: structuredClone(run) };
  const env = { GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: String(repositoryId), GITHUB_REPOSITORY_OWNER_ID: String(ownerId), GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_run', DISTRIBUTION_APP_ID: '5762098', DISTRIBUTION_APP_SLUG: 'hraness-distribution', GH_TOKEN: 'installation-test-token' };
  let pull = { number: 8, user: { login: 'dependabot[bot]', id: 400, type: 'Bot' }, head: { ref: branch, sha: head, repo: structuredClone(repo) }, base: { ref: 'main', sha: main, repo: structuredClone(repo) }, changed_files: 1 };
  const values = {
    app: { id: 5762098, slug: 'hraness-distribution', owner: { id: 307125679, login: 'hraness' } },
    repo, run, access: { total_count: 1, repositories: [structuredClone(repo)] },
    rules: [{ type: 'pull_request' }, { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'Required', integration_id: 15368 }] } }],
    files: [structuredClone(patch)], checks: { total_count: 1, check_runs: [{ id: 3, name: 'Required', head_sha: head, app: { id: 15368 }, status: 'completed', conclusion: 'success' }] },
    workflow: { id: 7, path: '.github/workflows/check.yml', name: 'Check' },
    comparison: { behind_by: behind ? 1 : 0, merge_base_commit: { sha: behind ? 'd'.repeat(40) : main } },
  };
  const reads = []; const requests = [];
  const read = async (path) => {
    reads.push(path);
    if (path === 'apps/hraness-distribution') return values.app;
    if (path === `repos/${repository}`) return values.repo;
    if (path === 'installation/repositories?per_page=2') return values.access;
    if (path.endsWith('/rules/branches/main')) return values.rules;
    if (path.endsWith('/actions/runs/99')) return values.run;
    if (path === 'users/dependabot[bot]') return { login: 'dependabot[bot]', id: 400, type: 'Bot' };
    if (path.endsWith('/actions/workflows/check.yml')) return values.workflow;
    if (path.includes('/pulls?')) return [pull];
    if (path.endsWith('/pulls/8')) return pull;
    if (path.endsWith('/files?per_page=100')) return values.files;
    if (path.includes('/check-runs?')) return values.checks;
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: main } };
    if (path.includes('/compare/')) return values.comparison;
    throw new Error('Unexpected fixture read');
  };
  const request = async (args) => {
    requests.push(args);
    if (args[0] === 'api' && args[3].endsWith('/update-branch')) pull = { ...pull, head: { ...pull.head, sha: next } };
    else if (args[0] === 'pr' && args[1] === 'merge') pull = { ...pull, merged: true, merge_commit_sha: 'e'.repeat(40) };
    else throw new Error('Unexpected write');
  };
  return { env, event, expected, read, request, values, reads, requests, pull: () => pull };
}

test('an explicitly selected public or private repository can deliver without a source-level name allowlist', async () => {
  for (const visibility of ['public', 'private']) {
    const current = fixture({ visibility }); const target = dependencyTarget(current); assert.equal(target.repository, repository);
    await deliverDependencyAction(current);
    assert.equal(current.requests.length, 1); assert.deepEqual(current.requests[0], ['pr', 'merge', '8', '--repo', repository, '--squash', '--match-head-commit', head]);
    assert(!current.requests.flat().includes('--admin')); assert(!current.requests.some((args) => args[0] === 'workflow'));
  }
  await assert.rejects(deliverDependabot({ repository }), /authorized public/);
});

test('caller identity, default main, App owner and one-repository scope fail before writes', async () => {
  for (const change of [
    (f) => { f.expected.repositoryId = '2'; }, (f) => { f.expected.ownerId = '2'; }, (f) => { f.expected.visibility = 'public'; },
    (f) => { f.env.GITHUB_REF = 'refs/heads/other'; }, (f) => { f.env.GH_TOKEN = ''; },
    (f) => { f.event.repository.default_branch = 'other'; }, (f) => { f.values.repo.default_branch = 'other'; },
    (f) => { f.values.app.owner.id = 2; }, (f) => { f.values.app.id = 2; },
    (f) => { f.values.access.total_count = 2; }, (f) => { f.values.access.repositories[0].id = 2; },
    (f) => { f.values.access.repositories[0].private = false; },
  ]) { const current = fixture(); change(current); await assert.rejects(deliverDependencyAction(current)); assert.equal(current.requests.length, 0); }
});

test('strict Actions Required protection, canonical run and exact dependency author are necessary', async () => {
  for (const change of [
    (f) => { f.values.rules[1].parameters.strict_required_status_checks_policy = false; },
    (f) => { f.values.rules[1].parameters.required_status_checks[0].integration_id = 1; },
    (f) => { f.values.rules.shift(); }, (f) => { f.values.run.head_sha = next; },
    (f) => { f.values.workflow.path = '.github/workflows/unrelated.yml'; },
    (f) => { f.pull().user.id = 401; }, (f) => { f.pull().head.repo.id = 2; },
    (f) => { f.values.files[0].filename = 'src/index.ts'; },
    (f) => { f.values.files[0].patch = patch.patch.replace(`actions/checkout@${head}`, `another/action@${head}`); },
    (f) => { f.values.checks.total_count = 101; },
  ]) { const current = fixture(); change(current); await assert.rejects(deliverDependencyAction(current)); assert.equal(current.requests.length, 0); }
});

test('held or incomplete exact-head validation never gets a replacement run or a merge', async () => {
  for (const conclusion of ['action_required', 'failure', 'cancelled']) {
    const current = fixture(); current.event.workflow_run.conclusion = conclusion;
    await assert.rejects(deliverDependencyAction(current)); assert.equal(current.reads.length, 0); assert.equal(current.requests.length, 0);
  }
  for (const status of ['in_progress', 'completed']) {
    const current = fixture();
    current.values.checks.check_runs.push({ id: 4, name: 'Required', head_sha: head, app: { id: 15368 }, status, conclusion: status === 'completed' ? 'failure' : null }); current.values.checks.total_count = 2;
    await assert.rejects(deliverDependencyAction(current)); assert.equal(current.requests.length, 0);
  }
});

test('a concurrent head change cannot be retried as an unconditional or administrator merge', async () => {
  const current = fixture(); const requests = [];
  await assert.rejects(deliverDependencyAction({ ...current, request: async (args) => { requests.push(args); throw new Error('Conditional head rejected'); } }));
  assert.equal(requests.length, 1); assert(requests[0].includes('--match-head-commit')); assert(!requests[0].includes('--admin'));
  const absent = fixture(); await deliverDependencyAction({ ...absent, read: (path) => path.includes('/pulls?') ? [] : absent.read(path) }); assert.equal(absent.requests.length, 0);
});

test('a current-base comparison refreshes an older merge base conditionally and waits for ordinary new checks', async () => {
  const current = fixture({ behind: true }); assert.equal(current.pull().base.sha, main);
  await deliverDependencyAction(current);
  assert.equal(current.requests.length, 1); assert.deepEqual(current.requests[0], ['api', '--method', 'PUT', `repos/${repository}/pulls/8/update-branch`, '-f', `expected_head_sha=${head}`]);
  assert.equal(current.pull().head.sha, next); assert(!current.requests.some((args) => args[0] === 'workflow' || args[0] === 'pr'));
});
