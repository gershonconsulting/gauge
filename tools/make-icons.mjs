// Generates extension/icons/icon{16,48,128}.png: a red gauge arc on white. No dependencies.
// Run once: node tools/make-icons.mjs (output is committed; the extension has no build step).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function icon(size) {
  const S = 4; // supersampling
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size * 0.62, R = size * 0.40, w = size * 0.13;
  const red = [0xfe, 0x1b, 0x04], grey = [0xe5, 0xe7, 0xeb], dark = [0x1d, 0x1d, 0x1f];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let acc = [0, 0, 0], cov = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const X = x + (sx + 0.5) / S, Y = y + (sy + 0.5) / S;
      const dx = X - cx, dy = Y - cy, r = Math.hypot(dx, dy);
      let col = [255, 255, 255];
      const ang = Math.atan2(-dy, dx); // 0 = right, PI = left
      if (dy <= w * 0.2 && Math.abs(r - R) <= w / 2 && ang >= -0.15 && ang <= Math.PI + 0.15) {
        col = ang >= Math.PI * 0.3 ? red : grey; // filled ~70% from the left
      }
      // needle
      const na = Math.PI * 0.42, nx = Math.cos(na), ny = -Math.sin(na);
      const t = dx * nx + dy * ny, perp = Math.abs(dx * ny - dy * nx);
      if (t >= 0 && t <= R * 0.78 && perp <= Math.max(0.6, size * 0.035)) col = dark;
      if (r <= Math.max(1, size * 0.07)) col = dark;
      acc = acc.map((a, i) => a + col[i]); cov++;
    }
    const o = (y * size + x) * 4;
    px[o] = acc[0] / cov; px[o + 1] = acc[1] / cov; px[o + 2] = acc[2] / cov; px[o + 3] = 255;
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const dir = new URL('../extension/icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const s of [16, 48, 128]) writeFileSync(new URL(`icon${s}.png`, dir), icon(s));
console.log('icons written');
