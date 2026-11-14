import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_BOT } from './authority.mjs';
import { appendPublications, checkLedgerAppendOnly, validateLedger } from './distribution.mjs';
import { validateUpdateFiles } from './github.mjs';
import { raycastFileMode } from './raycast.mjs';

const REPOSITORY = 'hraness/product-skills';
const need = (condition, message) => { if (!condition) throw new Error(message); };
const sha = (value) => { need(typeof value === 'string' && /^[a-f0-9]{40}$/.test(value), 'Invalid generated-update Git identity'); return value; };
const blobHash = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export function mergePendingPublications(pending, desired, baseline) {
  validateLedger(pending); validateLedger(desired); validateLedger(baseline);
  for (const entry of baseline.publications) {
    const old = pending.publications.find((candidate) => candidate.id === entry.id);
    if (old) checkLedgerAppendOnly({ schemaVersion: 1, publications: [entry] }, { schemaVersion: 1, publications: [old] });
  }
  const additions = desired.publications.filter((entry) => {
    const old = pending.publications.find((candidate) => candidate.id === entry.id);
    if (!old) return true;
    need(['product', 'channel', 'version', 'contentHash'].every((key) => entry[key] === old[key]), 'A pending publication id changed artifact identity');
    if (['mcp-registry', 'homebrew'].includes(entry.channel)) checkLedgerAppendOnly({ schemaVersion: 1, publications: [old] }, { schemaVersion: 1, publications: [entry] });
    // The earlier verified record keeps its timestamp and listing address.
    return false;
  });
  const merged = appendPublications(pending, additions); checkLedgerAppendOnly(baseline, merged); return merged;
}

export async function captureGenerated(root, kind, paths) {
  validateUpdateFiles(kind, paths); const output = {};
  for (const path of paths) {
    let target = root; const parts = path.split('/'); let missing = false;
    for (let index = 0; index < parts.length; index++) {
      target = join(target, parts[index]);
      try { const info = await lstat(target); need(!info.isSymbolicLink() && (index === parts.length - 1 ? info.isFile() : info.isDirectory()), 'Generated paths must be regular files'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; missing = true; break; }
    }
    if (missing) output[path] = null;
    else { const bytes = await readFile(target); need(bytes.length <= 512 * 1024, 'Generated refresh file exceeds its limit'); new TextDecoder('utf-8', { fatal: true }).decode(bytes); output[path] = bytes; }
  }
  return output;
}

export async function refreshGeneratedPull({ kind, branch, head, sourceBase, desired, bot, read, write }) {
  sha(head); sha(sourceBase);
  need(new RegExp(`^automation/${kind}-\\d+-\\d+$`).test(branch) && bot.login === APP_BOT && Number.isSafeInteger(bot.id) && bot.id > 0, 'Invalid generated-update owner');
  const paths = Object.keys(desired); validateUpdateFiles(kind, paths);
  need(Object.values(desired).every((bytes) => bytes === null || Buffer.isBuffer(bytes)) && Object.values(desired).reduce((sum, bytes) => sum + (bytes?.length ?? 0), 0) <= 2 * 1024 * 1024, 'Invalid generated refresh contents');
  const prefix = `repos/${REPOSITORY}/`;
  need((await read(`${prefix}git/ref/heads/main`)).object?.sha === sourceBase, 'Protected main changed; regenerate desired files');
  need((await read(`${prefix}git/ref/heads/${branch}`)).object?.sha === head, 'Generated branch changed concurrently');
  const commit = await read(`${prefix}git/commits/${head}`); const baseTree = sha(commit.tree?.sha);
  const mainTree = sha((await read(`${prefix}git/commits/${sourceBase}`)).tree?.sha);
  const tree = await read(`${prefix}git/trees/${baseTree}?recursive=1`);
  need(tree.truncated === false && Array.isArray(tree.tree) && tree.tree.length <= 5000, 'Cannot inspect the complete generated-update tree');
  const entries = new Map(tree.tree.map((entry) => [entry.path, entry])); const updates = [];
  for (const [path, bytes] of Object.entries(desired)) {
    const mode = raycastFileMode(path);
    const old = entries.get(path); need(!old || old.type === 'blob' && (old.mode === '100644' || mode === '100755' && old.mode === mode), 'Generated update includes an unexpected tree entry');
    if (bytes === null) { if (old) updates.push({ path, mode, type: 'blob', sha: null }); continue; }
    const hash = blobHash(bytes); if (old?.sha === hash && old.mode === mode) continue;
    updates.push({ path, mode, type: 'blob', sha: hash, bytes });
  }
  if (!updates.length) return { changed: false, head, matchesMain: baseTree === mainTree };
  for (const update of updates) if (update.bytes) {
    const blob = await write('POST', `${prefix}git/blobs`, { content: update.bytes.toString('base64'), encoding: 'base64' }); need(blob.sha === update.sha, 'Generated blob identity mismatch');
  }
  const nextTree = await write('POST', `${prefix}git/trees`, { base_tree: baseTree, tree: updates.map(({ bytes, ...entry }) => entry) });
  if (nextTree.sha === mainTree) return { changed: false, head, matchesMain: true };
  const nextCommit = await write('POST', `${prefix}git/commits`, { message: kind === 'products' ? 'Refresh checked product files' : kind === 'guides' ? 'Refresh shared writing guides' : 'Preserve verified product publications', tree: sha(nextTree.sha), parents: [head], author: { name: bot.login, email: `${bot.id}+${bot.login}@users.noreply.github.com` } });
  const next = sha(nextCommit.sha);
  need((await read(`${prefix}git/ref/heads/main`)).object?.sha === sourceBase, 'Protected main changed during generated refresh');
  // A single-parent, non-forced update refuses a divergent concurrent writer.
  await write('PATCH', `${prefix}git/refs/heads/${branch}`, { sha: next, force: false });
  need((await read(`${prefix}git/ref/heads/${branch}`)).object?.sha === next, 'Generated branch readback differs');
  return { changed: true, head: next };
}
