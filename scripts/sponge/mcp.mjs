import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CommandError, jsonFile, libraryArguments, requireValue, verifiedSpongeCommand } from './cli.mjs';

export function startSpongeMcp({ env = process.env, probe = spawnSync, launch = spawn, requirements = jsonFile(new URL('./requirements.json', import.meta.url)) } = {}) {
  const library = libraryArguments(env.SPONGE_MCP_LIBRARY);
  const command = verifiedSpongeCommand(requirements, { env, run: probe });
  return launch(process.execPath, [command.entry, 'mcp', ...library], { env, stdio: 'inherit', windowsHide: true });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireValue(process.argv.length === 2, 'Start this launcher through the Sponge plugin.');
    const child = startSpongeMcp();
    const interrupt = () => { child.kill('SIGINT'); };
    const terminate = () => { child.kill('SIGTERM'); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', () => { process.stderr.write('Sponge MCP did not start. Follow the setup guide in the README.\n'); process.exitCode = 1; });
    child.once('close', (code, signal) => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); process.exitCode = Number.isInteger(code) && code >= 0 ? code : signal === 'SIGINT' ? 130 : 1; });
  } catch (error) {
    process.stderr.write((error instanceof CommandError ? error.message : 'Sponge MCP did not start. Follow the setup guide in the README.') + '\n');
    process.exitCode = 1;
  }
}
