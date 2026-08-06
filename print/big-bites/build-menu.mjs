/* Big Bites A3 trifold, print-ready.
 *
 *   node print/big-bites/build-menu.mjs
 *
 * Reads data/shops/food-station/menu-visual.json + config.json, so every price
 * on the printed menu is the same one the website and the till charge. Re-run
 * it after a price change and reprint — no retyping, no drift.
 *
 * Output: print/big-bites/menu.html  (then rendered to PDF by render.mjs)
 * A3 landscape 420x297mm + 3mm bleed = 426x303mm, three 140mm panels.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SHOP = path.join(ROOT, 'data/shops/food-station');
const OUT = path.join(import.meta.dirname, 'menu.html');
/* Delete the previous sheet BEFORE doing anything that can throw. Every one of
   the guards below writes nothing and exits 1 — which used to leave the last
   good menu.html sitting on disk for render.mjs to print. The operator sees a
   failed build, runs render anyway (the README lists them as two commands),
   and gets a PDF of yesterday's prices with every gate green. */
fs.rmSync(OUT, { force: true });

const menu = JSON.parse(fs.readFileSync(path.join(SHOP, 'menu-visual.json'), 'utf8'));
/* menu-visual.json is the DISPLAY file; menu.json (pence) is what the server
   actually charges from. Printing from the first while the customer is charged
   from the second is exactly the drift this tool claims to make impossible —
   and nothing was comparing them. build-shop.js skips size-priced modifiers
   entirely (`if (mod.priceDeltaPBySize) continue`), so a stuffed-crust
   supplement could read +3.50 on the sheet and charge £5.00 at the till with
   its invariant check reporting zero warnings. */
const server = JSON.parse(fs.readFileSync(path.join(SHOP, 'menu.json'), 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(SHOP, 'config.json'), 'utf8'));
/* Fingerprint of everything the sheet is generated FROM. render.mjs refuses
   to print a menu.html whose stamp doesn't match a freshly computed one, so a
   sheet that was never rebuilt after a data edit cannot reach the PDF. */
const BUILD_SRC = crypto.createHash('sha256').update(
  fs.readFileSync(path.join(SHOP, 'menu-visual.json')),
).update(
  fs.readFileSync(path.join(SHOP, 'config.json')),
).update(
  fs.readFileSync(new URL(import.meta.url)),
).digest('hex').slice(0, 16);

const qr = fs.readFileSync(path.join(import.meta.dirname, 'qr.svg'), 'utf8')
  .replace(/<\?xml[^>]*\?>\s*/, '');

/* qr.svg is a committed, pre-encoded file — nothing in a pure-Node build can
   read what is inside it, so the host it points at is recorded here and tied
   to config below. Everything else on the cover (phone, address, hours,
   delivery bands, minimum) is derived from config and reprints when config
   changes; the domain was the one fact hardcoded in two places, with no
   check that they agreed with each other or with the shop.

   That is not hypothetical: config's own _comment_domain records that the
   printed brand guidelines carry bigbiteseasingwold.uk, a domain the shop
   does NOT own. Printing an unverified host on 5,000 menus is that same
   mistake with a longer tail.

   To change the domain: regenerate qr.svg, then update this constant.
     python3 -c "import segno; segno.make('https://<host>', error='H').save('print/big-bites/qr.svg', scale=10)"
   Verify with print/big-bites/verify-qr.py, which re-encodes and compares
   the matrix rather than trusting this line. */
const QR_TARGET = 'https://bigbiteseasingwold.co.uk';

/* A renamed or missing category must kill the build — the fallback used to
   print a bare slug over zero items, and every check passed because less
   content never overflows. */
/* Drawn, not typed: no vendored face carries U+2605 or U+2192, so Chromium was
   quietly embedding DejaVu off the build machine for the star and the arrow.
   The sheet would set differently on another machine — or print .notdef boxes
   on a bare one — and the name-only font check could not see it. */
const STAR = '<svg class="gl" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.4l2.9 6.1 6.7.9-4.9 4.6 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6L2.4 9.4l6.7-.9z"/></svg>';
const ARROW = '<svg class="gl" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M3 12h17M13 5l7 7-7 7"/></svg>';

/* Every id this build actually places on a panel. A renamed or emptied
   category already throws; an ADDED one used to sail through — nothing
   referenced it, the sheet simply under-advertised, and every gate stayed
   green because less content never overflows. */
const usedCats = new Set();
const cat = (id) => {
  const c = menu.find((x) => x.id === id);
  if (!c || !c.items.length) throw new Error(`menu category "${id}" is missing or empty`);
  usedCats.add(id);
  return c;
};
/* The reference prints bare numbers — no currency mark anywhere on the sheet.
   Kept as one function so a change of mind is one line. */
const money = (n) => {
  /* Number(null) is 0, so a cleared price printed "0.00" — the item FREE —
     and the NaN backstop never saw a NaN. An admin console or a hand edit
     writes null for a cleared field, so this is the likely shape of the
     mistake, not an exotic one. Demand a real number. */
  /* > 0, not merely finite: a cleared numeric field yields 0 at least as
     readily as null, and 0 printed "0.00" — the item free — straight past the
     NaN/null backstop, because "0.00" is ordinary text. Nothing on this sheet
     is legitimately free. */
  if (typeof n !== 'number' || !(n > 0))
    throw new Error(`price is ${JSON.stringify(n)} — fix the shop data; do not print this.`);
  return n.toFixed(2);
};
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
/* Descriptions are bracketed on the sheet, and the shop writes them as
   sentences — "(Brushed With Garlic Butter.)" reads wrong, so the full stop
   comes off here rather than being edited out of the menu data. */
/* Descriptions print Title Case via CSS `capitalize`, which uppercases the
   first LETTER of each word — so "¼lb" came out "¼Lb", the fraction not being
   a letter. Weight units are wrapped so they render exactly as the shop
   wrote them; the casing stays in CSS for everything else. */
const descText = (s) => esc(String(s).trim().replace(/\.+$/, ''))
  .replace(/([¼½¾]\s*lb)/gi, '<span class="unit">$1</span>');

/* PNG dimensions straight out of the IHDR chunk — needed so a side photo can
   reserve its own height, which CSS can't work out for an absolutely
   positioned image. */
function imgSize(name) {
  const b = fs.readFileSync(path.join(import.meta.dirname, 'img', `${name}.png`));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/* Food photography, cut out of the sheet the owner supplied — see img/README.
   On the reference the photo sits at the panel's RIGHT EDGE and the price
   columns hug the item names to its left — prices are not flush right.
   `place: 'side'` does that; 'below' centres it underneath. Widths are capped
   by the source resolution; img/README records the dpi each lands at. */
const shotDpi = [];
function shot(name, width, place = 'side') {
  if (!name) return '';
  const { w, h } = imgSize(name);
  const tall = (width * h / w).toFixed(1);
  /* Record what each placement actually resolves to, so the documented figures
     cannot drift from the sheet the way they did when the photos were
     enlarged. Below 140dpi is too soft to send anywhere. */
  const exact = w / (width / 25.4);
  const dpi = Math.round(exact);
  shotDpi.push({ name, px: `${w}x${h}`, mm: width, dpi });
  // Test the exact value: rounding let 139.5dpi through a "140dpi floor".
  if (exact < 140) throw new Error(`${name}.png at ${width}mm is ${exact.toFixed(1)}dpi — too soft to print`);
  return `<img class="shot ${place}" src="img/${name}.png" alt=""
    style="width:${width}mm;--shoth:${tall}mm" />`;
}

/* The list reserves the photo's column with padding, so the price column lands
   just left of the picture and a long name wraps instead of running under it.
   `slot` reserves the same column with nothing in it — how a section whose
   artwork is still missing keeps the reference's geometry (the space stays
   empty until the asset exists). */
function withShot(inner, img, slot = 0, dots = false) {
  if (!img && !slot) return inner;
  if (img && (img.includes('below'))) return `${inner}${img}`;
  const num = (k) => +(new RegExp(`${k}:([\\d.]+)mm`).exec(img)?.[1] || 0);
  /* 'mid' photos float in the gap with the prices staying flush right, so
     they reserve no column — the collision check polices the overlap. */
  /* A 'mid' photo floats in the gap and reserves no column OF ITS OWN, but an
     explicit slot still applies — that is how the reference stops the calzone
     and kebab prices short of the trim while the photo sits behind them. */
  const mid = img && img.includes('mid');
  const w = mid ? slot : Math.max(img ? (num('width') || 30) + 4 : 0, slot);
  return `<div class="blkrow${dots ? ' dots' : ''}" style="--slot:${w.toFixed(1)}mm;
    --rowmin:${(num('--shoth') + 3).toFixed(1)}mm">${inner}${img}</div>`;
}

/* How far a section's size chips shift left so they sit over the price columns
   when a photo column is reserved to their right. */
/* The KIDS MENU / BIG BITES lockup. The owner supplies it as artwork; until
   the file is in img/ the plain type stands in, so the sheet still builds and
   still reads correctly — it just isn't the branded lockup yet.
   The supplied artwork is a complete panel: its own red ground, its own gold
   dotted border and its own illustrations. So when it is present the box drops
   its own dashed outline and padding on that side, or the sheet would print a
   framed card inside a framed card. */
/* The owner's Sides/Salad column: one cutout carrying the burger, the chips
   and nuggets with their dips, and the salad bowl, in that vertical order —
   the same stack the reference runs down this panel. It replaces the two
   separate sides.png / salad.png placements, so the food reads as one
   photograph rather than two pasted cutouts.
   Absolutely positioned like the other side photos: in the flow it would
   narrow the lists and drag the prices off the right margin. The lists keep
   their `slot` so a long item name wraps rather than running under it. */
function sidesSaladColumn() {
  const file = path.join(import.meta.dirname, 'img', 'sides-salad.png');
  if (!fs.existsSync(file)) return '';
  const { w, h } = imgSize('sides-salad');
  const WIDE = 62;
  const dpi = w / (WIDE / 25.4);
  if (dpi < 140) throw new Error(`sides-salad.png at ${WIDE}mm is ${dpi.toFixed(1)}dpi — too soft to print`);
  shotDpi.push({ name: 'sides-salad', px: `${w}x${h}`, mm: WIDE, dpi: Math.round(dpi) });
  return `<img class="sscol" src="img/sides-salad.png" alt=""
    style="width:${WIDE}mm;--ssh:${(WIDE * h / w).toFixed(1)}mm" />`;
}

/* The cover's lower flood. The reference fills the bottom of this panel with a
   pizza photograph; this is the owner's. It runs off the panel's left, right
   and bottom edges into the bleed, so there is no hard cut on the trim. */
function coverArt() {
  const file = path.join(import.meta.dirname, 'img', 'gpt-hero.png');
  if (!fs.existsSync(file)) return '<div class="coverart" aria-hidden="true"></div>';
  const { w, h } = imgSize('gpt-hero');
  const WIDE = 152;                       // 143mm panel + 9mm of bleed either side
  const dpi = w / (WIDE / 25.4);
  if (dpi < 140) throw new Error(`gpt-hero.png at ${WIDE}mm is ${dpi.toFixed(1)}dpi — too soft to print`);
  shotDpi.push({ name: 'gpt-hero', px: `${w}x${h}`, mm: WIDE, dpi: Math.round(dpi) });
  return `<div class="coverart" aria-hidden="true"><img src="img/gpt-hero.png" alt="" /></div>`;
}

function kidsLockup() {
  const file = path.join(import.meta.dirname, 'img', 'kids-lockup.png');
  if (!fs.existsSync(file)) {
    return '<div class="kidsmark"><b>Kids</b><b>Menu</b><span>Big Bites</span></div>';
  }
  const { w, h } = imgSize('kids-lockup');
  /* 46mm, not the ~52mm the reference gives it: the artwork is square, and
     panel 1 (Drinks / Milk Shakes / Desserts / Kids) has no spare height —
     48mm overflows it by 5px. The reference can afford a taller kids box
     because its Desserts list carries no descriptions; this shop's does. */
  const WIDE = 46;
  const dpi = w / (WIDE / 25.4);
  if (dpi < 140) throw new Error(`kids-lockup.png at ${WIDE}mm is ${dpi.toFixed(1)}dpi — too soft to print`);
  shotDpi.push({ name: 'kids-lockup', px: `${w}x${h}`, mm: WIDE, dpi: Math.round(dpi) });
  return `<img class="kidslock" src="img/kids-lockup.png" alt="Kids Menu — Big Bites"
    style="width:${WIDE}mm" />`;
}

function slotOf(img, slot) {
  if (img && img.includes('mid')) return slot;   // chips follow the prices
  return Math.max(img ? +(/width:([\d.]+)mm/.exec(img)?.[1] || 30) + 4 : 0, slot);
}

/* Every section header on the reference is a plaque with a dotted rule running
   the full width of the panel underneath it. */
function header(inner, aside = '', stop = 0) {
  /* `stop` pulls the rule up short of the photo column, as the reference does
     — its rules never cross the photography. */
  const s = stop ? ` style="margin-right:${stop.toFixed(1)}mm"` : '';
  return `<div class="headrow"><h3>${inner}</h3>${aside}</div><div class="hrule"${s}></div>`;
}

/* Size chips. The reference colours them per section: both red where the two
   sizes are the same kind of thing (11"/13"), gold then red where they are a
   step up (MEDIUM/LARGE, 1/4lb/1/2lb). */
function chips(headings, tone = ['gold', 'red'], shift = 0) {
  const style = shift ? ` style="margin-right:${shift.toFixed(1)}mm"` : '';
  return `<span class="sizehdr"${style}>${headings.map((h, i) => `<i class="${tone[i]}">${h}</i>`).join('')}</span>`;
}

/* Some items carry their whole description in a required choice rather than a
   desc field — Kids Sunny is "(4) & chips or Tenders (3) & chips". Printing
   just the name would lose that, as the first draft did. */
/* Portion counts — "(5)", "(12)" — are red on the reference, inside an
   otherwise white item name. */
const redCounts = (s) => s.replace(/\((\d+)\)/g, '<u>($1)</u>');

function choiceLine(i) {
  const o = (i.options || []).find((x) => x.required && x.select === 'single');
  return o ? o.choices.map((c) => c.label).join(' or ') : '';
}

/* A price list. `dense` drops the description to fit more in. */
function list(id, { dense = false, cols = 1, title = null, desc = false, img = '', choices = false, tone = '', slot = 0, chip = '', dots = false, cls = '' } = {}) {
  const c = cat(id);
  const rows = c.items.map((i) => {
    const d = i.desc || (choices ? choiceLine(i) : '');
    return `
      <li>
        <span class="n">${redCounts(esc(i.name))}${(desc || !dense) && d ? `<em>${descText(d)}</em>` : ''}</span>
        <span class="dots"></span>
        <span class="p">${money(i.price)}</span>
      </li>`;
  }).join('');
  return `
    <section class="blk${cls ? ' ' + cls : ''}">
      ${header(esc(title || c.name), chip ? chips([chip], ['red'], slotOf(img, slot)) : '', slotOf(img, slot))}
      ${withShot(`<ul class="items${cols > 1 ? ' two' : ''}${dense ? ' dense' : ''}${tone ? ' ' + tone : ''}">${rows}</ul>`, img, slot, dots)}
    </section>`;
}

/* Any list whose items carry a two-choice size option (pizza 11"/13",
   garlic bread the same, burgers ¼lb/½lb, kebabs medium/large). Prints both
   prices in their own columns, with the topping line under the name — exactly
   as the designer's sheet does. Items without the option get one price and a
   dash, which is how the reference handles Tray Doner and the like. */
function sizedList(id, optId, headings, { title = null, img = '', secondOnly = null, firstOnly = null, defaultCol = 1, tight = true, tone = ['gold', 'red'], nameTone = '', slot = 0, labels = null, chipsBelow = false } = {}) {
  const c = cat(id);
  const rows = c.items.map((i) => {
    const opt = (i.options || []).find((o) => o.id === optId);
    if (opt && (opt.choices.length !== 2 || Number(opt.choices[0].price || 0) !== 0))
      throw new Error(`${id}/${i.id}: size option no longer two choices with a free base — the column maths would misprint`);
    const up = opt && opt.choices[1];
    const p2 = up ? Number(i.price) + Number(up.price || 0) : null;
    /* A few items exist in ONE size only — a 500ml water is a bottle, not a
       can; the Piggy Burger is a ½lb, not a ¼lb — so their single price has
       to be told which column it belongs in. Search the description as well
       as the name: this shop states the size in the description on every
       burger that has no size option, and matching the name alone printed
       the Piggy Burger's £10 under "1/4 lb" while its own description read
       "½lb". Throw on an item that claims both, rather than silently
       picking one. */
    const text = `${i.name} ${i.desc || ''}`;
    let only2 = false;
    if (!opt) {
      const a = firstOnly ? firstOnly.test(text) : false;
      const b = secondOnly ? secondOnly.test(text) : false;
      if (a && b)
        throw new Error(`${id}/${i.id}: "${text.trim()}" names BOTH sizes, so which column its single price belongs in is ambiguous — split it into two items or give it a size option`);
      if (!a && !b && defaultCol == null)
        throw new Error(`${id}/${i.id}: "${text.trim()}" has no "${optId}" option and names neither size, so placing its price in a column would assert a size the data never claims. State the size in the name or description, or give it a size option.`);
      only2 = b;
    }
    return `
      <li>
        <span class="n">${esc(i.name)}${i.desc ? `<em>${descText(i.desc)}</em>` : ''}</span>
        <span class="dots"></span>
        <span class="p2">${only2 ? '-' : money(i.price)}</span>
        <span class="p2">${only2 ? money(i.price) : p2 != null ? money(p2) : '-'}</span>
      </li>`;
  }).join('');
  return `
    <section class="blk">
      ${chipsBelow
        ? `${header(esc(title || c.name))}
           <div class="chiprow" style="padding-right:${slotOf(img, slot).toFixed(1)}mm">${chips(labels || headings, tone)}</div>`
        : header(esc(title || c.name), chips(labels || headings, tone, slotOf(img, slot)), slotOf(img, slot))}
      ${withShot(`<ul class="items sized${tight ? ' withdesc' : ''}${nameTone ? ' ' + nameTone : ''}">${rows}</ul>`, img, slot)}
    </section>`;
}

/* The reference sets this list as flavours only — the repeated "Milkshake" is
   dropped — and folds the coolers into a single Cooler row with the flavours
   named underneath, rather than listing each one as its own item. Same items,
   same prices; presentation only. */
function milkshakes() {
  const c = cat('milkshakes');
  const isCooler = (i) => /cooler/i.test(i.name);
  const shakes = c.items.filter((i) => !isCooler(i));
  const coolers = c.items.filter(isCooler);
  const flavour = (n) => n.replace(/\s*(milkshake|cooler)\s*/ig, '').trim();
  const row = (name, price, sub, cls = '') => `
      <li><span class="n">${esc(name)}${sub ? `<em${cls ? ` class="${cls}"` : ''}>${descText(sub)}</em>` : ''}</span>
        <span class="dots"></span><span class="p">${money(price)}</span></li>`;
  return `
    <section class="blk">
      ${header('Milk Shakes')}
      ${withShot(`<ul class="items">
        ${shakes.map((i) => row(flavour(i.name), i.price)).join('')}
        ${coolers.length ? (() => {
          if (new Set(coolers.map((i) => Number(i.price))).size > 1)
            throw new Error('coolers no longer share one price — they cannot fold into a single row');
          return row('Cooler', coolers[0].price, coolers.map((i) => `${flavour(i.name)} Cooler`).join(', '), 'plain');
        })() : ''}
      </ul>`, shot('shake', 30), 52)}
    </section>`;
}

/* The reference gives Kids its own red box with a yellow keyline rather than a
   plaque heading — the "KIDS MENU / BIG BITES" ribbon does the heading's job.
   That ribbon is artwork we don't have, so the space is left for it. */
function joinKid(name, desc) {
  if (!desc) return esc(name);
  const words = name.split(' ');
  for (let k = 0; k < words.length; k++) {
    const suffix = words.slice(k).join(' ').toLowerCase();
    if (desc.toLowerCase().startsWith(suffix)) {
      const rest = desc.slice(suffix.length).replace(/^[,\s]+/, '');
      return esc(name) + (rest ? (rest.startsWith('(') ? ` ${descText(rest)}` : `, ${descText(rest)}`) : '');
    }
  }
  return `${esc(name)}, ${descText(desc)}`;
}

function kidsBox() {
  const c = cat('kids');
  return `
    <section class="blk kidsbox">
        ${kidsLockup()}
        <div class="kidsticket">
        <ul class="items kidslist">
          ${c.items.map((i) => {
            const d = i.desc || choiceLine(i);
            return `<li><span class="n">${joinKid(i.name, d)}</span>
              <span class="dots"></span><span class="p">£${money(i.price)}</span></li>`;
          }).join('')}
        </ul>
        </div>
    </section>`;
}

/* Meal deals get boxes, as on the reference: centred plaque, the deal's
   components each on their own line, and — alone on the sheet — a £ on the
   price, exactly as the reference sets these boxes. The reference also folds
   the two pizza deals into ONE box with a price per line; same deals, same
   prices, one box. */
function deals() {
  const c = cat('meal-deals');
  /* NOT `s || ''`: that turned a missing description into a deal box printed
     blank under a £17 price, which is exactly what the NaN/undefined backstop
     exists to catch — and it erased the evidence first. */
  const lines = (s) => {
    if (!String(s || '').trim()) throw new Error('a meal deal has no description — the box would print blank');
    return esc(s);
  };
  const pizzaDeals = c.items.filter((i) => /^pizza deal/i.test(i.name));
  const rest = c.items.filter((i) => !/^pizza deal/i.test(i.name));
  const box = (i) => `
        <div class="deal">
          <b>${esc(i.name)}</b>
          <p>${lines(i.desc)}</p>
          <strong>£${money(i.price)}</strong>
        </div>`;
  const pizzaBox = pizzaDeals.length ? `
        <div class="deal">
          <b>Pizza Deal</b>
          ${pizzaDeals.map((i) => `<p class="pd">${lines(i.desc)}<strong>£${money(i.price)}</strong></p>`).join('')}
        </div>` : '';
  return `
    <section class="blk dealsblk">
      <div class="center dealshead">${header('Meal Deals')}</div>
      <div class="deals grow">
        ${rest.map(box).join('')}
        ${pizzaBox}
      </div>
    </section>`;
}

/* Dips: the flat-rate ones as a tick list, the dearer pots called out. */
function dips({ img = '' } = {}) {
  const c = cat('dips');
  /* The headline price is READ from the data, not typed: the flat-rate dips
     are whichever price most of them share, and it must actually be flat. */
  const counts = {};
  c.items.forEach((i) => { counts[i.price] = (counts[i.price] || 0) + 1; });
  const base = Number(Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0]);
  const flat = money(base);
  const cheap = c.items.filter((i) => Number(i.price) === base);
  const dear = c.items.filter((i) => Number(i.price) !== base);
  if (cheap.length < 2) throw new Error('dips no longer share a flat rate — the "(£x)" headline would lie');
  return `
    <section class="blk">
      <div class="redhead">${header(`Dips <span class="hdr2">(£${flat})</span>`)}</div>
      ${withShot(`<div class="dipcols">
      <ul class="chips three">${cheap.map((i) => `<li>${esc(i.name)}</li>`).join('')}${
        dear.map((i) => `<li>${esc(i.name)} <b>${money(i.price)}</b></li>`).join('')}</ul>
      </div>`, img)}
    </section>`;
}

/* The stuffed-crust supplement is a per-size modifier on every pizza; read it
   off the first one rather than hard-coding it. */
function stuffedCrust() {
  /* One printed line covers every pizza, so it must be true of every pizza —
     scan them all and refuse to print if the supplement isn't uniform. */
  const sts = cat('pizza').items.map((pz) => {
    const crust = (pz.options || []).find((o) => o.id === 'crust');
    return crust && crust.choices.find((x) => x.id === 'stuffed');
  }).filter(Boolean);
  if (!sts.length) return '';
  const key = (s) => `${s.price}/${s.priceBySize?.sz11 ?? ''}/${s.priceBySize?.sz13 ?? ''}`;
  if (new Set(sts.map(key)).size > 1)
    throw new Error('stuffed-crust supplement differs between pizzas — one printed line cannot cover them');
  const st = sts[0];
  const by = st.priceBySize || {};
  const p11 = by.sz11 ?? st.price;
  const p13 = by.sz13 ?? st.price;
  return `<div class="supp"><span>Stuffed Crust Supplement</span><i></i><b>+${money(p11)}</b><b>+${money(p13)}</b></div>`;
}

/* The printed label hardcodes the Sun-Thu / Fri-Sat grouping, so refuse to
   build if the config stops matching it — otherwise the sheet lies. */
{
  const w = (d) => JSON.stringify(cfg.hours[d]?.windows ?? null);
  for (const d of ['monday', 'tuesday', 'wednesday', 'thursday'])
    if (w(d) !== w('sunday')) throw new Error(`hours: ${d} differs from sunday — reword the printed grouping`);
  if (w('saturday') !== w('friday')) throw new Error('hours: saturday differs from friday — reword the printed grouping');
  if (cfg.hours.sunday.windows.length !== 1 || cfg.hours.friday.windows.length !== 1)
    throw new Error('hours: split windows — the printed one-line-per-group format cannot show them');
}

const hours = [
  ['Sunday - Thursday', cfg.hours.sunday.windows[0]],
  ['Friday - Saturday', cfg.hours.friday.windows[0]],
].map(([label, w]) => {
  const t = (s) => { const [h, m] = s.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12; return m ? `${hh}.${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`; };
  return `<div><span>${label}</span><b>${t(w.open)} - ${t(w.close)}</b></div>`;
}).join('');

const site = cfg.business.domain;
if (QR_TARGET !== `https://${site}`) {
  throw new Error(
    `the QR encodes ${QR_TARGET} but config.business.domain is "${site}".\n` +
    '  Regenerate qr.svg for the new host and update QR_TARGET — do not print a QR that goes somewhere else.');
}
const del = cfg.fulfillment.delivery;
/* "£X per mile, up to N miles" is only a true statement while the bands are
   linear — refuse to print it the moment they aren't. */
if (del.mode !== 'radius') throw new Error('cover copy assumes radius delivery — rewrite it for the new mode');
const bands = del.radius.bands;
bands.forEach((bd, i) => {
  if (bd.feePence !== (i + 1) * bands[0].feePence)
    throw new Error('delivery bands are no longer per-mile linear — rewrite the cover copy');
});
const maxMiles = del.radius.maxMiles;
const perMile = bands[0].feePence / 100;

const icon = (kind) => {
  const disc = '<circle cx="12" cy="12" r="12" fill="#d61313"/>';
  const art = kind === 'phone'
    ? '<path fill="#fff" d="M9.1 5.6c.5-.2 1 0 1.3.5l1.1 2c.2.5.1 1-.3 1.3l-.9.8c-.1.1-.2.3-.1.5a8.6 8.6 0 0 0 3.1 3.1c.2.1.4 0 .5-.1l.8-.9c.3-.4.8-.5 1.3-.3l2 1.1c.5.3.7.8.5 1.3l-.5 1.4c-.2.6-.8 1-1.5.9-2.3-.2-4.6-1.4-6.4-3.2S5.1 9.5 4.9 7.2c-.1-.7.3-1.3.9-1.5z"/>'
    : '<circle cx="12" cy="12" r="7.4" fill="none" stroke="#fff" stroke-width="1.6"/>'
      + '<path fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" d="M12 7.6V12l3 1.9"/>';
  return `<i class="ico"><svg viewBox="0 0 24 24">${disc}${art}</svg></i>`;
};

/* Split the phone so it sets as the reference does: dialling code on the line
   with the icon, the number itself oversized underneath. */
const phone = esc(cfg.business.phone);
const [phoneCode, ...phoneRest] = phone.split(' ');

const cover = `
  <div class="panel cover">
    <div class="coverbody">
      <img class="brandmark" src="logo.png" alt="Big Bites — Slice It! Fresh &amp; Loaded" />
      <div class="coverrule"></div>
      <div class="tel">
        <span class="telline">${icon('phone')}Tel : ${phoneCode}</span>
        <b>${phoneRest.join(' ')}</b>
      </div>
      <div class="strap plain">Delivery Service or Collection</div>
      <!-- The minimum is DELIVERY-only (functions/_lib/totals.js applies it
           under fulfillment === 'delivery'), so it says so rather than reading
           as though collection carried it too. The £1 online service charge is
           deliberately NOT printed here — the owner's call, 2026-08-06. -->
      <p class="fine">
        Order on our website for collection or delivery.<br />
        Easingwold — £${perMile.toFixed(2)} per mile (rounded up), up to ${maxMiles} miles.<br />
        Minimum delivery order £${(del.minimumOrderPence / 100).toFixed(2).replace(/\.00$/, '')}.
      </p>
      <div class="strapline">${icon('clock')}<div class="strap">Opening Time</div></div>
      <div class="hours">${hours}</div>
      <div class="strap red website">${esc(site)}</div>
      <div class="qrwrap">
        <div class="qrtxt"><b>SCAN<br />ME</b><span class="arrow">${ARROW}</span></div>
        <div class="qr">${qr}</div>
      </div>
      ${cfg.allergens?.noticeAtCheckout ? `<p class="allergy"><b>Allergies?</b> ${esc(cfg.allergens.noticeAtCheckout)}</p>` : ''}
    </div>
    ${coverArt()}
    <div class="spine">
      <b>Big Bites</b>
      <span>${esc(cfg.business.address.line1)}, ${esc(cfg.business.address.city)}, ${esc(cfg.business.address.postcode)}</span>
    </div>
  </div>`;

const ticker = (n = 6) =>
  `<div class="ticker">${Array.from({ length: n }, () => `<span>SLICE IT</span><i>${STAR}</i><span>BIG BITES</span><i>${STAR}</i><span>FRESH &amp; LOADED</span><i>${STAR}</i>`).join('')}</div>`;

const page = (cls, panels, foot = true) => `
  <div class="page ${cls}">
    ${panels}
    ${foot ? ticker() : ''}
  </div>`;

const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8" />
<meta name="build-src" content="${BUILD_SRC}" /><meta name="build-out" content="__BUILD_OUT__" />
<title>Big Bites — A3 trifold menu</title>
<style>
  /* Vendored, not fetched: the sheet must set identically on any machine, and
     a blocked network was silently swapping in fallback faces. Static per-
     weight files — the css2 endpoint serves one variable file for every
     weight, which Chromium faux-bolds into broken letterspacing. */
  @font-face { font-family: 'Montserrat'; font-weight: 400; src: url(fonts/Montserrat-400.ttf) format('truetype'); }
  @font-face { font-family: 'Montserrat'; font-weight: 600; src: url(fonts/Montserrat-600.ttf) format('truetype'); }
  @font-face { font-family: 'Montserrat'; font-weight: 700; src: url(fonts/Montserrat-700.ttf) format('truetype'); }
  @font-face { font-family: 'Oswald'; font-weight: 400; src: url(fonts/Oswald-400.ttf) format('truetype'); }
  @font-face { font-family: 'Oswald'; font-weight: 500; src: url(fonts/Oswald-500.ttf) format('truetype'); }
  @font-face { font-family: 'Oswald'; font-weight: 600; src: url(fonts/Oswald-600.ttf) format('truetype'); }
  @font-face { font-family: 'Oswald'; font-weight: 700; src: url(fonts/Oswald-700.ttf) format('truetype'); }
  @font-face { font-family: 'PlaqueIn';  font-weight: 900; src: url(fonts/ArchivoCd62-900.ttf) format('truetype'); }
  @font-face { font-family: 'PlaqueOut'; font-weight: 900; src: url(fonts/ArchivoCd75-900.ttf) format('truetype'); }
</style>
<style>
  /* ---- print geometry -------------------------------------------------
     A3 landscape 420x297mm, 3mm bleed all round -> 426x303mm trim box.
     Three equal 140mm panels. For a Z (concertina) fold equal thirds is
     correct; for a roll fold the tucked panel wants ~2mm shaving, which the
     printer will advise on. ------------------------------------------- */
  @page { size: 426mm 303mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #000; }
  /* Three families, each earning its place by measurement against the
     reference artwork. Two numbers decide the display face, both taken at
     matched cap height: STEM/CAP (how heavy) and ADVANCE/CAP (how wide).
     The reference measures stem/cap 0.275, advance/cap 0.665 on the inner
     face and 0.767 on the outer.

       face                        stem/cap   advance/cap
       Archivo wght900 wdth62        0.266       0.673   <- inner plaques
       Archivo wght900 wdth75        0.285       0.800   <- outer plaques
       Barlow Condensed Black        0.269       0.648
       Saira Condensed Black         0.262       0.665
       Oswald Bold                   0.221       0.644
       Anton                         0.193       0.510
       Archivo Black (wdth100)       0.321       1.045

     The reference sets its OUTER plaques heavier than its inner ones (0.322
     against 0.266). Barlow Condensed Black ships one weight, so round 4 got
     the extra weight from -webkit-text-stroke — which made Chromium emit the
     heading as a **Type 3** font, procedural glyphs that RIPs render badly
     and some printers reject outright. A press defect traded for a type
     match is not a trade worth making, and the font gate did not catch it
     because it read pdffonts' name and emb columns but not its TYPE column.
     Archivo is a two-axis variable font, so both faces come from real static
     instances cut at build time: wdth 62 matches the inner target almost
     exactly, wdth 75 gets the outer within 11% with no stroke anywhere.

     Read off the outlines with fontTools, not off a screenshot. Oswald Bold
     was the display face for three rounds and is 20% too light — and Anton,
     the obvious "heavy poster" answer, is *lighter still* relative to its
     cap: it is a tall-cap face, so its stems are thin against the caps even
     though the type looks black on the page. Archivo Black has the weight
     but is 58% too wide and cannot be tracked back in. Only the width is
     adjustable after the fact (letter-spacing, below); the weight is not,
     so the weight picks the face. */
  body { font-family: 'Oswald', system-ui, sans-serif; }
  .blk h3, .strap, .kidsmark, .tel b, .qrtxt b {
    font-family: 'PlaqueIn', 'Oswald', system-ui, sans-serif; font-weight: 900;
  }
  /* Marketing copy — not the price lists — is a normal-width sans on the
     reference, where this sheet had the condensed face everywhere. The deal
     cards are marketing copy: on the reference the price is set in the SAME
     face and weight as the card body, which is what makes it the card's
     anchor. Setting it in the condensed face left it 30% light. */
  .deal p, .chips li, .fine, .hours, .allergy, .sizehdr i, .qrtxt span, .telline,
  .deal b, .deal strong {
    font-family: 'Montserrat', system-ui, sans-serif;
  }

  .page {
    position: relative;
    width: 426mm; height: 303mm;
    display: grid;
    /* The outer columns are 3mm wider than the trim panel: that extra strip IS
       the bleed, and it belongs to the panel so its own overflow:hidden stops
       clipping every element that is meant to run off the sheet. Giving the
       page the padding instead put a hard cut exactly on the trim line. */
    grid-template-columns: 143mm 140mm 143mm;
    background: #030303;
    overflow: hidden;
    page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }

  /* The inner face bleeds its header plaques off the top trim and carries no
     ticker, so its panels run tighter to every edge. */
  .side-b .panel { --pt: 3mm; --pr: 6mm; --pb: 4mm; --pl: 6mm; }
  .side-b .blk:first-child h3 { margin-top: 0; }
  /* The outer face runs nearly as tight to its edges as the inner one. */
  .side-a .panel { --pt: 5mm; --pr: 8mm; --pb: 13mm; --pl: 8mm; }
  .panel {
    position: relative;
    /* Pinned, not implicit: as a grid item the panel would otherwise STRETCH
       to its content and push past the 303mm page, and the overflow check
       (scrollHeight vs clientHeight, both grown) would pass while the print
       clipped — which is exactly what happened to the kids box. */
    height: 303mm;
    /* Spread the sections down the panel instead of stacking them at the top
       and leaving a hole above the fold ticker — the reference sheet does the
       same. On a panel that exactly fills, this is a no-op. */
    display: flex; flex-direction: column; justify-content: flex-start;
    --pt: 8mm; --pr: 7mm; --pb: 13mm; --pl: 7mm;
    padding: calc(var(--pt) + 3mm) var(--pr) calc(var(--pb) + 3mm) var(--pl);
    border-right: 0.55mm solid #f9b902;   /* fold guide, and the reference's gold rule */
    /* Flat near-neutral black, as the reference is: it samples (1,2,3) at the
       top to (9,13,14) at the foot, with no cast. A gold radial here put
       (24,21,10) across the upper 40% of the sheet — a visible warm ramp
       against the reference's flat ground, and on press a large flat area is
       exactly where a gradient bands. The fine speckle stays: it is the
       paper texture, not a cast. */
    background:
      radial-gradient(circle at 50% 50%, rgba(255,255,255,.035) .12mm, transparent .13mm) 0 0 / .9mm .9mm,
      #050607;
    color: #fff;
    overflow: hidden;
  }
  /* Sections keep their natural height. The slack goes to the LAST block on
     the panel rather than being spread through every gap, which is what left
     the reference's tight sections floating far apart. */
  .panel > * { flex: none; }
  .panel > *:last-child { margin-top: auto; }
  /* Never the cover: its children are the body and the spine, and pushing the
     spine down left the top 38% of the sheet edge bare. */
  .side-b .panel > *:last-child, .panel.cover > *:last-child { margin-top: 0; }
  .panel:nth-child(3) { border-right: 0; }
  /* The bleed strip sits on the outer edge of the outer panels. */
  .page > .panel:nth-child(1) { padding-left: calc(var(--pl) + 3mm); }
  .page > .panel:nth-child(3) { padding-right: calc(var(--pr) + 3mm); }

  /* Following the designer's section order puts five blocks on the inner
     middle panel against three elsewhere, so that one panel carries tighter
     leading — the same trade the reference sheet makes. Scoped to the panel
     rather than applied globally, so the roomier panels stay roomy. */
  /* Five sections against three elsewhere. The plaques are held at the
     reference's size (0.94x the roomy panels) and the 1.3mm that costs is
     taken out of the gaps between blocks instead — render.mjs reported a 5px
     overrun here when it was not. */
  .panel.tight .blk { margin-bottom: 2.4mm; }
  .panel.tight .blk h3 { font-size: 10mm; margin-bottom: 0; }
  .panel.tight .hrule { margin: .4mm 0 .9mm; }
  .panel.tight .items.dense li { padding: 0; font-size: 2.95mm; }
  /* Five sections against three elsewhere, and this shop carries a description
     on nearly every one of them where the reference carries almost none — so
     the panel keeps the reference's look at a slightly smaller size rather than
     dropping the descriptions. */
  .panel.tight .items .n em { font-size: 2.55mm; }

  /* ---- section blocks ---- */
  .blk { margin-bottom: 1.5mm; }
  /* ---- header plaque ----
     The owner's bitten-corner plaque, levelled (the source art was tilted
     4.45°) and used as a border-image so the bite and the ragged ends keep
     their shape while only the middle stretches to the width of the label.
     Painting it as a plain background would smear the bite wider on a long
     header and squash it on a short one.

     The slice numbers are source pixels of img/header-plaque.png (809×240) —
     the right slice has to cover the bite, which starts at x=736. The widths
     are in em so the plaque stays in proportion on the smaller headings the
     tight panel uses. No background-colour: the bite is transparent, and a
     colour behind it would fill the notch back in. */
  .blk h3 {
    display: inline-block;
    /* The plaque is rotated, so its lower-left corner reaches below the slab.
       With no margin it dug 2-2.5mm into the first row of its own list and,
       on the tight panel, into the last row of the section above. */
    margin: .8mm 0 1.6mm;
    /* The reference's plaques carry air around the word — chunky slabs, not
       tight labels — and one shared width per column, not shrink-to-fit. */
    padding: .1em .3em .1em .28em;
    min-width: 26mm;
    border-style: solid; border-color: transparent;
    /* 18/85/20/25 source px at the height this header renders — solving
       240k = 1.05 + 0.4 + 38k gives k = 0.00718em per source pixel. Get these
       wrong and the bite comes out squashed or stretched. */
    border-width: .129em .61em .144em .179em;
    border-image: url(img/header-plaque.png) 18 85 20 25 fill stretch;
    color: #111;
    font-size: 11mm; line-height: 1;
    /* Width is set by tracking, not by the face — see the type note above.
       Barlow Condensed Black measures 0.648 advance/cap; the reference's
       inner face is 0.665, so the inner needs almost nothing. Tracking adds
       a gap after every letter but only n-1 of them fall inside the word's
       ink, so the spacing needed is (target - base) * cap/em * n/(n-1). */
    letter-spacing: 0;
    /* Was -.08em, tuned for a face whose word space was wide and which was
       set with POSITIVE tracking. Archivo's outer instance is tracked
       negative and the two compounded, closing "MILK SHAKES" and "MEAL DEALS"
       into single words. The word gap is left alone now. */
    word-spacing: 0;
    /* A plaque must never wrap: it shares its row with the size chips, and a
       heading that breaks onto a second line adds ~10mm to its panel and
       overflows it. "Garlic Bread" did exactly that when the word gap widened
       by a millimetre. */
    white-space: nowrap;
    text-transform: uppercase;
    transform: rotate(-3.2deg);
  }
  /* Inner-face plaques run wider on the reference; long words tighten their
     tail so they stop overshooting. Kept as its own rule — folding it into the
     block above once swallowed the plaque, the black text and the caps for the
     whole outer face. */
  /* The reference's inner plaques never go below 46mm of slab and mostly run
     54mm+; at 34mm the short words (PIZZA, WRAP, SALAD) came out 25-34% narrow
     and read as labels rather than the chunky slabs next to them. The
     border-image slices add ~9mm at this size, so 46 puts the floor at ~55. */
  .side-b .blk h3 { min-width: 46mm; }
  /* Part of the headline on the reference — same size, weight and baseline. */
  .blk h3 .hdr2 { margin-left: 2mm; }
  /* Every heading on the reference has a dotted rule running the full width of
     the panel underneath it. The header itself is inline-block and rotated, so
     the rule is its own element rather than a border. */
  /* Bright, widely-spaced dots — on the reference these read as a deliberate
     rule, not a faint hairline. A repeating gradient gives control over the
     pitch that a plain dotted border does not. */
  .hrule {
    margin: .8mm 0 1.8mm; height: .45mm;
    background: repeating-linear-gradient(to right,
      rgba(255,255,255,.92) 0 .3mm, transparent .3mm 1.5mm);
  }
  /* The outer face runs its dotted rules BETWEEN sections instead — under the
     lists, not under the plaques. Same rule, different position. */
  .side-a .hrule { display: none; }
  /* The 11mm plaque is the inner face's scale — the reference's outer face
     runs a slightly smaller one over shorter lists.
     The outer face is also set noticeably WIDER than the inner: 0.767
     advance/cap against 0.665. That is a real difference on the artwork, not
     an accident of measurement — all four outer headings sit above every one
     of the nine inner ones. 0.08em of tracking carries Barlow's 0.648 up to
     it. */
  .side-a .blk h3 {
    min-width: 52mm; font-size: 11.5mm; letter-spacing: -.023em;
    font-family: 'PlaqueOut', 'Oswald', system-ui, sans-serif;
  }
  /* The reference sets DIPS smaller than its sibling outer headings (cap 7.2
     against DRINKS/DESSERTS at 9.3) and starts the middle panel 7.7mm lower.
     Uniform sizing pushed this panel's first ink to y=3.6mm against the
     reference's 11.3. margin-top overrides the margin:0 on .blk h3. */
  .side-a .redhead h3 { min-width: 44mm; font-size: 8.3mm; margin-top: 4.5mm; }
  /* MEAL DEALS is stepped down hard on the reference — its plaque measures
     42px tall against DRINKS' 63px on the same sheet, 0.67x. It sits over the
     widest block on the panel, so at full size it fights the deal cards
     instead of introducing them. Every other outer heading stays at 10.5mm.
     Scoped ".side-a .dealshead h3" (0,2,1), NOT ".dealshead h3" (0,1,1):
     the plain form loses to ".side-a .blk h3" above and was silently doing
     nothing, which is why this heading measured the same size as DRINKS. */
  .side-a .dealshead h3 { font-size: 7.9mm; min-width: 44mm; letter-spacing: -.023em; font-family: 'PlaqueOut', 'Oswald', system-ui, sans-serif; }
  /* Same bold dots as .hrule — these were left on a thin dotted border when
     the header rules were rebuilt, so they read as a hairline. */
  /* Every section on the outer face closes with a dotted rule EXCEPT the one
     directly above the Kids box (its own border does that job). That used to
     be expressed as :nth-last-of-type(2) — second from last — which is true of
     the block above the kids box on the four-block left panel, but ALSO true
     of Dips on the two-block middle panel. So the middle panel, which has
     exactly one divider to draw, drew none, and the dips grid trailed off into
     black. Target the kids box directly instead of counting positions. */
  .side-a .panel .blk:not(:last-of-type) {
    padding-bottom: 2.0mm; position: relative;
  }
  .side-a .panel .blk:not(:last-of-type)::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: .45mm;
    background: repeating-linear-gradient(to right,
      rgba(255,255,255,.92) 0 .3mm, transparent .3mm 1.5mm);
  }
  /* AFTER the rule above, not before it: content:none set first is simply
     overwritten by content:'' and the exclusion does nothing. An explicit
     class, not :has(+ .kidsbox) — the marker belongs on the block that opts
     out, where it can be read at the call site. */
  .side-a .panel .blk.norule { padding-bottom: 0; }
  .side-a .panel .blk.norule::after { content: none; }
  .side-a .kidsbox { border-bottom: 0; }

  /* ---- food photography ----
     The cutouts arrive on transparency, so they drop straight onto the panel.
     The shadow is added here rather than baked in, so it stays consistent and
     survives a colour change to the panel. */
  .blkrow { position: relative; min-height: var(--rowmin, 0); }
  .shot { height: auto; display: block; filter: drop-shadow(0 1.2mm 1.8mm rgba(0,0,0,.65)); }
  /* At the panel's right edge; the list's own padding keeps the text clear. */
  /* The reference runs its photos large and lets the panel edge crop them. */
  .shot.side { position: absolute; top: 50%; translate: 0 -50%; right: -7mm; }
  /* The reference holds its outer-face photos well clear of the fold; a crease
     through artwork sitting on the rule is a real print risk. */
  .side-a .shot.side { right: 12mm; }
  /* The reference runs its cake hard against the panel edge, which is what
     lets the Desserts prices reach the same right margin as Milk Shakes'.
     Inset 12mm like the others, the photo ate the column and the prices sat
     11mm further left than every other section on the panel. */
  .side-a .dessertblk .shot.side { right: 2mm; }
  /* right:30mm put this 6mm into the price column, which only read because a
     blurred shadow was propping the numerals up. Clear of them now. */
  .shot.mid { position: absolute; top: 50%; translate: 0 -50%; right: 38mm; z-index: 0; }
  .blkrow .items { position: relative; z-index: 1; }
  .shot.below { margin: 3mm auto 0; }
  /* The reference sets the pizza on a gold halftone. Generated, not drawn. */
  .halftone {
    /* Out of the flow and cropped by the panel, so the list gets the whole
       column — which is how the reference fits 32 pizzas at this size. */
    /* Below the list's last price row rather than through it. The list runs to
       the foot of the panel now, so the photograph takes the corner and bleeds
       off two edges instead of sitting under the numerals. */
    position: absolute; right: 1mm; bottom: 1mm; display: flex; justify-content: flex-end; align-items: flex-end;
    /* Behind the prices: the reference tucks the pizza under the stuffed-crust
       line rather than over it, and white numerals on a photo are unreadable. */
    z-index: 0;
    padding: 0;
  }
  .blkrow .items { padding-right: var(--slot, 0mm); }
  .blkrow.dots .shot { position: absolute; z-index: 1; }

  .items { list-style: none; margin: 0; padding: 0; }
  .items.two { column-count: 2; column-gap: 6mm; }
  .items li {
    display: flex; align-items: baseline; gap: 1.5mm;
    break-inside: avoid;
    font-size: 4.7mm; line-height: 1.14;
  }
  .items li { padding: .45mm 0; }
  .items.dense li { font-size: 3.4mm; padding: 0; }
  /* Salad is three items at the foot of a panel whose Sides list runs to
     twenty-four. The reference sets it 1.4x the Sides line rather than
     leaving a short list stranded in white space — measured off the artwork,
     Sides 10px band against Salad 14px. Scoped to this section only. */
  .saladblk { margin-top: 7.5mm; }
  .saladblk .items.dense li { font-size: 4.75mm; padding: .5mm 0; }
  .saladblk .items .n em { font-size: 3.3mm; }
  /* Reference stem/cap is ~0.15 — a Regular. This was set a full weight
     heavier, which is why the lists read as shouty next to it. */
  .items .n { font-weight: 500; text-transform: uppercase; letter-spacing: .005em; }
  /* Reference palette: item names white, the line under them red. The pizza
     column inverts it — gold names, white toppings — which is what makes that
     panel read as the headline list. */
  /* Descriptions run in red and in Title Case on the reference, bracketed on
     every panel except pizza. capitalize does the casing so the menu data stays
     as the shop wrote it. */
  .items .n em {
    display: block; font-style: normal; font-weight: 400;
    text-transform: capitalize; font-size: 3.7mm; line-height: 1.1;
    /* see descText: capitalize would render "¼lb" as "¼Lb" */
    color: #f73a2e; margin-top: .1mm;
  }
  .items .n em::before { content: '('; }
  .items .n em::after { content: ')'; }
  .items.gold .n em::before, .items.gold .n em::after { content: none; }
  /* A sub-line that is part of the name, not a description — the cooler
     flavours. White, unbracketed. */
  .items .n em .unit { text-transform: none; }
  .items .n em.plain { color: #fff; }
  .items .n em.plain::before, .items .n em.plain::after { content: none; }
  /* Same red as the descriptions — the reference uses one. */
  .items .n u { text-decoration: none; color: #f73a2e; }
  /* Pizza inverts it: gold names, white toppings on their own line, no
     brackets — an ~7.4mm two-line pitch, which is what makes the reference's
     pizza column fill the panel top to bottom. */
  /* Two distinct golds on the reference: names lighter than the plaques. */
  .items.gold .n { color: #fbcc02; font-weight: 500; }
  .items.gold .n em { color: #fff; display: block; margin: .2mm 0 0; }
  .items.gold li { padding: .45mm 0; font-size: 4.1mm; }
  .items.gold .n em { font-size: 3.35mm; line-height: 1.06; }
  /* No leaders on the reference: the rows read on alignment alone, and the only
     dotted rule on the sheet is the one under each heading. The element stays
     as the flexible spacer that pushes the price right (and carries the photo
     gutter reservation). */
  .items .dots { flex: 1; }
  /* Prices are white on the reference, not gold, and set at the item size. */
  .items .p { font-weight: 500; color: #fff; white-space: nowrap; }
  .items.sized li { gap: 4mm; }
  .items.sized .p2 {
    width: 14mm; text-align: center; font-weight: 500; color: #fff; white-space: nowrap;
  }

  /* The reference floats the size chips clear of the plaque, right-aligned so
     they sit over the price columns they label. */
  .headrow { display: flex; align-items: center; justify-content: space-between; gap: 4mm; }
  .sizehdr { display: inline-flex; gap: 4mm; flex: none; }
  /* Drinks sets its column tabs on their own row under the plaque, each one
     centred on the price column it labels — the same 11mm grid as .p2. */
  .chiprow { display: flex; justify-content: flex-end; margin: 0 0 1.5mm; }
  /* "Bottle" is wider than the 14mm min-width once padding is counted, so the
     chip grew and stopped sitting over its column. Pin the width instead and
     size the type to fit it. */
  .chiprow .sizehdr i { width: 14mm; min-width: 0; font-size: 3.5mm; padding-left: 0; padding-right: 0; }
  .sizehdr i {
    font-style: normal; font-weight: 600;
    padding: .55mm 1.8mm; border-radius: 0; text-align: center;
    /* Same width and gutter as .items.sized .p2, so each chip sits squarely
       over the column of prices it labels. */
    min-width: 14mm; font-size: 4.4mm;
  }
  .sizehdr i.red { background: #dd1516; color: #fff; border-radius: .8mm; }
  .sizehdr i.gold { background: #f9b902; color: #111; border-radius: .8mm; }
  /* 32 pizzas with a topping line each need tighter type than the simple
     lists — the same trade the designer makes. */
  .items.withdesc li { align-items: center; padding: .1mm 0; font-size: 3.8mm; line-height: 1.03; min-height: 6.6mm; }
  /* Five sections share this panel, so it keeps its rows to their natural
     height — the uniform minimum is a luxury only the roomier panels have. */
  .panel.tight .items.withdesc li { min-height: 0; }
  .items.withdesc .n em { font-size: 3.2mm; margin-top: 0; line-height: 1.04; }
  .items.withdesc .p2 { font-size: 4.1mm; }
  .items.withdesc .dots { display: none; }
  .items.withdesc .n { flex: 1; }
  /* Reference: a red plaque hard left, the two supplements sitting in the same
     columns as the pizza prices above them. */
  .supp { display: flex; align-items: center; gap: 4mm; margin-top: 2.5mm; }
  .supp span {
    padding: 1.4mm 5mm; background: #dd1516; color: #fdf3d8; border-radius: 0;
    font-size: 3.9mm; font-weight: 600;
  }
  .supp i { flex: 1; }
  /* Same width, size and gutter as .items.sized .p2, so they land on the
     11" and 13" axes rather than floating right of them. */
  /* On the bar, not naked on the photograph beneath it — the same reason the
     bar itself is red. Was white-on-photo held together by a blurred shadow. */
  .supp b {
    width: 14mm; text-align: center; color: #fdf3d8; font-size: 3.8mm;
    background: #dd1516; padding: 1.4mm 0;
  }

  /* The reference singles Dips out with a red plaque. It is its own asset —
     tinted off the gold one by luminance, since a CSS hue-rotate took the gold
     to brown (the art is not a pure hue) and also recoloured the text. */
  .redhead h3 { border-image-source: url(img/header-plaque-red.png); color: #fdf3d8; }
  .redhead h3 .hdr2 { color: #fdf3d8; }

  /* Reference: plain white bullet list, white prices, roomy rows. */
  .chips { list-style: none; margin: 0 0 3mm; padding: 0; column-count: 2; column-gap: 5mm; }
  .chips.three { column-count: 3; column-gap: 2mm; }
  .chips b { color: #fff; font-weight: 600; margin-left: auto; }
  /* Reference pitch: the three columns and the price sit well inside the
     panel, not spread across its full width. */
  .dipcols { padding-right: 21mm; }
  .chips li { display: flex; align-items: baseline; font-size: 3.8mm; font-weight: 600; color: #fff; padding: 1mm 0; break-inside: avoid; }
  .chips li::before { content: '•'; color: #fff; margin-right: 1.6mm; font-size: 1.5em; line-height: .6; }

  /* ---- kids box ---- */
  /* Reference: red box, ribbon lockup on the left (asset gap — plain type
     holds its place), and the items on a YELLOW ticket in black, with dotted
     leaders and a £ — the one list on the sheet that keeps both. */
  .kidsbox {
    background: #c10f0f; border-radius: 3mm; padding: 5mm;
    display: flex; align-items: center; gap: 4mm;
    position: relative;
    min-height: 52mm;
    outline: .5mm dashed rgba(249,185,2,.85); outline-offset: -2.2mm;
  }
  /* With the artwork in place the box carries no frame of its own — the
     lockup brings one. */
  .kidsbox:has(.kidslock) { outline: 0; padding: 3mm; }
  .kidslock { flex: none; display: block; height: auto; align-self: center; }
  /* Sits against the panel's right edge and runs off it, as the reference's
     does — the panel's own overflow:hidden crops it at the bleed. Bottom-
     anchored so the salad bowl lands level with the end of the Salad list. */
  .sscol {
    /* Explicit height: an <img> is a replaced element, so top+bottom alone
       leave it at its intrinsic aspect instead of stretching. */
    position: absolute; right: -4mm; top: 106mm; height: 194mm; z-index: 0;
    width: 62mm; display: block;
    /* The column is 2:1; filling from the top of Sides to the foot of the
       panel needs a 3:1 box, so it is cropped left/right rather than shrunk —
       the food stays at full size and fills the black instead of floating in
       it. 62mm keeps it clear of the price column. */
    object-fit: contain; object-position: 50% 50%;
    filter: drop-shadow(0 1.2mm 1.8mm rgba(0,0,0,.55));
  }
  .kidsmark {
    flex: none; width: 44mm; text-align: center; color: #fdf3d8; line-height: .95;
    position: relative; z-index: 1;
    text-transform: uppercase;
  }
  .kidsmark b { display: block; font-size: 6.4mm; }
  .kidsmark span {
    display: block; margin-top: 1.6mm; padding: .8mm 0;
    background: #111; color: #f9b902; font-size: 3.6mm; border-radius: 1mm;
  }
  /* Runs the full width behind the lockup, which sits over it. */
  .kidsticket {
    flex: 1; min-width: 0; background: #f9b902; border-radius: 2mm;
    padding: 3.5mm 4mm 3.5mm 5mm; align-self: stretch; margin-left: 0;
    display: flex; flex-direction: column; justify-content: center;
    position: relative; overflow: hidden;
  }
  /* the bitten corner on the yellow ticket */
  .kidsticket::after {
    content: ''; position: absolute; top: -3mm; right: -3mm;
    width: 6mm; height: 6mm; border-radius: 50%; background: #c10f0f;
  }
  .kidslist li { font-size: 4mm; line-height: 1.45; padding: 1mm 0; }
  .kidsticket .items .n { text-transform: none; }
  .kidsticket .items .n, .kidsticket .items .p { color: #111; font-weight: 600; }
  /* The reference runs a two-line entry with the leader and price on the LAST
     line, so the row aligns to its bottom, not its first baseline. */
  .kidsticket .items li { align-items: flex-end; }
  .kidsticket .items .n { flex: none; max-width: 66%; }
  .kidsticket .items .dots {
    flex: 1; min-width: 6mm; align-self: flex-end; margin: 0 1.5mm 1.1mm;
    background: repeating-linear-gradient(to right, #111 0 .5mm, transparent .5mm 1.7mm);
    height: .5mm;
  }

  /* ---- meal deal boxes ---- */
  /* The deals are the upsell and the reference gives them a third of the
     panel, so they're sized to fill rather than left as small boxes. */
  .deals { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-bottom: 11mm; }
  /* The reference runs its cards from under the hero photo down to the footer;
     letting the grid grow fills that column instead of leaving a void above. */
  .deals.grow { flex: 1; grid-auto-rows: 1fr; }
  .dealsblk { display: flex; flex-direction: column; flex: 1; }
  /* Title top, price bottom, body between — so paired cards in a row share
     their baselines however long the description runs. */
  .deal {
    background: #f8e3bf; color: #111;
    border: .5mm solid #1a1a1a; border-radius: 2.5mm;
    padding: 2.6mm 3mm; text-align: center;
    box-shadow: 1mm 1mm 0 rgba(0,0,0,.5);
    display: grid; grid-template-rows: auto 1fr auto; align-content: stretch;
  }
  .deal p { align-self: center; }
  /* Reference cards: rounded, thin dark outline, and a circular bite punched
     out of the top-right corner — not torn edges. The bite is a disc of the
     page colour laid over the corner. */
  .deal { position: relative; overflow: hidden; }
  /* A torn corner, not a punched hole. The reference bites ~9mm x 8mm out of
     each card in a chain of three or four scalloped lobes — the same torn-
     ticket language as the plaques, which already get a real bite from the
     border-image. A single smooth disc was less than half the size in each
     dimension and had no serration at all, so the cards were the one element
     on the sheet speaking a different language.
     The corner is cut on a diagonal (the linear-gradient) and that cut is
     scalloped by three lobes whose centres sit ON the cut line. Centres must
     be on the line: placed further in they stop being a torn edge and become
     black blobs printed inside the card. */
  .deal::after {
    content: ''; position: absolute; top: 0; right: 0;
    width: 8.5mm; height: 7.5mm; pointer-events: none;
    background:
      radial-gradient(circle at 25% 25%, #030303 1.55mm, transparent 1.65mm),
      radial-gradient(circle at 52% 52%, #030303 1.65mm, transparent 1.75mm),
      radial-gradient(circle at 78% 78%, #030303 1.5mm, transparent 1.6mm),
      linear-gradient(to top right, transparent 49.5%, #030303 50%);
  }
  /* Keep the title out of the bite — it is centred, so this shifts it a couple
     of millimetres left rather than clipping "FAMILY MEAL DEAL". */
  /* Clearance for the bite. The reference runs this title nearly the full
     card width, which means its bite sits ABOVE the title line rather than
     beside it — matching that needs card height this panel does not have. So
     the title keeps clear of the notch instead, and "Family Meal Deal" takes
     two lines. A wrapped title reads; letters sitting on a dark notch do not. */
  .deal b { padding-right: 4.5mm; font-size: 4.8mm; }
  .pzcol { position: relative; z-index: 1; }
  /* 32 pizzas left 20.5mm of dead panel below the stuffed-crust bar. Opening
     each row by a third of a millimetre spends half of that on the list
     itself rather than leaving it black. Scoped to this column so no other
     section's leading moves. */
  .pzcol .items.withdesc li { padding: .28mm 0; }
  /* NO text-shadow anywhere on this sheet. A blurred shadow exports as a
     transparency group, and viewers render it inconsistently — in Preview it
     came out as hard black boxes that swallowed the bottom of every pizza name
     and of the kebab prices. What a viewer does that with, a RIP may too.
     Legibility over a photo is solved by moving the photo instead. */
  .dealshead .headrow { justify-content: center; }
  .center { text-align: center; }
  /* Size lives on ".side-a .dealshead h3" above — a bare ".dealshead h3"
     cannot outrank ".side-a .blk h3" and would be dead weight here. */
  .deal b { display: block; color: #bb0e12; font-size: 5mm; line-height: 1.05; text-transform: uppercase; font-weight: 700; }
  .deal p { margin: 1.4mm 0 1.6mm; font-size: 4.4mm; line-height: 1.3; font-weight: 600; text-transform: capitalize; }
  /* The card's anchor: same face and weight as the body copy above it, which
     is how the reference sets it. It was the condensed face at Regular —
     measured 30% lighter and 13% narrower than the reference's price. */
  .deal strong { font-size: 5.2mm; font-weight: 600; color: #111; }
  .deal .pd strong { display: block; margin-top: .6mm; font-size: 4mm; }

  /* ---- cover panel ---- */
  /* The reference splits this panel: the cover proper, and a red spine down the
     right edge carrying the brand name and the address. */
  /* .side-a .panel (0,2,0) was beating a bare .cover (0,1,0), so this panel
     silently kept 5/4/13mm of padding and held the spine back from three trim
     edges. The panel now carries the bleed itself, so the spine needs no
     negative margins to reach it. */
  .side-a .panel.cover { padding: 0; flex-direction: row; overflow: hidden; }
  .coverbody {
    flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center;
    text-align: center; padding: 6mm 5mm 16mm 7mm;
  }
  .spine {
    /* Floods the bleed on its three outer edges and carries a faint weave.
       Paints ABOVE the ticker: the ticker spans the full page width, and
       underneath it this band stopped 11.7mm short of the trim with
       "FRESH & LOAD" printed across the red. The reference stops its ticker
       where the spine starts and runs the spine unbroken to the sheet edge —
       this is the edge you actually see on the folded piece. */
    position: relative; z-index: 2;
    flex: none; width: 24mm;
    background:
      repeating-linear-gradient(45deg, rgba(0,0,0,.05) 0 .5mm, transparent .5mm 1.6mm),
      repeating-linear-gradient(-45deg, rgba(0,0,0,.05) 0 .5mm, transparent .5mm 1.6mm),
      #c0100e;
    color: #f9b902;
    display: flex; align-items: center; justify-content: center; gap: 6mm;
    writing-mode: vertical-rl;
  }
  /* The spine now paints over the ticker rather than under it, so the address
     no longer has to dodge the band — it runs to the same depth as the
     reference's. */
  /* padding-right is the 3mm bleed: the wordmark centres on the TRIMMED
     strip, not on the strip-plus-bleed, which is what the reference does
     (5.8mm each side of its cap). Centred on the full 32mm it sat 1.4mm
     over the trim line. */
  .spine { justify-content: space-between; padding: 6mm 3mm 6mm 0; }
  .side-a .spine { padding-bottom: 6mm; }
  /* NOT the condensed display face. Measured off the shipped outlines,
     BarlowCondensed-900 gives ink/cap 0.62 over B,G,T,E,S where the
     reference's spine averages 0.94, and its letter advance/cap is 1.14
     against the plaques' 0.65 — it sets this wordmark in a normal-width face.
     Montserrat-700 measures 0.87, within 7%. Tracking cannot widen a glyph,
     only the gaps, so this needs the face change. 23.7mm gives cap 16.6mm
     against the reference's 16.9, and .10em over nine gaps brings the run to
     ~143mm, matching. */
  .spine b {
    font-family: 'Montserrat', system-ui, sans-serif; font-weight: 700;
    font-size: 17.6mm; letter-spacing: .10em; text-transform: uppercase;
  }
  .spine span { font-size: 4.6mm; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #fff; }

  /* The reference sets a red disc with a handset beside the phone and one with
     a clock beside the opening times. Both are inline SVG — drawn, so they stay
     vector in the PDF and need no asset. */
  .ico { display: inline-block; vertical-align: middle; margin-right: -2mm; width: 11mm; height: 11mm; flex: none; position: relative; z-index: 1; }
  .ico svg { display: block; width: 100%; height: 100%; }
  /* The supplied wordmark, keyed to transparency so the panel's own black and
     its faint yellow glow read through instead of a slightly-off black box.
     105mm wide keeps the source above 300dpi at print size. */
  .brandmark { width: 80mm; height: auto; display: block; }
  .coverrule { width: 100%; margin-top: 1.5mm; border-top: .5mm dotted rgba(255,255,255,.55); }

  .tel { margin-top: 2mm; }
  /* Cream, not white: the reference ties this line to the big numerals
     directly beneath it, and white broke the pair apart. */
  .telline { display: flex; align-items: center; justify-content: center; font-size: 9.5mm; font-weight: 600; letter-spacing: .02em; color: #f8e3bf; }
  /* The display face draws well above its em box, so the number's glyphs ran over
     the line above even though the two boxes never touched. The margin is
     clearance for the overshoot, not decoration — don't trim it. */
  .tel b { display: block; margin-top: 1.5mm; font-size: 21mm; line-height: 1; letter-spacing: .04em; color: #f8e3bf; }

  /* The cover's straps are the same device as a section header, so they take
     the same plaque — a flat yellow bar next to a bitten one would read as an
     oversight. Text is centred here, so the left/right insets match. */
  .strapline { display: flex; align-items: center; gap: .8mm; margin: 2mm 0 1.5mm; align-self: flex-start; }
  .strapline .strap { margin: 0; min-width: 56mm; font-size: 5.2mm; }
  .strap.plain {
    border: 0; background: none; padding: 0; margin: 2.5mm 0 1mm;
    color: #ffe000; font-size: 5.8mm;
  }
  .strap.red { border-image-source: url(img/header-plaque-red.png); color: #fdf3d8; }
  .strap.website { font-size: 5.4mm; letter-spacing: .02em; padding: .25em .8em; }
  .strap {
    display: flex; align-items: center; justify-content: center;
    margin: 3mm 0 1.5mm; padding: .2em .35em .16em .35em;
    border-style: solid; border-color: transparent;
    border-width: .11em .5em .12em .15em;
    border-image: url(img/header-plaque.png) 18 85 20 25 fill stretch;
    color: #111; font-size: 4.4mm;
    text-transform: uppercase;
  }
  .fine { margin: 0; width: 100%; font-size: 4.1mm; line-height: 1.45; font-weight: 600; color: #fff; }
  .hours { display: grid; grid-template-columns: auto auto; column-gap: 9mm; row-gap: 1mm; justify-content: center; }
  .hours div { display: contents; }
  /* Straight from the shop's config, not written here — the same wording the
     website shows at checkout. */
  /* One line, pushed to the foot of the column so it sits hard against the
     ticker and the photograph above it gets the height instead. */
  .allergy {
    margin: 0; padding: 1.3mm 3mm; width: 100%;
    border: .35mm solid rgba(255,196,0,.55); border-radius: 1.5mm;
    font-size: 2.55mm; line-height: 1.3; font-weight: 600; color: #e8dcc6;
    white-space: nowrap; background: rgba(3,3,3,.86);
  }
  .allergy b { color: #f9b902; text-transform: uppercase; letter-spacing: .08em; }
  .hours span, .hours b { font-size: 3.9mm; font-weight: 600; }
  .hours span { text-align: left; }
  .hours b { color: #fff; text-align: left; }

  .qrwrap { display: flex; align-items: center; justify-content: center; gap: 3mm; padding-top: 0; }
  .qrtxt .arrow { display: block; font-size: 6mm; color: #f9b902; line-height: 1; }
  /* Reserved for the pizza / basil / tomato photograph the reference floods the
     lower half of the cover with. Empty until that asset exists. */
  /* A spacer for the missing cover photograph: it absorbs slack, it must not
     demand any — a min-height here pushed the cover 10mm past its box and
     under the footer ticker. */
  /* A LAYER on the panel, not a flex item: as a flex child it got whatever
     height the stack above it left over, which was almost none, and the photo
     was pushed off the bottom. It floods the foot of the cover, bleeds off the
     left, right and bottom edges, and sits behind the type. */
  /* A LAYER on the panel, not a flex item: as a flex child it got whatever
     height the stack above it left over, which was almost none.
     bottom is 0, NOT a negative — an absolutely positioned element pushed
     below the page box is DROPPED ENTIRELY by Chromium's print path, while
     rendering perfectly on screen. At -4mm this photograph was in preview.png
     and absent from the PDF. Zero here is already in the bleed: the panel's
     padding box ends 16mm above the sheet edge and the ticker covers the rest.
     Explicit mm on the image too — percentage heights on a replaced element
     are another thing print resolves differently from screen. */
  /* The panel has padding:0, so these inset from its own edges: right 24mm is
     exactly the spine's left edge, and bottom 22.4mm is exactly the top of the
     allergy line. The photograph therefore meets both with no black seam, and
     nothing is laid over it.
     bottom is NOT negative — an absolutely positioned element pushed below the
     page box is dropped entirely by Chromium's print path while rendering
     perfectly on screen, which is how this photo came to be in preview.png and
     absent from the PDF. */
  .coverart {
    position: absolute; left: 0; right: 24mm; bottom: 22.4mm; height: 98mm;
    z-index: 0; pointer-events: none; overflow: hidden;
  }
  .coverart img {
    /* Anchored to the BOTTOM and filling the width. This photograph is built
       with headroom — its top 60% is empty black — so the part that falls
       outside the frame is background, not content. That is the difference
       from the old one, where cover was throwing away a third of the actual
       picture. */
    width: 119mm; height: 98mm; object-fit: cover; object-position: 50% 100%;
  }
  .coverbody { position: relative; z-index: 1; }
  .qr { width: 30mm; height: 30mm; background: #fff; padding: 1.5mm; border-radius: 1.5mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .qrtxt { text-align: right; }
  .qrtxt b { display: block; font-size: 4.6mm; color: #f9b902; transform: skewX(-8deg); }
  .qrtxt span { font-size: 2.9mm; font-weight: 700; }
  /* The flood now runs behind this, and small type on a lit pizza crust is
     unreadable. A dark plate under it keeps the notice legible without
     covering the photograph. */
  .allergy { margin-top: auto; }

  /* ---- foot ticker ---- */
  .ticker {
    /* Floods the bleed: the band must run through the cut, not end on it. */
    position: absolute; left: 0; right: 0; bottom: 0; height: 14.5mm;
    padding: 0 3mm 3mm;
    background: #f9b902; color: #111;
    display: flex; align-items: center; justify-content: center; gap: 2.5mm;
    /* NOT the display face: the reference's ticker measures stem/cap 0.208,
       which is SemiBold territory — Barlow Condensed Black's 0.269 made it
       27% heavy and, being condensed, 18% small at the same size. The band
       repeats and is clipped by the sheet edge, so length is not a risk. */
    font-family: 'Oswald', system-ui, sans-serif; font-weight: 600;
    font-size: 4.55mm; letter-spacing: .14em; overflow: hidden; white-space: nowrap;
  }
  .ticker i { color: #d61313; font-style: normal; }
  .gl { width: 1em; height: 1em; display: inline-block; vertical-align: -.14em; }
</style></head>
<body>

${/* Section order and panel assignment follow the designer's artwork exactly:
      outer face  — Drinks/Milk Shakes/Desserts/Kids | Dips/Meal Deals | cover
      inner face  — Pizza | Garlic Bread/Calzone/Kebabs/Parmesan/Wrap | Burgers/Sides/Salad
      Don't reshuffle these without checking the reference sheets again. */''}
${page('side-a', `
  <div class="panel">
    ${sizedList('drinks', 'size', ['CAN', 'BOTTLE'], { secondOnly: /\d+\s*ml|bottle/i, firstOnly: /\bcan\b/i, tight: false, tone: ['gold', 'gold'], labels: ['Can', 'Bottle'], img: shot('pepsi-coke', 34), slot: 44, chipsBelow: true })}
    ${milkshakes()}
    ${list('desserts', { desc: true, img: shot('cake', 46), slot: 52, cls: 'dessertblk norule' })}
    ${kidsBox()}
  </div>
  <div class="panel">
    ${dips()}
    ${shot('burger-meal', 108, 'below')}
    ${deals()}
  </div>
  ${cover}
`)}

${page('side-b', `
  <div class="panel">
    <div class="pzcol">
      ${sizedList('pizza', 'size', ['11"', '13"'], { tone: ['red', 'red'], nameTone: 'gold', slot: 5 })}
      ${stuffedCrust()}
    </div>
    <div class="halftone">${shot('pizza', 50, 'below')}</div>
  </div>
  <div class="panel tight">
    ${sizedList('garlic-bread', 'size', ['11"', '13"'], { tone: ['red', 'red'], slot: 14 })}
    ${list('calzone', { dense: true, desc: true, img: shot('calzone', 46, 'mid'), slot: 14, chip: '11"' })}
    ${sizedList('kebab', 'size', ['MEDIUM', 'LARGE'], { title: 'Kebabs', img: shot('kebab', 42, 'mid'), slot: 4 })}
    ${list('parmesan', { dense: true, desc: true, slot: 48 })}
    ${list('wraps', { dense: true, desc: true, img: shot('wrap', 46), slot: 48, title: 'Wrap' })}
  </div>
  <div class="panel">
    ${sizedList('burgers', 'size', ['1/4 lb', '1/2 lb'], { slot: 12, firstOnly: /(¼|1\/4)\s*lb/i, secondOnly: /(½|1\/2)\s*lb/i, defaultCol: null })}
    ${list('sides', { dense: true, title: 'Sides', slot: 56 })}
    ${list('salad', { dense: true, desc: true, slot: 56, cls: 'saladblk' })}
    ${sidesSaladColumn()}
  </div>
`, false)}

</body></html>`;

/* Nothing on this sheet may be a missing field rendered as text. Dropping
   minimumOrderPence printed "Minimum order £NaN." on the cover and every check
   stayed green, because NaN is content like any other. */
{
  const drift = [];
  const byId = new Map();
  for (const c of server) for (const i of c.items) byId.set(`${c.id}/${i.id}`, i);
  for (const c of menu) for (const i of c.items) {
    const key = `${c.id}/${i.id}`;
    const srv = byId.get(key);
    if (!srv) { drift.push(`${key}: on the printed menu but not in menu.json — the server cannot sell it`); continue; }
    const shown = Math.round(Number(i.price) * 100);
    if (shown !== srv.priceP) drift.push(`${key}: sheet prints £${Number(i.price).toFixed(2)} but the server charges ${srv.priceP}p`);
    const mods = new Map((srv.modifiers || []).map((m) => [m.id, m]));
    for (const o of i.options || []) for (const ch of o.choices || []) {
      const m = mods.get(ch.id);
      if (!m) continue;                       // build-shop.js already polices this
      if (m.priceDeltaPBySize) {
        for (const [sz, p] of Object.entries(m.priceDeltaPBySize)) {
          const vis = Math.round(Number((ch.priceBySize || {})[sz] ?? NaN) * 100);
          if (Number.isFinite(vis) && vis !== p)
            drift.push(`${key}/${ch.id}[${sz}]: sheet prints £${((vis) / 100).toFixed(2)} but the server charges ${p}p`);
        }
        continue;
      }
      const vis = Math.round(Number(ch.price || 0) * 100);
      if (vis !== (Number(m.priceDeltaP) || 0))
        drift.push(`${key}/${ch.id}: sheet prints £${(vis / 100).toFixed(2)} but the server charges ${Number(m.priceDeltaP) || 0}p`);
    }
  }
  if (drift.length)
    throw new Error(`the printed prices disagree with menu.json, which is what the server charges:\n  ${drift.slice(0, 12).join('\n  ')}` +
      (drift.length > 12 ? `\n  ...and ${drift.length - 12} more` : ''));
  console.log(`prices agree with menu.json (${byId.size} items)`);
}

const bad = html.match(/NaN|undefined|Infinity|null/);
if (bad) throw new Error(`generated sheet contains "${bad[0]}" — a data field is missing. Fix the shop data; do not print this.`);

const orphans = menu.map((c) => c.id).filter((id) => !usedCats.has(id));
if (orphans.length) {
  throw new Error(`menu categories not placed on any panel: ${orphans.join(', ')}\n` +
    '  Add them to a panel in build-menu.mjs, or the printed sheet will under-advertise the menu.');
}

/* Hash the finished sheet as well as its inputs. The input stamp proves
   menu.html was generated from the current data; this proves nobody edited it
   afterwards — and menu.html is a generated file, so a hand-patched price in
   it would otherwise reprint forever. Hashed with the placeholder still in
   place so render.mjs can reverse the substitution and recompute it. */
const BUILD_OUT = crypto.createHash('sha256').update(html).digest('hex').slice(0, 16);
fs.writeFileSync(OUT, html.replace('__BUILD_OUT__', BUILD_OUT));
const n = menu.reduce((a, c) => a + c.items.length, 0);
console.log(`menu.html written — ${n} items across ${menu.length} categories`);
console.log('photo dpi: ' + shotDpi.sort((a, b) => a.dpi - b.dpi)
  .map((s) => `${s.name} ${s.mm}mm=${s.dpi}`).join('  '));
console.log(`phone ${cfg.business.phone} · min £${del.minimumOrderPence / 100} · £${perMile}/mile to ${maxMiles} miles`);
