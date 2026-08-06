/* Does any item name or price run under a food photo?
 *   node print/big-bites/check-collisions.mjs
 * Run after resizing any photo. Measures the rendered glyphs, not the boxes —
 * .n is flex:1 with the gutter as padding, so its box reaches under the photo
 * by design while the text does not. */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
import path from 'node:path';
const b = await pw.chromium.launch({ args: ['--no-proxy-server'] });
const p = await b.newPage({ viewport: { width: 1610, height: 1145 } });
await p.goto('file://' + path.join(import.meta.dirname, 'menu.html'), { waitUntil: 'networkidle' });
// Measure in the shipping faces, not a fallback — same reason as render.mjs.
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(400);
const hits = await p.evaluate(() => {
  const hits = [];
  const over = (a, c) => !(a.right <= c.left + 1 || a.left >= c.right - 1 || a.bottom <= c.top + 1 || a.top >= c.bottom - 1);
  // Measure the ink, not the box: .n is flex:1 with the gutter as padding, so
  // its box reaches under the photo by design while the glyphs do not.
  const inkRects = (el) => {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      out.push(...r.getClientRects());
    }
    return out;
  };
  /* A 'mid' photo sits BEHIND the prices by design — the reference does the
     same — so overlap there is intent, not a fault. What matters is that those
     numerals still read, which is what the shadow on .p2 is for; anything
     overlapping a mid photo without one is reported. */
  document.querySelectorAll('.shot.mid').forEach((img) => {
    const ir = img.getBoundingClientRect();
    img.closest('.blkrow').querySelectorAll('.n, .p, .p2').forEach((el) => {
      const shadowed = getComputedStyle(el).textShadow !== 'none';
      for (const r of inkRects(el)) {
        if (over(r, ir) && !shadowed) {
          hits.push(`"${el.textContent.trim().slice(0, 30)}" sits on ${img.getAttribute('src')} with no shadow to carry it`);
          break;
        }
      }
    });
  });
  document.querySelectorAll('.shot.side').forEach((img) => {
    const ir = img.getBoundingClientRect();
    img.closest('.blkrow').querySelectorAll('.n, .p, .p2').forEach((el) => {
      for (const r of inkRects(el)) {
        if (over(r, ir)) { hits.push(`"${el.textContent.trim().slice(0, 40)}" runs under ${img.getAttribute('src')}`); break; }
      }
    });
  });
  document.querySelectorAll('.shot').forEach((img) => {
    /* The pizza shot is positioned to be cropped by the panel edge on purpose,
       so "escaping its section" is the intent, not a fault. */
    if (img.closest('.halftone')) return;
    const blk = img.closest('.blk') || img.closest('.panel'); if (!blk) return;
    const ir = img.getBoundingClientRect(), br = blk.getBoundingClientRect();
    if (ir.top < br.top - 1 || ir.bottom > br.bottom + 1) hits.push(`${img.getAttribute('src')} escapes its section by ${Math.round(Math.max(br.top - ir.top, ir.bottom - br.bottom))}px`);
  });
  return hits;
});
await b.close();
console.log(hits.length ? hits.join('\n') : 'clean: no text runs under a photo, no photo escapes its section');
// Exit non-zero so this can actually gate a build. It is the only check that
// polices the absolutely-positioned photos, which the overflow gate skips.
process.exit(hits.length ? 1 : 0);
