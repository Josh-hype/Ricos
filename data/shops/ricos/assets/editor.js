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
    ['Offer cards', '.offer-stack'],
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
    '.bbe-tag{position:fixed;z-index:99998;background:#ffc400;color:#14100d;font:600 11px system-ui;padding:2px 6px;border-radius:5px;pointer-events:none}';
  document.head.appendChild(css);

  function val(i) {
    if (!state[i.sel]) state[i.sel] = { x: 0, y: 0 };
    return state[i.sel];
  }
  function apply(i) {
    var v = val(i);
    i.el.style.translate = v.x + 'px ' + v.y + 'px';
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  items.forEach(apply);

  var panel = document.createElement('div');
  panel.className = 'bbe';
  panel.innerHTML =
    '<h4>Move things (' + mode + ')</h4>' +
    '<select data-pick>' + items.map(function (i, n) { return '<option value="' + n + '">' + i.label + '</option>'; }).join('') + '</select>' +
    '<div class="row"><input data-x type="number" step="1" placeholder="left/right"><input data-y type="number" step="1" placeholder="up/down"></div>' +
    '<div class="row"><button data-nudge="-10,0">←</button><button data-nudge="0,-10">↑</button><button data-nudge="0,10">↓</button><button data-nudge="10,0">→</button></div>' +
    '<div class="row" style="margin-top:6px"><button data-reset>Reset this</button><button data-resetall>Reset all</button></div>' +
    '<div class="row" style="margin-top:6px"><button class="go" data-copy>Copy for Claude</button></div>' +
    '<p class="hint">Drag the outlined blocks, or use the arrows. Saved in this browser only — the live site is untouched. Send me the copied text and I\'ll turn it into real layout CSS.</p>';
  document.body.appendChild(panel);

  var pick = panel.querySelector('[data-pick]');
  var xI = panel.querySelector('[data-x]');
  var yI = panel.querySelector('[data-y]');
  var tag = document.createElement('div');
  tag.className = 'bbe-tag';
  tag.style.display = 'none';
  document.body.appendChild(tag);

  function cur() { return items[Number(pick.value)]; }
  function sync() {
    var v = val(cur());
    xI.value = v.x; yI.value = v.y;
    items.forEach(function (i) { i.el.classList.toggle('bbe-on', i === cur()); });
    var r = cur().el.getBoundingClientRect();
    tag.textContent = cur().label;
    tag.style.display = '';
    tag.style.left = Math.max(4, r.left) + 'px';
    tag.style.top = Math.max(4, r.top - 20) + 'px';
  }
  pick.addEventListener('change', sync);
  [xI, yI].forEach(function (inp) {
    inp.addEventListener('input', function () {
      var v = val(cur());
      v.x = Number(xI.value) || 0; v.y = Number(yI.value) || 0;
      apply(cur()); save(); sync();
    });
  });
  panel.querySelectorAll('[data-nudge]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = b.dataset.nudge.split(',').map(Number), v = val(cur());
      v.x += d[0]; v.y += d[1]; apply(cur()); save(); sync();
    });
  });
  panel.querySelector('[data-reset]').addEventListener('click', function () {
    state[cur().sel] = { x: 0, y: 0 }; apply(cur()); save(); sync();
  });
  panel.querySelector('[data-resetall]').addEventListener('click', function () {
    state = {}; items.forEach(apply); save(); sync();
  });
  panel.querySelector('[data-copy]').addEventListener('click', function () {
    var moved = items.filter(function (i) { var v = val(i); return v.x || v.y; });
    var out = moved.length
      ? 'Rico\'s layout changes (' + mode + ', viewport ' + innerWidth + 'px):\n' +
        moved.map(function (i) {
          var v = val(i);
          return '- ' + i.label + '  [' + i.sel + ']  x:' + v.x + 'px  y:' + v.y + 'px';
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
    var hit = items.filter(function (i) { return i.el.contains(e.target) || i.el === e.target; }).pop();
    if (!hit || panel.contains(e.target)) return;
    pick.value = items.indexOf(hit); sync();
    var v = val(hit);
    drag = { i: hit, sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y };
    e.preventDefault();
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var v = val(drag.i);
    v.x = drag.ox + (e.clientX - drag.sx);
    v.y = drag.oy + (e.clientY - drag.sy);
    apply(drag.i); sync();
  });
  document.addEventListener('pointerup', function () { if (drag) { save(); drag = null; } });

  sync();
})();
