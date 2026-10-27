// Usage: node store/make-icons.js icons [preview-dir]
// Draws the extension icon at several sizes and writes PNGs: a title-card
// poster with a gold rating star on its top-right corner, which is what the
// extension does (a rating badge on each card), with a play triangle on
// the poster so it reads as video rather than a document. The star has a dark outline
// so it stays separate from the poster at 16 px; the rest is transparent,
// so it sits on light and dark toolbars alike. Pure Node: zlib for
// deflate/crc, 4x supersampling. With a preview-dir it also writes a
// 512 px copy there, for looking at.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const outDir = process.argv[2];
const previewDir = process.argv[3];
const SS = 4;
const gold = [0xff, 0xb7, 0x00], outline = [0x1c, 0x23, 0x31];
const posterTop = [0x62, 0x7b, 0xae], posterBottom = [0x3a, 0x4a, 0x70], play = [0xe8, 0xee, 0xf8];

// Everything in units of the icon's size (0..1).
const POSTER = { x0: 0.06, y0: 0.22, x1: 0.62, y1: 0.96, r: 0.08 };
const STAR = { cx: 0.66, cy: 0.33, R: 0.29, r: 0.125, edge: 0.045 };
// A play triangle in the poster's lower half, so it reads as video.
const PLAY = [[0.23, 0.6], [0.23, 0.86], [0.45, 0.73]];

function inRoundRect(x, y, b) {
  const cx = Math.min(Math.max(x, b.x0 + b.r), b.x1 - b.r), cy = Math.min(Math.max(y, b.y0 + b.r), b.y1 - b.r);
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && (x - cx) ** 2 + (y - cy) ** 2 <= b.r * b.r;
}
function starPoly(s) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? s.r : s.R;
    pts.push([s.cx + rad * Math.cos(a), s.cy + rad * Math.sin(a)]);
  }
  return pts;
}
function inPoly(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distToPoly(x, y, p) {
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [x1, y1] = p[j], [x2, y2] = p[i];
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    d = Math.min(d, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return d;
}
const star = starPoly(STAR);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Colour at a point (units 0..1), or null for transparent.
function paint(x, y) {
  const inStar = inPoly(x, y, star);
  if (inStar) return gold;
  if (distToPoly(x, y, star) <= STAR.edge) return outline;
  if (inRoundRect(x, y, POSTER)) {
    if (inPoly(x, y, PLAY)) return play;
    return mix(posterTop, posterBottom, (y - POSTER.y0) / (POSTER.y1 - POSTER.y0));
  }
  return null;
}

function render(size) {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = paint((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
      if (!c) continue;
      r += c[0]; g += c[1]; b += c[2]; n++;
    }
    const i = (y * size + x) * 4;
    if (n) { px[i] = r / n; px[i + 1] = g / n; px[i + 2] = b / n; }
    px[i + 3] = (255 * n) / (SS * SS);
  }
  return px;
}
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(outDir, `icon${s}.png`), png(s, render(s)));
if (previewDir) fs.writeFileSync(path.join(previewDir, 'icon512.png'), png(512, render(512)));
console.log('icons written');
