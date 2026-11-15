import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The Yaptake Mac app ships its MCP server as a signed helper inside the app.
// This launcher runs only that helper, after checking the app's identity,
// version and Developer ID signature. It never downloads or installs anything.
export const YAPTAKE_APP = Object.freeze({ bundleIdentifier: 'com.yapwing.app', helperIdentifier: 'yaptake', team: '8AAP53VTW3', helper: 'Contents/Helpers/yaptake', plist: 'Contents/Info.plist' });
const SETUP = 'Install or update Yaptake from https://yaptake.com, then open it once.';
export class LaunchError extends Error {}
const requireValue = (value, message) => { if (!value) throw new LaunchError(message); };
function release(value) {
  const match = typeof value === 'string' && /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:\.(0|[1-9]\d{0,8}))?$/.exec(value);
  requireValue(match, SETUP); return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}
function atLeast(value, minimum) {
  const current = release(value), required = release(minimum);
  for (let i = 0; i < 3; i++) if (current[i] !== required[i]) return current[i] > required[i];
  return true;
}
function plistString(xml, key) {
  const matches = [...xml.matchAll(new RegExp(`<key>${key}</key>\\s*<string>([^<]{1,200})</string>`, 'g'))];
  requireValue(matches.length === 1, SETUP); return matches[0][1];
}
export function readRequirements(path = new URL('./requirements.json', import.meta.url)) {
  const info = lstatSync(path);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.size <= 4096, 'Yaptake bundle metadata is unavailable.');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  requireValue(value?.schemaVersion === 1 && value.command === 'yaptake' && value.homepage === 'https://yaptake.com' && typeof value.build === 'string' && /^[1-9]\d{0,8}$/.test(value.build), 'Yaptake bundle metadata is invalid.');
  release(value.version); return value;
}
export const appCandidates = (home = homedir()) => ['/Applications/Yaptake.app', join(home, 'Applications/Yaptake.app')];
function signed(run, path, identifier) {
  const requirement = `anchor apple generic and identifier "${identifier}" and certificate leaf[subject.OU] = "${YAPTAKE_APP.team}"`;
  const result = run('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirement}`, path], { encoding: 'utf8', input: '', timeout: 30000, maxBuffer: 64 * 1024 });
  return !result.error && result.status === 0;
}
export function verifiedYaptakeHelper(requirements, { candidates = appCandidates(), run = spawnSync, platform = process.platform } = {}) {
  requireValue(platform === 'darwin', 'Yaptake runs on a Mac with Apple silicon.');
  let app;
  for (const candidate of candidates) { try { const info = lstatSync(candidate); requireValue(info.isDirectory() && !info.isSymbolicLink(), SETUP); app = candidate; break; } catch (error) { if (error instanceof LaunchError) throw error; } }
  requireValue(app, SETUP);
  const helper = join(app, YAPTAKE_APP.helper), plist = join(app, YAPTAKE_APP.plist);
  let xml;
  try {
    const helperInfo = lstatSync(helper); requireValue(helperInfo.isFile() && !helperInfo.isSymbolicLink(), SETUP); accessSync(helper, constants.X_OK);
    const plistInfo = lstatSync(plist); requireValue(plistInfo.isFile() && !plistInfo.isSymbolicLink() && plistInfo.size <= 256 * 1024, SETUP);
    xml = readFileSync(plist, 'utf8');
  } catch (error) { if (error instanceof LaunchError) throw error; throw new LaunchError(SETUP); }
  requireValue(xml.startsWith('<?xml') && !/<!ENTITY/i.test(xml), SETUP);
  requireValue(plistString(xml, 'CFBundleIdentifier') === YAPTAKE_APP.bundleIdentifier, 'This is not the Yaptake app from https://yaptake.com.');
  const version = plistString(xml, 'CFBundleShortVersionString'), build = plistString(xml, 'CFBundleVersion');
  requireValue(/^[1-9]\d{0,8}$/.test(build) && atLeast(version, requirements.version) && BigInt(build) >= BigInt(requirements.build), `Update Yaptake to ${requirements.version} (build ${requirements.build}) or newer from https://yaptake.com.`);
  requireValue(signed(run, app, YAPTAKE_APP.bundleIdentifier) && signed(run, helper, YAPTAKE_APP.helperIdentifier), 'Yaptake is damaged or not signed by its developer. Reinstall it from https://yaptake.com.');
  return { app, helper, version, build };
}
export function startYaptakeMcp({ env = process.env, run = spawnSync, launch = spawn, requirements = readRequirements(), candidates, platform } = {}) {
  const { helper } = verifiedYaptakeHelper(requirements, { run, candidates, platform });
  return launch(helper, ['mcp'], { env, stdio: 'inherit' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireValue(process.argv.length === 2, 'Start this server through its MCP bundle.');
    const child = startYaptakeMcp();
    const interrupt = () => { child.kill('SIGINT'); };
    const terminate = () => { child.kill('SIGTERM'); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', () => { process.stderr.write(`Yaptake MCP did not start. ${SETUP}\n`); process.exitCode = 1; });
    child.once('close', (code, signal) => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); process.exitCode = Number.isInteger(code) && code >= 0 ? code : signal === 'SIGINT' ? 130 : 1; });
  } catch (error) {
    process.stderr.write((error instanceof LaunchError ? error.message : `Yaptake MCP did not start. ${SETUP}`) + '\n');
    process.exitCode = 1;
  }
}
