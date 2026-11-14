import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGovernedLedger } from '../scripts/distribution.mjs';

test('the governed initial tree may lack a ledger even when the current checkout has one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'product-ledger-history-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '--quiet');
    await writeFile(join(root, 'README.md'), 'Initial repository\n');
    git('add', 'README.md'); git('commit', '--quiet', '-m', 'Initial');
    const initial = git('rev-parse', 'HEAD');
    const ledger = { schemaVersion: 1, publications: [] };
    await writeFile(join(root, 'publication-ledger.json'), JSON.stringify(ledger));
    assert.deepEqual(await readGovernedLedger(root, initial), ledger);
    git('add', 'publication-ledger.json'); git('commit', '--quiet', '-m', 'Add ledger');
    assert.deepEqual(await readGovernedLedger(root, git('rev-parse', 'HEAD')), ledger);
    await assert.rejects(readGovernedLedger(root, 'f'.repeat(40)));
    await assert.rejects(readGovernedLedger(root, '--all'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
