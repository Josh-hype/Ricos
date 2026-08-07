/* Read the SHEET and check every fact on it against the shop's own data.
 * The build already proves the printed prices match menu.json (what the server
 * charges). This comes at it from the other end: what is on the paper, and is
 * anything missing, invented, or contradicted by config.json. */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
import fs from 'node:fs';

const SHOP = '/home/user/Ricos/data/shops/food-station';
const vis = JSON.parse(fs.readFileSync(`${SHOP}/menu-visual.json`, 'utf8'));
const cfg = JSON.parse(fs.readFileSync(`${SHOP}/config.json`, 'utf8'));
const cats = vis.categories || vis;

const b = await pw.chromium.launch({ args: ['--no-proxy-server'] });
const p = await b.newPage({ viewport: { width: 1610, height: 1145 } });
await p.goto('file:///home/user/Ricos/print/big-bites/menu.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);

const sheet = await p.evaluate(() => {
  const rows = [];
  document.querySelectorAll('.blk').forEach((blk) => {
    const sec = (blk.querySelector('h3')?.textContent || '').trim();
    blk.querySelectorAll('li').forEach((li) => {
      const n = li.querySelector('.n');
      if (!n) return;
      // the whole name cell minus its description, so "(5)" counts survive
      const clone = n.cloneNode(true);
      clone.querySelectorAll('em').forEach((e) => e.remove());
      const name = clone.textContent.replace(/\s+/g, ' ').trim();
      const prices = [...li.querySelectorAll('.p, .p2')].map((e) => e.textContent.trim());
      rows.push({ sec, name, prices });
    });
  });
  // the sections that are not price lists: dips chips, deal boxes, kids ticket
  document.querySelectorAll('.dipcols .chips li').forEach((li) => {
    const b = li.querySelector('b');
    rows.push({ sec: 'Dips', name: li.childNodes[0].textContent.trim(), prices: b ? [b.textContent.trim()] : [] });
  });
  document.querySelectorAll('.deal').forEach((d) => {
    d.querySelectorAll('b, .pd').forEach(() => {});
    const b = d.querySelector('b');
    d.querySelectorAll('p.pd').forEach((pd) => rows.push({ sec: 'Meal Deals', name: (b.textContent + ' ' + pd.textContent.replace(/£.*/, '')).trim(), prices: [pd.querySelector('strong')?.textContent.trim()] }));
    if (!d.querySelector('p.pd')) rows.push({ sec: 'Meal Deals', name: b.textContent.trim(), prices: [d.querySelector('strong')?.textContent.trim()] });
  });
  document.querySelectorAll('.kidsticket li, .kidsticket p, .kidsticket div').forEach(() => {});
  const txt = (s) => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    rows,
    tel: txt('.tel'),
    fine: txt('.fine'),
    hours: txt('.hours'),
    site: txt('.strap.website'),
    spine: txt('.spine'),
    allergy: txt('.allergy'),
    deals: [...document.querySelectorAll('.deal')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
    dips: txt('.dipcols'),
    kids: txt('.kidsticket') || txt('.kidsbox'),
  };
});
await b.close();

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const money = (p) => (p / 100).toFixed(2).replace(/\.00$/, '.00');
const problems = [];

/* every item in the data must be on the paper, and vice versa */
const printed = new Map();
sheet.rows.forEach((r) => printed.set(norm(r.name), r));
let checked = 0;
for (const c of cats) {
  for (const i of c.items || []) {
    checked++;
    const key = norm(i.name);
    if (printed.has(key)) { printed.delete(key); continue; }
    // milk shakes print the flavour only, coolers are folded into one row
    const flav = norm(String(i.name).replace(/milkshake|milk shake/gi, ''));
    if (printed.has(flav)) { printed.delete(flav); continue; }
    if (/cooler/i.test(i.name) && sheet.rows.some((r) => /cooler/i.test(r.name))) continue;
    // the kids box prints each meal's required-option text, not the item name
    if (/^kids/i.test(c.name) && sheet.kids && norm(sheet.kids).includes(norm(i.name).replace(/^kids /, ''))) continue;
    // a deal whose name carries the size prints as one box with a line each
    if (/^pizza deal/i.test(i.name) && sheet.rows.some((r) => /pizza deal/i.test(r.name))) continue;
    problems.push(`MISSING from the sheet: ${c.name} / ${i.name}`);
  }
}
printed.forEach((r, k) => {
  if (/^(cooler)$/.test(k)) return;
  problems.push(`ON THE SHEET but not in the data: ${r.sec} / ${r.name}`);
});

/* the cover's facts */
const phone = cfg.business.phone;
if (!sheet.tel.replace(/\s+/g, '').includes(phone.replace(/\s+/g, '')))
  problems.push(`phone on the sheet "${sheet.tel}" is not config's "${phone}"`);
const addr = cfg.business.address;
for (const part of [addr.line1, addr.city, addr.postcode])
  if (!norm(sheet.spine).includes(norm(part))) problems.push(`address part missing from the spine: ${part}`);
if (!norm(sheet.site).includes(norm(cfg.business.domain)))
  problems.push(`website strap "${sheet.site}" is not config's domain "${cfg.business.domain}"`);
const del = cfg.fulfillment.delivery;
const min = money(del.minimumOrderPence);
if (!sheet.fine.includes(min.replace(/\.00$/, ''))) problems.push(`minimum order ${min} not on the cover`);
if (!sheet.fine.includes(String(del.radius.maxMiles))) problems.push(`max miles ${del.radius.maxMiles} not on the cover`);
if (cfg.allergens?.noticeAtCheckout && !norm(sheet.allergy).includes(norm(cfg.allergens.noticeAtCheckout).slice(0, 40)))
  problems.push('allergen notice does not match config');

/* opening hours, day by day */
const hrs = cfg.hours || {};
const printedHours = sheet.hours.toLowerCase();
/* config stores windows[], not open/close on the day. Reading v.open gave
   undefined, so this check passed every day without testing anything. */
const h12 = (t) => { const [H, M] = t.split(':').map(Number);
  const ampm = H >= 12 ? 'pm' : 'am'; const h = H % 12 || 12;
  return M ? `${h}:${String(M).padStart(2, '0')} ${ampm}` : `${h} ${ampm}`; };
let daysChecked = 0;
for (const [day, v] of Object.entries(hrs)) {
  if (!v || typeof v !== 'object' || v.closed || !Array.isArray(v.windows)) continue;
  for (const w of v.windows) {
    daysChecked++;
    const want = `${h12(w.open)} - ${h12(w.close)}`.toLowerCase();
    if (!printedHours.replace(/\s+/g, ' ').includes(want))
      problems.push(`hours: ${day} is ${want} in config — the sheet prints "${sheet.hours}"`);
  }
}
console.log(`hours windows checked: ${daysChecked}`);
if (cfg.closures && cfg.closures['*'])
  problems.push('config still carries the indefinite closures["*"] rebrand closure — the sheet tells customers to order on the website, and the website refuses every order');

console.log(`items in the data: ${checked}   rows on the sheet: ${sheet.rows.length}`);
console.log(`tel     : ${sheet.tel}`);
console.log(`site    : ${sheet.site}`);
console.log(`spine   : ${sheet.spine}`);
console.log(`hours   : ${sheet.hours}`);
console.log(`terms   : ${sheet.fine}`);
console.log(`allergy : ${sheet.allergy}`);
console.log(`\n${problems.length ? problems.length + ' PROBLEM(S):' : 'no problems found'}`);
problems.forEach((x) => console.log('  - ' + x));
