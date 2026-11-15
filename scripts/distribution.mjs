import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { raycastFileMode, raycastPath, renderRaycast } from './raycast.mjs';
import { agentInstallInstructions, fetchListingIcon, listingIconBytes, listingIconPath, listingInterface, validateListingPNG } from './listing.mjs';
import { renderSpongeSupport, spongeClaudeServer, spongePortableServer } from './sponge.mjs';

export const PRODUCTS = Object.freeze({ dawn: { name: 'Dawn', url: 'https://dawnav.com' }, yaptake: { name: 'Yaptake', url: 'https://yaptake.com' }, textmock: { name: 'Textmock', url: 'https://textmock.com' }, sponge: { name: 'Sponge', url: 'https://sponge.computer' } });
export const MCP_REGISTRY = Object.freeze({ origin: 'https://registry.modelcontextprotocol.io', name: 'io.github.hraness/sponge', product: 'sponge' });
export const HOMEBREW_TAP = Object.freeze({ repository: 'hraness/homebrew-tap', repositoryId: 1382935233, ownerId: 307125679, product: 'yaptake', cask: 'Casks/yaptake.rb', catalog: 'catalog/yaptake.json', cursor: 'catalog/homebrew-observation.json' });
export const REPOSITORY = 'https://github.com/hraness/product-skills';
export const MAX_BUNDLE = 65536;
const TEXTMOCK_HELPER = 'scripts/textmock-link.mjs';
const DAWN_EXAMPLE = 'skills/dawn/examples/morning-study.ts';
const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const need = (v, message) => { if (!v) throw new Error(message); };
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
export const digest = (v) => createHash('sha256').update(v).digest('hex');
const canonical = (v) => JSON.stringify(Array.isArray(v) ? v.map((x) => JSON.parse(canonical(x))) : object(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, JSON.parse(canonical(v[k]))])) : v);
const keys = (v, required, optional = []) => { need(object(v) && required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => [...required, ...optional].includes(k)), 'Unexpected or missing field'); };
const text = (v, limit = 300) => need(typeof v === 'string' && v.length > 0 && v.length <= limit && v.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v), 'Invalid text');
export function parseUnique(raw) {
  let i = 0;
  const space = () => { while (/\s/.test(raw[i] ?? '') && i < raw.length) i++; };
  function string() { const start = i++; for (; i < raw.length; i++) { if (raw[i] === '\\') i++; else if (raw[i] === '"') { i++; return JSON.parse(raw.slice(start, i)); } } throw new Error('Unclosed JSON string'); }
  function value(depth = 0) {
    need(depth < 32, 'JSON nesting exceeds limit'); space();
    if (raw[i] === '"') return string();
    if (raw[i] === '{') { i++; space(); const seen = new Set(); if (raw[i] === '}') { i++; return; } while (i < raw.length) { space(); need(raw[i] === '"', 'Invalid JSON key'); const key = string(); need(!seen.has(key), 'Duplicate JSON key'); seen.add(key); space(); need(raw[i++] === ':', 'Invalid JSON object'); value(depth + 1); space(); const next = raw[i++]; if (next === '}') return; need(next === ',', 'Invalid JSON separator'); } }
    else if (raw[i] === '[') { i++; space(); if (raw[i] === ']') { i++; return; } while (i < raw.length) { value(depth + 1); space(); const next = raw[i++]; if (next === ']') return; need(next === ',', 'Invalid JSON array'); } }
    else { const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(i)); need(token, 'Invalid JSON value'); i += token[0].length; return; }
    throw new Error('Unclosed JSON value');
  }
  value(); space(); need(i === raw.length, 'Trailing JSON data'); return JSON.parse(raw);
}
export function version(v) { need(typeof v === 'string' && /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(v), 'An exact release version is required'); return v.split('.').map(Number); }
export function compareVersion(a, b) { const av = version(a); const bv = version(b); for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1; return 0; }
export function mcpRegistryPublicationId(value) { version(value); return `sponge-mcp-registry-${value.replaceAll('.', '-')}`; }
export function mcpRegistryPublicationUrl(value) { version(value); return `${MCP_REGISTRY.origin}/v0.1/servers/${encodeURIComponent(MCP_REGISTRY.name)}/versions/${value}`; }
export function homebrewPublicationId(value, build) { version(value); need(typeof build === 'string' && /^[1-9]\d{0,8}$/.test(build), 'An exact Homebrew build is required'); return `yaptake-homebrew-${value.replaceAll('.', '-')}-${build}`; }
export function homebrewPublicationUrl(commit) { need(/^[a-f0-9]{40}$/.test(commit), 'An exact Homebrew publication commit is required'); return `https://github.com/${HOMEBREW_TAP.repository}/blob/${commit}/${HOMEBREW_TAP.cask}`; }
function publicUrl(value, allowedOrigins) {
  need(typeof value === 'string' && value.length <= 500, 'Invalid URL');
  const u = new URL(value);
  const productOrigin = Object.values(PRODUCTS).some((p) => p.url === u.origin);
  need(u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.search && allowedOrigins.includes(u.origin) && !(productOrigin && (u.pathname.includes('%') || /\/(?:api|account|library|s|@[^/]+)(?:\/|$)/.test(u.pathname))), 'URL is outside the public allowlist');
  return u;
}
function inspectText(value, id, member = null) {
  text(value, MAX_BUNDLE);
  need(!/(?:\/Users\/|\/home\/|[A-Z]:\\|\b(?:file|ssh|javascript|data):\S|gh[pousr]_[A-Za-z0-9]{20}|sourceCommit|submissionId|PRIVATE KEY|github\.com\/hraness\/(?:yaptake|sponge|dawn|textmock)(?:[\s/).]|$))/.test(value), 'Private source or credential material is not admitted');
  for (const match of value.matchAll(/https?:\/\/[^\s<>\)\]`"']+/g)) {
    const url = match[0].replace(/[.,;]$/, '');
    // The selected encoder constructs a link at runtime; it contains no share payload.
    const helperTemplate = id === 'textmock' && member === TEXTMOCK_HELPER && url === 'https://textmock.com/s#${fragment}';
    publicUrl(helperTemplate ? PRODUCTS.textmock.url : url, [PRODUCTS[id].url, 'https://hraness.com', 'https://www.npmjs.com', 'https://registry.npmjs.org', 'https://skills.sh', 'https://www.skills.sh', 'https://agentskills.io', 'https://agent-plugins.org']);
  }
}
export function validateBundle(input, id) {
  need(Object.hasOwn(PRODUCTS, id), 'Unknown product');
  const raw = typeof input === 'string' ? input : json(input);
  need(Buffer.byteLength(raw) <= MAX_BUNDLE, 'Bundle exceeds 64 KiB');
  const bundle = typeof input === 'string' ? parseUnique(input) : input;
  keys(bundle, ['schemaVersion', 'manifest', 'files']); need(bundle.schemaVersion === 1, 'Unsupported bundle schema');
  const m = bundle.manifest;
  keys(m, ['schemaVersion', 'product', 'runtime', 'license'], ['mcp']); need(m.schemaVersion === 1 && m.license === 'MIT', 'Unsupported manifest or license');
  keys(m.product, ['id', 'name', 'url', 'description', 'agentGuideUrl']);
  need(m.product.id === id && m.product.name === PRODUCTS[id].name && m.product.url === PRODUCTS[id].url, 'Product identity mismatch');
  text(m.product.description, 300); need(!/[\r\n]/.test(m.product.description), 'Product description must be one line'); inspectText(m.product.description, id);
  const guide = publicUrl(m.product.agentGuideUrl, [PRODUCTS[id].url]); need(guide.pathname.startsWith('/docs/') && !guide.hash, 'A public product agent guide is required');
  const r = m.runtime; keys(r, ['command', 'version', 'install'], ['node', 'bun', 'build', 'platform', 'versionScope', 'helper']);
  need(r.command === (id === 'textmock' ? 'textmock-link' : id), 'Runtime command mismatch'); version(r.version);
  if (r.install.type === 'npm') {
    keys(r.install, ['type', 'package', 'version']); need(id === 'sponge' && r.install.package === '@hraness/sponge' && r.install.version === r.version && r.build === undefined && r.platform === undefined && r.bun === undefined && r.versionScope === undefined && r.helper === undefined, 'npm runtime mismatch');
    need(typeof r.node === 'string' && /^>=\d+\.\d+\.\d+$/.test(r.node), 'Exact minimum Node version is required');
  } else if (r.install.type === 'app') {
    keys(r.install, ['type', 'url']); need(id === 'yaptake' && r.install.url === PRODUCTS[id].url && r.node === undefined && r.bun === undefined && r.versionScope === undefined && r.helper === undefined && typeof r.build === 'string' && /^[1-9]\d{0,8}$/.test(r.build), 'App runtime mismatch');
    keys(r.platform, ['os', 'architecture', 'minimumVersion']); need(r.platform.os === 'macos' && r.platform.architecture === 'arm64' && /^\d+\.\d+(?:\.\d+)?$/.test(r.platform.minimumVersion), 'Unsupported app platform');
  } else if (r.install.type === 'web') {
    keys(r.install, ['type', 'url']); keys(r.helper, ['path', 'node']);
    need(id === 'textmock' && r.install.url === PRODUCTS.textmock.url && r.versionScope === 'helper' && r.helper.path === TEXTMOCK_HELPER && r.helper.node === '>=24.0.0' && r.node === undefined && r.bun === undefined && r.build === undefined && r.platform === undefined, 'Web helper mismatch');
  } else {
    keys(r.install, ['type', 'url', 'requiresAccess']);
    need(id === 'dawn' && r.install.type === 'private-release' && r.install.url === 'https://dawnav.com/install' && r.install.requiresAccess === true && /^>=\d+\.\d+\.\d+$/.test(r.bun) && r.node === undefined && r.build === undefined && r.platform === undefined && r.versionScope === undefined && r.helper === undefined, 'Private preview runtime mismatch');
  }
  if (m.mcp !== undefined) { keys(m.mcp, ['command', 'args']); need(['sponge', 'yaptake'].includes(id) && m.mcp.command === id && Array.isArray(m.mcp.args) && m.mcp.args.length === 1 && m.mcp.args[0] === 'mcp', 'MCP command mismatch'); }
  const skillPath = `skills/${id}/SKILL.md`;
  keys(bundle.files, [skillPath, 'LICENSE', 'README.md', ...(id === 'textmock' ? [TEXTMOCK_HELPER] : id === 'dawn' ? [DAWN_EXAMPLE] : [])]);
  if (id === 'textmock') need(Buffer.byteLength(bundle.files[TEXTMOCK_HELPER]) <= 16384, 'Textmock helper exceeds 16 KiB');
  if (id === 'dawn') need(Buffer.byteLength(bundle.files[DAWN_EXAMPLE]) <= 4096, 'Dawn example exceeds 4 KiB');
  for (const [member, value] of Object.entries(bundle.files)) inspectText(value, id, member);
  const skill = bundle.files[skillPath];
  need(skill.startsWith('---\n') && new RegExp(`(?:^|\\n)name: ${id}\\n`).test(skill) && /\ndescription: [^\n]+(?:\n|$)/.test(skill.split('\n---\n')[0]) && skill.includes(m.product.agentGuideUrl), 'Skill frontmatter or guide mismatch');
  need(bundle.files['README.md'].split(/\s+/).length >= 40 && bundle.files['README.md'].includes(m.product.url) && bundle.files['README.md'].includes(m.product.agentGuideUrl), 'README needs setup and a product guide');
  need(bundle.files.LICENSE.includes('MIT License') && bundle.files.LICENSE.includes('Permission is hereby granted') && bundle.files.LICENSE.includes('THE SOFTWARE IS PROVIDED "AS IS"'), 'MIT text is missing');
  return bundle;
}
export function validatePortfolio(portfolio) {
  keys(portfolio, ['schemaVersion', 'projects']); need(portfolio.schemaVersion === 1 && Array.isArray(portfolio.projects) && portfolio.projects.length === 4, 'Invalid portfolio');
  const seen = new Set();
  for (const p of portfolio.projects) { keys(p, ['id', 'name', 'url', 'short', 'icon']); need(Object.hasOwn(PRODUCTS, p.id) && !seen.has(p.id) && p.name === PRODUCTS[p.id].name && p.url === PRODUCTS[p.id].url && p.icon === `/products/${p.id}/icon.png`, 'Portfolio identity mismatch'); text(p.short, 100); need(!/[\r\n]/.test(p.short), 'Product summary must be one line'); inspectText(p.short, p.id); seen.add(p.id); }
  return portfolio;
}
export async function download(url, { fetchImpl = fetch, etag, limit = MAX_BUNDLE, token } = {}) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { accept: 'application/json', ...(etag ? { 'if-none-match': etag } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (response.status === 304) return { unchanged: true };
  need(response.ok, `HTTP ${response.status}`);
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; need(length <= limit, 'Response exceeds size limit'); chunks.push(Buffer.from(chunk)); }
  const tag = response.headers.get('etag');
  return { body: Buffer.concat(chunks).toString('utf8'), etag: tag && tag.length <= 256 && !/[\r\n]/.test(tag) ? tag : null };
}
function xmlValue(xml, tag) { const matches = [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))]; need(matches.length === 1, `Missing or duplicate ${tag}`); return matches[0][1].trim(); }
function attrs(tag) { const result = {}; for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) { need(!Object.hasOwn(result, m[1]), 'Duplicate XML attribute'); result[m[1]] = m[2].replaceAll('&amp;', '&').replaceAll('&quot;', '"'); } return result; }
export function verifyApp(bundle, release, feed) {
  const r = bundle.manifest.runtime;
  need(release?.schemaVersion === 1 && object(release.release), 'No admitted app release');
  const live = release.release;
  need(live.version === r.version && live.architecture === r.platform.architecture && live.minimumMacOS === r.platform.minimumVersion && /^[a-f0-9]{64}$/.test(live.sha256), 'App release does not match the source bundle');
  const u = publicUrl(live.url, [bundle.manifest.product.url]); need(u.pathname.startsWith(`/downloads/${live.sha256}/`) && u.pathname.endsWith('.zip'), 'App archive identity mismatch');
  need(live.notarization?.status?.toLowerCase() === 'accepted' && live.notarization.stapleValidated === true && live.notarization.gatekeeperAccepted === true, 'App release is not admitted');
  need(typeof feed === 'string' && Buffer.byteLength(feed) <= 262144 && !/<!DOCTYPE|<!ENTITY/i.test(feed), 'Unsupported appcast');
  const item = /<item\b[^>]*>([\s\S]*?)<\/item>/.exec(feed)?.[1]; need(item, 'No appcast item');
  need(xmlValue(item, 'sparkle:version') === r.build && xmlValue(item, 'sparkle:shortVersionString') === r.version && xmlValue(item, 'sparkle:minimumSystemVersion') === r.platform.minimumVersion && xmlValue(item, 'sparkle:hardwareRequirements') === r.platform.architecture, 'Appcast runtime mismatch');
  const enclosure = [...item.matchAll(/<enclosure\b([^>]+)\/?\s*>/g)]; need(enclosure.length === 1, 'Missing or duplicate enclosure'); const a = attrs(enclosure[0][1]);
  need(a.url === live.url && a.length === String(live.sparkle?.length) && a['sparkle:edSignature'] === live.sparkle?.edSignature && /^[1-9]\d*$/.test(a.length) && typeof a['sparkle:edSignature'] === 'string' && a['sparkle:edSignature'].length >= 80, 'Appcast archive or signature mismatch');
  return { type: 'app', sha256: live.sha256, metadataHash: digest(canonical(release)), feedHash: digest(feed) };
}
export async function qualify(bundle, { fetchImpl = fetch } = {}) {
  const { runtime, product } = bundle.manifest;
  // Guide availability is checked only when the source bundle changes.
  const guide = await download(product.agentGuideUrl, { fetchImpl, limit: 512000 }); need(guide.body.includes(product.name), 'Product guide is unavailable');
  if (runtime.install.type === 'npm') {
    const result = await download(`https://registry.npmjs.org/${encodeURIComponent(runtime.install.package)}/${runtime.version}`, { fetchImpl, limit: 262144 });
    const metadata = JSON.parse(result.body);
    need(metadata.name === runtime.install.package && metadata.version === runtime.version && typeof metadata.dist?.integrity === 'string' && /^sha512-[A-Za-z0-9+/=]+$/.test(metadata.dist.integrity) && metadata.bin && (typeof metadata.bin === 'string' || typeof metadata.bin[runtime.command] === 'string'), 'Exact npm release is unavailable or mismatched');
    const node = /^>=(\d+)\.(\d+)(?:\.(\d+))?$/.exec(metadata.engines?.node ?? ''); need(node && `>=${node[1]}.${node[2]}.${node[3] ?? '0'}` === runtime.node, 'npm engine requirement differs from the skill');
    publicUrl(metadata.dist.tarball, ['https://registry.npmjs.org']);
    return { type: 'npm', package: metadata.name, version: metadata.version, integrity: metadata.dist.integrity };
  }
  if (runtime.install.type === 'web') {
    const helper = await download(`${product.url}/integrations/textmock-link.mjs`, { fetchImpl, limit: 16384 });
    need(helper.body === bundle.files[TEXTMOCK_HELPER], 'Public Textmock helper differs from the selected file');
    return { type: 'web', version: runtime.version, helperHash: digest(helper.body), node: runtime.helper.node };
  }
  if (runtime.install.type === 'private-release') {
    const install = await download(runtime.install.url, { fetchImpl, limit: 512000 }); need(install.body.toLowerCase().includes(product.name.toLowerCase()), 'Private preview setup guide is unavailable');
    return { type: 'private-release', version: runtime.version, bun: runtime.bun, requiresAccess: true, scope: 'selected-files-only', guideHash: digest(guide.body), installPageHash: digest(install.body) };
  }
  const [release, feed] = await Promise.all([download(`${product.url}/release.json`, { fetchImpl, limit: 262144 }), download(`${product.url}/appcast.xml`, { fetchImpl, limit: 262144 })]);
  return verifyApp(bundle, JSON.parse(release.body), feed.body);
}
function stateCheck(state) {
  keys(state, ['schemaVersion', 'products']); need(state.schemaVersion === 1 && object(state.products), 'Invalid admitted catalog');
  for (const [id, entry] of Object.entries(state.products)) {
    need(Object.hasOwn(PRODUCTS, id), 'Unknown admitted product');
    keys(entry, ['contentHash', 'sourceHash', 'revision', 'runtimeVersion', 'runtimeBuild', 'etag', 'qualification'], ['packageFingerprint', 'integrationFormat', 'presentationHash', 'listingIcon']);
    need(/^[a-f0-9]{64}$/.test(entry.contentHash) && /^[a-f0-9]{64}$/.test(entry.sourceHash) && Number.isSafeInteger(entry.revision) && entry.revision >= 1 && entry.revision <= 1000000 && (entry.etag === null || (typeof entry.etag === 'string' && entry.etag.length <= 256 && !/[\r\n]/.test(entry.etag))) && (entry.runtimeBuild === null || (typeof entry.runtimeBuild === 'string' && /^[1-9]\d{0,8}$/.test(entry.runtimeBuild))), 'Invalid admitted identity');
    need(entry.packageFingerprint === undefined || /^[a-f0-9]{64}$/.test(entry.packageFingerprint), 'Invalid rendered package identity');
    // Legacy fields remain readable until the next successful reconciliation.
    need(entry.integrationFormat === undefined || (Number.isSafeInteger(entry.integrationFormat) && entry.integrationFormat >= 1 && entry.integrationFormat <= 1000000), 'Unsupported legacy integration format');
    need(entry.presentationHash === undefined || /^[a-f0-9]{64}$/.test(entry.presentationHash), 'Invalid product presentation identity');
    if (entry.listingIcon !== undefined) listingIconBytes(entry.listingIcon, id);
    version(entry.runtimeVersion); const q = entry.qualification;
    if (q?.type === 'npm') { keys(q, ['type', 'package', 'version', 'integrity']); need(q.package === `@hraness/${id}` && q.version === entry.runtimeVersion && entry.runtimeBuild === null && /^sha512-[A-Za-z0-9+/=]+$/.test(q.integrity), 'Invalid npm qualification'); }
    else if (q?.type === 'app') { keys(q, ['type', 'sha256', 'metadataHash', 'feedHash']); need(id === 'yaptake' && entry.runtimeBuild !== null && ['sha256', 'metadataHash', 'feedHash'].every((key) => /^[a-f0-9]{64}$/.test(q[key])), 'Invalid app qualification'); }
    else if (q?.type === 'web') { keys(q, ['type', 'version', 'helperHash', 'node']); need(id === 'textmock' && entry.runtimeBuild === null && q.version === entry.runtimeVersion && /^[a-f0-9]{64}$/.test(q.helperHash) && q.node === '>=24.0.0', 'Invalid web helper qualification'); }
    else { keys(q, ['type', 'version', 'bun', 'requiresAccess', 'scope', 'guideHash', 'installPageHash']); need(id === 'dawn' && q.type === 'private-release' && q.version === entry.runtimeVersion && entry.runtimeBuild === null && /^>=\d+\.\d+\.\d+$/.test(q.bun) && q.requiresAccess === true && q.scope === 'selected-files-only' && ['guideHash', 'installPageHash'].every((key) => /^[a-f0-9]{64}$/.test(q[key])), 'Invalid private preview source qualification'); }
  }
  return state;
}
export async function reconcile({ state, bundles, portfolio, selected, fetchImpl = fetch, renderer = render, archive = zip }) {
  stateCheck(state); validatePortfolio(portfolio); need(Array.isArray(selected) && new Set(selected).size === selected.length && selected.every((id) => Object.hasOwn(PRODUCTS, id)), 'Invalid selected products');
  const nextState = structuredClone(state); const nextBundles = structuredClone(bundles); const outcomes = [];
  for (const id of selected) {
    try {
      const previous = state.products[id]; const source = `${PRODUCTS[id].url}/integrations/${id}.json`;
      const response = await download(source, { fetchImpl, etag: previous?.etag });
      let bundle, candidate;
      if (response.unchanged) {
        need(previous && bundles[id], '304 without an admitted source');
        bundle = validateBundle(bundles[id], id); candidate = { ...previous };
      } else {
        bundle = validateBundle(response.body, id); const contentHash = digest(canonical(bundle)); const runtime = bundle.manifest.runtime;
        if (previous && (compareVersion(runtime.version, previous.runtimeVersion) < 0 || (runtime.build && BigInt(runtime.build) < BigInt(previous.runtimeBuild ?? '0')))) throw new Error('Runtime rollback refused');
        const qualification = previous?.contentHash === contentHash ? previous.qualification : await qualify(bundle, { fetchImpl });
        candidate = { contentHash, sourceHash: digest(response.body), revision: previous?.revision ?? 1, runtimeVersion: runtime.version, runtimeBuild: runtime.build ?? null, etag: response.etag, qualification };
      }
      candidate.listingIcon = await fetchListingIcon(portfolio.projects.find((project) => project.id === id), { previous: previous?.listingIcon, fetchImpl });
      delete candidate.integrationFormat; delete candidate.presentationHash;
      const fingerprint = renderedPackageFingerprint(id, candidate, bundle, portfolio, { renderer, archive });
      if (previous?.packageFingerprint === fingerprint) { outcomes.push({ id, status: 'unchanged' }); continue; }
      need(!previous || previous.revision < 1000000, 'Integration revision limit reached');
      nextState.products[id] = { ...candidate, revision: (previous?.revision ?? 0) + 1, packageFingerprint: fingerprint };
      nextBundles[id] = bundle; outcomes.push({ id, status: 'updated' });
    } catch { outcomes.push({ id, status: 'pending', reason: 'Source, documentation, listing icon or released runtime did not qualify; the admitted package was preserved.' }); }
  }
  return { state: nextState, bundles: nextBundles, outcomes, changed: outcomes.some((r) => r.status === 'updated') };
}
function pluginVersion(entry) { return `0.1.${entry.revision - 1}`; }
export function render(state, bundles, portfolio, ledger = { schemaVersion: 1, publications: [] }) {
  stateCheck(state); validatePortfolio(portfolio); validateLedger(ledger); const output = {};
  const ids = Object.keys(state.products).sort();
  const openai = []; const claude = []; const cursor = [];
  for (const id of ids) {
    const bundle = validateBundle(bundles[id], id); const e = state.products[id]; need(digest(canonical(bundle)) === e.contentHash, 'Admitted source hash mismatch');
    const m = bundle.manifest; need(m.runtime.version === e.runtimeVersion && (m.runtime.build ?? null) === e.runtimeBuild && m.runtime.install.type === e.qualification.type, 'Admitted runtime identity mismatch'); const version = pluginVersion(e); const base = `plugins/${id}`;
    for (const [path, value] of Object.entries(bundle.files)) output[`${base}/${path}`] = value;
    output[`${base}/README.md`] = bundle.files['README.md'].trimEnd() + '\n\n' + agentInstallInstructions(id);
    if (e.listingIcon) output[`${base}/assets/icon.png`] = listingIconBytes(e.listingIcon, id);
    for (const [path, value] of Object.entries(bundle.files)) if (path.startsWith(`skills/${id}/`)) output[path] = value;
    if (id === 'textmock') for (const prefix of ['', `${base}/`]) output[`${prefix}skills/textmock/scripts/textmock-link.mjs`] = bundle.files[TEXTMOCK_HELPER];
    if (id === 'sponge') {
      for (const [path, value] of Object.entries(renderSpongeSupport(m))) output[`${base}/${path}`] = value;
      for (const [path, value] of Object.entries(renderRaycast(m, '../../README.md'))) output[base + '/adapters/raycast/' + path] = value;
      for (const [path, value] of Object.entries(renderRaycast(m, '../../plugins/sponge/README.md'))) output['adapters/raycast/' + path] = value;
    }
    const common = { name: id, version, description: m.product.description, author: { name: 'Hraness', url: 'https://hraness.com' }, homepage: m.product.agentGuideUrl, repository: REPOSITORY, license: 'MIT' };
    const oa = { requires_local_executor: true, interface: listingInterface(m, portfolio.projects.find((p) => p.id === id), Boolean(e.listingIcon)) };
    output[`${base}/plugin.json`] = json({ $schema: PLUGIN_SCHEMA, ...common, extensions: { 'com.openai': oa } });
    output[`${base}/.codex-plugin/plugin.json`] = json({ ...common, skills: './skills/', ...oa, ...(m.mcp ? { mcpServers: id === 'sponge' ? './mcp.codex.json' : './.mcp.json' } : {}) });
    output[`${base}/.claude-plugin/plugin.json`] = json({ ...common, displayName: m.product.name, skills: './skills/', ...(e.listingIcon ? { icon: './assets/icon.png' } : {}) });
    output[`${base}/.cursor-plugin/plugin.json`] = json({ ...common, skills: './skills/', ...(e.listingIcon ? { logo: './assets/icon.png' } : {}), ...(m.mcp ? { mcpServers: './.mcp.json' } : {}) });
    if (m.mcp) {
      const servers = { [id]: id === 'sponge' ? spongePortableServer() : { type: 'stdio', command: m.mcp.command, args: m.mcp.args } };
      output[`${base}/mcp.json`] = json({ $schema: MCP_SCHEMA, mcpServers: servers });
      output[`${base}/.mcp.json`] = json({ mcpServers: id === 'sponge' ? { sponge: spongeClaudeServer() } : servers });
      if (id === 'sponge') output[`${base}/mcp.codex.json`] = json({ mcpServers: servers });
    }
    output[`${base}/runtime.json`] = json(m.runtime);
    openai.push({ name: id, source: { source: 'local', path: `./${base}` }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' });
    claude.push({ name: id, source: `./${base}`, description: common.description, version }); cursor.push({ name: id, source: `./${base}` });
  }
  output['.agents/plugins/marketplace.json'] = json({ name: 'hraness-products', interface: { displayName: 'Hraness products' }, plugins: openai });
  output['.claude-plugin/marketplace.json'] = json({ name: 'hraness-products', owner: { name: 'Hraness' }, plugins: claude });
  output['.cursor-plugin/marketplace.json'] = json({ name: 'hraness-products', owner: { name: 'Hraness' }, plugins: cursor });
  output['catalog/store-status.json'] = json({ schemaVersion: 1, products: Object.fromEntries(ids.map((id) => {
    const version = pluginVersion(state.products[id]); const prefix = `plugins/${id}/`;
    const artifactHash = digest(zip(Object.fromEntries(Object.entries(output).filter(([p]) => p.startsWith(prefix)).map(([p, value]) => [p.slice(prefix.length), value]))));
    const published = (channel) => ledger.publications.some((p) => p.product === id && p.channel === channel && p.version === version && p.contentHash === artifactHash);
    return [id, { version, contentHash: state.products[id].contentHash, artifactHash, github: published('github') ? 'published' : 'release_required', skillsSh: published('skills-sh') ? 'published' : 'public_install_required', chatgpt: published('chatgpt') ? 'published' : bundles[id].manifest.mcp ? 'eligibility_and_review_required' : 'review_required', claude: published('claude') ? 'published' : 'review_required', cursor: published('cursor') ? 'published' : 'review_required' }];
  })) });
  output['README.md'] = `# Hraness product skills\n\nSkills for working with [Hraness](https://hraness.com) products from a coding agent. Each package explains its workflow, setup and first task.\n\n${ids.length ? '## Product packages\n\n' + ids.map((id) => `- [${PRODUCTS[id].name}](plugins/${id}/README.md): ${portfolio.projects.find((p) => p.id === id).short}`).join('\n') + '\n\nRead the product package for its app, command and access requirements.\n\n```sh\nnpx skills add hraness/product-skills\n```\n\nChoose the product skill during installation, then follow its setup and first task. ' : 'Product packages are being prepared. ' }${ids.includes('sponge') ? "Use Sponge's [Raycast commands](adapters/raycast/README.md) to queue URLs and search saved text.\n\n" : ''}A package available here may still be awaiting directory review or host testing. See [package status](catalog/store-status.json) and [verified publications](publication-ledger.json).\n\n## Product pages\n\n${portfolio.projects.map((p) => `- [${p.name}](${p.url}): ${p.short}`).join('\n')}\n\n## Check a package\n\nUse Node.js 24. Run \`npm run check\` to validate sources, generated copies and package metadata. \`npm run package\` writes deterministic plugin ZIPs and \`SHA256SUMS\` under \`dist/\`. The package license covers these skills and integration files; product applications have their own terms.\n\n[Maintain packages](docs/MAINTAINING.md) · [Prepare a directory submission](docs/DIRECTORY_SUBMISSIONS.md) · [MIT license](LICENSE)\n`;
  return output;
}
export function renderedPackageFingerprint(id, entry, bundle, portfolio, { renderer = render, archive = zip } = {}) {
  need(Object.hasOwn(PRODUCTS, id) && typeof renderer === 'function' && typeof archive === 'function', 'Invalid rendered package request');
  // A fixed integration version and fingerprint remove their own derived values
  // from the hash. Product runtime versions and selected source bytes stay real.
  const normalized = { ...entry, revision: 1, packageFingerprint: '0'.repeat(64) };
  delete normalized.integrationFormat; delete normalized.presentationHash;
  const output = renderer({ schemaVersion: 1, products: { [id]: normalized } }, { [id]: bundle }, portfolio);
  const prefix = `plugins/${id}/`;
  const files = Object.fromEntries(Object.entries(output).filter(([path]) => path.startsWith(prefix)).map(([path, value]) => [path.slice(prefix.length), value]));
  need(Object.keys(files).length > 0, 'Rendered package has no files');
  return digest(canonical({ source: digest(canonical(bundle)), archive: digest(archive(files)) }));
}
export function checkPackageFingerprints(state, bundles, portfolio, options = {}) {
  stateCheck(state); validatePortfolio(portfolio);
  for (const [id, entry] of Object.entries(state.products)) need(entry.packageFingerprint === renderedPackageFingerprint(id, entry, bundles[id], portfolio, options), 'Reconcile changed rendered packages before checking or packaging');
}
export async function checkRendered(root, output) {
  for (const [path, expected] of Object.entries(output)) { const target = join(root, path); const info = await lstat(target); need(info.isFile() && !info.isSymbolicLink() && Boolean(info.mode & 0o111) === (raycastFileMode(path) === '100755'), 'Generated file type or executable mode differs'); need((await readFile(target)).equals(Buffer.isBuffer(expected) ? expected : Buffer.from(expected)), `Generated file is stale: ${path}`); }
  for (const path of [...await tree(root, 'plugins'), ...await tree(root, 'skills'), ...await tree(root, 'adapters')]) need(Object.hasOwn(output, path), `Unexpected package file: ${path}`);
}
async function safeTarget(root, path) {
  need(!path.startsWith('/') && path.split('/').every((p) => p && p !== '.' && p !== '..' && /^[A-Za-z0-9_.-]+$/.test(p)), 'Unsafe output path');
  const parts = path.split('/'); let target = root;
  for (let i = 0; i < parts.length; i++) { target = join(target, parts[i]); try { const info = await lstat(target); need(!info.isSymbolicLink() && (i === parts.length - 1 ? info.isFile() : info.isDirectory()), 'Unsafe output entry'); } catch (e) { if (e.code !== 'ENOENT') throw e; if (i < parts.length - 1) await mkdir(target); } }
  return target;
}
export async function writeRendered(root, output, previous = {}) {
  for (const path of Object.keys(previous)) if (!Object.hasOwn(output, path)) { need(path.startsWith('plugins/') || path.startsWith('skills/') || raycastPath(path), 'Refusing to remove a non-package file'); await rm(await safeTarget(root, path)); }
  for (const [path, value] of Object.entries(output)) { need(typeof value === 'string' || Buffer.isBuffer(value) && listingIconPath(path), 'Only selected listing icons may contain binary data'); if (Buffer.isBuffer(value)) validateListingPNG(value); const target = await safeTarget(root, path); const temp = `${target}.new-${process.pid}`; await writeFile(temp, value, { flag: 'wx', mode: raycastFileMode(path) === '100755' ? 0o755 : 0o644 }); await rename(temp, target); }
}
function crc32(buffer) { let crc = 0xffffffff; for (const value of buffer) { crc ^= value; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
export function zip(files) {
  const local = []; const central = []; let offset = 0;
  for (const path of Object.keys(files).sort()) {
    need(/^[A-Za-z0-9_.\/-]+$/.test(path) && !path.split('/').some((p) => !p || p === '.' || p === '..') && !path.startsWith('/'), 'Unsafe ZIP path');
    need(typeof files[path] === 'string' || Buffer.isBuffer(files[path]) && (path === 'assets/icon.png' || listingIconPath(path)), 'Only selected listing icons may contain binary ZIP data'); if (Buffer.isBuffer(files[path])) validateListingPNG(files[path]);
    const name = Buffer.from(path); const bytes = Buffer.from(files[path]); const crc = crc32(bytes);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(33, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(bytes.length, 18); h.writeUInt32LE(bytes.length, 22); h.writeUInt16LE(name.length, 26);
    local.push(h, name, bytes);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(raycastFileMode(path) === '100755' ? 0x0314 : 20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(33, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(bytes.length, 20); c.writeUInt32LE(bytes.length, 24); c.writeUInt16LE(name.length, 28); if (raycastFileMode(path) === '100755') c.writeUInt32LE((0o100755 * 65536) >>> 0, 38); c.writeUInt32LE(offset, 42); central.push(c, name); offset += h.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function packages(state, output, { toolkitHash = null } = {}) {
  stateCheck(state); need(Object.values(state.products).every((entry) => entry.listingIcon), 'Reconcile public listing icons before packaging'); need(Object.values(state.products).every((entry) => /^[a-f0-9]{64}$/.test(entry.packageFingerprint ?? '')), 'Reconcile rendered package identities before packaging');
  need(toolkitHash === null || /^[a-f0-9]{64}$/.test(toolkitHash), 'Invalid toolkit source hash');
  const artifacts = {}; const products = [];
  for (const [id, entry] of Object.entries(state.products).sort()) {
    const prefix = `plugins/${id}/`; const files = Object.fromEntries(Object.entries(output).filter(([p]) => p.startsWith(prefix)).map(([p, value]) => [p.slice(prefix.length), value]));
    const name = `${id}-${pluginVersion(entry)}.zip`; artifacts[name] = zip(files); products.push({ id, version: pluginVersion(entry), file: name, sha256: digest(artifacts[name]), sourceHash: entry.sourceHash });
  }
  artifacts['SHA256SUMS'] = Buffer.from(products.map((p) => `${p.sha256}  ${p.file}\n`).join(''));
  const tag = `integrations-${digest(canonical({ products, toolkitHash })).slice(0, 16)}`;
  artifacts['release.json'] = Buffer.from(json({ schemaVersion: 1, tag, toolkitHash, products }));
  return { artifacts, tag, products };
}
async function load(root) {
  const read = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
  const state = stateCheck(await read('catalog/admitted.json')); const portfolio = validatePortfolio(await read('catalog/portfolio.json')); const bundles = {};
  for (const id of Object.keys(state.products)) bundles[id] = validateBundle(await readFile(join(root, `bundles/${id}.json`), 'utf8'), id);
  const ledger = validateLedger(await read('publication-ledger.json'));
  return { state, portfolio, bundles, ledger };
}
export async function refreshRendered(root = process.cwd()) {
  const data = await load(root);
  await writeRendered(root, render(data.state, data.bundles, data.portfolio, data.ledger));
}
async function tree(root, path) {
  const output = []; let entries; try { const info = await lstat(join(root, path)); need(info.isDirectory() && !info.isSymbolicLink(), 'Package roots must be regular directories'); entries = await readdir(join(root, path), { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return output; throw e; }
  for (const entry of entries) { need(!entry.isSymbolicLink(), 'Symlink is not admitted'); const p = `${path}/${entry.name}`; if (entry.isDirectory()) output.push(...await tree(root, p)); else { need(entry.isFile(), 'Non-file package entry'); output.push(p); } } return output;
}
async function toolSourceHash(root) {
  const paths = ['package.json', 'AGENTS.md', 'CLAUDE.md', 'LICENSE', 'CONTRIBUTING.md', 'STYLE.md', 'WRITING.md', 'GENERATION_STYLE.md', 'MESSAGING.md', 'DOCUMENTATION_GUIDELINES.md', 'README_GUIDELINES.md', 'config/sources.json', ...await tree(root, 'scripts'), ...await tree(root, 'actions'), ...await tree(root, '.github/workflows'), ...await tree(root, 'test'), ...await tree(root, 'docs')].sort();
  const sources = {};
  for (const path of paths) { need((await lstat(join(root, path))).isFile(), 'Toolkit source must be a regular file'); sources[path] = digest(await readFile(join(root, path))); }
  return digest(canonical(sources));
}
export function validateLedger(ledger) {
  keys(ledger, ['schemaVersion', 'publications']); need(ledger.schemaVersion === 1 && Array.isArray(ledger.publications), 'Invalid publication ledger'); const seen = new Set();
  for (const p of ledger.publications) {
    keys(p, ['id', 'product', 'channel', 'publishedAt', 'url', 'version', 'contentHash']);
    need(/^[a-z0-9][a-z0-9-]{0,63}$/.test(p.id) && !seen.has(p.id) && Object.hasOwn(PRODUCTS, p.product) && ['github', 'skills-sh', 'chatgpt', 'claude', 'cursor', 'homebrew', 'raycast', 'mcp-registry'].includes(p.channel) && /^[a-f0-9]{64}$/.test(p.contentHash), 'Invalid publication identity');
    need(typeof p.publishedAt === 'string' && new Date(p.publishedAt).toISOString() === p.publishedAt, 'An actual ISO publication timestamp is required'); version(p.version);
    if (p.channel === 'mcp-registry') need(p.product === MCP_REGISTRY.product && p.id === mcpRegistryPublicationId(p.version) && p.url === mcpRegistryPublicationUrl(p.version), 'MCP Registry publication identity or address differs');
    if (p.channel === 'homebrew') {
      const build = /^yaptake-homebrew-\d+-\d+-\d+-([1-9]\d{0,8})$/.exec(p.id)?.[1];
      const commit = /^https:\/\/github\.com\/hraness\/homebrew-tap\/blob\/([a-f0-9]{40})\/Casks\/yaptake\.rb$/.exec(p.url)?.[1];
      need(p.product === HOMEBREW_TAP.product && build && p.id === homebrewPublicationId(p.version, build) && commit && p.url === homebrewPublicationUrl(commit) && Date.parse(p.publishedAt) <= Date.now(), 'Homebrew publication identity, time or address differs');
    }
    publicUrl(p.url, p.channel === 'mcp-registry' ? [MCP_REGISTRY.origin] : ['https://github.com', 'https://skills.sh', 'https://www.skills.sh', 'https://chatgpt.com', 'https://claude.ai', 'https://cursor.com', 'https://formulae.brew.sh', 'https://www.raycast.com']); seen.add(p.id);
  }
  return ledger;
}
export function appendPublications(ledger, entries) {
  validateLedger(ledger); const next = structuredClone(ledger);
  for (const entry of entries) { const previous = next.publications.find((p) => p.id === entry.id); if (previous) need(canonical(previous) === canonical(entry), 'Publication identity cannot be overwritten'); else next.publications.push(entry); }
  return validateLedger(next);
}
export function checkLedgerAppendOnly(previous, current) {
  validateLedger(previous); validateLedger(current);
  for (const entry of previous.publications) need(current.publications.some((p) => p.id === entry.id && canonical(p) === canonical(entry)), 'An existing publication was changed or removed');
}
export async function readGovernedLedger(root, sha) {
  need(/^[a-f0-9]{40}$/.test(sha), 'Invalid governed base SHA');
  const execute = promisify(execFile);
  await execute('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root });
  const path = 'publication-ledger.json';
  const listed = (await execute('git', ['ls-tree', '--name-only', sha, '--', path], { cwd: root })).stdout.trim();
  // An initial repository has no ledger yet. Read the tree explicitly rather
  // than interpreting Git's platform-dependent missing-path diagnostic.
  if (listed === '') return { schemaVersion: 1, publications: [] };
  need(listed === path, 'Unexpected governed publication path');
  return validateLedger(parseUnique((await execute('git', ['show', `${sha}:${path}`], { cwd: root, maxBuffer: 1048576 })).stdout));
}
export async function recordGithub(ledger, releasePlan, { fetchImpl = fetch, token } = {}) {
  const repo = JSON.parse((await download('https://api.github.com/repos/hraness/product-skills', { fetchImpl, token, limit: 262144 })).body); need(repo.full_name === 'hraness/product-skills' && repo.private === false, 'GitHub publication requires the public repository');
  const release = JSON.parse((await download(`https://api.github.com/repos/hraness/product-skills/releases/tags/${releasePlan.tag}`, { fetchImpl, token, limit: 262144 })).body);
  need(release.tag_name === releasePlan.tag && !release.draft && release.immutable === true && typeof release.published_at === 'string' && release.html_url === `${REPOSITORY}/releases/tag/${releasePlan.tag}`, 'Release is not an immutable public publication');
  const entries = [];
  for (const p of releasePlan.products) { const assets = release.assets.filter((a) => a.name === p.file); need(assets.length === 1 && assets[0].digest === `sha256:${p.sha256}` && assets[0].browser_download_url === `${REPOSITORY}/releases/download/${releasePlan.tag}/${p.file}`, 'Published artifact digest mismatch'); if (ledger.publications.some((previous) => previous.product === p.id && previous.channel === 'github' && previous.version === p.version && previous.contentHash === p.sha256)) continue; entries.push({ id: `${p.id}-github-${p.version.replaceAll('.', '-')}-${p.sha256.slice(0, 8)}`, product: p.id, channel: 'github', publishedAt: new Date(release.published_at).toISOString(), url: release.html_url, version: p.version, contentHash: p.sha256 }); }
  return appendPublications(ledger, entries);
}
export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const [command, ...rest] = argv; need(rest.length === 0 && ['check', 'reconcile', 'package', 'record-github', 'record-registry', 'record-homebrew'].includes(command), 'Use check, reconcile, package, record-github, record-registry or record-homebrew');
  let data = await load(root); const before = render(data.state, data.bundles, data.portfolio, data.ledger);
  if (command === 'check') {
    checkPackageFingerprints(data.state, data.bundles, data.portfolio);
    await checkRendered(root, before);
    const ledger = validateLedger(JSON.parse(await readFile(join(root, 'publication-ledger.json'), 'utf8')));
    const { readHomebrewCursor } = await import('./homebrew-observer.mjs'); await readHomebrewCursor(root);
    if (process.env.LEDGER_BASE_SHA) {
      checkLedgerAppendOnly(await readGovernedLedger(root, process.env.LEDGER_BASE_SHA), ledger);
    }
    process.stdout.write(`${Object.keys(data.state.products).length} product packages checked.\n`); return;
  }
  if (command === 'reconcile') {
    const config = JSON.parse(await readFile(join(root, 'config/sources.json'), 'utf8')); keys(config, ['schemaVersion', 'portfolio', 'selected']); need(config.schemaVersion === 1 && config.portfolio === 'https://hraness.com/portfolio.json', 'Unexpected source configuration');
    const portfolio = validatePortfolio(JSON.parse((await download(config.portfolio)).body));
    const result = await reconcile({ ...data, portfolio, selected: config.selected });
    data = { state: result.state, bundles: result.bundles, portfolio, ledger: data.ledger };
    const output = render(data.state, data.bundles, data.portfolio, data.ledger);
    // Every input and generated output is validated before the first source write.
    await mkdir(join(root, 'bundles'), { recursive: true });
    for (const [id, bundle] of Object.entries(data.bundles)) await writeFile(join(root, `bundles/${id}.json`), json(bundle));
    await writeFile(join(root, 'catalog/admitted.json'), json(data.state)); await writeFile(join(root, 'catalog/portfolio.json'), json(portfolio));
    await writeRendered(root, output, before); await writeFile(join(root, 'reconcile-report.json'), json({ schemaVersion: 1, outcomes: result.outcomes })); process.stdout.write(json(result.outcomes)); return;
  }
  if (command === 'record-registry') {
    await mkdir(join(root, 'dist'), { recursive: true });
    try {
      const { observeMcpRegistry } = await import('./mcp-registry.mjs');
      const result = await observeMcpRegistry(data.ledger);
      const output = render(data.state, data.bundles, data.portfolio, result.ledger);
      await writeFile(join(root, 'publication-ledger.json'), json(result.ledger)); await writeRendered(root, output, before);
      await writeFile(join(root, 'dist/registry-observation.json'), json(result.report)); process.stdout.write(json(result.report));
    } catch (error) {
      await writeFile(join(root, 'dist/registry-observation.json'), json({ schemaVersion: 1, source: 'official-mcp-registry', status: 'pending', reason: 'Registry data or its exact public npm metadata did not verify; prior publication records were preserved.' }));
      throw error;
    }
    return;
  }
  if (command === 'record-homebrew') {
    await mkdir(join(root, 'dist'), { recursive: true });
    try {
      const { observeHomebrew, readHomebrewCursor } = await import('./homebrew-observer.mjs');
      const result = await observeHomebrew(data.ledger, await readHomebrewCursor(root));
      const output = render(data.state, data.bundles, data.portfolio, result.ledger);
      await writeFile(join(root, 'publication-ledger.json'), json(result.ledger)); await writeFile(join(root, HOMEBREW_TAP.cursor), json(result.cursor)); await writeRendered(root, output, before);
      await writeFile(join(root, 'dist/homebrew-observation.json'), json(result.report)); process.stdout.write(json(result.report));
    } catch (error) {
      await writeFile(join(root, 'dist/homebrew-observation.json'), json({ schemaVersion: 1, source: 'homebrew-tap', status: 'pending', reason: 'The actual tap publication or its canonical cask checks did not verify; earlier records and the observation cursor were preserved.' })); throw error;
    }
    return;
  }
  checkPackageFingerprints(data.state, data.bundles, data.portfolio);
  const plan = packages(data.state, before, { toolkitHash: await toolSourceHash(root) }); await mkdir(join(root, 'dist'), { recursive: true });
  for (const [name, bytes] of Object.entries(plan.artifacts)) await writeFile(join(root, 'dist', name), bytes);
  if (command === 'record-github') {
    need(plan.products.length, 'No product package to publish');
    const ledger = JSON.parse(await readFile(join(root, 'publication-ledger.json'), 'utf8'));
    const updated = await recordGithub(ledger, plan, { token: process.env.GH_TOKEN });
    await writeFile(join(root, 'publication-ledger.json'), json(updated));
    await writeRendered(root, render(data.state, data.bundles, data.portfolio, updated), before);
  }
  process.stdout.write(json({ tag: plan.tag, products: plan.products }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
