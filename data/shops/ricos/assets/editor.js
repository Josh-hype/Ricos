/* Layout scratchpad — loaded ONLY with ?edit=1, never on a normal visit.
 *
 * Drag any outlined block to try a position. Nothing is saved to the site:
 * offsets live in this browser's localStorage and are applied with CSS
 * `translate`, which is fine for previewing but MUST NOT be pasted into the
 * stylesheet as-is. `translate` moves a thing visually without moving its
 * layout box, so the space it used to fill stays reserved — that is what left
 * 300px holes in the Big Bites page and pushed content under the sticky header.
 *
 * When you're happy, hit "Copy for Claude". That produces a list of blocks and
 * pixel offsets, which get converted into real layout changes (margins,
 * positions, grid placement) before anything is committed.
 */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('edit') !== '1') return;

  var BLOCKS = [
    ['Header buttons', '.nav-actions'],
    ['Fresh off the grill', '.nav-sizzle'],
    ['Hero ribbon', '.hero-ribbon'],
    ['Hero headline', '.hero h1'],
    ['Hero script line', '.hero-script'],
    ['Hero paragraph', '.hero-lead'],
    ['Order button', '.hero-ctas'],
    ['Hero perks', '.hero-perks'],
    ['Chicken image', '.hero-food'],
    ['Offer cards (both)', '.offer-stack'],
    ['Offer 1 — Family Platter', '.offer-stack .offer-card:nth-child(1)'],
    ['Offer 2 — Kings Platter', '.offer-stack .offer-card:nth-child(2)'],
    ['25% seal', '.promo-seal'],
    ['Category strip', '.categories'],
    ['Story section', '.story .wrap'],
    ['Spice section', '.spice .wrap'],
    ['Find us section', '.location .wrap'],
    ['Footer', 'footer .wrap'],
  ];

  var mode = matchMedia('(max-width: 900px)').matches ? 'mobile' : 'desktop';
  var KEY = 'ricos-layout-scratchpad:' + mode;
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}

  var items = [];
  BLOCKS.forEach(function (b) {
    var el = document.querySelector(b[1]);
    if (el) items.push({ label: b[0], sel: b[1], el: el });
  });
  if (!items.length) return;

  // .hero-food (and anything else decorative) sets pointer-events:none so it
  // cannot swallow clicks on the real site. That also made it undraggable in
  // here, so turn it back on for managed blocks while the editor is open.
  items.forEach(function (i) { i.el.style.pointerEvents = 'auto'; });

  var css = document.createElement('style');
  css.textContent =
    '.bbe{position:fixed;right:14px;bottom:14px;z-index:99999;width:250px;font:13px/1.4 system-ui,sans-serif;' +
    'background:#14100d;color:#fff6e5;border:2px solid #ffc400;border-radius:12px;padding:12px;box-shadow:0 18px 44px rgba(0,0,0,.5)}' +
    '.bbe h4{margin:0 0 8px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#ffc400}' +
    '.bbe select,.bbe input{width:100%;box-sizing:border-box;margin:3px 0 7px;padding:6px;border-radius:7px;border:1px solid #4a3a2c;background:#221a14;color:#fff6e5;font:inherit}' +
    '.bbe .row{display:flex;gap:6px}.bbe .row>*{flex:1}' +
    '.bbe button{cursor:pointer;padding:7px 8px;border-radius:7px;border:1px solid #4a3a2c;background:#2b211a;color:#fff6e5;font:inherit}' +
    '.bbe button.go{background:#ffc400;color:#14100d;border-color:#ffc400;font-weight:700}' +
    '.bbe .hint{margin:8px 0 0;font-size:11px;color:#c9b9a4;line-height:1.35}' +
    '.bbe-on{outline:2px dashed rgba(255,196,0,.85);outline-offset:2px;cursor:grab}' +
        '.bbe .lab{display:block;font-size:11px;color:#c9b9a4;margin-top:4px}' +
    '.bbe button.on{background:#ffc400;color:#14100d;border-color:#ffc400;font-weight:700}' +
    '.bbe .fold{display:block}.bbe.shut .fold{display:none}' +
    '.bbe h4{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;cursor:pointer}' +
    '.bbe h4 .cx{font-size:15px;line-height:1}' +
    '.bbe.none .fold{opacity:.4;pointer-events:none}' +
    '.bbe.none .fold [data-pick]{opacity:1;pointer-events:auto}' +
    '@media (max-width:700px){.bbe{left:6px;right:6px;bottom:6px;width:auto;padding:7px;font-size:11px;' +
    'max-height:46vh;overflow:auto}' +
    '.bbe .hint{display:none}.bbe select,.bbe input{margin:1px 0 4px;padding:4px}' +
    '.bbe .lab{margin-top:1px}.bbe .row{gap:4px}.bbe button{padding:7px 4px;border-radius:6px}' +
    '.bbe h4{font-size:11px}}' +
    '.bbe-tag{position:fixed;z-index:99998;background:#ffc400;color:#14100d;font:600 11px system-ui;padding:2px 6px;border-radius:5px;pointer-events:none}';
  document.head.appendChild(css);

  function val(i) {
    if (!state[i.sel]) state[i.sel] = { x: 0, y: 0, s: 100, fx: false, fy: false };
    var v = state[i.sel];
    if (v.s == null) v.s = 100;          // older saved sessions predate these
    if (v.fx == null) v.fx = false;
    if (v.fy == null) v.fy = false;
    if (v.r == null) v.r = 0;
    return state[i.sel];
  }
  function apply(i) {
    var v = val(i);
    i.el.style.translate = v.x + 'px ' + v.y + 'px';
    var s = (Number(v.s) || 100) / 100;
    i.el.style.scale = (v.fx ? -s : s) + ' ' + (v.fy ? -s : s);
    i.el.style.rotate = (Number(v.r) || 0) + 'deg';
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  items.forEach(apply);

  var panel = document.createElement('div');
  panel.className = 'bbe shut';
  panel.innerHTML =
    '<h4 data-fold-btn><span data-hdr>Move things (' + mode + ')</span><span class="cx">▸</span></h4>' +
    '<div class="fold">' +
    '<select data-pick><option value="-1">— nothing selected —</option>' + items.map(function (i, n) { return '<option value="' + n + '">' + i.label + '</option>'; }).join('') + '</select>' +
    '<div class="row"><input data-x type="number" step="1" placeholder="left/right"><input data-y type="number" step="1" placeholder="up/down"></div>' +
    '<div class="row"><button data-nudge="-10,0">←</button><button data-nudge="0,-10">↑</button><button data-nudge="0,10">↓</button><button data-nudge="10,0">→</button></div>' +
    '<label class="lab">Size %<input data-size type="number" step="5" min="20" max="300"></label>' +
    '<div class="row"><button data-size-step="-5">− smaller</button><button data-size-step="5">+ bigger</button></div>' +
    '<div class="row"><button data-flip="fx">Flip ↔</button><button data-flip="fy">Flip ↕</button></div>' +
    '<label class="lab">Turn °<input data-rot type="number" step="5"></label>' +
    '<div class="row"><button data-rot-step="-90">↺ 90°</button><button data-rot-step="-5">↺ 5°</button><button data-rot-step="5">5° ↻</button><button data-rot-step="90">90° ↻</button></div>' +
    '<div class="row" style="margin-top:6px"><button data-reset>Reset this</button><button data-resetall>Reset all</button></div>' +
    '<div class="row" style="margin-top:6px"><button class="go" data-copy>Copy for Claude</button></div>' +
    '<p class="hint">Tap a block to select it, drag to move. Tap empty space to deselect. Saved in this browser only.</p>' +
    '</div>';
  document.body.appendChild(panel);

  panel.querySelector('[data-fold-btn]').addEventListener('click', function () {
    panel.classList.toggle('shut');
    panel.querySelector('.cx').textContent = panel.classList.contains('shut') ? '▸' : '▾';
  });
  var pick = panel.querySelector('[data-pick]');
  var xI = panel.querySelector('[data-x]');
  var yI = panel.querySelector('[data-y]');
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
    if (hdr) hdr.textContent = c ? c.label : 'Move things (' + mode + ')';
    if (!c) { tag.style.display = 'none'; return; }
    var v = val(c);
    xI.value = v.x; yI.value = v.y;
    sizeI.value = v.s;
    rotI.value = v.r || 0;
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
    var rotI = panel.querySelector('[data-rot]');
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
  var sizeI = panel.querySelector('[data-size]');
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
  panel.querySelectorAll('[data-flip]').forEach(function (b) {
    b.addEventListener('click', function () {
      var c = cur(); if (!c) return; var v = val(c);
      v[b.dataset.flip] = !v[b.dataset.flip];
      b.classList.toggle('on', v[b.dataset.flip]);
      apply(c); save();
    });
  });
  panel.querySelector('[data-reset]').addEventListener('click', function () {
    var c = cur(); if (!c) return; state[c.sel] = { x: 0, y: 0, s: 100, fx: false, fy: false, r: 0 }; apply(c); save(); sync();
  });
  panel.querySelector('[data-resetall]').addEventListener('click', function () {
    state = {}; items.forEach(apply); save(); sync();
  });
  panel.querySelector('[data-copy]').addEventListener('click', function () {
    var moved = items.filter(function (i) { var v = val(i); return v.x || v.y || (v.s && v.s !== 100) || v.fx || v.fy || v.r; });
    var out = moved.length
      ? 'Rico\'s layout changes (' + mode + ', viewport ' + innerWidth + 'px):\n' +
        moved.map(function (i) {
          var v = val(i);
          return '- ' + i.label + '  [' + i.sel + ']  x:' + v.x + 'px  y:' + v.y + 'px'
            + '  size:' + (v.s || 100) + '%'
            + (v.r ? '  turn:' + v.r + 'deg' : '')
            + (v.fx ? '  FLIPPED-H' : '') + (v.fy ? '  FLIPPED-V' : '');
        }).join('\n') +
        '\n\n(These are preview offsets — convert to real layout CSS, do not paste translate.)'
      : 'No changes made.';
    navigator.clipboard.writeText(out).then(function () {
      var b = panel.querySelector('[data-copy]');
      b.textContent = 'Copied ✓';
      setTimeout(function () { b.textContent = 'Copy for Claude'; }, 1400);
    }, function () { prompt('Copy this:', out); });
  });

  // drag straight on the page
  var drag = null;
  document.addEventListener('pointerdown', function (e) {
    if (panel.contains(e.target)) return;
    // Prefer whatever block was actually clicked. Some blocks can never be the
    // event target — the chicken sits at z-index 1 under the copy layer, so the
    // pointer always lands on something above it. In that case fall back to the
    // block chosen in the dropdown, so picking it there and dragging anywhere
    // moves it.
    var onBlock = items.filter(function (i) { return i.el.contains(e.target) || i.el === e.target; }).pop();
    if (!onBlock) {
      // Nothing claimed the event. Some blocks can never be the target — the
      // chicken is painted under the copy layer — so hit-test their boxes and
      // take the smallest match, which favours the specific over the sprawling.
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
    // Falling back to the current selection is what lets an unreachable block
    // (the chicken sits under the copy layer) still be dragged. But it also
    // meant a tap on empty space nudged whatever was selected and there was no
    // way to deselect — so a press that never moves is treated as a tap and
    // clears the selection instead. See pointerup.
    var hit = onBlock || cur();
    if (!hit) { deselect(); return; }
    if (onBlock) { pick.value = items.indexOf(onBlock); sync(); }
    var v = val(hit);
    drag = { i: hit, sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y, onBlock: !!onBlock, moved: false };
    e.preventDefault();
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.sx) > 4 || Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
    if (!drag.moved) return;
    var v = val(drag.i);
    v.x = drag.ox + (e.clientX - drag.sx);
    v.y = drag.oy + (e.clientY - drag.sy);
    apply(drag.i); sync();
  });
  document.addEventListener('pointerup', function () {
    if (!drag) return;
    // A press on empty space that never moved is a tap: deselect.
    if (!drag.moved && !drag.onBlock) deselect(); else save();
    drag = null;
  });

  sync();
})();
