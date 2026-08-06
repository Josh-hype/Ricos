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
  return ['Archivo Black', 'Oswald', 'Montserrat'].every((f) => document.fonts.check(`12px "${f}"`));
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

// The collision check is the only gate covering the absolutely-positioned
// photos, which the overflow gate deliberately skips — so run it here rather
// than trusting someone to run it by hand.
const collisions = await p.evaluate(() => {
  const hits = [];
  const over = (a, c) => !(a.right <= c.left + 1 || a.left >= c.right - 1 || a.bottom <= c.top + 1 || a.top >= c.bottom - 1);
  const ink = (el) => {
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
      for (const r of ink(el)) if (over(r, ir)) { hits.push(`"${el.textContent.trim().slice(0, 30)}" under ${img.getAttribute('src')}`); break; }
    });
  });
  return hits;
});
if (collisions.length) {
  console.error('COLLISIONS:\n  ' + collisions.join('\n  '));
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

/* Chromium writes no TrimBox, so the 3mm bleed is indistinguishable from the
   page unless the printer is told in words. Stamp one on both pages: 420x297mm
   centred in the 426x303 sheet, in points. */
{
  const f = path.join(DIR, 'big-bites-menu-A3-trifold.pdf');
  const buf = fs.readFileSync(f);
  const pt = (mm) => (mm * 72 / 25.4).toFixed(2);
  const trim = `/TrimBox [${pt(3)} ${pt(3)} ${pt(423)} ${pt(300)}] `;
  let n = 0;
  const out = buf.toString('latin1').replace(/\/Type\s*\/Page[^s]/g, (m) => { n++; return trim + m; });
  if (n === 2) { fs.writeFileSync(f, Buffer.from(out, 'latin1')); console.log('TrimBox stamped on 2 pages'); }
  else console.warn(`TrimBox NOT stamped (matched ${n} pages) — tell the printer the trim is 420x297mm`);
}

/* A name-only font check cannot see this: document.fonts.check() reports true
   for a family even when the glyph asked for is not in it, so Chromium was
   embedding DejaVu off the build machine for characters no vendored face
   carried. Read the PDF's own font list instead — that is the ground truth. */
const { execFileSync } = await import('node:child_process');
try {
  const fonts = execFileSync('pdffonts', [path.join(DIR, 'big-bites-menu-A3-trifold.pdf')], { encoding: 'utf8' })
    .split('\n').slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean)
    .map((n) => n.replace(/^[A-Z]{6}\+/, ''));
  const allowed = /^(ArchivoBlack|Oswald|Montserrat)/;
  const strays = [...new Set(fonts)].filter((f) => !allowed.test(f));
  if (strays.length) {
    console.error(`FAIL: the PDF embeds fonts from this machine, not the repo: ${strays.join(', ')}`);
    process.exit(1);
  }
  console.log(`fonts embedded: ${[...new Set(fonts)].join(', ')}`);
} catch (e) {
  if (e.status) throw e;
  console.warn('pdffonts unavailable — could not verify embedded fonts');
}
