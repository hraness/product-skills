import { crc32, deflateSync } from 'node:zlib';
export function originalIcon({ size = 512, marker = 17 } = {}) {
  const chunk = (name, bytes) => {
    const type = Buffer.from(name), result = Buffer.alloc(bytes.length + 12);
    result.writeUInt32BE(bytes.length, 0); type.copy(result, 4); bytes.copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([type, bytes])), bytes.length + 8); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const stride = size * 4 + 1, pixels = Buffer.alloc(stride * size);
  for (let row = 0; row < size; row++) for (let x = 0; x < size; x++) pixels[row * stride + 1 + x * 4 + 3] = 255;
  pixels[1] = marker;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export const originalIconResponse = () => new Response(originalIcon(), { headers: { 'content-type': 'image/png', etag: '"original-icon"' } });
export const withOriginalIcon = (fetchImpl) => (url, options) => /^https:\/\/hraness\.com\/products\/(?:oh|yaptake|textmock|sponge)\/icon\.png$/.test(url) ? originalIconResponse() : fetchImpl(url, options);
