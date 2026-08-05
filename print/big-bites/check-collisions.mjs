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
await p.waitForTimeout(900);
console.log(await p.evaluate(() => {
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
  document.querySelectorAll('.shot.side').forEach((img) => {
    const ir = img.getBoundingClientRect();
    img.closest('.blkrow').querySelectorAll('.n, .p, .p2').forEach((el) => {
      for (const r of inkRects(el)) {
        if (over(r, ir)) { hits.push(`"${el.textContent.trim().slice(0, 40)}" runs under ${img.getAttribute('src')}`); break; }
      }
    });
  });
  document.querySelectorAll('.shot').forEach((img) => {
    const blk = img.closest('.blk'); if (!blk) return;
    const ir = img.getBoundingClientRect(), br = blk.getBoundingClientRect();
    if (ir.top < br.top - 1 || ir.bottom > br.bottom + 1) hits.push(`${img.getAttribute('src')} escapes its section by ${Math.round(Math.max(br.top - ir.top, ir.bottom - br.bottom))}px`);
  });
  return hits.length ? hits.join('\n') : 'clean: no text runs under a photo, no photo escapes its section';
}));
await b.close();
