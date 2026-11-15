import { createHash } from 'node:crypto';
import { crc32, inflateSync } from 'node:zlib';

export const MAX_ICON_BYTES = 64 * 1024;
const need = (condition, message) => { if (!condition) throw new Error(message); };
const productId = (id) => need(/^(?:dawn|yaptake|textmock|sponge)$/.test(id), 'Unknown listing product');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const iconName = 'assets/icon.png';
export function listingIconPath(path) { return /^plugins\/(?:dawn|yaptake|textmock|sponge)\/assets\/icon\.png$/.test(path); }
export function portfolioIconURL(project) {
  productId(project.id); need(project.icon === `/products/${project.id}/icon.png`, 'Unexpected portfolio icon path');
  return new URL(project.icon, 'https://hraness.com/portfolio.json').href;
}
export function validateListingPNG(bytes) {
  need(Buffer.isBuffer(bytes) && bytes.length >= 57 && bytes.length <= MAX_ICON_BYTES && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Listing icon must be a bounded PNG');
  let offset = 8, header = null, ended = false, dataClosed = false, palette = false; const data = [];
  while (offset < bytes.length) {
    need(offset + 12 <= bytes.length, 'PNG chunk is incomplete');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    need(length <= MAX_ICON_BYTES && end <= bytes.length, 'PNG chunk exceeds its source');
    const name = bytes.subarray(offset + 4, offset + 8).toString('latin1');
    need(/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(name) && crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'PNG chunk identity differs');
    if (name === 'IHDR') {
      need(!header && offset === 8 && length === 13, 'PNG needs one initial header');
      const width = bytes.readUInt32BE(offset + 8), height = bytes.readUInt32BE(offset + 12), color = bytes[offset + 17];
      need(width === height && width >= 512 && width <= 2048 && bytes[offset + 16] === 8 && [2, 6].includes(color) && bytes[offset + 18] === 0 && bytes[offset + 19] === 0 && bytes[offset + 20] === 0, 'Listing icon must be a square noninterlaced RGB PNG from 512 to 2048 pixels');
      header = { width, height, channels: color === 6 ? 4 : 3 };
    } else {
      need(header && !ended && !['acTL', 'fcTL', 'fdAT'].includes(name), 'Animated or misplaced PNG content is unsupported');
      if (name === 'IDAT') { need(!dataClosed, 'PNG image data must be contiguous'); data.push(bytes.subarray(offset + 8, end - 4)); }
      else {
        if (data.length) dataClosed = true;
        if (name === 'IEND') { need(length === 0 && data.length > 0 && end === bytes.length, 'PNG ending differs'); ended = true; }
        else if (name === 'PLTE') { need(!palette && data.length === 0 && length > 0 && length <= 768 && length % 3 === 0, 'PNG palette differs'); palette = true; }
        else need(/^[a-z]/.test(name), 'Unknown critical PNG chunk');
      }
    }
    offset = end;
  }
  need(header && ended, 'PNG image is incomplete');
  const stride = header.width * header.channels + 1, expected = stride * header.height;
  const pixels = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  need(pixels.length === expected, 'PNG pixel data length differs');
  for (let row = 0; row < header.height; row++) need(pixels[row * stride] <= 4, 'PNG filter is unsupported');
  return { width: header.width, height: header.height };
}
export function listingIconBytes(value, id) {
  productId(id);
  need(value && Object.keys(value).sort().join(',') === 'base64,bytes,etag,sha256,url' && value.url === portfolioIconURL({ id, icon: `/products/${id}/icon.png` }) && /^[a-f0-9]{64}$/.test(value.sha256) && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= MAX_ICON_BYTES && typeof value.base64 === 'string' && value.base64.length <= Math.ceil(MAX_ICON_BYTES / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64) && (value.etag === null || typeof value.etag === 'string' && value.etag.length <= 256 && !/[\x00-\x1f\x7f]/.test(value.etag)), 'Invalid admitted listing icon');
  const bytes = Buffer.from(value.base64, 'base64');
  need(bytes.length === value.bytes && bytes.toString('base64') === value.base64 && hash(bytes) === value.sha256, 'Listing icon bytes differ from their admitted identity');
  validateListingPNG(bytes); return bytes;
}
export async function fetchListingIcon(project, { previous, fetchImpl = fetch } = {}) {
  const url = portfolioIconURL(project); if (previous) listingIconBytes(previous, project.id);
  const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { accept: 'image/png', ...(previous?.etag ? { 'if-none-match': previous.etag } : {}) } });
  if (response.status === 304) { await response.body?.cancel().catch(() => {}); need(previous && !response.redirected, 'An icon 304 needs its admitted public source'); return previous; }
  if (response.status !== 200 || response.redirected || response.headers.get('content-type')?.split(';')[0] !== 'image/png') { await response.body?.cancel().catch(() => {}); throw new Error('Public listing icon is unavailable'); }
  const chunks = []; let length = 0;
  try { for await (const chunk of response.body) { length += chunk.length; need(length <= MAX_ICON_BYTES, 'Public listing icon exceeds its limit'); chunks.push(Buffer.from(chunk)); } }
  catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
  const bytes = Buffer.concat(chunks); validateListingPNG(bytes); const sha256 = hash(bytes);
  if (previous?.sha256 === sha256) return previous;
  const rawTag = response.headers.get('etag'); const etag = rawTag && rawTag.length <= 256 && !/[\x00-\x1f\x7f]/.test(rawTag) ? rawTag : null;
  return { url, sha256, bytes: bytes.length, base64: bytes.toString('base64'), etag };
}
function runtimeRequirement(manifest) {
  const name = manifest.product.name, runtime = manifest.runtime;
  if (runtime.install.type === 'private-release') return `Requires access to ${name}'s private preview, its separately installed CLI and Bun ${runtime.bun.slice(2)} or later.`;
  if (runtime.install.type === 'app') return `Requires the separately installed ${name} app and its local command on Apple silicon with macOS ${runtime.platform.minimumVersion} or later.`;
  if (runtime.install.type === 'npm') return `Requires the separately installed ${runtime.install.package} CLI, Node.js ${runtime.node.slice(2)} or later and an initialized local library.`;
  return `The included share-link helper requires Node.js ${runtime.helper.node.slice(2)} or later. Open its link in ${name} to export an image or video.`;
}
export function listingInterface(manifest, project, hasIcon) {
  return { displayName: manifest.product.name, shortDescription: project.short, longDescription: `${manifest.product.description}\n\n${runtimeRequirement(manifest)}`, developerName: 'Hraness', category: 'Productivity', capabilities: [], websiteURL: manifest.product.url, ...(hasIcon ? { composerIcon: `./${iconName}`, logo: `./${iconName}` } : {}) };
}
export function agentInstallInstructions(id) {
  productId(id);
  const mcp = id === 'sponge' ? `\n## Local MCP setup\n\nThe included launcher checks the installed \`@hraness/sponge\` package and runs a\nread-only version probe before starting its MCP server. It refuses an unrelated\n\`sponge\` command. It does not install software, sign in or initialize a library.\n\nThe server uses your existing default library. To choose another existing library,\nset \`SPONGE_MCP_LIBRARY\` to its absolute directory in the agent's environment. If\nyour Sponge command is outside PATH, set \`SPONGE_CLI\` to its absolute path. Follow\nthe setup guide above when the launcher reports a missing command or library.\n` : '';
  return `## Add the skill to an agent\n\nSet up the product as described above, then install its integration files.\n\nFor Codex CLI:\n\n\`\`\`sh\ncodex plugin marketplace add https://github.com/hraness/product-skills.git\ncodex plugin add ${id}@hraness-products\n\`\`\`\n\nIn Claude Code:\n\n\`\`\`text\n/plugin install ${id} --marketplace hraness/product-skills\n\`\`\`\n\nA Cursor team marketplace administrator can import\n\`https://github.com/hraness/product-skills\`, then select this product. See\n[Cursor's repository import instructions](https://cursor.com/docs/plugins#add-a-team-marketplace).\nThese repository installs are separate from public directory approval.\n${mcp}`;
}
