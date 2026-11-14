import test from 'node:test';
import assert from 'node:assert/strict';
import { updateOwnedBranch, validateUpdateFiles } from '../scripts/github.mjs';
test('owned update branches contain only their exact generated files', () => {
  assert.doesNotThrow(() => validateUpdateFiles('products', ['catalog/admitted.json', 'plugins/sponge/skills/sponge/SKILL.md', 'plugins/yaptake/.claude-plugin/plugin.json']));
  assert.doesNotThrow(() => validateUpdateFiles('publications', ['publication-ledger.json', 'catalog/store-status.json']));
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
