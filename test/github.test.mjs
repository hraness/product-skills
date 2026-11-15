import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshBehindPull, repairMissingCheck, successfulRequired, updateOwnedBranch, validateUpdateFiles } from '../scripts/github.mjs';
test('owned update branches contain only their exact generated files', () => {
  assert.doesNotThrow(() => validateUpdateFiles('products', ['catalog/admitted.json', 'plugins/sponge/skills/sponge/SKILL.md', 'plugins/yaptake/.claude-plugin/plugin.json']));
  assert.doesNotThrow(() => validateUpdateFiles('publications', ['publication-ledger.json', 'catalog/store-status.json']));
  for (const kind of ['products', 'publications']) {
    assert.doesNotThrow(() => validateUpdateFiles(kind, ['catalog/directory-observations.json']));
    for (const path of ['catalog/directory-observations.json.bak', 'catalog/directory-verification-2026-11-14.json', 'catalog/../directory-observations.json']) assert.throws(() => validateUpdateFiles(kind, [path]));
  }
  assert.doesNotThrow(() => validateUpdateFiles('products', ['plugins/textmock/scripts/textmock-link.mjs', 'plugins/textmock/skills/textmock/scripts/textmock-link.mjs', 'skills/textmock/scripts/textmock-link.mjs', 'plugins/dawn/skills/dawn/examples/morning-study.ts', 'skills/dawn/examples/morning-study.ts']));
  for (const path of ['scripts/distribution.mjs', '.github/workflows/check.yml', 'plugins/sponge/skills/yaptake/SKILL.md', 'plugins/sponge/../README.md', 'publication-ledger.json']) assert.throws(() => validateUpdateFiles('products', [path]));
  assert.throws(() => validateUpdateFiles('publications', ['README.md']));
  for (const path of ['plugins/sponge/scripts/textmock-link.mjs', 'skills/textmock/scripts/unreviewed.mjs', 'skills/dawn/examples/private.ts', 'plugins/dawn/skills/textmock/scripts/textmock-link.mjs']) assert.throws(() => validateUpdateFiles('products', [path]));
});
test('a stale branch updates conditionally and waits for the new head before dispatch can continue', async () => {
  const expected = 'a'.repeat(40); let reads = 0; let requests = 0;
  const result = await updateOwnedBranch({ repository: 'hraness/product-skills', number: 7, expected, request: async (argv) => { requests++; assert.ok(argv.includes(`expected_head_sha=${expected}`)); assert.equal(argv[2], 'PUT'); }, read: async () => ({ head: { sha: ++reads === 1 ? expected : 'b'.repeat(40) }, mergeable_state: 'behind' }), wait: async () => {} });
  assert.equal(result.head.sha, 'b'.repeat(40)); assert.equal(requests, 1); assert.equal(reads, 2);
});
test('a concurrent head mismatch is not retried without reconciliation', async () => {
  let reads = 0;
  await assert.rejects(updateOwnedBranch({ repository: 'hraness/product-skills', number: 7, expected: 'a'.repeat(40), request: async () => { throw new Error('422 expected head mismatch'); }, read: async () => { reads++; }, wait: async () => {} }));
  assert.equal(reads, 0);
});
test('check repair preserves approval-held or running workflow runs and dispatches only a missing run', async () => {
  const sha = 'a'.repeat(40); const requested = [];
  for (const run of [{ head_sha: sha, status: 'waiting', conclusion: null }, { head_sha: sha, status: 'completed', conclusion: 'action_required' }, { head_sha: sha, status: 'in_progress', conclusion: null }]) {
    const result = await repairMissingCheck({ repository: 'hraness/product-skills', workflow: 'check.yml', ref: 'automation/products-1-1', sha, read: async (path) => { assert.ok(!path.includes('branch=')); return path.includes('/check-runs') ? { check_runs: [] } : { total_count: 1, workflow_runs: [run] }; }, request: async (args) => requested.push(args) });
    assert.equal(result, 'present');
  }
  assert.equal(requested.length, 0);
  assert.equal(await repairMissingCheck({ repository: 'hraness/product-skills', workflow: 'check.yml', ref: 'automation/products-1-1', sha, read: async (path) => path.includes('/check-runs') ? { check_runs: [] } : { total_count: 0, workflow_runs: [] }, request: async (args) => requested.push(args) }), 'requested');
  assert.equal(requested.length, 1); assert.equal(requested[0][0], 'workflow');
  await assert.rejects(repairMissingCheck({ repository: 'hraness/product-skills', workflow: 'check.yml', ref: 'automation/products-1-1', sha, read: async (path) => path.includes('/check-runs') ? { check_runs: [] } : { total_count: 1, workflow_runs: [{ head_sha: 'b'.repeat(40) }] }, request: async () => { throw new Error('An inconsistent run list must not dispatch'); } }));
});
test('an unsettled mergeability state or current base ref cannot conceal a behind head', async () => {
  const main = 'a'.repeat(40); const old = 'b'.repeat(40); const refreshed = 'c'.repeat(40); const calls = [];
  const result = await refreshBehindPull({ repository: 'hraness/product-skills', number: 7, head: old, request: async (args) => calls.push(args), read: async (path) => {
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: main } };
    if (path.endsWith(`/compare/${main}...${old}`)) return { behind_by: 1, merge_base_commit: { sha: 'd'.repeat(40) } };
    if (path.endsWith(`/compare/${main}...${refreshed}`)) return { behind_by: 0, merge_base_commit: { sha: main } };
    if (path.endsWith('/pulls/7')) return { head: { sha: refreshed }, base: { sha: main }, mergeable_state: null };
    throw new Error('Unexpected branch read');
  }, wait: async () => {} });
  assert.equal(result.updated, true); assert.equal(result.head, refreshed); assert.equal(calls.length, 1); assert.ok(calls[0].includes(`expected_head_sha=${old}`));
});
test('Required belongs to the exact head and official App, and a newer pending run supersedes success', () => {
  const sha = 'a'.repeat(40); const passed = { id: 1, name: 'Required', app: { id: 15368 }, head_sha: sha, status: 'completed', conclusion: 'success' };
  assert.equal(successfulRequired({ check_runs: [passed] }, sha), true);
  for (const changes of [{ app: { id: 1 } }, { head_sha: 'b'.repeat(40) }, { status: 'in_progress', conclusion: null }, { conclusion: 'failure' }]) assert.equal(successfulRequired({ check_runs: [{ ...passed, ...changes }] }, sha), false);
  assert.equal(successfulRequired({ check_runs: [passed, { ...passed, id: 2, status: 'in_progress', conclusion: null }] }, sha), false);
});
