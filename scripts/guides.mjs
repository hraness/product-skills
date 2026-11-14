import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GUIDE_FILES = Object.freeze(['DOCUMENTATION_GUIDELINES.md', 'GENERATION_STYLE.md', 'MESSAGING.md', 'README_GUIDELINES.md', 'STYLE.md', 'WRITING.md']);
export const GUIDE_RECORD = 'catalog/guide-source.json';
const repository = 'hraness/.github';
const repositoryId = 1342874802;
const need = (value, message) => { if (!value) throw new Error(message); };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blobHash = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') === [...fields].sort().join('\0');

function text(bytes) {
  need(bytes.length > 0 && bytes.length <= 65536, 'Shared guide exceeds its text limit');
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  need(!value.includes('\0') && !value.includes('\r') && value.endsWith('\n'), 'Shared guides require UTF-8 text and Unix newlines');
  return value;
}

// Only a real Markdown heading starts the local section. A fenced example is
// part of the shared guide, and must not accidentally truncate its contents.
export function repositoryAdditions(value) {
  let fence = null; let offset = 0; let start = null;
  for (const line of value.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*?)(?:\n)?$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    } else if (marker) fence = { character: marker[1][0], length: marker[1].length };
    else if (/^ {0,3}#{1,6}[ \t]+Repository additions(?:[ \t]+#+)?[ \t]*(?:\n)?$/i.test(line)) {
      need(start === null, 'A guide has multiple Repository additions sections'); start = offset;
    }
    offset += line.length;
  }
  need(!fence, 'Shared guides require closed Markdown fences');
  return start === null ? '' : value.slice(start);
}

export function mergeGuide(shared, local) {
  const source = text(Buffer.from(shared)); text(Buffer.from(local));
  need(!repositoryAdditions(source), 'The canonical guide cannot contain repository additions');
  const tail = repositoryAdditions(local);
  return text(Buffer.from(source + (tail ? `${source.endsWith('\n\n') ? '' : '\n'}${tail}` : '')));
}

export function validateGuideRecord(value) {
  need(exact(value, ['schemaVersion', 'repository', 'sourceCommit', 'files']) && value.schemaVersion === 1 && value.repository === repository && /^[a-f0-9]{40}$/.test(value.sourceCommit), 'Invalid shared-guide source record');
  need(exact(value.files, GUIDE_FILES), 'Shared-guide file inventory differs');
  for (const file of GUIDE_FILES) {
    const entry = value.files[file];
    need(exact(entry, ['bytes', 'sha256']) && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= 65536 && /^[a-f0-9]{64}$/.test(entry.sha256), 'Invalid shared-guide file identity');
  }
  return value;
}

async function publicJSON(path) {
  const controller = new AbortController(); const deadline = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`https://api.github.com/${path}`, { redirect: 'error', signal: controller.signal, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' } });
    need(response.status === 200, 'Public shared-guide source is unavailable');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; need(size <= 1024 * 1024, 'Public shared-guide response exceeds its limit'); chunks.push(chunk); }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { clearTimeout(deadline); }
}

export async function fetchGuideSnapshot({ read = publicJSON } = {}) {
  const repo = await read(`repos/${repository}`);
  need(repo.id === repositoryId && repo.full_name === repository && repo.private === false && repo.visibility === 'public' && repo.owner?.id === 307125679 && repo.default_branch === 'main', 'Canonical shared-guide repository identity differs');
  const sourceCommit = (await read(`repos/${repository}/git/ref/heads/main`)).object?.sha;
  need(/^[a-f0-9]{40}$/.test(sourceCommit), 'Invalid canonical guide commit');
  const commit = await read(`repos/${repository}/git/commits/${sourceCommit}`);
  need(commit.sha === sourceCommit && /^[a-f0-9]{40}$/.test(commit.tree?.sha), 'Canonical guide commit differs');
  const tree = await read(`repos/${repository}/git/trees/${commit.tree.sha}?recursive=1`);
  need(tree.truncated === false && Array.isArray(tree.tree) && tree.tree.length <= 5000, 'Canonical guide tree is incomplete');
  const files = {}; const identities = {};
  for (const file of GUIDE_FILES) {
    const entries = tree.tree.filter((entry) => entry.path === file); const entry = entries[0];
    need(entries.length === 1 && entry.type === 'blob' && entry.mode === '100644' && /^[a-f0-9]{40}$/.test(entry.sha) && Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= 65536, 'Canonical guide is not a bounded regular file');
    const blob = await read(`repos/${repository}/git/blobs/${entry.sha}`);
    need(blob.sha === entry.sha && blob.encoding === 'base64' && typeof blob.content === 'string' && blob.content.length <= 100000, 'Canonical guide blob is unavailable');
    const encoded = blob.content.replaceAll('\n', '');
    need(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded), 'Invalid canonical guide encoding');
    const bytes = Buffer.from(encoded, 'base64');
    need(bytes.length === entry.size && blob.size === entry.size && blobHash(bytes) === entry.sha, 'Canonical guide bytes differ from their Git identity');
    files[file] = text(bytes); need(!repositoryAdditions(files[file]), 'The canonical guide cannot contain repository additions');
    identities[file] = { bytes: bytes.length, sha256: digest(bytes) };
  }
  return { record: validateGuideRecord({ schemaVersion: 1, repository, sourceCommit, files: identities }), files };
}

async function regular(root, file) {
  const rootInfo = await lstat(root); need(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'Guide checkout must be a regular directory');
  let path = root;
  const parts = file.split('/');
  for (const [index, part] of parts.entries()) {
    path = join(path, part); const info = await lstat(path);
    need(!info.isSymbolicLink() && (index === parts.length - 1 ? info.isFile() : info.isDirectory()), 'Shared-guide paths must be regular files');
  }
  return path;
}

export async function checkGuides(root) {
  const record = validateGuideRecord(JSON.parse(await readFile(await regular(root, GUIDE_RECORD), 'utf8')));
  for (const file of GUIDE_FILES) {
    const bytes = await readFile(await regular(root, file)); const value = text(bytes); const source = bytes.subarray(0, record.files[file].bytes);
    need(digest(source) === record.files[file].sha256, 'A shared guide differs from its recorded canonical source');
    const sourceText = text(source); const tail = repositoryAdditions(value);
    need(!repositoryAdditions(sourceText) && value === sourceText + (tail ? `${sourceText.endsWith('\n\n') ? '' : '\n'}${tail}` : ''), 'Only Repository additions may follow a shared guide');
  }
  return record;
}

export async function refreshGuides(root, options = {}) {
  // Finish every source read and local merge before changing the checkout.
  const snapshot = await fetchGuideSnapshot(options); const output = {};
  for (const file of GUIDE_FILES) output[file] = mergeGuide(snapshot.files[file], await readFile(await regular(root, file), 'utf8'));
  let previous;
  try { previous = await checkGuides(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && JSON.stringify(previous.files) === JSON.stringify(snapshot.record.files)) snapshot.record = previous;
  for (const [file, value] of Object.entries(output)) await writeFile(join(root, file), value);
  await writeFile(join(root, GUIDE_RECORD), `${JSON.stringify(snapshot.record, null, 2)}\n`);
  return snapshot.record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  (async () => {
    need(process.argv.length === 3 && ['check', 'refresh'].includes(command), 'Use check or refresh');
    await (command === 'check' ? checkGuides(process.cwd()) : refreshGuides(process.cwd()));
    process.stdout.write(command === 'check' ? 'Shared guides match their source; local additions are preserved.\n' : 'Refreshed the selected shared guides.\n');
  })().catch(() => { process.stderr.write('Shared-guide update stopped. The selected public source or local guide structure could not be verified.\n'); process.exitCode = 1; });
}
