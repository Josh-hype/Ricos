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

const cat = (id) => menu.find((c) => c.id === id) || { name: id, items: [] };
const money = (n) => '£' + Number(n).toFixed(2);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* A price list. `dense` drops the description to fit more in. */
function list(id, { dense = false, cols = 1, title = null } = {}) {
  const c = cat(id);
  const rows = c.items.map((i) => `
      <li>
        <span class="n">${esc(i.name)}${!dense && i.desc ? `<em>${esc(i.desc)}</em>` : ''}</span>
        <span class="dots"></span>
        <span class="p">${money(i.price)}</span>
      </li>`).join('');
  return `
    <section class="blk">
      <h3>${esc(title || c.name)}</h3>
      <ul class="items${cols > 1 ? ' two' : ''}${dense ? ' dense' : ''}">${rows}</ul>
    </section>`;
}

/* Pizzas carry a second price for 13". */
function pizzaList() {
  const c = cat('pizza');
  const rows = c.items.map((i) => {
    const up = (i.options || []).find((o) => o.id === 'size');
    const big = up && up.choices.find((x) => x.id === 'sz13');
    const p13 = big ? Number(i.price) + Number(big.price || 0) : null;
    return `
      <li>
        <span class="n">${esc(i.name)}</span>
        <span class="dots"></span>
        <span class="p2">${money(i.price)}</span>
        <span class="p2">${p13 != null ? money(p13) : '—'}</span>
      </li>`;
  }).join('');
  return `
    <section class="blk">
      <h3>Pizza <span class="hdr2">11"&nbsp;&nbsp;&nbsp;13"</span></h3>
      <ul class="items sized">${rows}</ul>
    </section>`;
}

/* Meal deals get boxes, as on the reference. */
function deals() {
  const c = cat('meal-deals');
  return `
    <section class="blk">
      <h3>Meal Deals</h3>
      <div class="deals">
        ${c.items.map((i) => `
        <div class="deal">
          <b>${esc(i.name)}</b>
          <p>${esc(i.desc || '')}</p>
          <strong>${money(i.price)}</strong>
        </div>`).join('')}
      </div>
    </section>`;
}

/* Dips: the flat-rate ones as a tick list, the dearer pots called out. */
function dips() {
  const c = cat('dips');
  const cheap = c.items.filter((i) => Number(i.price) === 1);
  const dear = c.items.filter((i) => Number(i.price) !== 1);
  return `
    <section class="blk">
      <h3>Dips <span class="hdr2">£1.00</span></h3>
      <ul class="chips">${cheap.map((i) => `<li>${esc(i.name)}</li>`).join('')}</ul>
      <ul class="items dense">${dear.map((i) => `
        <li><span class="n">${esc(i.name)}</span><span class="dots"></span><span class="p">${money(i.price)}</span></li>`).join('')}</ul>
    </section>`;
}

const hours = [
  ['Sunday – Thursday', cfg.hours.sunday.windows[0]],
  ['Friday – Saturday', cfg.hours.friday.windows[0]],
].map(([label, w]) => {
  const t = (s) => { const [h, m] = s.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12; return m ? `${hh}.${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`; };
  return `<div><span>${label}</span><b>${t(w.open)} – ${t(w.close)}</b></div>`;
}).join('');

const del = cfg.fulfillment.delivery;
const maxMiles = del.radius?.maxMiles ?? 5;
const perMile = (del.radius?.bands?.[0]?.feePence ?? 100) / 100;

const cover = `
  <div class="panel cover">
    <div class="brandmark">
      <span class="big">BIG</span><span class="big">BITES</span>
      <span class="slice">SLICE IT!</span>
      <span class="fresh">★ FRESH &amp; LOADED ★</span>
    </div>
    <div class="tel">
      <span class="lab">Tel</span>
      <b>${esc(cfg.business.phone)}</b>
    </div>
    <div class="strap">Delivery Service or Collection</div>
    <p class="fine">
      Order on our website for collection or delivery.<br />
      Easingwold — £${perMile.toFixed(2)} per mile, up to ${maxMiles} miles.<br />
      Minimum order £${(del.minimumOrderPence / 100).toFixed(0)}.
    </p>
    <div class="strap">Opening Times</div>
    <div class="hours">${hours}</div>
    <div class="qrwrap">
      <div class="qr">${qr}</div>
      <div class="qrtxt"><b>SCAN ME</b><span>bigbiteseasingwold.co.uk</span></div>
    </div>
    <div class="addr">${esc(cfg.business.address.line1)}, ${esc(cfg.business.address.city)}, ${esc(cfg.business.address.postcode)}</div>
  </div>`;

const ticker = (n = 6) =>
  `<div class="ticker">${Array.from({ length: n }, () => '<span>SLICE IT</span><i>★</i><span>BIG BITES</span><i>★</i><span>FRESH &amp; LOADED</span><i>★</i>').join('')}</div>`;

const page = (cls, panels) => `
  <div class="page ${cls}">
    ${panels}
    ${ticker()}
  </div>`;

const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8" />
<title>Big Bites — A3 trifold menu</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Luckiest+Guy&family=Montserrat:wght@500;600;700;800;900&display=swap" rel="stylesheet" />
<style>
  /* ---- print geometry -------------------------------------------------
     A3 landscape 420x297mm, 3mm bleed all round -> 426x303mm trim box.
     Three equal 140mm panels. For a Z (concertina) fold equal thirds is
     correct; for a roll fold the tucked panel wants ~2mm shaving, which the
     printer will advise on. ------------------------------------------- */
  @page { size: 426mm 303mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #111; }
  body { font-family: 'Montserrat', system-ui, sans-serif; }

  .page {
    position: relative;
    width: 426mm; height: 303mm;
    padding: 3mm;                 /* the bleed */
    display: grid;
    grid-template-columns: 140mm 140mm 140mm;
    background: #0b0b0b;
    overflow: hidden;
    page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }

  .panel {
    position: relative;
    padding: 10mm 8mm 14mm;
    border-right: 0.4mm dashed rgba(255,255,255,.14);   /* fold guide */
    background:
      radial-gradient(circle at 30% 12%, rgba(255,196,0,.06), transparent 45%),
      #0b0b0b;
    color: #fff;
    overflow: hidden;
  }
  .panel:last-of-type { border-right: 0; }

  /* ---- section blocks ---- */
  .blk { margin-bottom: 6mm; }
  .blk h3 {
    display: inline-block;
    margin: 0 0 3mm;
    padding: 1.4mm 4mm 1mm;
    background: #ffc400;
    color: #111;
    font-family: 'Luckiest Guy', Impact, sans-serif;
    font-size: 6.4mm; line-height: 1.05;
    letter-spacing: .02em;
    text-transform: uppercase;
    transform: rotate(-1.2deg);
  }
  .blk h3 .hdr2 { font-family: 'Montserrat'; font-size: 3.4mm; font-weight: 800; margin-left: 2mm; }

  .items { list-style: none; margin: 0; padding: 0; }
  .items.two { column-count: 2; column-gap: 6mm; }
  .items li {
    display: flex; align-items: baseline; gap: 1.5mm;
    break-inside: avoid;
    padding: .7mm 0;
    font-size: 3.15mm; line-height: 1.25;
  }
  .items.dense li { font-size: 3mm; padding: .45mm 0; }
  .items .n { font-weight: 700; text-transform: uppercase; letter-spacing: .01em; }
  .items .n em {
    display: block; font-style: normal; font-weight: 500;
    text-transform: none; font-size: 2.6mm; color: #c9bda8; margin-top: .3mm;
  }
  .items .dots { flex: 1; border-bottom: .3mm dotted rgba(255,255,255,.32); transform: translateY(-.8mm); }
  .items .p { font-weight: 800; color: #ffc400; white-space: nowrap; }
  .items.sized li { gap: 2mm; }
  .items.sized .p2 { width: 13mm; text-align: right; font-weight: 800; color: #ffc400; white-space: nowrap; }

  .chips { list-style: none; margin: 0 0 2mm; padding: 0; column-count: 2; column-gap: 5mm; }
  .chips li { font-size: 3mm; font-weight: 700; text-transform: uppercase; padding: .5mm 0; break-inside: avoid; }
  .chips li::before { content: '•'; color: #ffc400; margin-right: 1.6mm; }

  /* ---- meal deal boxes ---- */
  .deals { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; }
  .deal {
    background: #fdf6e3; color: #111;
    border: .6mm solid #111; border-radius: 2mm;
    padding: 2.6mm 2.4mm; text-align: center;
    box-shadow: 1mm 1mm 0 rgba(0,0,0,.55);
  }
  .deal b { display: block; font-family: 'Luckiest Guy', Impact, sans-serif; color: #d61313; font-size: 3.9mm; line-height: 1.05; }
  .deal p { margin: 1mm 0 1.4mm; font-size: 2.55mm; line-height: 1.3; font-weight: 600; }
  .deal strong { font-size: 4.6mm; font-weight: 900; }

  /* ---- cover panel ---- */
  .cover { display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 12mm; }
  .brandmark { display: flex; flex-direction: column; align-items: center; line-height: .84; }
  .brandmark .big {
    font-family: 'Luckiest Guy', Impact, sans-serif;
    font-size: 26mm; color: #ffc400;
    -webkit-text-stroke: 1.1mm #111;
    text-shadow: 1.6mm 1.6mm 0 #d61313;
    letter-spacing: .01em;
  }
  .brandmark .slice {
    margin-top: 2.5mm; padding: .8mm 4mm;
    background: #d61313; color: #fff;
    font-family: 'Luckiest Guy', Impact, sans-serif; font-size: 5.4mm;
    transform: rotate(-2deg);
  }
  .brandmark .fresh { margin-top: 2mm; font-size: 3.4mm; font-weight: 800; letter-spacing: .18em; color: #ffc400; }

  .tel { margin-top: 8mm; }
  .tel .lab { display: block; font-size: 3.4mm; font-weight: 800; letter-spacing: .3em; color: #ffc400; }
  .tel b { display: block; font-family: 'Luckiest Guy', Impact, sans-serif; font-size: 15mm; letter-spacing: .02em; }

  .strap {
    margin: 6mm 0 2mm; padding: 1.2mm 4mm;
    background: #ffc400; color: #111;
    font-family: 'Luckiest Guy', Impact, sans-serif; font-size: 4.4mm;
    text-transform: uppercase;
  }
  .fine { margin: 0; font-size: 3mm; line-height: 1.5; font-weight: 600; color: #e8dcc6; }
  .hours { width: 100%; }
  .hours div { display: flex; justify-content: space-between; font-size: 3.2mm; padding: .9mm 0; border-bottom: .2mm dotted rgba(255,255,255,.25); }
  .hours b { color: #ffc400; }

  .qrwrap { margin-top: auto; display: flex; align-items: center; gap: 4mm; padding-top: 6mm; }
  .qr { width: 30mm; height: 30mm; background: #fff; padding: 1.5mm; border-radius: 1.5mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .qrtxt { text-align: left; }
  .qrtxt b { display: block; font-family: 'Luckiest Guy', Impact, sans-serif; font-size: 5mm; color: #ffc400; }
  .qrtxt span { font-size: 2.9mm; font-weight: 700; }
  .addr { margin-top: 4mm; font-size: 3mm; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #e8dcc6; }

  /* ---- foot ticker ---- */
  .ticker {
    position: absolute; left: 3mm; right: 3mm; bottom: 3mm; height: 7mm;
    background: #ffc400; color: #111;
    display: flex; align-items: center; justify-content: center; gap: 2.5mm;
    font-family: 'Luckiest Guy', Impact, sans-serif; font-size: 3.4mm;
    letter-spacing: .08em; overflow: hidden; white-space: nowrap;
  }
  .ticker i { color: #d61313; font-style: normal; }
</style></head>
<body>

${page('side-a', `
  <div class="panel">
    ${list('drinks')}
    ${list('milkshakes')}
    ${list('desserts', { dense: true })}
  </div>
  <div class="panel">
    ${dips()}
    ${list('kids')}
    ${deals()}
  </div>
  ${cover}
`)}

${page('side-b', `
  <div class="panel">
    ${pizzaList()}
    ${list('garlic-bread', { dense: true })}
  </div>
  <div class="panel">
    ${list('kebab', { dense: true })}
    ${list('wraps', { dense: true })}
    ${list('calzone', { dense: true })}
  </div>
  <div class="panel">
    ${list('burgers', { dense: true })}
    ${list('sides', { dense: true, cols: 2 })}
    ${list('parmesan', { dense: true })}
    ${list('salad', { dense: true })}
  </div>
`)}

</body></html>`;

fs.writeFileSync(path.join(import.meta.dirname, 'menu.html'), html);
const n = menu.reduce((a, c) => a + c.items.length, 0);
console.log(`menu.html written — ${n} items across ${menu.length} categories`);
console.log(`phone ${cfg.business.phone} · min £${del.minimumOrderPence / 100} · £${perMile}/mile to ${maxMiles} miles`);
