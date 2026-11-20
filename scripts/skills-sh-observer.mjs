import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseUnique } from './distribution.mjs';

const earlierIds = ['dawn', 'sponge', 'textmock', 'yaptake'];
export const DIRECTORY_IDS = Object.freeze([...earlierIds, 'oh']);
export const DIRECTORY_FILE = 'catalog/directory-observations.json';
const origin = 'https://www.skills.sh';
const scope = 'listing-presence';
const maxPageBytes = 1024 * 1024;
const need = (value, message) => { if (!value) throw new Error(message); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => object(value) && Object.keys(value).sort().join('\0') === [...fields].sort().join('\0');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validText = (value) => typeof value === 'string' && value.length > 0 && value.length <= 2048 && value.isWellFormed() && !/[\x00-\x1f\x7f]/.test(value);

export function directoryUrl(id) {
  need(DIRECTORY_IDS.includes(id), 'Unknown selected skill');
  return `${origin}/hraness/product-skills/${id}`;
}
export const initialDirectoryObservations = () => ({ schemaVersion: 1, scope, observations: [] });
export function validateDirectoryObservations(value, { now = Date.now } = {}) {
  need(exact(value, ['schemaVersion', 'scope', 'observations']) && value.schemaVersion === 1 && value.scope === scope && Array.isArray(value.observations), 'Invalid directory observations');
  need([0, earlierIds.length, DIRECTORY_IDS.length].includes(value.observations.length), 'Directory observations must contain the selected skills');
  const seen = new Set();
  for (const row of value.observations) {
    need(exact(row, ['product', 'url', 'firstVerifiedAt', 'sourceSkillHash']) && DIRECTORY_IDS.includes(row.product) && !seen.has(row.product), 'Invalid directory observation identity');
    need(row.url === directoryUrl(row.product) && iso(row.firstVerifiedAt) && Date.parse(row.firstVerifiedAt) <= now() && validHash(row.sourceSkillHash), 'Invalid directory address, first verification time or source hash');
    seen.add(row.product);
  }
  if (seen.size) need(earlierIds.every((id) => seen.has(id)), 'An earlier directory observation is missing');
  return value;
}
async function regular(path, directory) {
  const info = await lstat(path);
  need(!info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile()), 'Directory sources and observations must be regular checkout files');
  return info;
}
export async function readDirectoryObservations(root) {
  for (const path of [root, join(root, 'catalog')]) await regular(path, true);
  const path = join(root, DIRECTORY_FILE); const info = await regular(path, false);
  need(info.size > 0 && info.size <= 8192, 'Directory observations exceed their file limit');
  return validateDirectoryObservations(parseUnique(await readFile(path, 'utf8')));
}

// The selected SKILL files use one-line scalar name and description fields.
// Refuse other YAML forms rather than compare the wrong displayed description.
function scalar(raw) {
  raw = raw.trim();
  let value = raw;
  if (raw.startsWith('"')) value = JSON.parse(raw);
  else if (raw.startsWith("'")) { need(/^'(?:[^']|'')*'$/.test(raw), 'Unsupported quoted skill field'); value = raw.slice(1, -1).replaceAll("''", "'"); }
  else need(!/^[\[\]{|>!&*#`]|\s#|:\s/.test(raw) && !/^(?:null|true|false|~|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)$/i.test(raw), 'Unsupported skill scalar');
  need(validText(value), 'Invalid skill field'); return value;
}
function skillFields(source, id) {
  need(source.startsWith('---\n') && source.indexOf('\n---\n', 4) > 0, 'Missing skill frontmatter');
  const header = source.slice(4, source.indexOf('\n---\n', 4)); need(Buffer.byteLength(header) <= 8192, 'Skill frontmatter exceeds its limit');
  const fields = {}; const seen = new Set(); let current;
  for (const line of header.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\s/.test(line)) { need(current && !['name', 'description'].includes(current), 'Unsupported skill identity continuation'); continue; }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/.exec(line);
    need(match, 'Unsupported skill frontmatter key form'); current = match[1];
    need(!seen.has(current), 'Duplicate skill identity field'); seen.add(current);
    if (['name', 'description'].includes(current)) { need(match[2], 'Missing skill identity scalar'); fields[current] = scalar(match[2]); }
  }
  need(fields.name === id && validText(fields.description), 'Skill name or description differs'); return fields;
}
export function sourceSkillIdentity(id, files) {
  directoryUrl(id); need(object(files), 'Missing skill files');
  const paths = Object.keys(files).sort(); need(paths.length >= 1 && paths.length <= 16 && paths.includes('SKILL.md'), 'Invalid skill file set');
  let total = 0; const hashes = [];
  for (const path of paths) {
    need(/^[a-zA-Z0-9._/-]+$/.test(path) && !path.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.')), 'Invalid relative skill file path');
    const bytes = typeof files[path] === 'string' ? Buffer.from(files[path]) : files[path]; need(Buffer.isBuffer(bytes), 'Skill files must be UTF-8 bytes');
    total += bytes.length; need(total <= 65536 && bytes.length > 0, 'Skill source exceeds its limit'); new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    hashes.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
  const fields = skillFields(Buffer.from(files['SKILL.md']).toString('utf8'), id);
  return { name: id, description: fields.description, sourceSkillHash: hash(JSON.stringify(hashes)) };
}
export async function readDirectorySources(root) {
  for (const path of [root, join(root, 'skills')]) await regular(path, true);
  const sources = {};
  for (const id of DIRECTORY_IDS) {
    const base = join(root, 'skills', id); const files = {}; let count = 0;
    async function walk(path, prefix = '', depth = 0) {
      need(depth <= 4 && ++count <= 32, 'Skill directory exceeds its entry limit'); await regular(path, true);
      for (const entry of await readdir(path, { withFileTypes: true })) {
        need(!entry.isSymbolicLink(), 'Skill symlink is not admitted'); const name = prefix + entry.name;
        if (entry.isDirectory()) await walk(join(path, entry.name), name + '/', depth + 1);
        else {
          const file = join(path, entry.name); const info = await regular(file, false); need(info.size > 0 && info.size <= 65536 && Object.keys(files).length < 16, 'Skill file exceeds its limit');
          files[name] = await readFile(file);
        }
      }
    }
    await walk(base); sources[id] = sourceSkillIdentity(id, files);
  }
  return sources;
}

function entity(value) {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);/gi, (_, token) => {
    if (!token.startsWith('#')) return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[token.toLowerCase()];
    const code = /^#x/i.test(token) ? parseInt(token.slice(2), 16) : Number(token.slice(1));
    need(code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff), 'Invalid metadata entity'); return String.fromCodePoint(code);
  });
}
function attributes(raw) {
  const result = {}; let index = 0;
  while (index < raw.length) {
    while (/\s/.test(raw[index] ?? '') && index < raw.length) index++;
    if (index === raw.length || /^\/\s*$/.test(raw.slice(index))) break;
    const name = /^[^\s"'<>/=]+/.exec(raw.slice(index)); need(name, 'Malformed metadata attribute'); index += name[0].length;
    const key = name[0].toLowerCase(); need(!Object.hasOwn(result, key), 'Duplicate metadata attribute');
    while (/\s/.test(raw[index] ?? '') && index < raw.length) index++;
    let value = '';
    if (raw[index] === '=') {
      index++; while (/\s/.test(raw[index] ?? '') && index < raw.length) index++;
      const quote = raw[index];
      if (quote === '"' || quote === "'") { const end = raw.indexOf(quote, ++index); need(end !== -1, 'Unclosed metadata attribute'); value = raw.slice(index, end); index = end + 1; }
      else { const match = /^[^\s"'=<>`]+/.exec(raw.slice(index)); need(match, 'Missing metadata attribute value'); value = match[0]; index += value.length; }
    }
    result[key] = entity(value);
  }
  return result;
}
function structuredMetadata(html) {
  need(typeof html === 'string' && Buffer.byteLength(html) <= maxPageBytes && html.isWellFormed(), 'Invalid or oversized directory page');
  const documents = []; const canonical = []; const inert = []; let index = 0; let jsonBytes = 0;
  const containers = new Set(['template', 'svg', 'math']);
  const rawText = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
  while ((index = html.indexOf('<', index)) !== -1) {
    if (html.startsWith('<!--', index)) { const end = html.indexOf('-->', index + 4); need(end !== -1, 'Unclosed HTML comment'); index = end + 3; continue; }
    if (html.startsWith('<!', index)) { const doctype = /^<!doctype\s+html\s*>/i.exec(html.slice(index)); need(doctype, 'Unsupported HTML declaration'); index += doctype[0].length; continue; }
    need(!html.startsWith('<?', index), 'Unsupported HTML processing instruction');
    const start = /^<\/?([a-z][a-z0-9:-]*)\b/i.exec(html.slice(index)); if (!start) { index++; continue; }
    let end = index + start[0].length; let quote = null;
    for (; end < html.length; end++) { const char = html[end]; if (quote) { if (char === quote) quote = null; } else if (char === '"' || char === "'") quote = char; else if (char === '>') break; }
    need(end < html.length, 'Unclosed HTML tag');
    const name = start[1].toLowerCase(); const closing = html[index + 1] === '/'; const raw = html.slice(index + start[0].length, end); index = end + 1;
    if (containers.has(name)) {
      if (closing) { need(inert.at(-1) === name, 'Malformed inert metadata container'); inert.pop(); }
      else if (name === 'template' || !/\/\s*$/.test(raw)) inert.push(name);
      continue;
    }
    if (closing) continue;
    if (name === 'plaintext') break;
    if (rawText.has(name)) {
      const close = new RegExp(`</${name}\\s*>`, 'ig'); close.lastIndex = index; const match = close.exec(html); need(match, 'Unclosed raw HTML element');
      if (name === 'script' && inert.length === 0) {
        const attrs = attributes(raw);
        if (attrs.type?.trim().toLowerCase() === 'application/ld+json') {
          const json = html.slice(index, match.index); jsonBytes += Buffer.byteLength(json);
          need(jsonBytes <= 131072 && documents.length < 8, 'Structured metadata exceeds its limit'); documents.push(parseUnique(json));
        }
      }
      index = close.lastIndex; continue;
    }
    if (name === 'link' && inert.length === 0) { const attrs = attributes(raw); if (attrs.rel?.toLowerCase().split(/\s+/).includes('canonical')) canonical.push(attrs.href); }
  }
  need(inert.length === 0, 'Unclosed inert metadata container'); return { documents, canonical };
}
export function verifyDirectoryPage(html, source) {
  need(exact(source, ['name', 'description', 'sourceSkillHash']) && validText(source.description) && validHash(source.sourceSkillHash), 'Invalid expected skill identity');
  const url = directoryUrl(source.name); const metadata = structuredMetadata(html); const applications = [];
  function visit(value, context) {
    if (Array.isArray(value)) { for (const entry of value) visit(entry, context); return; }
    if (!object(value)) return;
    const current = value['@context'] ?? context;
    const type = value['@type'];
    if (type === 'SoftwareApplication' || Array.isArray(type) && type.includes('SoftwareApplication')) { need(current === 'https://schema.org', 'Unexpected structured metadata context'); applications.push(value); }
    if (Object.hasOwn(value, '@graph')) visit(value['@graph'], current);
  }
  for (const document of metadata.documents) visit(document);
  need(metadata.canonical.length === 1 && metadata.canonical[0] === url && applications.length === 1, 'Missing, ambiguous or mismatched skill listing metadata');
  const app = applications[0];
  need(app.name === source.name && app.url === url && app.description === source.description && app.publisher?.['@type'] === 'Organization' && app.publisher.name === 'hraness' && app.publisher.url === `${origin}/hraness`, 'Skill listing identity or description differs');
  return { url, name: source.name, description: source.description, publisher: 'hraness' };
}
async function directoryPage(id, fetchImpl) {
  const url = directoryUrl(id);
  const response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20000), headers: { accept: 'text/html' } });
  need(response.status === 200 && !response.redirected && response.url === url && /^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') && response.body, 'The exact public directory page is unavailable');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; need(bytes <= maxPageBytes, 'Directory page exceeds its byte limit'); chunks.push(Buffer.from(chunk)); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
export async function observeDirectories(previous, sources, { fetchImpl = fetch, now = Date.now } = {}) {
  const startedAt = now();
  validateDirectoryObservations(previous, { now: () => startedAt }); need(exact(sources, DIRECTORY_IDS), 'All selected source skills are required');
  for (const id of DIRECTORY_IDS) need(sources[id]?.name === id && exact(sources[id], ['name', 'description', 'sourceSkillHash']) && validText(sources[id].description) && validHash(sources[id].sourceSkillHash), 'Invalid expected skill identity');
  const results = await Promise.allSettled(DIRECTORY_IDS.map(async (id) => verifyDirectoryPage(await directoryPage(id, fetchImpl), sources[id])));
  const pending = DIRECTORY_IDS.filter((_, index) => results[index].status === 'rejected');
  const alreadyObserved = new Set(previous.observations.map((row) => row.product));
  need(pending.every((id) => id === 'oh' && !alreadyObserved.has(id)), 'Not all selected directory listings verified; prior records must be preserved');
  const verified = DIRECTORY_IDS.filter((id) => !pending.includes(id));
  const completedAt = now(); need(Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt, 'Directory check clock moved backward');
  const observedAt = new Date(completedAt).toISOString(); const clock = () => completedAt;
  const observations = verified.map((id) => ({ product: id, url: directoryUrl(id), firstVerifiedAt: previous.observations.find((row) => row.product === id)?.firstVerifiedAt ?? observedAt, sourceSkillHash: sources[id].sourceSkillHash }));
  const next = validateDirectoryObservations({ schemaVersion: 1, scope, observations }, { now: clock });
  const report = { schemaVersion: 1, scope, checkedAt: observedAt, status: pending.length ? 'pending' : 'verified', remoteFileBytesVerified: false, products: verified };
  if (pending.length) report.pendingProducts = pending;
  return { observations: next, changed: !same(previous, next), report };
}
export function mergePendingDirectoryObservations(pending, desired, baseline, options = {}) {
  for (const value of [pending, desired, baseline]) validateDirectoryObservations(value, options);
  for (const original of baseline.observations) {
    for (const value of [pending, desired]) { const row = value.observations.find((entry) => entry.product === original.product); need(row && row.url === original.url && row.firstVerifiedAt === original.firstVerifiedAt, 'An existing first directory verification was changed or removed'); }
  }
  if (!desired.observations.length) { need(!pending.observations.length, 'Pending directory evidence cannot be removed'); return structuredClone(desired); }
  const observations = DIRECTORY_IDS.flatMap((id) => {
    const row = desired.observations.find((entry) => entry.product === id);
    if (!row) return pending.observations.filter((entry) => entry.product === id);
    const previous = pending.observations.find((entry) => entry.product === row.product);
    return { ...row, firstVerifiedAt: previous && previous.firstVerifiedAt < row.firstVerifiedAt ? previous.firstVerifiedAt : row.firstVerifiedAt };
  });
  return validateDirectoryObservations({ schemaVersion: 1, scope, observations }, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2] ?? 'observe'; const root = process.cwd(); const previous = await readDirectoryObservations(root);
  need(['check', 'observe'].includes(command), 'Use check or observe');
  if (command === 'check') process.stdout.write('Directory observation records are valid.\n');
  else process.stdout.write(JSON.stringify(await observeDirectories(previous, await readDirectorySources(root)), null, 2) + '\n');
}
