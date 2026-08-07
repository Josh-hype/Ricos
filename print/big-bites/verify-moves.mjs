/* Score the sheet against the owner's editor export.
 *   node verify-moves.mjs baseline      -> write the pre-change positions
 *   node verify-moves.mjs               -> compare current positions to target
 * Target = baseline position + the offset the owner dragged. Labels are built
 * by exactly the code build-editor.mjs uses, so they line up with the export.
 */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
import fs from 'node:fs';

const DIR = import.meta.dirname;
const want = JSON.parse(fs.readFileSync(`${DIR}/editor-export.json`, 'utf8'));
const mode = process.argv[2];

const b = await pw.chromium.launch({ args: ['--no-proxy-server'] });
const p = await b.newPage({ viewport: { width: 1610, height: 1145 } });
await p.goto('file:///home/user/Ricos/print/big-bites/menu.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(400);

const now = await p.evaluate(() => {
  const MM = 96 / 25.4;
  const panelNames = [];
  document.querySelectorAll('.page').forEach((pg) => {
    const face = pg.classList.contains('side-b') ? 'Inner' : 'Outer';
    pg.querySelectorAll('.panel').forEach((pn, ni) => panelNames.push({ el: pn, name: `${face} ${ni + 1}` }));
  });
  const panelOf = (el) => (panelNames.find((n) => n.el.contains(el)) || {}).name || '?';
  const out = {};
  const seen = new WeakSet();
  const add = (el, label) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    let lab = `${panelOf(el)} · ${label}`;
    let n = 1, base = lab;
    while (out[lab]) lab = `${base}-${++n}`;
    const r = el.getBoundingClientRect();
    const pr = (panelNames.find((q) => q.el.contains(el)) || {}).el?.getBoundingClientRect();
    out[lab] = {
      x: +((r.left - (pr ? pr.left : 0)) / MM).toFixed(1),
      y: +((r.top - (pr ? pr.top : 0)) / MM).toFixed(1),
      w: +(r.width / MM).toFixed(1),
      h: +(r.height / MM).toFixed(1),
    };
  };
  document.querySelectorAll('.blk').forEach((blk) => {
    const h = blk.querySelector('h3');
    const name = h ? h.textContent.trim().replace(/\s+/g, ' ') : 'section';
    if (h) add(h, `${name} plaque`);
    const ch = blk.querySelector('.sizehdr'); if (ch) add(ch, `${name} size chips`);
    blk.querySelectorAll('.items, .chips').forEach((u) => add(u, `${name} list`));
    blk.querySelectorAll('.deal').forEach((d) => {
      const bb = d.querySelector('b'); add(d, `${bb ? bb.textContent.trim() : 'deal'} box`);
    });
    add(blk.querySelector('.kidsmark'), 'Kids ribbon');
    add(blk.querySelector('.kidsticket'), 'Kids ticket');
  });
  document.querySelectorAll('.shot, .sscol, .kidslock, .coverart').forEach((img) => {
    // menu.html has no data-photo (the editor adds it during inlining), so
    // fall back to the filename — same name, same label either way.
    const srcOf = (e) => (e.getAttribute('src') || e.dataset.src || '').replace(/^img\/|\.png$/g, '');
    const n = img.getAttribute('data-photo') || srcOf(img)
      || srcOf(img.querySelector('img') || {})
      || (img.className.indexOf('coverart') >= 0 ? 'cover' : 'photo');
    add(img, `${n} photo`);
  });
  document.querySelectorAll('.supp').forEach((s) => add(s, 'stuffed crust bar'));
  add(document.querySelector('.brandmark'), 'logo');
  add(document.querySelector('.tel'), 'phone block');
  document.querySelectorAll('.cover .strap, .cover .strapline').forEach((s) => {
    add(s, `"${s.textContent.trim().slice(0, 22)}"`);
  });
  add(document.querySelector('.fine'), 'delivery small print');
  add(document.querySelector('.hours'), 'opening hours');
  add(document.querySelector('.qrwrap'), 'QR block');
  document.querySelectorAll('.ticker').forEach((t) => add(t, 'footer ticker'));
  return out;
});
await b.close();

if (mode === 'baseline') {
  fs.writeFileSync(`${DIR}/editor-baseline.json`, JSON.stringify(now, null, 1));
  console.log(`baseline written: ${Object.keys(now).length} blocks`);
  const missing = Object.keys(want).filter((k) => !now[k]);
  if (missing.length) { console.log('LABELS IN THE EXPORT THAT DO NOT MATCH A BLOCK:'); missing.forEach((m) => console.log('  ' + m)); }
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(`${DIR}/editor-baseline.json`, 'utf8'));
let worst = 0, n = 0;
const rows = [];
for (const [k, off] of Object.entries(want)) {
  if (!base[k] || !now[k]) { rows.push(`  ?? ${k} — no such block`); continue; }
  /* The editor scales about the CENTRE, and its x/y are the translate alone —
     so a block scaled up also has its left edge moved out by half the growth.
     Scoring left-edge-against-left-edge without that reads a correct rebuild
     as several millimetres wrong. */
  const gw = off.s ? base[k].w * (off.s / 100 - 1) / 2 : 0;
  const gh = off.s ? base[k].h * (off.s / 100 - 1) / 2 : 0;
  const tx = base[k].x + off.x - gw, ty = base[k].y + off.y - gh;
  const dx = +(now[k].x - tx).toFixed(1), dy = +(now[k].y - ty).toFixed(1);
  const d = Math.hypot(dx, dy);
  worst = Math.max(worst, d); n++;
  const sw = off.s ? `  size ${(100 * now[k].w / base[k].w).toFixed(0)}% (want ${off.s}%)` : '';
  rows.push(`  ${d < 2 ? 'ok  ' : 'OFF '} ${k.padEnd(38)} dx ${String(dx).padStart(6)}  dy ${String(dy).padStart(6)}${sw}`);
}
rows.sort();
rows.forEach((r) => console.log(r));
console.log(`\n${n} blocks scored, worst miss ${worst.toFixed(1)}mm`);
