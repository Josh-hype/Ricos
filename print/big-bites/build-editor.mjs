/* Build a self-contained, draggable proof of the menu.
 *
 *   node print/big-bites/build-menu.mjs     (first — the editor wraps its output)
 *   node print/big-bites/build-editor.mjs   -> menu-editor.html
 *
 * menu-editor.html is the whole sheet with every font and photo inlined as a
 * data URI, plus a move-things-around panel adapted from templates/editor.js
 * (same battle-tested pointer handling: select first then drag, touch-action
 * pinned on the selected block only, tap empty space to deselect).
 *
 * Differences from the website editor, all because this is PRINT:
 *  - blocks are auto-discovered from the sheet, not hand-listed per shop
 *  - the report is in millimetres (the sheet is 426x303mm; 1px = 25.4/96 mm)
 *  - there is a zoom control, and drags divide by the zoom so the block
 *    follows the finger at any scale
 *
 * The offsets are previews (CSS translate/scale/rotate). They get converted
 * into real layout — margins, widths, font sizes — by hand afterwards; never
 * paste them into build-menu.mjs as-is.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dirname;
let html = fs.readFileSync(path.join(DIR, 'menu.html'), 'utf8');

const mime = { ttf: 'font/ttf', png: 'image/png', svg: 'image/svg+xml' };
const data = (rel) => {
  const f = path.join(DIR, rel);
  const ext = rel.split('.').pop();
  return `data:${mime[ext]};base64,${fs.readFileSync(f).toString('base64')}`;
};

// Inline every local reference so the file works opened from anywhere.
html = html.replace(/url\((fonts\/[\w.-]+\.ttf)\)/g, (_, p) => `url(${data(p)})`);
/* Keep the filename on the tag. Inlining the image as a data URI wiped the
   only thing that said which photograph it was, so every one of them came out
   labelled "photo photo" in the block list — and an export naming three
   identical blocks is an export nobody can act on without guessing. */
html = html.replace(/src="(img\/([\w.-]+)\.png)"/g,
  (_, p, name) => `data-photo="${name}" src="${data(p)}"`);
html = html.replace(/src="(logo\.png)"/g, (_, p) => `src="${data(p)}"`);
html = html.replace(/url\((img\/[\w.-]+\.png)\)/g, (_, p) => `url(${data(p)})`);

const editor = `
<style>
  html, body { background: #2b2b2b !important; }
  #pz-wrap { transform-origin: 0 0; width: fit-content; margin: 46px 8px 130px; }
  #pz-wrap .page { margin-bottom: 10mm; box-shadow: 0 6px 30px rgba(0,0,0,.6); }
  .pe-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 99999; display: flex; gap: 6px;
    padding: 7px 10px; background: #14100d; border-bottom: 2px solid #f9b902; }
  .pe-bar button { padding: 6px 12px; border-radius: 7px; border: 1px solid #4a3a2c;
    background: #2b211a; color: #fff6e5; font: 13px system-ui; cursor: pointer; }
  .pe-bar button.on { background: #f9b902; color: #14100d; font-weight: 700; }
  .pe-bar span { color: #c9b9a4; font: 11px/2.4 system-ui; margin-left: auto; }
  .bbe{position:fixed;right:10px;bottom:10px;z-index:99999;width:250px;font:13px/1.4 system-ui,sans-serif;
    background:#14100d;color:#fff6e5;border:2px solid #f9b902;border-radius:12px;padding:12px;box-shadow:0 18px 44px rgba(0,0,0,.5)}
  .bbe h4{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;cursor:pointer;
    font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#f9b902}
  .bbe select,.bbe input{width:100%;box-sizing:border-box;margin:3px 0 7px;padding:6px;border-radius:7px;
    border:1px solid #4a3a2c;background:#221a14;color:#fff6e5;font:inherit}
  .bbe .row{display:flex;gap:6px}.bbe .row>*{flex:1}
  .bbe button{cursor:pointer;padding:7px 8px;border-radius:7px;border:1px solid #4a3a2c;background:#2b211a;color:#fff6e5;font:inherit}
  .bbe button.go{background:#f9b902;color:#14100d;border-color:#f9b902;font-weight:700}
  .bbe button.on{background:#f9b902;color:#14100d;border-color:#f9b902;font-weight:700}
  .bbe .lab{display:block;font-size:11px;color:#c9b9a4;margin-top:4px}
  .bbe .hint{margin:8px 0 0;font-size:11px;color:#c9b9a4;line-height:1.35}
  .bbe .fold{display:block}.bbe.shut .fold{display:none}
  .bbe h4 .cx{font-size:15px;line-height:1}
  .bbe.none .fold{opacity:.4;pointer-events:none}
  .bbe.none .fold [data-pick]{opacity:1;pointer-events:auto}
  @media (max-width:700px){.bbe{left:6px;right:6px;bottom:6px;width:auto;padding:7px;font-size:11px;max-height:44vh;overflow:auto}
    .bbe .hint{display:none}.bbe select,.bbe input{margin:1px 0 4px;padding:4px}
    .bbe .lab{margin-top:1px}.bbe .row{gap:4px}.bbe button{padding:7px 4px;border-radius:6px}.bbe h4{font-size:11px}}
  .bbe-on{outline:2px dashed rgba(249,185,2,.9);outline-offset:2px;cursor:grab;touch-action:none;
    -webkit-user-select:none;user-select:none}
  .bbe-tag{position:fixed;z-index:99998;background:#f9b902;color:#14100d;font:600 11px system-ui;
    padding:2px 6px;border-radius:5px;pointer-events:none}
</style>
<script>
(function () {
  'use strict';
  var PXMM = 25.4 / 96;                       // the sheet renders at 96dpi CSS
  var mm = function (px) { return (px * PXMM).toFixed(1); };

  // ---- wrap the pages so the whole sheet can zoom -------------------------
  var wrap = document.createElement('div');
  wrap.id = 'pz-wrap';
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  document.body.insertBefore(wrap, pages[0]);
  pages.forEach(function (p) { wrap.appendChild(p); });

  var Z = 1;
  function setZoom(z, btn) {
    Z = z;
    wrap.style.transform = 'scale(' + z + ')';
    // reserve real scroll space for the scaled sheet
    wrap.style.height = wrap.scrollHeight ? '' : '';
    document.querySelectorAll('.pe-bar button[data-z]').forEach(function (b) {
      b.classList.toggle('on', b === btn);
    });
  }
  var bar = document.createElement('div');
  bar.className = 'pe-bar';
  bar.innerHTML = '<button data-z>Fit</button><button data-z>50%</button><button data-z>100%</button>' +
    '<span>Big Bites print sheet \u2014 tap a block, then drag. Text size and box size are separate.</span>';
  document.body.appendChild(bar);
  var zb = bar.querySelectorAll('[data-z]');
  zb[0].addEventListener('click', function () { setZoom((innerWidth - 20) / wrap.offsetWidth, zb[0]); });
  zb[1].addEventListener('click', function () { setZoom(.5, zb[1]); });
  zb[2].addEventListener('click', function () { setZoom(1, zb[2]); });
  zb[0].click();

  // ---- auto-discover the blocks ------------------------------------------
  // Panels are named the way we talk about them, and every block gets a label
  // a human can find again: "Inner 1 · PIZZA plaque".
  var panelNames = [];
  document.querySelectorAll('.page').forEach(function (pg, pi) {
    var face = pg.classList.contains('side-b') ? 'Inner' : 'Outer';
    pg.querySelectorAll('.panel').forEach(function (pn, ni) {
      panelNames.push({ el: pn, name: face + ' ' + (ni + 1) });
    });
  });
  function panelOf(el) {
    for (var k = 0; k < panelNames.length; k++) if (panelNames[k].el.contains(el)) return panelNames[k].name;
    return '?';
  }
  var items = [];
  function add(el, label) {
    if (!el || el.__pe) return;
    el.__pe = true;
    /* Key the saved state by a slug of the LABEL, never by position. It used
       to be 'pe' + index, with one storage key shared by every build of this
       file — so state saved in an older editor came back in a newer one
       attached to whatever block now sat at that index. That is how an export
       came back carrying photo scales the owner had never set in the editor he
       was looking at. */
    var lab = panelOf(el) + ' · ' + label;
    var sel = lab.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    var n = 1, base = sel;
    while (items.some(function (i) { return i.sel === sel; })) sel = base + '-' + (++n);
    items.push({ label: lab, sel: sel, el: el });
  }
  document.querySelectorAll('.blk').forEach(function (blk) {
    var h = blk.querySelector('h3');
    var name = h ? h.textContent.trim().replace(/\\s+/g, ' ') : 'section';
    if (h) add(h, name + ' plaque');
    var ch = blk.querySelector('.sizehdr'); if (ch) add(ch, name + ' size chips');
    blk.querySelectorAll('.items, .chips').forEach(function (u) { add(u, name + ' list'); });
    blk.querySelectorAll('.deal').forEach(function (d) {
      var b = d.querySelector('b'); add(d, (b ? b.textContent.trim() : 'deal') + ' box');
    });
    add(blk.querySelector('.kidsmark'), 'Kids ribbon');
    add(blk.querySelector('.kidsticket'), 'Kids ticket');
  });
  document.querySelectorAll('.shot').forEach(function (img) {
    /* data-photo survives the data-URI inlining; img.src does not, which is
       why every photograph used to be labelled "photo photo". */
    var n = img.getAttribute('data-photo') || 'photo';
    add(img, n + ' photo');
  });
  document.querySelectorAll('.supp').forEach(function (s) { add(s, 'stuffed crust bar'); });
  add(document.querySelector('.brandmark'), 'logo');
  add(document.querySelector('.tel'), 'phone block');
  document.querySelectorAll('.cover .strap, .cover .strapline').forEach(function (s) {
    add(s, '"' + s.textContent.trim().slice(0, 22) + '"');
  });
  add(document.querySelector('.fine'), 'delivery small print');
  add(document.querySelector('.hours'), 'opening hours');
  add(document.querySelector('.allergy'), 'allergy note');
  add(document.querySelector('.qrwrap'), 'QR block');
  add(document.querySelector('.spine'), 'red spine');
  document.querySelectorAll('.ticker').forEach(function (t) { add(t, 'footer ticker'); });

  items.forEach(function (i) { i.el.style.pointerEvents = 'auto'; });

  // ---- state (storage may be blocked where this file is hosted) ----------
  /* Versioned: a stored blob from the positional-key era must not be read
     back, because its keys mean nothing here. */
  var KEY = 'print-scratchpad:big-bites:v2';
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  /* Base box and type size are captured ONCE, before anything is applied, so
     repeated edits stay absolute instead of compounding. */
  items.forEach(function (i) {
    var r = i.el.getBoundingClientRect(), cs = getComputedStyle(i.el);
    i.bw = r.width; i.bh = r.height;
    i.bf = parseFloat(cs.fontSize) || 12;
  });
  function val(i) {
    if (!state[i.sel]) state[i.sel] = {};
    var v = state[i.sel];
    if (v.x == null) v.x = 0;
    if (v.y == null) v.y = 0;
    if (v.s == null) v.s = 100;
    if (v.r == null) v.r = 0;
    if (v.w == null) v.w = 100;      // box width  %
    if (v.h == null) v.h = 100;      // box height %
    if (v.f == null) v.f = 100;      // font size  %
    return v;
  }
  function apply(i) {
    var v = val(i);
    i.el.style.translate = v.x + 'px ' + v.y + 'px';
    var s = (Number(v.s) || 100) / 100;
    i.el.style.scale = (v.fx ? -s : s) + ' ' + (v.fy ? -s : s);
    i.el.style.rotate = (Number(v.r) || 0) + 'deg';
    /* Box size is the BOX, not a transform: the text reflows inside it, which
       is what "make the text box bigger" has to mean on a print sheet. */
    if (Number(v.w) !== 100) { i.el.style.width = (i.bw * v.w / 100).toFixed(2) + 'px'; i.el.style.maxWidth = 'none'; }
    else i.el.style.width = '';
    if (Number(v.h) !== 100) { i.el.style.height = (i.bh * v.h / 100).toFixed(2) + 'px'; }
    else i.el.style.height = '';
    if (Number(v.f) !== 100) i.el.style.fontSize = (i.bf * v.f / 100).toFixed(2) + 'px';
    else i.el.style.fontSize = '';
  }
  items.forEach(apply);

  // ---- panel -------------------------------------------------------------
  var panel = document.createElement('div');
  panel.className = 'bbe shut';
  panel.innerHTML =
    '<h4 data-fold-btn><span data-hdr>Move things</span><span class="cx">\\u25b8</span></h4>' +
    '<div class="fold">' +
    '<select data-pick><option value="-1">\\u2014 nothing selected \\u2014</option>' +
    items.map(function (i, n) { return '<option value="' + n + '">' + i.label + '</option>'; }).join('') + '</select>' +
    '<div class="row"><input data-x type="number" step="1" placeholder="left/right px"><input data-y type="number" step="1" placeholder="up/down px"></div>' +
    '<div class="row"><button data-nudge="-10,0">\\u2190</button><button data-nudge="0,-10">\\u2191</button><button data-nudge="0,10">\\u2193</button><button data-nudge="10,0">\\u2192</button></div>' +
    '<label class="lab">Whole thing (scale) %<input data-size type="number" step="5" min="20" max="300"></label>' +
    '<div class="row"><button data-size-step="-5">\\u2212 smaller</button><button data-size-step="5">+ bigger</button></div>' +
    '<label class="lab">Text size %<input data-font type="number" step="5" min="20" max="400"></label>' +
    '<div class="row"><button data-font-step="-5">A- text</button><button data-font-step="5">A+ text</button></div>' +
    '<label class="lab">Box width %<input data-w type="number" step="5" min="20" max="400"></label>' +
    '<div class="row"><button data-w-step="-5">narrower</button><button data-w-step="5">wider</button></div>' +
    '<label class="lab">Box height %<input data-h type="number" step="5" min="20" max="400"></label>' +
    '<div class="row"><button data-h-step="-5">shorter</button><button data-h-step="5">taller</button></div>' +
    '<div class="row"><button data-flip="fx">Flip \\u2194</button><button data-flip="fy">Flip \\u2195</button></div>' +
    '<label class="lab">Turn \\u00b0<input data-rot type="number" step="5"></label>' +
    '<div class="row"><button data-rot-step="-90">\\u21ba 90</button><button data-rot-step="-5">\\u21ba 5</button><button data-rot-step="5">5 \\u21bb</button><button data-rot-step="90">90 \\u21bb</button></div>' +
    '<div class="row" style="margin-top:6px"><button data-reset>Reset this</button><button data-resetall>Reset all</button></div>' +
    '<div class="row" style="margin-top:6px"><button class="go" data-copy>Copy for Claude</button></div>' +
    '<p class="hint">Tap a block to select, then drag it. Tap empty space to deselect. Offsets are previews \\u2014 Claude rebuilds them as real layout.</p>' +
    '</div>';
  document.body.appendChild(panel);

  panel.querySelector('[data-fold-btn]').addEventListener('click', function () {
    panel.classList.toggle('shut');
    panel.querySelector('.cx').textContent = panel.classList.contains('shut') ? '\\u25b8' : '\\u25be';
  });
  var pick = panel.querySelector('[data-pick]');
  var xI = panel.querySelector('[data-x]');
  var yI = panel.querySelector('[data-y]');
  var sizeI = panel.querySelector('[data-size]');
  var rotI = panel.querySelector('[data-rot]');
  var fontI = panel.querySelector('[data-font]');
  var wI = panel.querySelector('[data-w]');
  var hI = panel.querySelector('[data-h]');
  var tag = document.createElement('div');
  tag.className = 'bbe-tag';
  tag.style.display = 'none';
  document.body.appendChild(tag);

  function cur() { var n = Number(pick.value); return n >= 0 ? items[n] : null; }
  function deselect() { pick.value = '-1'; sync(); }
  function sync() {
    var c = cur();
    items.forEach(function (i) { i.el.classList.toggle('bbe-on', i === c); });
    panel.classList.toggle('none', !c);
    var hdr = panel.querySelector('[data-hdr]');
    if (hdr) hdr.textContent = c ? c.label : 'Move things';
    if (!c) { tag.style.display = 'none'; return; }
    var v = val(c);
    xI.value = v.x; yI.value = v.y; sizeI.value = v.s; rotI.value = v.r || 0;
    fontI.value = v.f; wI.value = v.w; hI.value = v.h;
    panel.querySelectorAll('[data-flip]').forEach(function (b) {
      b.classList.toggle('on', !!v[b.dataset.flip]);
    });
    var r = c.el.getBoundingClientRect();
    tag.textContent = c.label;
    tag.style.display = '';
    tag.style.left = Math.max(4, r.left) + 'px';
    tag.style.top = Math.max(4, r.top - 20) + 'px';
  }
  pick.addEventListener('change', sync);
  [xI, yI].forEach(function (inp) {
    inp.addEventListener('input', function () {
      var c = cur(); if (!c) return; var v = val(c);
      v.x = Number(xI.value) || 0; v.y = Number(yI.value) || 0;
      apply(c); save(); sync();
    });
  });
  panel.querySelectorAll('[data-nudge]').forEach(function (b) {
    b.addEventListener('click', function () {
      var c = cur(); if (!c) return;
      var d = b.dataset.nudge.split(',').map(Number), v = val(c);
      v.x += d[0]; v.y += d[1]; apply(c); save(); sync();
    });
  });
  rotI.addEventListener('input', function () {
    var c = cur(); if (!c) return; var v = val(c); v.r = Number(rotI.value) || 0; apply(c); save();
  });
  panel.querySelectorAll('[data-rot-step]').forEach(function (b) {
    b.addEventListener('click', function () {
      var c = cur(); if (!c) return; var v = val(c);
      v.r = ((Number(v.r) || 0) + Number(b.dataset.rotStep)) % 360;
      apply(c); save(); sync();
    });
  });
  sizeI.addEventListener('input', function () {
    var c = cur(); if (!c) return; var v = val(c);
    v.s = Math.min(300, Math.max(20, Number(sizeI.value) || 100));
    apply(c); save();
  });
  panel.querySelectorAll('[data-size-step]').forEach(function (b) {
    b.addEventListener('click', function () {
      var c = cur(); if (!c) return; var v = val(c);
      v.s = Math.min(300, Math.max(20, (Number(v.s) || 100) + Number(b.dataset.sizeStep)));
      apply(c); save(); sync();
    });
  });
  [['f', fontI, 'data-font-step', 20, 400], ['w', wI, 'data-w-step', 20, 400], ['h', hI, 'data-h-step', 20, 400]]
    .forEach(function (spec) {
      var key = spec[0], inp = spec[1], stepAttr = spec[2], lo = spec[3], hi = spec[4];
      inp.addEventListener('input', function () {
        var c = cur(); if (!c) return; var v = val(c);
        v[key] = Math.min(hi, Math.max(lo, Number(inp.value) || 100));
        apply(c); save();
      });
      panel.querySelectorAll('[' + stepAttr + ']').forEach(function (b) {
        b.addEventListener('click', function () {
          var c = cur(); if (!c) return; var v = val(c);
          v[key] = Math.min(hi, Math.max(lo, (Number(v[key]) || 100) + Number(b.getAttribute(stepAttr))));
          apply(c); save(); sync();
        });
      });
    });
  panel.querySelectorAll('[data-flip]').forEach(function (b) {
    b.addEventListener('click', function () {
      var c = cur(); if (!c) return; var v = val(c);
      v[b.dataset.flip] = !v[b.dataset.flip];
      b.classList.toggle('on', v[b.dataset.flip]);
      apply(c); save();
    });
  });
  panel.querySelector('[data-reset]').addEventListener('click', function () {
    var c = cur(); if (!c) return; state[c.sel] = { x: 0, y: 0, s: 100, fx: false, fy: false, r: 0, w: 100, h: 100, f: 100 }; apply(c); save(); sync();
  });
  panel.querySelector('[data-resetall]').addEventListener('click', function () {
    state = {}; items.forEach(apply); save(); sync();
  });
  panel.querySelector('[data-copy]').addEventListener('click', function () {
    var moved = items.filter(function (i) { var v = val(i); return v.x || v.y || (v.s !== 100) || v.fx || v.fy || v.r || (v.w !== 100) || (v.h !== 100) || (v.f !== 100); });
    var out = moved.length
      ? 'Big Bites print menu changes (mm on the 426x303mm sheet):\\n' +
        moved.map(function (i) {
          var v = val(i);
          return '- ' + i.label + '  x:' + mm(v.x) + 'mm  y:' + mm(v.y) + 'mm'
            + (v.s !== 100 ? '  scale:' + v.s + '%' : '')
            + (v.f !== 100 ? '  TEXT:' + v.f + '% (' + (i.bf * v.f / 100 / (1610 / 426)).toFixed(2) + 'mm)' : '')
            + (v.w !== 100 ? '  box-width:' + v.w + '% (' + mm(i.bw * (v.w - 100) / 100) + 'mm)' : '')
            + (v.h !== 100 ? '  box-height:' + v.h + '% (' + mm(i.bh * (v.h - 100) / 100) + 'mm)' : '')
            + (v.r ? '  turn:' + v.r + 'deg' : '')
            + (v.fx ? '  FLIPPED-H' : '') + (v.fy ? '  FLIPPED-V' : '');
        }).join('\\n') +
        '\\n\\n(Preview offsets \\u2014 rebuild as real layout, do not paste translate.)'
      : 'No changes made.';
    navigator.clipboard.writeText(out).then(function () {
      var b = panel.querySelector('[data-copy]');
      b.textContent = 'Copied \\u2713';
      setTimeout(function () { b.textContent = 'Copy for Claude'; }, 1400);
    }, function () { prompt('Copy this:', out); });
  });

  // ---- drag straight on the sheet (deltas divide by zoom) ----------------
  var drag = null, pendingTap = null;
  document.addEventListener('pointerdown', function (e) {
    if (panel.contains(e.target) || bar.contains(e.target)) return;
    var onBlock = items.filter(function (i) { return i.el.contains(e.target) || i.el === e.target; }).pop();
    if (!onBlock) {
      var under = items.filter(function (i) {
        var r = i.el.getBoundingClientRect();
        return r.width && r.height && e.clientX >= r.left && e.clientX <= r.right
          && e.clientY >= r.top && e.clientY <= r.bottom;
      }).sort(function (a, z) {
        var ra = a.el.getBoundingClientRect(), rz = z.el.getBoundingClientRect();
        return (ra.width * ra.height) - (rz.width * rz.height);
      });
      if (under.length) onBlock = under[0];
    }
    if (onBlock && onBlock !== cur()) { pick.value = items.indexOf(onBlock); sync(); return; }
    var hit = onBlock;
    if (!hit) { pendingTap = { x: e.clientX, y: e.clientY }; return; }
    var v = val(hit);
    drag = { i: hit, sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y, moved: false };
    try { hit.el.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.sx) > 4 || Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.moved && e.cancelable) e.preventDefault();
    if (!drag.moved) return;
    var v = val(drag.i);
    v.x = Math.round(drag.ox + (e.clientX - drag.sx) / Z);
    v.y = Math.round(drag.oy + (e.clientY - drag.sy) / Z);
    apply(drag.i); sync();
  }, { passive: false });
  document.addEventListener('pointerup', function (e) {
    if (pendingTap) {
      if (Math.abs(e.clientX - pendingTap.x) < 6 && Math.abs(e.clientY - pendingTap.y) < 6) deselect();
      pendingTap = null;
    }
    if (!drag) return;
    save();
    drag = null;
  });
  document.addEventListener('pointercancel', function () { drag = null; pendingTap = null; });

  sync();
})();
</script>`;

html = html.replace('</body>', editor + '\n</body>');
html = html.replace('<title>Big Bites — A3 trifold menu</title>',
  '<title>Big Bites menu — layout editor</title>');
const out = path.join(DIR, 'menu-editor.html');
fs.writeFileSync(out, html);
console.log(`menu-editor.html written (${Math.round(fs.statSync(out).size / 1024)}KB, self-contained)`);
