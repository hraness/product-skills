import { delimiter, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CommandError } from './cli.mjs';
import { startSpongeMcp } from './mcp.mjs';

// Desktop hosts leave an unset optional setting as its literal placeholder and
// often start servers without the shell's PATH. Treat a placeholder as unset and
// add the usual npm global directories; the launcher still verifies the package.
const COMMON_BIN = ['/opt/homebrew/bin', '/usr/local/bin'];
export function bundleEnvironment(env) {
  const next = { ...env };
  for (const key of ['SPONGE_CLI', 'SPONGE_MCP_LIBRARY']) if (typeof next[key] !== 'string' || next[key] === '' || next[key].startsWith('${')) delete next[key];
  const path = (next.PATH ?? '').split(delimiter).filter(Boolean);
  for (const directory of COMMON_BIN) if (!path.includes(directory)) path.push(directory);
  next.PATH = path.filter(isAbsolute).join(delimiter);
  return next;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new CommandError('Start this server through its MCP bundle.');
    const child = startSpongeMcp({ env: bundleEnvironment(process.env) });
    const interrupt = () => { child.kill('SIGINT'); };
    const terminate = () => { child.kill('SIGTERM'); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', () => { process.stderr.write('Sponge MCP did not start. Follow the setup guide at https://sponge.computer/docs/agents.\n'); process.exitCode = 1; });
    child.once('close', (code, signal) => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); process.exitCode = Number.isInteger(code) && code >= 0 ? code : signal === 'SIGINT' ? 130 : 1; });
  } catch (error) {
    process.stderr.write((error instanceof CommandError ? error.message : 'Sponge MCP did not start. Follow the setup guide at https://sponge.computer/docs/agents.') + '\n');
    process.exitCode = 1;
  }
}
