/* make-brand-assets.cjs — generate the LumiPOS app icon + splash from the Lumin Labs
   "L" mark (navy stem + foot, gold accent bar) on cream, matching docs/assets/lumin-
   labs-logo. Pure Node (zlib) PNG writer — no native deps. Outputs into app/assets/,
   which @capacitor/assets reads to generate the Android launcher icons + splash.
   Re-run with: node app/scripts/make-brand-assets.cjs */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });

// Brand palette (from docs/assets/lumin-labs-logo.svg)
const CREAM = [242, 239, 230, 255];
const NAVY  = [22, 36, 60, 255];
const GOLD  = [194, 162, 105, 255];
const CLEAR = [0, 0, 0, 0];

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const canvas = (w, h, bg) => { const b = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) b.set(bg, i * 4); return b; };
function rect(buf, w, x0, y0, x1, y1, c) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) buf.set(c, (y * w + x) * 4);
}
// The "L" mark in its own 92x100 bbox (from the SVG), centred, scaled to markH px.
function drawMark(buf, W, H, markH, body, accent) {
  const s = markH / 100, markW = 92 * s, ox = (W - markW) / 2, oy = (H - markH) / 2;
  rect(buf, W, ox,         oy,          ox + 34 * s, oy + 100 * s, body);   // vertical stem
  rect(buf, W, ox,         oy + 66 * s, ox + 92 * s, oy + 100 * s, body);   // horizontal foot
  rect(buf, W, ox + 46 * s, oy + 9 * s, ox + 57 * s, oy + 64 * s,  accent); // gold accent
}
function write(name, w, h, bg, markH, body, accent) {
  const buf = canvas(w, h, bg);
  if (markH) drawMark(buf, w, h, markH, body, accent);
  fs.writeFileSync(path.join(OUT, name), encodePNG(w, h, buf));
  console.log('  ✓', name, `${w}x${h}`);
}

// Launcher icon (legacy + base), adaptive fg/bg, and splash (light + dark).
write('icon.png',            1024, 1024, CREAM, 580, NAVY,  GOLD);
write('icon-background.png', 1024, 1024, CREAM,   0, NAVY,  GOLD);
write('icon-foreground.png', 1024, 1024, CLEAR, 470, NAVY,  GOLD); // smaller → safe inside the adaptive mask
write('splash.png',          2732, 2732, CREAM, 760, NAVY,  GOLD);
write('splash-dark.png',     2732, 2732, NAVY,  760, CREAM, GOLD);
console.log('✓ LumiPOS brand assets written to app/assets/');
