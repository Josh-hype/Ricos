/* debug-console.js — TEMPORARY on-screen console for the Sunmi T2s (the till has no
   remote console we can attach to). It captures console.log/warn/error + uncaught
   errors + promise rejections and shows them behind a floating "LOG" button (auto-opens
   on the first error). Loaded FIRST so it catches faults in the other scripts.
   Remove this file + its injection in app/scripts/sync-web.mjs once the app is stable. */
(function () {
  'use strict';
  var logs = [];
  var panel = null, body = null, btn = null;
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function ts() { var d = new Date(); return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()); }
  function fmt(a) {
    if (a instanceof Error) return a.message + (a.stack ? ' | ' + a.stack : '');
    if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return Object.prototype.toString.call(a); } }
    return String(a);
  }
  function push(kind, args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(fmt(args[i]));
    logs.push(ts() + ' [' + kind + '] ' + parts.join(' '));
    if (logs.length > 400) logs.shift();
    render();
    if (kind === 'error') openPanel();
  }
  function ensure() {
    if (btn) return;
    var root = document.body || document.documentElement;
    if (!root) return;
    btn = document.createElement('div');
    btn.textContent = 'LOG';
    btn.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;background:#0070F0;color:#fff;' +
      'font:bold 12px monospace;padding:9px 13px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.45)';
    btn.addEventListener('click', function () { if (panel) { panel.style.display = (panel.style.display === 'none' ? 'block' : 'none'); render(); } });
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;background:#0b0b0b;' +
      'color:#bdf7bd;font:11px/1.45 monospace;padding:10px 10px 72px;white-space:pre-wrap;overflow:auto;display:none';
    var hdr = document.createElement('div');
    hdr.textContent = 'LumiPOS device log — tap LOG (bottom-right) to hide';
    hdr.style.cssText = 'color:#fff;font-weight:bold;margin-bottom:8px';
    body = document.createElement('div');
    panel.appendChild(hdr); panel.appendChild(body);
    root.appendChild(panel); root.appendChild(btn);
    render();
  }
  function render() { if (body) body.textContent = logs.join('\n'); }
  function openPanel() { ensure(); if (panel) { panel.style.display = 'block'; render(); } }

  var kinds = ['log', 'info', 'warn', 'error'];
  for (var i = 0; i < kinds.length; i++) {
    (function (k) {
      var orig = (console[k] || console.log) ? (console[k] || console.log).bind(console) : function () {};
      console[k] = function () { try { push(k === 'info' ? 'log' : k, arguments); } catch (e) {} try { orig.apply(null, arguments); } catch (e) {} };
    })(kinds[i]);
  }
  try { window.addEventListener('error', function (e) { push('error', [(e && e.message) || e, '@' + ((e && e.filename) || '?') + ':' + ((e && e.lineno) || '?')]); }); } catch (e) {}
  try { window.addEventListener('unhandledrejection', function (e) { push('error', ['unhandledrejection:', (e && e.reason) || '?']); }); } catch (e) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure); else ensure();

  console.log('[debug-console] ready · readyState=' + document.readyState +
    ' · Capacitor=' + (typeof window.Capacitor) +
    ' · isNative=' + ((window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') ? window.Capacitor.isNativePlatform() : 'n/a') +
    ' · Plugins=' + ((window.Capacitor && window.Capacitor.Plugins) ? Object.keys(window.Capacitor.Plugins).join(',') : 'n/a'));
})();
