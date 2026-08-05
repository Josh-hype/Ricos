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

/* PNG dimensions straight out of the IHDR chunk — needed so a side photo can
   reserve its own height, which CSS can't work out for an absolutely
   positioned image. */
function imgSize(name) {
  const b = fs.readFileSync(path.join(import.meta.dirname, 'img', `${name}.png`));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/* Food photography, cut out of the sheet the owner supplied — see img/README.
   `place: 'side'` drops it into the gutter between the item names and the price
   column, as the designer's sheets do; 'below' centres it underneath. `clear`
   is how much room the prices need on the right — two-column price lists need
   more than one. Widths are capped by the source resolution; img/README records
   the dpi each lands at. */
function shot(name, width, place = 'side', clear = 15) {
  if (!name) return '';
  const { w, h } = imgSize(name);
  const tall = (width * h / w).toFixed(1);
  return `<img class="shot ${place}" src="img/${name}.png" alt=""
    style="width:${width}mm;--clear:${clear}mm;--shoth:${tall}mm" />`;
}

/* Prices stay pinned to the right edge of the panel — the photo is lifted out
   of the flow and dropped into the gutter rather than narrowing the list, which
   is what pulled the prices inwards before. The gutter is reserved on the row
   so a long item name can never run underneath the picture. */
function withShot(inner, img) {
  if (!img) return inner;
  if (img.includes('below')) return `${inner}${img}`;
  const num = (k) => +(new RegExp(`${k}:([\\d.]+)mm`).exec(img)?.[1] || 0);
  const w = num('width') || 30;
  return `<div class="blkrow" style="--gutter:${(w + num('--clear') + 4).toFixed(1)}mm;
    --rowmin:${(num('--shoth') + 3).toFixed(1)}mm">${inner}${img}</div>`;
}

/* Some items carry their whole description in a required choice rather than a
   desc field — Kids Sunny is "(4) & chips or Tenders (3) & chips". Printing
   just the name would lose that, as the first draft did. */
function choiceLine(i) {
  const o = (i.options || []).find((x) => x.required && x.select === 'single');
  return o ? o.choices.map((c) => c.label).join(' or ') : '';
}

/* A price list. `dense` drops the description to fit more in. */
function list(id, { dense = false, cols = 1, title = null, desc = false, img = '', choices = false } = {}) {
  const c = cat(id);
  const rows = c.items.map((i) => {
    const d = i.desc || (choices ? choiceLine(i) : '');
    return `
      <li>
        <span class="n">${esc(i.name)}${(desc || !dense) && d ? `<em>${esc(d)}</em>` : ''}</span>
        <span class="dots"></span>
        <span class="p">${money(i.price)}</span>
      </li>`;
  }).join('');
  return `
    <section class="blk">
      <h3>${esc(title || c.name)}</h3>
      ${withShot(`<ul class="items${cols > 1 ? ' two' : ''}${dense ? ' dense' : ''}">${rows}</ul>`, img)}
    </section>`;
}

/* Any list whose items carry a two-choice size option (pizza 11"/13",
   garlic bread the same, burgers ¼lb/½lb, kebabs medium/large). Prints both
   prices in their own columns, with the topping line under the name — exactly
   as the designer's sheet does. Items without the option get one price and a
   dash, which is how the reference handles Tray Doner and the like. */
function sizedList(id, optId, headings, { title = null, img = '', secondOnly = null, tight = true } = {}) {
  const c = cat(id);
  const rows = c.items.map((i) => {
    const opt = (i.options || []).find((o) => o.id === optId);
    const up = opt && opt.choices[1];
    const p2 = up ? Number(i.price) + Number(up.price || 0) : null;
    /* A few items only exist in the second size — a 500ml water is a bottle,
       not a can — so their single price belongs in the right-hand column. */
    const only2 = !opt && secondOnly && secondOnly.test(i.name);
    return `
      <li>
        <span class="n">${esc(i.name)}${i.desc ? `<em>${esc(i.desc)}</em>` : ''}</span>
        <span class="dots"></span>
        <span class="p2">${only2 ? '—' : money(i.price)}</span>
        <span class="p2">${only2 ? money(i.price) : p2 != null ? money(p2) : '—'}</span>
      </li>`;
  }).join('');
  return `
    <section class="blk">
      <h3>${esc(title || c.name)} <span class="sizehdr"><i>${headings[0]}</i><i>${headings[1]}</i></span></h3>
      ${withShot(`<ul class="items sized${tight ? ' withdesc' : ''}">${rows}</ul>`, img)}
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
function dips({ img = '' } = {}) {
  const c = cat('dips');
  const cheap = c.items.filter((i) => Number(i.price) === 1);
  const dear = c.items.filter((i) => Number(i.price) !== 1);
  return `
    <section class="blk">
      <h3>Dips <span class="hdr2">£1.00</span></h3>
      ${withShot(`<div>
      <ul class="chips">${cheap.map((i) => `<li>${esc(i.name)}</li>`).join('')}</ul>
      <ul class="items dense">${dear.map((i) => `
        <li><span class="n">${esc(i.name)}</span><span class="dots"></span><span class="p">${money(i.price)}</span></li>`).join('')}</ul>
      </div>`, img)}
    </section>`;
}

/* The stuffed-crust supplement is a per-size modifier on every pizza; read it
   off the first one rather than hard-coding it. */
function stuffedCrust() {
  const pz = cat('pizza').items[0] || {};
  const crust = (pz.options || []).find((o) => o.id === 'crust');
  const st = crust && crust.choices.find((x) => x.id === 'stuffed');
  if (!st) return '';
  const by = st.priceBySize || {};
  const p13 = by.sz13 != null ? by.sz13 : st.price;
  return `<div class="supp">Stuffed Crust Supplement <b>+${money(st.price)}</b> <b>+${money(p13)}</b></div>`;
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
    <img class="brandmark" src="logo.png" alt="Big Bites — Slice It! Fresh &amp; Loaded" />
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
    ${cfg.allergens?.noticeAtCheckout ? `<p class="allergy"><b>Allergies?</b> ${esc(cfg.allergens.noticeAtCheckout)}</p>` : ''}
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
    /* Spread the sections down the panel instead of stacking them at the top
       and leaving a hole above the fold ticker — the reference sheet does the
       same. On a panel that exactly fills, this is a no-op. */
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 8mm 7mm 13mm;
    border-right: 0.4mm dashed rgba(255,255,255,.14);   /* fold guide */
    background:
      radial-gradient(circle at 30% 12%, rgba(255,196,0,.06), transparent 45%),
      #0b0b0b;
    color: #fff;
    overflow: hidden;
  }
  /* Sections keep their natural height; only the gaps between them stretch. */
  .panel > * { flex: none; }
  .panel:last-of-type { border-right: 0; }

  /* Following the designer's section order puts five blocks on the inner
     middle panel against three elsewhere, so that one panel carries tighter
     leading — the same trade the reference sheet makes. Scoped to the panel
     rather than applied globally, so the roomier panels stay roomy. */
  .panel.tight .blk { margin-bottom: 2.5mm; }
  .panel.tight .blk h3 { font-size: 5.6mm; margin-bottom: 1.5mm; }
  .panel.tight .items.dense li { padding: .2mm 0; }

  /* ---- section blocks ---- */
  .blk { margin-bottom: 5mm; }
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
    margin: 0 0 3mm;
    padding: .22em .3em .18em .55em;
    border-style: solid; border-color: transparent;
    /* 18/85/20/25 source px at the height this header renders — solving
       240k = 1.05 + 0.4 + 38k gives k = 0.00718em per source pixel. Get these
       wrong and the bite comes out squashed or stretched. */
    border-width: .129em .61em .144em .179em;
    border-image: url(img/header-plaque.png) 18 85 20 25 fill stretch;
    color: #111;
    font-family: 'Luckiest Guy', Impact, sans-serif;
    font-size: 6.4mm; line-height: 1.05;
    letter-spacing: .02em;
    text-transform: uppercase;
    transform: rotate(-1.2deg);
  }
  .blk h3 .hdr2 { font-family: 'Montserrat'; font-size: 3.4mm; font-weight: 800; margin-left: 2mm; }

  /* ---- food photography ----
     The cutouts arrive on transparency, so they drop straight onto the panel.
     The shadow is added here rather than baked in, so it stays consistent and
     survives a colour change to the panel. */
  .blkrow { position: relative; min-height: var(--rowmin, 0); }
  .shot { height: auto; display: block; filter: drop-shadow(0 1.2mm 1.8mm rgba(0,0,0,.65)); }
  /* Sits in the gutter, clear of the prices, which stay hard right. */
  .shot.side { position: absolute; top: 50%; translate: 0 -50%; right: var(--clear, 15mm); }
  .shot.below { margin: 3mm auto 0; }
  /* The reservation: the leaders refuse to shrink past the gutter, so a long
     name wraps instead of running under the photo. Lists that hide their
     leaders reserve it on the name itself. */
  .blkrow .items .dots { min-width: var(--gutter); }
  .blkrow .items.withdesc .n { padding-right: var(--gutter); }

  .items { list-style: none; margin: 0; padding: 0; }
  .items.two { column-count: 2; column-gap: 6mm; }
  .items li {
    display: flex; align-items: baseline; gap: 1.5mm;
    break-inside: avoid;
    padding: .7mm 0;
    font-size: 3.15mm; line-height: 1.25;
  }
  .items.dense li { font-size: 2.85mm; padding: .35mm 0; }
  .items .n { font-weight: 700; text-transform: uppercase; letter-spacing: .01em; }
  .items .n em {
    display: block; font-style: normal; font-weight: 500;
    text-transform: none; font-size: 2.6mm; color: #c9bda8; margin-top: .3mm;
  }
  .items .dots { flex: 1; border-bottom: .3mm dotted rgba(255,255,255,.32); transform: translateY(-.8mm); }
  .items .p { font-weight: 800; color: #ffc400; white-space: nowrap; }
  .items.sized li { gap: 2mm; }
  .items.sized .p2 { width: 11mm; text-align: right; font-weight: 800; color: #ffc400; white-space: nowrap; }

  .blk h3 .sizehdr { display: inline-flex; gap: 1.5mm; margin-left: 2.5mm; vertical-align: middle; }
  .blk h3 .sizehdr i {
    font-family: 'Montserrat'; font-style: normal; font-size: 2.7mm; font-weight: 800;
    background: #111; color: #fff; padding: .5mm 1.6mm; border-radius: .8mm; min-width: 9mm; text-align: center;
  }
  /* 32 pizzas with a topping line each need tighter type than the simple
     lists — the same trade the designer makes. */
  .items.withdesc li { align-items: flex-start; padding: .38mm 0; font-size: 2.55mm; line-height: 1.12; }
  .items.withdesc .n em { font-size: 2.1mm; margin-top: .1mm; line-height: 1.15; }
  .items.withdesc .p2 { font-size: 2.6mm; }
  .items.withdesc .dots { display: none; }
  .items.withdesc .n { flex: 1; }
  .supp {
    display: flex; justify-content: flex-end; gap: 2mm;
    margin-top: 1.5mm; padding: 1mm 2mm;
    background: #d61313; color: #fff;
    font-size: 2.8mm; font-weight: 800; text-transform: uppercase;
  }
  .supp b { width: 13mm; text-align: right; }

  .chips { list-style: none; margin: 0 0 3mm; padding: 0; column-count: 2; column-gap: 5mm; }
  .chips li { font-size: 3.3mm; font-weight: 700; text-transform: uppercase; padding: 1.1mm 0; break-inside: avoid; }
  .chips li::before { content: '•'; color: #ffc400; margin-right: 1.6mm; }

  /* ---- meal deal boxes ---- */
  /* The deals are the upsell and the reference gives them a third of the
     panel, so they're sized to fill rather than left as small boxes. */
  .deals { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .deal {
    background: #fdf6e3; color: #111;
    border: .6mm solid #111; border-radius: 2mm;
    padding: 3.5mm 3mm; text-align: center;
    box-shadow: 1.2mm 1.2mm 0 rgba(0,0,0,.55);
    display: flex; flex-direction: column; justify-content: center;
  }
  .deal b { display: block; font-family: 'Luckiest Guy', Impact, sans-serif; color: #d61313; font-size: 4.6mm; line-height: 1.05; }
  .deal p { margin: 1.8mm 0 2.2mm; font-size: 2.9mm; line-height: 1.35; font-weight: 600; }
  .deal strong { font-size: 5.6mm; font-weight: 900; }

  /* ---- cover panel ---- */
  /* The cover balances itself (the QR block takes the slack with margin-top:
     auto), so it opts out of the panel's space-between. */
  .cover { justify-content: flex-start; align-items: center; text-align: center; padding-top: 6mm; }
  /* The supplied wordmark, keyed to transparency so the panel's own black and
     its faint yellow glow read through instead of a slightly-off black box.
     105mm wide keeps the source above 300dpi at print size. */
  .brandmark { width: 112mm; height: auto; display: block; }

  .tel { margin-top: 7mm; }
  /* Luckiest Guy draws well above its em box, so the number's glyphs ran over
     the label even though the two boxes never touched. The margin is clearance
     for the overshoot, not decoration — don't trim it. */
  .tel .lab { display: block; margin-bottom: 6mm; font-size: 3.4mm; font-weight: 800; letter-spacing: .3em; color: #ffc400; }
  .tel b { display: block; font-family: 'Luckiest Guy', Impact, sans-serif; font-size: 15mm; line-height: 1; letter-spacing: .02em; }

  /* The cover's straps are the same device as a section header, so they take
     the same plaque — a flat yellow bar next to a bitten one would read as an
     oversight. Text is centred here, so the left/right insets match. */
  .strap {
    margin: 9mm 0 3mm; padding: .2em .35em .16em .35em;
    border-style: solid; border-color: transparent;
    border-width: .11em .5em .12em .15em;
    border-image: url(img/header-plaque.png) 18 85 20 25 fill stretch;
    color: #111;
    font-family: 'Luckiest Guy', Impact, sans-serif; font-size: 4.4mm;
    text-transform: uppercase;
  }
  .fine { margin: 0; font-size: 3mm; line-height: 1.5; font-weight: 600; color: #e8dcc6; }
  .hours { width: 100%; }
  .hours div { display: flex; justify-content: space-between; font-size: 3.2mm; padding: 2mm 0; border-bottom: .2mm dotted rgba(255,255,255,.25); }
  /* Straight from the shop's config, not written here — the same wording the
     website shows at checkout. */
  .allergy {
    margin: 9mm 0 0; padding: 2.4mm 4mm;
    border: .35mm solid rgba(255,196,0,.55); border-radius: 1.5mm;
    font-size: 2.9mm; line-height: 1.45; font-weight: 600; color: #e8dcc6;
  }
  .allergy b { color: #ffc400; text-transform: uppercase; letter-spacing: .08em; }
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

${/* Section order and panel assignment follow the designer's artwork exactly:
      outer face  — Drinks/Milk Shakes/Desserts/Kids | Dips/Meal Deals | cover
      inner face  — Pizza | Garlic Bread/Calzone/Kebabs/Parmesan/Wrap | Burgers/Sides/Salad
      Don't reshuffle these without checking the reference sheets again. */''}
${page('side-a', `
  <div class="panel">
    ${sizedList('drinks', 'size', ['CAN', 'BOTTLE'], { secondOnly: /\d+\s*ml|bottle/i, tight: false })}
    ${list('milkshakes', { img: shot('shake', 26) })}
    ${list('desserts', { dense: true, desc: true, img: shot('cake', 36) })}
    ${list('kids', { choices: true })}
  </div>
  <div class="panel">
    ${dips()}
    ${shot('burger-meal', 96, 'below')}
    ${deals()}
  </div>
  ${cover}
`)}

${page('side-b', `
  <div class="panel">
    <div>
      ${sizedList('pizza', 'size', ['11"', '13"'])}
      ${stuffedCrust()}
    </div>
    ${shot('pizza', 50, 'below')}
  </div>
  <div class="panel tight">
    ${sizedList('garlic-bread', 'size', ['11"', '13"'])}
    ${list('calzone', { dense: true, desc: true, img: shot('calzone', 34) })}
    ${sizedList('kebab', 'size', ['MED', 'LGE'], { title: 'Kebabs', img: shot('kebab', 27, 'side', 25) })}
    ${list('parmesan', { dense: true, desc: true })}
    ${list('wraps', { dense: true, desc: true, img: shot('wrap', 33) })}
  </div>
  <div class="panel">
    ${sizedList('burgers', 'size', ['¼lb', '½lb'])}
    ${list('sides', { dense: true, cols: 2, img: shot('sides', 36, 'below') })}
    ${list('salad', { dense: true, desc: true, img: shot('salad', 40) })}
  </div>
`)}

</body></html>`;

fs.writeFileSync(path.join(import.meta.dirname, 'menu.html'), html);
const n = menu.reduce((a, c) => a + c.items.length, 0);
console.log(`menu.html written — ${n} items across ${menu.length} categories`);
console.log(`phone ${cfg.business.phone} · min £${del.minimumOrderPence / 100} · £${perMile}/mile to ${maxMiles} miles`);
