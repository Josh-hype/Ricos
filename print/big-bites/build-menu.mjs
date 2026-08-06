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
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SHOP = path.join(ROOT, 'data/shops/food-station');
const menu = JSON.parse(fs.readFileSync(path.join(SHOP, 'menu-visual.json'), 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(SHOP, 'config.json'), 'utf8'));
const qr = fs.readFileSync(path.join(import.meta.dirname, 'qr.svg'), 'utf8')
  .replace(/<\?xml[^>]*\?>\s*/, '');

/* A renamed or missing category must kill the build — the fallback used to
   print a bare slug over zero items, and every check passed because less
   content never overflows. */
/* Drawn, not typed: no vendored face carries U+2605 or U+2192, so Chromium was
   quietly embedding DejaVu off the build machine for the star and the arrow.
   The sheet would set differently on another machine — or print .notdef boxes
   on a bare one — and the name-only font check could not see it. */
const STAR = '<svg class="gl" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.4l2.9 6.1 6.7.9-4.9 4.6 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6L2.4 9.4l6.7-.9z"/></svg>';
const ARROW = '<svg class="gl" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M3 12h17M13 5l7 7-7 7"/></svg>';

const cat = (id) => {
  const c = menu.find((x) => x.id === id);
  if (!c || !c.items.length) throw new Error(`menu category "${id}" is missing or empty`);
  return c;
};
/* The reference prints bare numbers — no currency mark anywhere on the sheet.
   Kept as one function so a change of mind is one line. */
const money = (n) => Number(n).toFixed(2);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
/* Descriptions are bracketed on the sheet, and the shop writes them as
   sentences — "(Brushed With Garlic Butter.)" reads wrong, so the full stop
   comes off here rather than being edited out of the menu data. */
const descText = (s) => esc(String(s).trim().replace(/\.+$/, ''));

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
     enlarged. Below 120dpi is too soft to send anywhere. */
  const dpi = Math.round(w / (width / 25.4));
  shotDpi.push({ name, px: `${w}x${h}`, mm: width, dpi });
  if (dpi < 140) throw new Error(`${name}.png at ${width}mm is ${dpi}dpi — too soft to print`);
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
function list(id, { dense = false, cols = 1, title = null, desc = false, img = '', choices = false, tone = '', slot = 0, chip = '', dots = false } = {}) {
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
    <section class="blk">
      ${header(esc(title || c.name), chip ? chips([chip], ['red'], slotOf(img, slot)) : '', slotOf(img, slot))}
      ${withShot(`<ul class="items${cols > 1 ? ' two' : ''}${dense ? ' dense' : ''}${tone ? ' ' + tone : ''}">${rows}</ul>`, img, slot, dots)}
    </section>`;
}

/* Any list whose items carry a two-choice size option (pizza 11"/13",
   garlic bread the same, burgers ¼lb/½lb, kebabs medium/large). Prints both
   prices in their own columns, with the topping line under the name — exactly
   as the designer's sheet does. Items without the option get one price and a
   dash, which is how the reference handles Tray Doner and the like. */
function sizedList(id, optId, headings, { title = null, img = '', secondOnly = null, tight = true, tone = ['gold', 'red'], nameTone = '', slot = 0, labels = null, chipsBelow = false } = {}) {
  const c = cat(id);
  const rows = c.items.map((i) => {
    const opt = (i.options || []).find((o) => o.id === optId);
    if (opt && (opt.choices.length !== 2 || Number(opt.choices[0].price || 0) !== 0))
      throw new Error(`${id}/${i.id}: size option no longer two choices with a free base — the column maths would misprint`);
    const up = opt && opt.choices[1];
    const p2 = up ? Number(i.price) + Number(up.price || 0) : null;
    /* A few items only exist in the second size — a 500ml water is a bottle,
       not a can — so their single price belongs in the right-hand column. */
    const only2 = !opt && secondOnly && secondOnly.test(i.name);
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
      </ul>`, shot('shake', 36), 52)}
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
        <!-- ASSET GAP: the KIDS MENU / BIG BITES ribbon lockup goes here. -->
        <div class="kidsmark"><b>Kids</b><b>Menu</b><span>Big Bites</span></div>
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
  const lines = (s) => esc(s || '');
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
      ${withShot(`<div>
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
      <p class="fine">
        Order on our website for collection or delivery.<br />
        Easingwold — £${perMile.toFixed(2)} per mile, up to ${maxMiles} miles.<br />
        Minimum order £${(del.minimumOrderPence / 100).toFixed(2).replace(/\.00$/, '')}.
      </p>
      <div class="strapline">${icon('clock')}<div class="strap">Opening Time</div></div>
      <div class="hours">${hours}</div>
      <div class="strap red website">bigbiteseasingwold.co.uk</div>
      <div class="qrwrap">
        <div class="qrtxt"><b>SCAN<br />ME</b><span class="arrow">${ARROW}</span></div>
        <div class="qr">${qr}</div>
      </div>
      ${cfg.allergens?.noticeAtCheckout ? `<p class="allergy"><b>Allergies?</b> ${esc(cfg.allergens.noticeAtCheckout)}</p>` : ''}
      <!-- ASSET GAP: the reference floods the lower half of this panel with a
           pizza / basil / tomato photograph. Left empty until one exists. -->
      <div class="coverart" aria-hidden="true"></div>
    </div>
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
<title>Big Bites — A3 trifold menu</title>
<style>
  /* Vendored, not fetched: the sheet must set identically on any machine, and
     a blocked network was silently swapping in fallback faces. Static per-
     weight files — the css2 endpoint serves one variable file for every
     weight, which Chromium faux-bolds into broken letterspacing. */
  @font-face { font-family: 'Archivo Black'; font-weight: 400; src: url(fonts/ArchivoBlack-400.ttf) format('truetype'); }
  @font-face { font-family: 'Montserrat'; font-weight: 400; src: url(fonts/Montserrat-400.ttf) format('truetype'); }
  @font-face { font-family: 'Montserrat'; font-weight: 600; src: url(fonts/Montserrat-600.ttf) format('truetype'); }
  @font-face { font-family: 'Montserrat'; font-weight: 700; src: url(fonts/Montserrat-700.ttf) format('truetype'); }
  @font-face { font-family: 'Oswald'; font-weight: 400; src: url(fonts/Oswald-400.ttf) format('truetype'); }
  @font-face { font-family: 'Oswald'; font-weight: 500; src: url(fonts/Oswald-500.ttf) format('truetype'); }
  @font-face { font-family: 'Oswald'; font-weight: 600; src: url(fonts/Oswald-600.ttf) format('truetype'); }
  @font-face { font-family: 'Oswald'; font-weight: 700; src: url(fonts/Oswald-700.ttf) format('truetype'); }
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
  /* The reference is set in a condensed grotesque throughout — Anton for the
     plaques and Oswald for everything else. It is the single biggest thing that
     makes it read as that sheet rather than a generic menu: the condensed
     widths are what let the type run this large in a 140mm panel. */
  /* Three families, as the reference uses: a WIDE heavy poster face for the
     plaques (Anton is 36% too narrow at matched cap height), condensed Oswald
     for the item lists, and a normal-width sans for marketing copy. */
  body { font-family: 'Oswald', system-ui, sans-serif; }
  .blk h3, .strap, .spine b, .kidsmark, .deal b, .deal strong, .ticker, .tel b, .qrtxt b {
    font-family: 'Archivo Black', Impact, sans-serif; font-weight: 400;
  }
  /* Marketing copy — not the price lists — is a normal-width sans on the
     reference, where this sheet had the condensed face everywhere. */
  .deal p, .chips li, .fine, .hours, .allergy, .sizehdr i, .qrtxt span, .telline {
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
  .side-b .panel { --pt: 3mm; --pr: 3mm; --pb: 4mm; --pl: 3mm; }
  .side-b .blk:first-child h3 { margin-top: -3.5mm; }
  /* The outer face runs nearly as tight to its edges as the inner one. */
  .side-a .panel { --pt: 5mm; --pr: 4mm; --pb: 13mm; --pl: 4mm; }
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
    border-right: 0.5mm solid #f9b902;   /* fold guide, and the reference's gold rule */
    background:
      radial-gradient(circle at 30% 12%, rgba(255,196,0,.06), transparent 45%),
      radial-gradient(circle at 50% 50%, rgba(255,255,255,.035) .12mm, transparent .13mm) 0 0 / .9mm .9mm,
      #0b0b0b;
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
  .panel.tight .blk { margin-bottom: 1.5mm; }
  .panel.tight .blk h3 { font-size: 6.8mm; margin-bottom: 0; }
  .panel.tight .hrule { margin: .7mm 0 1.6mm; }
  .panel.tight .items.dense li { padding: 0; font-size: 2.9mm; }
  /* Five sections against three elsewhere, and this shop carries a description
     on nearly every one of them where the reference carries almost none — so
     the panel keeps the reference's look at a slightly smaller size rather than
     dropping the descriptions. */
  .panel.tight .items .n em { font-size: 2.65mm; }

  /* ---- section blocks ---- */
  .blk { margin-bottom: 2mm; }
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
    /* No bottom margin: the dotted rule sits directly under the plaque, as it
       does on the reference, and carries the spacing itself. */
    margin: 0;
    /* The reference's plaques carry air around the word — chunky slabs, not
       tight labels — and one shared width per column, not shrink-to-fit. */
    padding: .16em 1.2em .16em .7em;
    min-width: 44mm;
    border-style: solid; border-color: transparent;
    /* 18/85/20/25 source px at the height this header renders — solving
       240k = 1.05 + 0.4 + 38k gives k = 0.00718em per source pixel. Get these
       wrong and the bite comes out squashed or stretched. */
    border-width: .129em .61em .144em .179em;
    border-image: url(img/header-plaque.png) 18 85 20 25 fill stretch;
    color: #111;
    font-size: 8.6mm; line-height: 1;
    letter-spacing: .005em;
    text-transform: uppercase;
    transform: rotate(-1.6deg);
  }
  /* Part of the headline on the reference — same size, weight and baseline. */
  .blk h3 .hdr2 { margin-left: 2mm; }
  /* Every heading on the reference has a dotted rule running the full width of
     the panel underneath it. The header itself is inline-block and rotated, so
     the rule is its own element rather than a border. */
  /* Bright, widely-spaced dots — on the reference these read as a deliberate
     rule, not a faint hairline. A repeating gradient gives control over the
     pitch that a plain dotted border does not. */
  .hrule {
    margin: 1mm 0 2.6mm; height: .8mm;
    background: repeating-linear-gradient(to right,
      rgba(255,255,255,.92) 0 .8mm, transparent .8mm 2.1mm);
  }
  /* The outer face runs its dotted rules BETWEEN sections instead — under the
     lists, not under the plaques. Same rule, different position. */
  .side-a .hrule { display: none; }
  /* The 11mm plaque is the inner face's scale — the reference's outer face
     runs a slightly smaller one over shorter lists. */
  .side-a .blk h3 { min-width: 58mm; font-size: 7.4mm; }
  .side-a .redhead h3 { min-width: 56mm; }
  /* Same bold dots as .hrule — these were left on a thin dotted border when
     the header rules were rebuilt, so they read as a hairline. */
  .side-a .panel .blk:not(:last-of-type):not(:nth-last-of-type(2)) {
    padding-bottom: 4mm; position: relative;
  }
  .side-a .panel .blk:not(:last-of-type):not(:nth-last-of-type(2))::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: .8mm;
    background: repeating-linear-gradient(to right,
      rgba(255,255,255,.92) 0 .8mm, transparent .8mm 2.1mm);
  }
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
  .side-a .shot.side { right: 0; }
  .shot.mid { position: absolute; top: 50%; translate: 0 -50%; right: 30mm; z-index: 0; }
  .blkrow .items { position: relative; z-index: 1; }
  .shot.below { margin: 3mm auto 0; }
  /* The reference sets the pizza on a gold halftone. Generated, not drawn. */
  .halftone {
    /* Out of the flow and cropped by the panel, so the list gets the whole
       column — which is how the reference fits 32 pizzas at this size. */
    position: absolute; right: -2mm; bottom: -8mm; display: flex; justify-content: flex-end; align-items: flex-end;
    /* Behind the prices: the reference tucks the pizza under the stuffed-crust
       line rather than over it, and white numerals on a photo are unreadable. */
    z-index: 0;
    background:
      radial-gradient(circle at center, #e8901a 30%, transparent 31%) 0 0 / 2.4mm 2.4mm,
      radial-gradient(circle at center, #e8901a 30%, transparent 31%) 1.2mm 1.2mm / 2.4mm 2.4mm;
    /* Radiates up-and-LEFT out of the crust and grades away — the burst is
       the graphic, the pizza just sits in it. */
    -webkit-mask: radial-gradient(ellipse 62% 58% at 82% 72%, #000 26%, rgba(0,0,0,.55) 52%, transparent 86%);
            mask: radial-gradient(ellipse 62% 58% at 82% 72%, #000 26%, rgba(0,0,0,.55) 52%, transparent 86%);
    padding: 22mm 0 6mm 44mm;
  }
  .blkrow .items { padding-right: var(--slot, 0mm); }
  /* The reference repeats its halftone behind the right-panel photos. Same
     dots as the pizza burst, graded away from the picture. */
  .blkrow.dots::after {
    content: ''; position: absolute; right: -14mm; top: 50%; translate: 0 -50%;
    width: 76mm; height: 62mm; z-index: 0;
    background:
      radial-gradient(circle at center, #e8901a 30%, transparent 31%) 0 0 / 2.4mm 2.4mm,
      radial-gradient(circle at center, #e8901a 30%, transparent 31%) 1.2mm 1.2mm / 2.4mm 2.4mm;
    -webkit-mask: radial-gradient(ellipse 58% 56% at 62% 50%, #000 22%, rgba(0,0,0,.5) 50%, transparent 84%);
            mask: radial-gradient(ellipse 58% 56% at 62% 50%, #000 22%, rgba(0,0,0,.5) 50%, transparent 84%);
  }
  .blkrow.dots .shot { position: absolute; z-index: 1; }

  .items { list-style: none; margin: 0; padding: 0; }
  .items.two { column-count: 2; column-gap: 6mm; }
  .items li {
    display: flex; align-items: baseline; gap: 1.5mm;
    break-inside: avoid;
    font-size: 4.7mm; line-height: 1.14;
  }
  .items li { padding: .45mm 0; }
  .items.dense li { font-size: 3.55mm; padding: 0; }
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
    color: #e93326; margin-top: .1mm;
  }
  .items .n em::before { content: '('; }
  .items .n em::after { content: ')'; }
  .items.gold .n em::before, .items.gold .n em::after { content: none; }
  /* A sub-line that is part of the name, not a description — the cooler
     flavours. White, unbracketed. */
  .items .n em.plain { color: #fff; }
  .items .n em.plain::before, .items .n em.plain::after { content: none; }
  .items .n u { text-decoration: none; color: #e0483a; }
  /* Pizza inverts it: gold names, white toppings on their own line, no
     brackets — an ~7.4mm two-line pitch, which is what makes the reference's
     pizza column fill the panel top to bottom. */
  /* Two distinct golds on the reference: names lighter than the plaques. */
  .items.gold .n { color: #fbcc02; font-weight: 600; }
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
    text-shadow: 0 0 1.2mm #000, 0 0 .5mm #000;
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
    font-style: normal; font-size: 4.4mm; font-weight: 600;
    padding: .55mm 1.8mm; border-radius: 0; text-align: center;
    /* Same width and gutter as .items.sized .p2, so each chip sits squarely
       over the column of prices it labels. */
    min-width: 14mm; font-size: 4.4mm;
  }
  .sizehdr i.red { background: #dd1516; color: #fff; }
  .sizehdr i.gold { background: #f9b902; color: #111; }
  /* 32 pizzas with a topping line each need tighter type than the simple
     lists — the same trade the designer makes. */
  .items.withdesc li { align-items: center; padding: .1mm 0; font-size: 3.8mm; line-height: 1.03; }
  .items.withdesc .n em { font-size: 3.2mm; margin-top: 0; line-height: 1.04; }
  .items.withdesc .p2 { font-size: 4.1mm; }
  .items.withdesc .dots { display: none; }
  .items.withdesc .n { flex: 1; }
  /* Reference: a red plaque hard left, the two supplements sitting in the same
     columns as the pizza prices above them. */
  .supp { display: flex; align-items: center; gap: 2mm; margin-top: 2.5mm; }
  .supp span {
    padding: 1.4mm 5mm; background: #dd1516; color: #fdf3d8; border-radius: 0;
    font-size: 3.9mm; font-weight: 600;
  }
  .supp i { flex: 1; }
  .supp b { width: 14mm; text-align: right; color: #fff; font-size: 3.1mm; text-shadow: 0 0 1.2mm #000, 0 0 .5mm #000; }

  /* The reference singles Dips out with a red plaque. It is its own asset —
     tinted off the gold one by luminance, since a CSS hue-rotate took the gold
     to brown (the art is not a pure hue) and also recoloured the text. */
  .redhead h3 { border-image-source: url(img/header-plaque-red.png); color: #fdf3d8; }
  .redhead h3 .hdr2 { color: #fdf3d8; }

  /* Reference: plain white bullet list, white prices, roomy rows. */
  .chips { list-style: none; margin: 0 0 3mm; padding: 0; column-count: 2; column-gap: 5mm; }
  .chips.three { column-count: 3; column-gap: 4mm; }
  .chips b { color: #fff; font-weight: 600; margin-left: auto; }
  .chips li { display: flex; align-items: baseline; font-size: 3.8mm; font-weight: 500; color: #fff; padding: 1mm 0; break-inside: avoid; }
  .chips li::before { content: '•'; color: #fff; margin-right: 1.6mm; }

  /* ---- kids box ---- */
  /* Reference: red box, ribbon lockup on the left (asset gap — plain type
     holds its place), and the items on a YELLOW ticket in black, with dotted
     leaders and a £ — the one list on the sheet that keeps both. */
  .kidsbox {
    background: #c10f0f; border-radius: 3mm; padding: 7mm 5mm;
    display: flex; align-items: center; gap: 4mm;
    min-height: 58mm;
    outline: .5mm dashed rgba(249,185,2,.85); outline-offset: -2.2mm;
  }
  .kidsmark {
    flex: none; width: 44mm; text-align: center; color: #fdf3d8; line-height: .95;
    text-transform: uppercase;
  }
  .kidsmark b { display: block; font-size: 6.4mm; }
  .kidsmark span {
    display: block; margin-top: 1.6mm; padding: .8mm 0;
    background: #111; color: #f9b902; font-size: 3.6mm; border-radius: 1mm;
  }
  .kidsticket {
    flex: 1; min-width: 0; background: #f9b902; border-radius: 2mm;
    padding: 3.5mm 4mm; align-self: stretch;
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
  .deals { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
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
  .deal::after {
    content: ''; position: absolute; top: -3.4mm; right: -3.4mm;
    width: 6.8mm; height: 6.8mm; border-radius: 50%;
    background: #030303; border: .5mm solid #1a1a1a;
  }
  .pzcol { position: relative; z-index: 1; }
  .dealshead .headrow { justify-content: center; }
  .center { text-align: center; }
  .dealshead h3 { min-width: 46mm; font-size: 7.2mm; }
  .deal b { display: block; color: #bb0e12; font-size: 5mm; line-height: 1.05; text-transform: uppercase; }
  .deal p { margin: 1.4mm 0 1.6mm; font-size: 3.5mm; line-height: 1.3; font-weight: 700; text-transform: capitalize; }
  .deal strong { font-size: 4.6mm; font-weight: 400; color: #111; }
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
    text-align: center; padding: 8mm 5mm 15mm 8mm;
  }
  .spine {
    /* Floods the bleed on its three outer edges and carries a faint weave. */
    flex: none; width: 30mm;
    background:
      repeating-linear-gradient(45deg, rgba(0,0,0,.05) 0 .5mm, transparent .5mm 1.6mm),
      repeating-linear-gradient(-45deg, rgba(0,0,0,.05) 0 .5mm, transparent .5mm 1.6mm),
      #c0100e;
    color: #f9b902;
    display: flex; align-items: center; justify-content: center; gap: 6mm;
    writing-mode: vertical-rl;
  }
  .spine { justify-content: space-between; padding: 6mm 0; }
  .spine b { font-size: 19mm; letter-spacing: .04em; text-transform: uppercase; }
  .spine span { font-size: 4.6mm; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #fff; }

  /* The reference sets a red disc with a handset beside the phone and one with
     a clock beside the opening times. Both are inline SVG — drawn, so they stay
     vector in the PDF and need no asset. */
  .ico { display: inline-block; vertical-align: middle; margin-right: 2.5mm; width: 9mm; height: 9mm; flex: none; }
  .ico svg { display: block; width: 100%; height: 100%; }
  /* The supplied wordmark, keyed to transparency so the panel's own black and
     its faint yellow glow read through instead of a slightly-off black box.
     105mm wide keeps the source above 300dpi at print size. */
  .brandmark { width: 88mm; height: auto; display: block; }
  .coverrule { width: 100%; margin-top: 2.5mm; border-top: .5mm dotted rgba(255,255,255,.55); }

  .tel { margin-top: 4mm; }
  .telline { display: flex; align-items: center; justify-content: center; font-size: 7.5mm; font-weight: 600; letter-spacing: .02em; }
  /* Anton draws well above its em box, so the number's glyphs ran over
     the line above even though the two boxes never touched. The margin is
     clearance for the overshoot, not decoration — don't trim it. */
  .tel b { display: block; margin-top: 2mm; font-size: 17mm; line-height: 1; letter-spacing: .06em; color: #fbefd2; }

  /* The cover's straps are the same device as a section header, so they take
     the same plaque — a flat yellow bar next to a bitten one would read as an
     oversight. Text is centred here, so the left/right insets match. */
  .strapline { display: flex; align-items: center; gap: .8mm; margin: 6mm 0 3mm; align-self: flex-start; }
  .strapline .strap { margin: 0; min-width: 52mm; font-size: 5.2mm; }
  .strap.plain {
    border: 0; background: none; padding: 0; margin: 5mm 0 2mm;
    color: #f9b902; font-size: 5.8mm;
  }
  .strap.red { border-image-source: url(img/header-plaque-red.png); color: #fdf3d8; }
  .strap.website { font-size: 5.4mm; letter-spacing: .02em; padding: .25em .8em; }
  .strap {
    display: flex; align-items: center; justify-content: center;
    margin: 6mm 0 3mm; padding: .2em .35em .16em .35em;
    border-style: solid; border-color: transparent;
    border-width: .11em .5em .12em .15em;
    border-image: url(img/header-plaque.png) 18 85 20 25 fill stretch;
    color: #111; font-size: 4.4mm;
    text-transform: uppercase;
  }
  .fine { margin: 0; width: 100%; font-size: 4.1mm; line-height: 1.45; font-weight: 400; color: #fff; }
  .hours { display: grid; grid-template-columns: auto auto; column-gap: 9mm; row-gap: 1mm; justify-content: center; }
  .hours div { display: contents; }
  /* Straight from the shop's config, not written here — the same wording the
     website shows at checkout. */
  .allergy {
    margin: 9mm 0 0; padding: 2.4mm 4mm;
    border: .35mm solid rgba(255,196,0,.55); border-radius: 1.5mm;
    font-size: 2.9mm; line-height: 1.45; font-weight: 600; color: #e8dcc6;
  }
  .allergy b { color: #f9b902; text-transform: uppercase; letter-spacing: .08em; }
  .hours span, .hours b { font-size: 3.9mm; font-weight: 500; }
  .hours span { text-align: left; }
  .hours b { color: #fff; text-align: left; }

  .qrwrap { display: flex; align-items: center; justify-content: center; gap: 3mm; padding-top: 3mm; }
  .qrtxt .arrow { display: block; font-size: 6mm; color: #f9b902; line-height: 1; }
  /* Reserved for the pizza / basil / tomato photograph the reference floods the
     lower half of the cover with. Empty until that asset exists. */
  /* A spacer for the missing cover photograph: it absorbs slack, it must not
     demand any — a min-height here pushed the cover 10mm past its box and
     under the footer ticker. */
  .coverart { flex: 1; min-height: 0; }
  .qr { width: 30mm; height: 30mm; background: #fff; padding: 1.5mm; border-radius: 1.5mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .qrtxt { text-align: right; }
  .qrtxt b { display: block; font-size: 4.6mm; color: #f9b902; transform: skewX(-8deg); }
  .qrtxt span { font-size: 2.9mm; font-weight: 700; }
  .allergy { margin-top: 6mm; }

  /* ---- foot ticker ---- */
  .ticker {
    /* Floods the bleed: the band must run through the cut, not end on it. */
    position: absolute; left: 0; right: 0; bottom: 0; height: 11mm;
    padding: 0 3mm 3mm;
    background: #f9b902; color: #111;
    display: flex; align-items: center; justify-content: center; gap: 2.5mm;
    font-size: 3.4mm; letter-spacing: .08em; overflow: hidden; white-space: nowrap;
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
    ${sizedList('drinks', 'size', ['CAN', 'BOTTLE'], { secondOnly: /\d+\s*ml|bottle/i, tight: false, tone: ['gold', 'gold'], labels: ['Can', 'Bottle'], slot: 48, chipsBelow: true })}
    ${milkshakes()}
    ${list('desserts', { desc: true, img: shot('cake', 50), slot: 50 })}
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
    <div class="halftone">${shot('pizza', 82, 'below')}</div>
  </div>
  <div class="panel tight">
    ${sizedList('garlic-bread', 'size', ['11"', '13"'], { tone: ['red', 'red'], slot: 14 })}
    ${list('calzone', { dense: true, desc: true, img: shot('calzone', 46, 'mid'), slot: 14, chip: '11"' })}
    ${sizedList('kebab', 'size', ['MEDIUM', 'LARGE'], { title: 'Kebabs', img: shot('kebab', 42, 'mid'), slot: 4 })}
    ${list('parmesan', { dense: true, desc: true, slot: 48 })}
    ${list('wraps', { dense: true, desc: true, img: shot('wrap', 46), slot: 48, title: 'Wrap' })}
  </div>
  <div class="panel">
    ${sizedList('burgers', 'size', ['1/4 lb', '1/2 lb'], { slot: 18 })}
    ${list('sides', { dense: true, img: shot('sides', 57), title: 'Sides', slot: 56, dots: true })}
    ${list('salad', { dense: true, desc: true, img: shot('salad', 62), slot: 56, dots: true })}
  </div>
`, false)}

</body></html>`;

fs.writeFileSync(path.join(import.meta.dirname, 'menu.html'), html);
const n = menu.reduce((a, c) => a + c.items.length, 0);
console.log(`menu.html written — ${n} items across ${menu.length} categories`);
console.log('photo dpi: ' + shotDpi.sort((a, b) => a.dpi - b.dpi)
  .map((s) => `${s.name} ${s.mm}mm=${s.dpi}`).join('  '));
console.log(`phone ${cfg.business.phone} · min £${del.minimumOrderPence / 100} · £${perMile}/mile to ${maxMiles} miles`);
