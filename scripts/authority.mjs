export const APP_SLUG = 'hraness-distribution';
export const APP_BOT = `${APP_SLUG}[bot]`;
const TARGETS = new Set(['hraness/product-skills', 'hraness/.github', '0thernet/0thernet']);
const need = (condition, message) => { if (!condition) throw new Error(message); };

export async function distributionAuthority(repository, { read, env = process.env }) {
  need(TARGETS.has(repository) && env.GITHUB_REPOSITORY === repository && env.GITHUB_REF === 'refs/heads/main' && /^[1-9]\d{0,19}$/.test(env.DISTRIBUTION_APP_ID ?? '') && env.DISTRIBUTION_APP_SLUG === APP_SLUG && typeof env.GH_TOKEN === 'string' && env.GH_TOKEN.length > 0, 'The dedicated distribution App token on trusted main is required; there is no repository-token fallback');
  const app = await read(`apps/${APP_SLUG}`);
  need(String(app.id) === env.DISTRIBUTION_APP_ID && app.slug === APP_SLUG && app.owner?.id === 307125679 && app.owner.login === 'hraness', 'Distribution App identity mismatch');
  const access = await read('installation/repositories?per_page=2');
  need(access.total_count === 1 && Array.isArray(access.repositories) && access.repositories.length === 1 && access.repositories[0].full_name === repository, 'The installation token must be limited to this one repository');
  const bot = await read(`users/${APP_BOT}`);
  need(bot.login === APP_BOT && bot.type === 'Bot' && Number.isSafeInteger(bot.id) && bot.id > 0, 'Distribution App bot identity mismatch');
  return bot;
}

export function ownedByDistributionApp(pull, bot) {
  return pull?.user?.login === APP_BOT && pull.user.id === bot.id && pull.user.type === 'Bot';
}
