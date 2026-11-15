import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CommandError, control, execute, jsonFile, libraryArguments, requireValue, verifiedSpongeCommand } from './cli.mjs';

export function runRaycast(action, input, { env = process.env, run = spawnSync, requirements = jsonFile(new URL('./requirements.json', import.meta.url)) } = {}) {
  requireValue(['save', 'search'].includes(action) && typeof input === 'string' && input.length > 0 && input.trim() === input && input.length <= (action === 'save' ? 8192 : 1000) && input.isWellFormed() && !control.test(input), 'Enter one URL or search phrase.');
  let value = input;
  if (action === 'save') {
    let url; try { url = new URL(input); } catch {}
    requireValue(url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'Enter an HTTP or HTTPS URL without embedded credentials.');
    value = url.href;
  }
  const library = libraryArguments(env.SPONGE_RAYCAST_LIBRARY);
  const command = verifiedSpongeCommand(requirements, { env, run, commandPath: env.SPONGE_RAYCAST_CLI ?? env.SPONGE_CLI });
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
