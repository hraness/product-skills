import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_SLUG } from './authority.mjs';
import { deliverCheckedDependabot } from './dependabot.mjs';
import { automationFailure, stage } from './diagnostics.mjs';

const exec = promisify(execFile);
const need = (value, message) => { if (!value) throw new Error(message); };
const numericId = (value) => typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));

export function dependencyTarget({ env, event, expected }) {
  const repository = env.GITHUB_REPOSITORY; const run = event?.workflow_run;
  need(numericId(expected.repositoryId) && numericId(expected.ownerId) && ['public', 'private'].includes(expected.visibility) && /^[A-Za-z0-9_-]+\.ya?ml$/.test(expected.checkWorkflow), 'Explicit dependency repository and check inputs are required');
  need(typeof repository === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) && env.GITHUB_REPOSITORY_ID === expected.repositoryId && env.GITHUB_REPOSITORY_OWNER_ID === expected.ownerId && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_EVENT_NAME === 'workflow_run', 'Dependency delivery requires the selected repository on trusted main');
  need(event.repository?.id === Number(expected.repositoryId) && event.repository.full_name === repository && event.repository.owner?.id === Number(expected.ownerId) && event.repository.default_branch === 'main' && event.repository.visibility === expected.visibility && event.repository.private === (expected.visibility === 'private'), 'Dependency event repository identity differs');
  need(run?.status === 'completed' && run.conclusion === 'success' && run.event === 'pull_request' && Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.workflow_id) && run.workflow_id > 0 && typeof run.name === 'string' && run.name.length > 0 && run.name.length <= 128 && run.head_repository?.id === Number(expected.repositoryId) && run.head_repository.full_name === repository && /^dependabot\/github_actions\/[A-Za-z0-9_.\/-]+$/.test(run.head_branch) && /^[a-f0-9]{40}$/.test(run.head_sha), 'Only an ordinary successful dependency pull-request run can deliver');
  const [owner, name] = repository.split('/');
  return { repository, owner, name, repositoryId: Number(expected.repositoryId), ownerId: Number(expected.ownerId), visibility: expected.visibility, checkWorkflow: expected.checkWorkflow, run };
}

export async function deliverDependencyAction({ env, event, expected, read, request }) {
  const target = dependencyTarget({ env, event, expected });
  need(numericId(env.DISTRIBUTION_APP_ID) && env.DISTRIBUTION_APP_SLUG === APP_SLUG && typeof env.GH_TOKEN === 'string' && env.GH_TOKEN.length > 0, 'The dedicated App token is required without a repository-token fallback');
  const app = await read(`apps/${APP_SLUG}`);
  need(String(app.id) === env.DISTRIBUTION_APP_ID && app.slug === APP_SLUG && app.owner?.id === 307125679 && app.owner.login === 'hraness', 'Dependency App identity differs');
  const repo = await read(`repos/${target.repository}`);
  const matchesRepository = (value) => value?.id === target.repositoryId && value.full_name === target.repository && value.owner?.id === target.ownerId && value.visibility === target.visibility && value.private === (target.visibility === 'private') && value.default_branch === 'main';
  need(matchesRepository(repo), 'Dependency repository identity or default branch changed');
  const access = await read('installation/repositories?per_page=2');
  need(access.total_count === 1 && Array.isArray(access.repositories) && access.repositories.length === 1 && matchesRepository(access.repositories[0]), 'The App installation token must select only this repository');
  const rules = await read(`repos/${target.repository}/rules/branches/main`);
  need(Array.isArray(rules) && rules.length <= 100 && rules.some((rule) => rule.type === 'pull_request') && rules.some((rule) => rule.type === 'required_status_checks' && rule.parameters?.strict_required_status_checks_policy === true && rule.parameters.required_status_checks?.some((check) => check.context === 'Required' && check.integration_id === 15368)), 'Dependency delivery requires strict main protection and the Actions Required check');
  const run = await read(`repos/${target.repository}/actions/runs/${target.run.id}`);
  need(run.id === target.run.id && run.status === 'completed' && run.conclusion === 'success' && run.event === 'pull_request' && run.head_sha === target.run.head_sha && run.head_branch === target.run.head_branch && run.head_repository?.id === target.repositoryId && run.head_repository.full_name === target.repository && run.workflow_id === target.run.workflow_id && run.name === target.run.name, 'Dependency workflow run identity changed');
  const bot = await read('users/dependabot[bot]');
  need(bot.login === 'dependabot[bot]' && bot.type === 'Bot' && Number.isSafeInteger(bot.id) && bot.id > 0, 'Dependency bot identity differs');
  const checkedRead = async (path) => {
    const value = await read(path);
    if (path.includes('/check-runs?')) need(Array.isArray(value.check_runs) && Number.isSafeInteger(value.total_count) && value.total_count <= value.check_runs.length && value.check_runs.length <= 100, 'Dependency check inventory is incomplete');
    return value;
  };
  return deliverCheckedDependabot({ repository: target.repository, run, read: checkedRead, request, checkWorkflow: target.checkWorkflow, expectedActor: bot, expectedRepositoryId: target.repositoryId });
}

function inputs(env) {
  return { repositoryId: env.DEPENDENCY_REPOSITORY_ID, ownerId: env.DEPENDENCY_OWNER_ID, visibility: env.DEPENDENCY_VISIBILITY, checkWorkflow: env.DEPENDENCY_CHECK_WORKFLOW };
}

async function gh(args, env) {
  return stage(`github.${args[0] === 'pr' ? 'pr' : 'api'}`, async () => (await exec('gh', args, { env, timeout: 60000, maxBuffer: 1048576 })).stdout.trim());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  (async () => {
    const env = process.env; const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')); const expected = inputs(env);
    need(process.argv.length === 3 && ['prepare', 'deliver'].includes(process.argv[2]), 'Use prepare or deliver');
    if (process.argv[2] === 'prepare') {
      const target = dependencyTarget({ env, event, expected }); need(env.GITHUB_OUTPUT, 'The Actions output file is required');
      await appendFile(env.GITHUB_OUTPUT, `owner=${target.owner}\nrepository=${target.name}\n`); return;
    }
    const read = async (path) => {
      const checks = /^repos\/[^/]+\/[^/]+\/commits\/[a-f0-9]{40}\/check-runs\?per_page=100$/.test(path);
      if (checks) need(env.REPORT_GH_TOKEN, 'The read-only check token is required');
      return JSON.parse(await gh(['api', path], checks ? { ...env, GH_TOKEN: env.REPORT_GH_TOKEN } : env));
    };
    process.stdout.write(`${await deliverDependencyAction({ env, event, expected, read, request: (args) => gh(args, env) })}\n`);
  })().catch((error) => { process.stderr.write(`${automationFailure(error, 'deliver')}\nChecked dependency delivery stopped; repository protection remains enforced.\n`); process.exitCode = 1; });
}
