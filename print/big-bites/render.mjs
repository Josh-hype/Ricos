/* Render menu.html to a print-ready PDF.
 *   node print/big-bites/render.mjs
 * Fonts are fetched and inlined so they embed in the PDF rather than falling
 * back to a system face at the printer. */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
import path from 'node:path';
import fs from 'node:fs';

const DIR = import.meta.dirname;
const b = await pw.chromium.launch({ args: ['--no-proxy-server'] });
// 426x303mm at 96dpi, so the panels lay out at their true print size and the
// overflow check below means something.
const p = await b.newPage({ viewport: { width: 1610, height: 1145 } });

// The sandbox blocks fonts.googleapis; serve the real faces locally so the PDF
// embeds them. installFonts comes from the same helper used for screenshots.
try {
  const { installFonts } = await import('/tmp/claude-0/-home-user-Ricos/de4df914-afd4-56eb-a936-462ef5450f78/scratchpad/fontroute.mjs');
  await installFonts(p);
} catch (e) { console.warn('font route unavailable:', e.message); }

// A missing typeface silently swaps in a fallback and quietly changes every
// measurement on the sheet, so fail loudly instead.
const fontsOK = await p.evaluate(async () => {
  await document.fonts.ready;
  return ['Anton', 'Oswald'].every((f) => document.fonts.check(`12px "${f}"`));
});

await p.goto('file://' + path.join(DIR, 'menu.html'), { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

// Report any panel whose content runs past its box — the one thing that
// silently ruins a print run.
const overflow = await p.evaluate(() => {
  const bad = [];
  document.querySelectorAll('.panel').forEach((el, i) => {
    if (el.scrollHeight > el.clientHeight + 2) {
      bad.push(`panel ${i + 1}: content ${el.scrollHeight}px vs box ${el.clientHeight}px (over by ${el.scrollHeight - el.clientHeight})`);
    }
  });
  return bad;
});
console.log(overflow.length ? 'OVERFLOW:\n  ' + overflow.join('\n  ') : 'panels fit');
if (!fontsOK) console.log('WARNING: Anton/Oswald did not load — the PDF is set in a fallback face');

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
