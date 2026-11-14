import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_BOT, distributionAuthority, ownedByDistributionApp } from '../scripts/authority.mjs';

const repository = 'hraness/product-skills';
const env = { GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/main', DISTRIBUTION_APP_ID: '12345', DISTRIBUTION_APP_SLUG: 'hraness-distribution', GH_TOKEN: 'synthetic-installation-token' };
function authority(changes = {}) {
  const values = {
    app: { id: 12345, slug: 'hraness-distribution', owner: { id: 307125679, login: 'hraness' } },
    access: { total_count: 1, repositories: [{ full_name: repository }] },
    bot: { id: 67890, login: APP_BOT, type: 'Bot' }, ...changes,
  };
  return async (path) => path.startsWith('apps/') ? values.app : path.startsWith('users/') ? values.bot : values.access;
}
test('the scoped distribution App is restricted to the exact repository and trusted main', async () => {
  const bot = await distributionAuthority(repository, { env, read: authority() });
  assert.equal(bot.login, APP_BOT);
  assert.equal(ownedByDistributionApp({ user: bot }, bot), true);
  assert.equal(ownedByDistributionApp({ user: { ...bot, id: 1 } }, bot), false);
  assert.equal(ownedByDistributionApp({ user: { ...bot, login: 'github-actions[bot]' } }, bot), false);
  for (const changes of [{ GITHUB_REF: 'refs/heads/untrusted' }, { DISTRIBUTION_APP_SLUG: 'another-app' }, { DISTRIBUTION_APP_ID: '' }, { GH_TOKEN: undefined, GITHUB_TOKEN: 'no-fallback-token' }]) await assert.rejects(distributionAuthority(repository, { env: { ...env, ...changes }, read: authority() }));
  for (const changes of [
    { app: { id: 999, slug: 'hraness-distribution', owner: { id: 307125679, login: 'hraness' } } },
    { app: { id: 12345, slug: 'hraness-distribution', owner: { id: 1, login: 'other-owner' } } },
    { access: { total_count: 2, repositories: [{ full_name: repository }, { full_name: 'hraness/private-app' }] } },
    { access: { total_count: 1, repositories: [{ full_name: 'hraness/private-app' }] } },
    { bot: { id: 67890, login: APP_BOT, type: 'User' } },
  ]) await assert.rejects(distributionAuthority(repository, { env, read: authority(changes) }));
});
