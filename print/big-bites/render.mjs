/* Render menu.html to a print-ready PDF.
 *   node print/big-bites/render.mjs
 * Fonts are vendored in fonts/ and declared locally, so they embed in the PDF
 * identically on any machine. The run FAILS (exit 1, no PDF written) if a face
 * didn't load or any panel overflows — a bad sheet must never reach a printer
 * on an unread warning. */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DIR = import.meta.dirname;
const SHOP = path.resolve(DIR, '../../data/shops/food-station');

/* menu.html is an intermediate file, and nothing used to tie it to the data it
   came from. Every guard in build-menu.mjs writes nothing and exits 1, leaving
   the PREVIOUS sheet on disk — and an operator who edits a price and forgets
   to rebuild at all gets the same result. Either way this printed a PDF of
   stale prices and reported every gate green, which is the one failure the
   tool exists to prevent. Recompute the fingerprint and refuse to print a
   sheet that doesn't carry it. */
const wantStamp = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(SHOP, 'menu-visual.json')))
  .update(fs.readFileSync(path.join(SHOP, 'config.json')))
  .update(fs.readFileSync(path.join(DIR, 'build-menu.mjs')))
  .digest('hex').slice(0, 16);
const sheet = fs.existsSync(path.join(DIR, 'menu.html'))
  ? fs.readFileSync(path.join(DIR, 'menu.html'), 'utf8') : '';
const gotStamp = /<meta name="build-src" content="([a-f0-9]+)"/.exec(sheet)?.[1];
/* And the sheet's own hash, so an edit made to menu.html AFTER a clean build
   cannot reach the PDF. Recomputed by putting the placeholder back. */
const gotOut = /<meta name="build-out" content="([a-f0-9]+)"/.exec(sheet)?.[1];
const wantOut = gotOut && crypto.createHash('sha256')
  .update(sheet.replace(`content="${gotOut}"`, 'content="__BUILD_OUT__"'))
  .digest('hex').slice(0, 16);
if (gotOut && gotOut !== wantOut) {
  console.error('FAIL: menu.html has been edited since it was generated — the sheet no longer matches the shop data.');
  console.error('  Run: node print/big-bites/build-menu.mjs');
  process.exit(1);
}
if (gotStamp !== wantStamp) {
  console.error(gotStamp
    ? `FAIL: menu.html was built from different data or a different generator (${gotStamp} != ${wantStamp}).`
    : 'FAIL: menu.html is missing or carries no build stamp.');
  console.error('  Run: node print/big-bites/build-menu.mjs');
  process.exit(1);
}
const b = await pw.chromium.launch({ args: ['--no-proxy-server'] });
// 426x303mm at 96dpi, so the panels lay out at their true print size and the
// overflow check below means something.
const p = await b.newPage({ viewport: { width: 1610, height: 1145 } });
await p.goto('file://' + path.join(DIR, 'menu.html'), { waitUntil: 'networkidle' });

// Wait for the real faces before measuring anything: a fallback face lays the
// whole sheet out differently, and a check that ran on the fallback would be a
// false negative for the sheet that ships.
/* fonts.ready can resolve before a face that only later layout triggers has
   loaded, so ASK for each weight explicitly and then verify — otherwise the
   guard reports a false failure (or worse, a false pass) depending on timing. */
const fontsOK = await p.evaluate(async () => {
  const want = [];
  for (const f of ['Oswald', 'Montserrat']) for (const w of [400, 500, 600, 700]) want.push(`${w} 12px "${f}"`);
  // The display face ships in one weight only; asking for 400 would pass on a
  // synthesised grade and hide a missing file.
  want.push('900 12px "PlaqueIn"');
  want.push('900 12px "PlaqueOut"');
  await Promise.all(want.map((s) => document.fonts.load(s).catch(() => null)));
  await document.fonts.ready;
  return want.every((s) => document.fonts.check(s));
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
  });
  /* Clipped text is measured against the TRIM, once, for the whole sheet —
     not per panel and not against a hand-written selector list.
     The per-panel version had four holes: its boundary was the panel's BLEED
     edge, so the outer 3mm was a blind strip and text cut off by the
     guillotine passed; on inner panels the boundary was the fold crease, so a
     price ending on the fold passed; the cover was reassigned to .coverbody
     before the box was taken, so the spine was never tested at all; and the
     selector list missed .telline, .tel b, .allergy, .chips li, .kidsmark,
     .sizehdr, .spine b and .ticker. Walking text nodes needs no list. */
  const PX = 1610 / 426;                       // px per mm at this viewport
  document.querySelectorAll('.page').forEach((page, pi) => {
    const pr = page.getBoundingClientRect();
    const safe = { l: pr.left + 3 * PX, r: pr.right - 3 * PX, t: pr.top + 3 * PX, b: pr.bottom - 3 * PX };
    const w = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue;
      // The ticker band is a repeating strip cropped by the sheet edge by
      // design; everything else must sit inside the trim.
      if (n.parentElement.closest('.ticker')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) {
        if (!r.width || !r.height) continue;
        if (r.right > safe.r + 1 || r.left < safe.l - 1 || r.bottom > safe.b + 1 || r.top < safe.t - 1) {
          const key = n.textContent.trim().slice(0, 30);
          if (seen.has(key)) break;
          seen.add(key);
          bad.push(`page ${pi + 1}: "${key}" crosses the trim line`);
          break;
        }
      }
    }
  });
  return bad;
});

if (!fontsOK) console.error('FAIL: Oswald/Montserrat/Plaque faces did not load — the sheet is set in a fallback face');
console.log(overflow.length ? 'OVERFLOW:\n  ' + overflow.join('\n  ') : 'panels fit');

if (!fontsOK || overflow.length) {
  await b.close();
  console.error('PDF NOT written — fix the failure above first.');
  process.exit(1);
}

/* Run check-collisions.mjs itself rather than an inlined copy. The copy had
   drifted: it carried two of that script's three tests and silently dropped
   "photo escapes its section", so photos landing 13-24mm outside their section
   — over the section below — passed this gate while the standalone script
   exited 1 on five of them. A subset that calls itself the check is worse than
   no check, because it is trusted. */
try {
  execFileSync(process.execPath, [path.join(DIR, 'check-collisions.mjs')], { stdio: 'inherit' });
  /* The build can only check that two strings it was told agree; this reads
     the committed QR and compares it module by module. It was a README step,
     which meant a changed domain beside a stale QR printed clean. */
  execFileSync('python3', [path.join(DIR, 'verify-qr.py')], { stdio: 'inherit' });
} catch {
  await b.close();
  console.error('PDF NOT written — fix the failure above first.');
  process.exit(1);
}

const FINAL = path.join(DIR, 'big-bites-menu-A3-trifold.pdf');
const TMP = FINAL + '.tmp';
await p.pdf({
  path: TMP,
  width: '426mm', height: '303mm',
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  preferCSSPageSize: true,
});
/* The TrimBox below is stamped from constants. If the page did not come out
   426x303 those constants describe the wrong rectangle, and a preflight-driven
   cut follows the stamp — so assert the size the PDF actually has. */
{
  const mb = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(fs.readFileSync(TMP).toString('latin1'));
  if (!mb) throw new Error('no MediaBox found in the PDF');
  const [w, h] = [Number(mb[1]), Number(mb[2])];
  if (Math.abs(w - 1207.92) > 0.5 || Math.abs(h - 858.96) > 0.5) {
    fs.unlinkSync(TMP);
    console.error(`FAIL: page is ${(w * 25.4 / 72).toFixed(1)}x${(h * 25.4 / 72).toFixed(1)}mm, not 426x303 — the TrimBox constants do not apply.`);
    process.exit(1);
  }
}

/* The preview is what anyone reviews the sheet from, and at 1x its subpixel
   antialiasing invents letterspacing faults that do not exist in the PDF —
   verified by rasterising the real file at 300dpi. Render it at 2x so the
   proof matches the print. */
await p.emulateMedia({ media: 'screen' });
const hiCtx = await b.newContext({ viewport: { width: 1610, height: 1145 }, deviceScaleFactor: 2 });
const hi = await hiCtx.newPage();
await hi.goto('file://' + path.join(DIR, 'menu.html'), { waitUntil: 'networkidle' });
await hi.evaluate(() => document.fonts.ready);
await hi.waitForTimeout(400);
await hi.screenshot({ path: path.join(DIR, 'preview.png'), fullPage: true });
await hi.close();
await hiCtx.close();
await b.close();
const kb = Math.round(fs.statSync(TMP).size / 1024);

/* Chromium writes no TrimBox, so the 3mm bleed is indistinguishable from the
   page. Stamp one on both pages — 420x297mm centred in the 426x303 sheet.

   Splicing bytes into a PDF shifts every offset after the splice, which
   silently invalidates the cross-reference table: readers that rebuild the
   xref by scanning still open the file, which is exactly why pdfinfo and the
   font gate below reported success on a damaged one. So the whole table is
   regenerated from the object positions afterwards, and asserted. */
{
  const f = TMP;
  const pt = (mm) => (mm * 72 / 25.4).toFixed(2);
  const trim = `/TrimBox [${pt(3)} ${pt(3)} ${pt(423)} ${pt(300)}] `;
  let src = fs.readFileSync(f).toString('latin1');

  let stamped = 0;
  src = src.replace(/\/Type\s*\/Page(?![s])/g, (m) => { stamped++; return trim + m; });
  if (stamped !== 2) throw new Error(`TrimBox: expected 2 page objects, patched ${stamped}`);

  // Rebuild the cross-reference table from where the objects actually are now.
  const objs = new Map();
  for (const m of src.matchAll(/(?:^|[\r\n>\s])(\d+) 0 obj\b/g)) {
    objs.set(Number(m[1]), m.index + m[0].length - `${m[1]} 0 obj`.length);
  }
  const max = Math.max(...objs.keys());
  const trailer = /trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(src);
  if (!trailer) throw new Error('TrimBox: no trailer to carry over');

  src = src.slice(0, src.lastIndexOf('xref\n0 ') > 0 ? src.lastIndexOf('xref\n0 ') : src.length);
  const start = src.length;
  let table = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= max; i++) {
    table += objs.has(i)
      ? `${String(objs.get(i)).padStart(10, '0')} 00000 n \n`
      : '0000000000 65535 f \n';
  }
  const dict = trailer[1].replace(/\/Size\s+\d+/, `/Size ${max + 1}`);
  src += `${table}trailer\n<<${dict}>>\nstartxref\n${start}\n%%EOF\n`;
  fs.writeFileSync(f, Buffer.from(src, 'latin1'));

  // Assert it rather than trusting it: startxref must land on the keyword, and
  // every entry must land on its own object header.
  const out = fs.readFileSync(f).toString('latin1');
  const sx = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(out)[1]);
  if (out.slice(sx, sx + 4) !== 'xref') throw new Error('TrimBox: startxref does not point at the table');
  let bad = 0;
  for (const [n, off] of objs) if (!out.startsWith(`${n} 0 obj`, off)) bad++;
  if (bad) throw new Error(`TrimBox: ${bad} xref entries point at the wrong byte`);
  console.log(`TrimBox stamped on 2 pages; xref rebuilt (${objs.size} objects, all verified)`);
}

/* A name-only font check cannot see this: document.fonts.check() reports true
   for a family even when the glyph asked for is not in it, so Chromium was
   embedding DejaVu off the build machine for characters no vendored face
   carried. Read the PDF's own font list instead — that is the ground truth. */
try {
  /* TMP, not FINAL: the rename happens below, so pointing this at the final
     path made it inspect the PREVIOUS run's PDF — the gate reported the old
     file's fonts and would have passed a new one that embedded a stray. */
  /* Column 0 alone is not the test. pdffonts also reports emb/sub, and a font
     that is NAMED acceptably but not embedded travels as a reference to the
     printer's machine — the gate would print "fonts embedded: Oswald" about a
     font that is not in the file. Same shape as the name-only
     document.fonts.check() bug this replaced. */
  const rows = execFileSync('pdffonts', [TMP], { encoding: 'utf8' })
    .split('\n').slice(2).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 6);
  if (!rows.length) throw new Error('pdffonts reported no fonts at all');
  const allowed = /^(Oswald|Montserrat|ArchivoCd)/;
  const name = (r) => r[0].replace(/^[A-Z]{6}\+/, '');
  const fonts = rows.map(name);
  /* The TYPE column matters as much as the name. -webkit-text-stroke made
     Chromium emit a heading as a Type 3 font — procedural glyphs that RIPs
     render badly and some printers reject — and this gate passed it, because
     it was named acceptably and was embedded and subset. Third time this
     project has shipped a check that read the wrong column. */
  const strays = [...new Set(rows.filter((r) => {
    const emb = r[r.length - 4], sub = r[r.length - 3];
    const type = r.slice(1, -3).join(' ');
    return !allowed.test(name(r)) || emb !== 'yes' || sub !== 'yes' || /Type\s*3/i.test(type);
  }).map((r) => `${name(r)} [${r.slice(1, -3).join(' ')}] emb=${r[r.length - 4]} sub=${r[r.length - 3]}`))];
  if (strays.length) {
    fs.unlinkSync(TMP);
    console.error(`FAIL: a font is Type 3, not embedded, not subset, or not from the repo: ${strays.join(', ')}`);
    process.exit(1);
  }
  console.log(`fonts embedded: ${[...new Set(fonts)].join(', ')}`);
} catch (e) {
  if (e.status) throw e;
  /* Without pdffonts there is no ground truth on what got embedded, and this
     file goes to a printer — refuse rather than shipping unverified. */
  fs.unlinkSync(TMP);
  console.error('FAIL: pdffonts is unavailable, so the embedded fonts cannot be verified. Install poppler-utils.');
  process.exit(1);
}

/* The preview is the only thing anyone reviews, and it is produced by a
   DIFFERENT code path from the PDF — screen media, its own context. They
   diverged silently once: an element positioned below the page box renders on
   screen and is dropped by the print path, so the cover photograph was in the
   preview and absent from the PDF while every other gate passed. Compare them
   block by block; a global mean does not move enough to notice. */
try {
  execFileSync('python3', [path.join(DIR, 'verify-preview.py'), TMP], { stdio: 'inherit' });
} catch {
  fs.unlinkSync(TMP);
  console.error('PDF NOT written — the preview and the PDF disagree.');
  process.exit(1);
}

/* Only now does it become the real file: every assertion above ran against the
   temp copy, so a failure can never leave a corrupt PDF on disk under a
   "PDF written" message. */
fs.renameSync(TMP, FINAL);
console.log(`PDF written (${kb}KB)`);
