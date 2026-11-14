import { accessSync, constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

class CommandError extends Error {}
const requireValue = (value, message) => { if (!value) throw new CommandError(message); };
const control = /[\x00-\x1f\x7f]/;
function jsonFile(path) {
  const info = lstatSync(path);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.size <= 65536, 'Sponge package metadata is unavailable.');
  return JSON.parse(readFileSync(path, 'utf8'));
}
function semver(value) {
  const match = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.exec(value);
  requireValue(match, 'Use a stable Sponge release.');
  return match.slice(1).map(Number);
}
function atLeast(value, minimum) {
  const current = semver(value), required = semver(minimum);
  for (let i = 0; i < 3; i++) if (current[i] !== required[i]) return current[i] > required[i];
  return true;
}
function nodeRequirement(value) {
  requireValue(typeof value === 'string' && /^>=\d+\.\d+\.\d+$/.test(value), 'Sponge has an unsupported Node.js requirement.');
  requireValue(atLeast(process.versions.node, value.slice(2)), 'Update Node.js using the Sponge setup guide.');
}
function selectedCommand(env) {
  if (env.SPONGE_RAYCAST_CLI) {
    requireValue(isAbsolute(env.SPONGE_RAYCAST_CLI) && !control.test(env.SPONGE_RAYCAST_CLI), 'Use an absolute SPONGE_RAYCAST_CLI path.');
    return env.SPONGE_RAYCAST_CLI;
  }
  for (const directory of (env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
    const path = join(directory, 'sponge');
    try { accessSync(path, constants.X_OK); return path; } catch {}
  }
  throw new CommandError('Install the @hraness/sponge CLI using the Sponge setup guide.');
}
function installedCommand(requirements, env) {
  requireValue(requirements.schemaVersion === 1 && requirements.command === 'sponge' && requirements.package === '@hraness/sponge', 'Sponge command requirements are invalid.');
  nodeRequirement(requirements.node);
  let entry, manifest;
  try {
    entry = realpathSync(selectedCommand(env));
    requireValue(lstatSync(entry).isFile(), 'Sponge CLI entry is unavailable.');
    const root = dirname(dirname(entry));
    requireValue(entry === join(root, 'bin/sponge.js'), 'Use the @hraness/sponge CLI from the Sponge setup guide.');
    manifest = jsonFile(join(root, 'package.json'));
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError('Install the @hraness/sponge CLI using the Sponge setup guide.');
  }
  requireValue(manifest.name === requirements.package && manifest.bin?.sponge === 'bin/sponge.js' && manifest.homepage === requirements.homepage && manifest.mcpName === 'io.github.hraness/sponge', 'This command requires the @hraness/sponge CLI. Follow the Sponge setup guide.');
  requireValue(atLeast(manifest.version, requirements.version), 'Update Sponge using its setup guide.');
  nodeRequirement(manifest.engines?.node);
  return { entry, version: manifest.version };
}
function execute(run, entry, args, env) {
  const result = run(process.execPath, [entry, ...args], { env, encoding: 'utf8', input: '', timeout: 15000, maxBuffer: 256 * 1024, windowsHide: true });
  requireValue(!result.error && result.status === 0 && typeof result.stdout === 'string' && Buffer.byteLength(result.stdout) <= 256 * 1024, 'Sponge did not finish. Check your library before retrying.');
  return result.stdout;
}
function libraryArguments(env) {
  if (!env.SPONGE_RAYCAST_LIBRARY) return [];
  const path = env.SPONGE_RAYCAST_LIBRARY;
  requireValue(isAbsolute(path) && path !== '/' && path.length <= 4096 && !control.test(path), 'Use an existing absolute SPONGE_RAYCAST_LIBRARY directory.');
  let info; try { info = lstatSync(path); } catch {}
  requireValue(info?.isDirectory() && !info.isSymbolicLink(), 'Use an existing absolute SPONGE_RAYCAST_LIBRARY directory.');
  return ['--library', path];
}
export function runRaycast(action, input, { env = process.env, run = spawnSync, requirements = jsonFile(new URL('./requirements.json', import.meta.url)) } = {}) {
  requireValue(['save', 'search'].includes(action) && typeof input === 'string' && input.length > 0 && input.trim() === input && input.length <= (action === 'save' ? 8192 : 1000) && input.isWellFormed() && !control.test(input), 'Enter one URL or search phrase.');
  let value = input;
  if (action === 'save') {
    let url; try { url = new URL(input); } catch {}
    requireValue(url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'Enter an HTTP or HTTPS URL without embedded credentials.');
    value = url.href;
  }
  const library = libraryArguments(env);
  const command = installedCommand(requirements, env);
  requireValue(execute(run, command.entry, ['--version'], env).trim() === command.version, 'Sponge CLI version differs from its package. Reinstall it using the setup guide.');
  if (action === 'save') {
    const stdout = execute(run, command.entry, ['add', value, '--json', ...library], env);
    let result; try { result = JSON.parse(stdout); } catch {}
    requireValue(result?.ok === true && typeof result.itemId === 'string' && result.itemId.length > 0, 'Sponge returned an unexpected result. Check your library before retrying.');
    if (result.duplicate === true) return 'Already in Sponge.';
    requireValue(typeof result.jobId === 'string' && result.jobId.length > 0, 'Sponge returned an unexpected result. Check your library before retrying.');
    return 'Queued for capture in Sponge.';
  }
  const stdout = execute(run, command.entry, ['search', '--mode', 'lexical', '--limit', '20', ...library, '--', value], env);
  return stdout.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim() || 'No matching saved text.';
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireValue(process.argv.length === 4, 'Enter one URL or search phrase.');
    process.stdout.write(runRaycast(process.argv[2], process.argv[3]) + '\n');
  } catch (error) {
    process.stderr.write((error instanceof CommandError ? error.message : 'Sponge command failed. Follow the setup guide in the README.') + '\n');
    process.exitCode = 1;
  }
}
