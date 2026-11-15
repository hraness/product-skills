import { accessSync, constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export class CommandError extends Error {}
export const requireValue = (value, message) => { if (!value) throw new CommandError(message); };
export const control = /[\x00-\x1f\x7f]/;
export function jsonFile(path) {
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
  if (env.SPONGE_CLI) {
    requireValue(isAbsolute(env.SPONGE_CLI) && !control.test(env.SPONGE_CLI), 'Use an absolute SPONGE_CLI path.');
    return env.SPONGE_CLI;
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
export function execute(run, entry, args, env) {
  const result = run(process.execPath, [entry, ...args], { env, encoding: 'utf8', input: '', timeout: 15000, maxBuffer: 256 * 1024, windowsHide: true });
  requireValue(!result.error && result.status === 0 && typeof result.stdout === 'string' && Buffer.byteLength(result.stdout) <= 256 * 1024, 'Sponge did not finish. Check your library before retrying.');
  return result.stdout;
}
export function libraryArguments(path) {
  if (!path) return [];
  requireValue(isAbsolute(path) && path !== '/' && path.length <= 4096 && !control.test(path), 'Use an existing absolute Sponge library directory.');
  let info; try { info = lstatSync(path); } catch {}
  requireValue(info?.isDirectory() && !info.isSymbolicLink(), 'Use an existing absolute Sponge library directory.');
  return ['--library', path];
}
export function verifiedSpongeCommand(requirements, { env = process.env, run = spawnSync, commandPath = env.SPONGE_CLI } = {}) {
  const command = installedCommand(requirements, { ...env, SPONGE_CLI: commandPath });
  requireValue(execute(run, command.entry, ['--version'], env).trim() === command.version, 'Sponge CLI version differs from its package. Reinstall it using the setup guide.');
  return command;
}
