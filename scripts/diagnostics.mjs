const COMMANDS = new Set(['propose-products', 'propose-publications', 'propose-guides', 'deliver', 'publish', 'refresh']);
const GUARDS = new Map([
  ['Created release did not reconcile', 'created-release-not-visible'],
  ['Release source or version differs', 'release-source-or-version'],
  ['Unexpected or duplicate release assets', 'release-asset-inventory'],
  ['Existing release asset differs; no overwrite is allowed', 'release-asset-identity'],
  ['Draft release tag identifies another source', 'draft-tag-source'],
  ['Invalid release publication plan', 'release-plan'],
  ['Release bytes and local paths are required', 'release-local-artifacts'],
]);
const STEPS = new Set([
  'release.lookup', 'release.prepare', 'release.create', 'release.upload', 'release.readback', 'release.current-head', 'release.publish', 'release.public-readback', 'release.tag-readback',
  'package.check', 'package.build', 'checks.read',
  ...['api', 'pr', 'release', 'workflow', 'command'].map((name) => `github.${name}`),
  ...['rev-parse', 'fetch', 'rev-list', 'diff', 'ls-files', 'show', 'checkout', 'add', 'commit', 'push', 'status', 'command'].map((name) => `git.${name}`),
]);

export function httpStatus(error) {
  for (let cause = error, depth = 0; cause && depth < 4; cause = cause.cause, depth++) {
    if (Number.isSafeInteger(cause.status) && cause.status >= 100 && cause.status <= 599) return cause.status;
    const match = /\bHTTP ([1-5]\d{2})\b/.exec(String(cause.stderr ?? '').slice(0, 8192));
    if (match) return Number(match[1]);
  }
  return null;
}

export async function stage(name, action) {
  try { return await action(); }
  catch (error) {
    const failure = error instanceof Error ? error : new Error('Unexpected automation failure');
    if (!failure.automationStage || failure.automationStage.startsWith('github.') && !name.startsWith('github.')) failure.automationStage = name;
    throw failure;
  }
}

// Provider stderr, command arguments, response bodies and environment values may
// contain credentials or private content. Report only bounded structural facts.
export function automationFailure(error, command) {
  const status = httpStatus(error);
  const guard = GUARDS.get(error?.message);
  const step = STEPS.has(error?.automationStage) ? error.automationStage : 'automation';
  const processCode = ['ENOENT', 'EACCES', 'ETIMEDOUT', 'EPIPE', 'ECONNRESET'].includes(error?.code) ? error.code : null;
  const errorType = status ? 'HttpError' : error?.killed === true || error?.code === 'ETIMEDOUT' ? 'TimeoutError' : Number.isInteger(error?.code) || processCode ? 'ProcessError' : ['SyntaxError', 'TypeError', 'RangeError'].includes(error?.name) ? error.name : 'ValidationError';
  return JSON.stringify({ event: 'automation_failed', command: COMMANDS.has(command) ? command : 'unknown', step, errorType, ...(guard ? { guard } : {}), ...(status ? { httpStatus: status } : {}), ...(Number.isInteger(error?.code) ? { exitCode: error.code } : {}), ...(processCode ? { processCode } : {}) });
}
