/* Render menu.html to a print-ready PDF.
 *   node print/big-bites/render.mjs
 * Fonts are vendored in fonts/ and declared locally, so they embed in the PDF
 * identically on any machine. The run FAILS (exit 1, no PDF written) if a face
 * didn't load or any panel overflows — a bad sheet must never reach a printer
 * on an unread warning. */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
import path from 'node:path';
import fs from 'node:fs';

const DIR = import.meta.dirname;
const b = await pw.chromium.launch({ args: ['--no-proxy-server'] });
// 426x303mm at 96dpi, so the panels lay out at their true print size and the
// overflow check below means something.
const p = await b.newPage({ viewport: { width: 1610, height: 1145 } });
await p.goto('file://' + path.join(DIR, 'menu.html'), { waitUntil: 'networkidle' });

// Wait for the real faces before measuring anything: a fallback face lays the
// whole sheet out differently, and a check that ran on the fallback would be a
// false negative for the sheet that ships.
const fontsOK = await p.evaluate(async () => {
  await document.fonts.ready;
  return ['Anton', 'Oswald'].every((f) => document.fonts.check(`12px "${f}"`));
});
await p.waitForTimeout(400);

// Report any panel whose content runs past its box, in either axis — the one
// thing that silently ruins a print run.
const overflow = await p.evaluate(() => {
  const bad = [];
  document.querySelectorAll('.panel').forEach((el, i) => {
    // The cover's spine bleeds past the trim BY DESIGN — measure the body,
    // not the bleed.
    if (el.classList.contains('cover')) el = el.querySelector('.coverbody') || el;
    /* scrollHeight is not the test: photos and the spine are positioned to be
       cropped by the panel edge on purpose, and they inflate it. What must not
       overflow is the IN-FLOW content — so measure that against the padding
       box, and let the text check below catch anything clipped sideways. */
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const top = box.top + parseFloat(cs.paddingTop);
    const bottom = box.bottom - parseFloat(cs.paddingBottom);
    let low = top;
    [...el.children].forEach((ch) => {
      if (getComputedStyle(ch).position === 'absolute') return;   // deliberate bleed
      low = Math.max(low, ch.getBoundingClientRect().bottom);
    });
    if (low > bottom + 1) {
      bad.push(`panel ${i + 1}: in-flow content overruns its box by ${Math.round(low - bottom)}px`);
    }
    /* Photos are cropped by the panel edge on purpose, so scrollWidth is not
       the test — clipped TEXT is. Measure the ink of every text run against
       the panel box instead. */
    el.querySelectorAll('.n, .p, .p2, h3, .deal, .fine, .hours, .strap, .qrtxt').forEach((tx) => {
      const r = tx.getBoundingClientRect();
      if (r.width && (r.right > box.right + 1 || r.left < box.left - 1)) {
        bad.push(`panel ${i + 1}: "${tx.textContent.trim().slice(0, 28)}" is clipped by the panel edge`);
      }
    });
  });
  return bad;
});

if (!fontsOK) console.error('FAIL: Anton/Oswald did not load — the sheet is set in a fallback face');
console.log(overflow.length ? 'OVERFLOW:\n  ' + overflow.join('\n  ') : 'panels fit');

if (!fontsOK || overflow.length) {
  await b.close();
  console.error('PDF NOT written — fix the failure above first.');
  process.exit(1);
}

await p.pdf({
  path: path.join(DIR, 'big-bites-menu-A3-trifold.pdf'),
  width: '426mm', height: '303mm',
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  preferCSSPageSize: true,
});
await p.screenshot({ path: path.join(DIR, 'preview.png'), fullPage: true });
await b.close();
const kb = Math.round(fs.statSync(path.join(DIR, 'big-bites-menu-A3-trifold.pdf')).size / 1024);
console.log(`PDF written (${kb}KB)`);
