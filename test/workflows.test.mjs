import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Status functions are valid in job/step `if`, not environment expressions.
// This regression covers the class that plain YAML and cost checks cannot see;
// actionlint separately validates the full Actions schema before delivery.
function statusFunctionsInEnvironment(source) {
  let environmentIndent = null; const invalid = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (environmentIndent !== null && indent <= environmentIndent) environmentIndent = null;
    if (/^\s*env:\s*$/.test(line)) environmentIndent = indent;
    if (environmentIndent !== null && /\$\{\{[^}]*\b(?:always|cancelled|failure|success)\s*\(/.test(line)) invalid.push(index + 1);
  }
  return invalid;
}

test('workflow environment expressions use job status and preserve conditional status functions', () => {
  assert.deepEqual(statusFunctionsInEnvironment("steps:\n  - if: always()\n    env:\n      FAILED: ${{ failure() }}\n    run: echo private\n"), [4]);
  assert.deepEqual(statusFunctionsInEnvironment("steps:\n  - if: always()\n    env:\n      FAILED: ${{ job.status == 'failure' }}\n    run: echo private\n  - if: failure()\n    run: exit 1\n"), []);
});

test('all repository workflows avoid status functions in environment expressions', async () => {
  for (const name of await readdir(new URL('../.github/workflows/', import.meta.url))) if (/\.ya?ml$/.test(name)) {
    const invalid = statusFunctionsInEnvironment(await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8'));
    assert.deepEqual(invalid, [], `${name} has forbidden status functions in env at lines ${invalid.join(', ')}`);
  }
});

test('publication admits trusted scheduled and manual recovery plus canonical successful main checks', async () => {
  const source = await readFile(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');
  const folded = /^    if: >-\n((?:      .*\n)+)/m.exec(source); assert(folded, 'The publication guard must remain explicitly reviewable');
  const admit = new Function('github', `return (${folded[1].trim().replaceAll('\n', ' ')});`);
  const context = (event_name) => ({ repository: 'hraness/product-skills', repository_id: '1458031600', ref: 'refs/heads/main', event_name, event: { workflow_run: { conclusion: 'success', head_repository: { id: 1458031600, full_name: 'hraness/product-skills' }, head_branch: 'main' } } });
  for (const event of ['schedule', 'workflow_dispatch', 'workflow_run']) assert.equal(admit(context(event)), true, event);
  assert.equal(admit(context('pull_request')), false);
  for (const change of [{ repository_id: '1' }, { repository: 'someone/else' }, { ref: 'refs/heads/proposal' }]) assert.equal(admit({ ...context('schedule'), ...change }), false);
  const failed = context('workflow_run'); failed.event.workflow_run.conclusion = 'failure'; assert.equal(admit(failed), false);
  const fork = context('workflow_run'); fork.event.workflow_run.head_repository.id = 1; assert.equal(admit(fork), false);
  const branch = context('workflow_run'); branch.event.workflow_run.head_branch = 'proposal'; assert.equal(admit(branch), false);
});
