/* provision.js — first-run "set up this till" screen. Stores the shop's backend
   origin so this device talks to the right shop (the app-layer SHOP_SLUG). For
   the scaffold we accept the site address directly; a short setup-code → base-URL
   exchange can replace this later. */
(function () {
  'use strict';

  function show() {
    if (document.getElementById('eposProvision')) return;
    var current = '';
    try { current = localStorage.getItem('epos_api_base') || ''; } catch (e) {}

    var ov = document.createElement('div');
    ov.id = 'eposProvision';
    ov.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#0B1A2E;color:#fff;' +
      'display:flex;align-items:center;justify-content:center;padding:24px;' +
      "font-family:'Hanken Grotesk',system-ui,-apple-system,sans-serif";
    ov.innerHTML =
      '<div style="max-width:380px;width:100%;text-align:center">' +
      '<div style="width:56px;height:56px;border-radius:16px;margin:0 auto 16px;' +
      'background:linear-gradient(150deg,#2D9BFF,#0070F0 55%,#0050B4);' +
      'box-shadow:0 8px 22px rgba(0,112,240,.5)"></div>' +
      '<h1 style="font-size:22px;font-weight:800;margin:0 0 6px;letter-spacing:-.02em">Set up this till</h1>' +
      '<p style="opacity:.7;font-size:14px;margin:0 0 20px;line-height:1.5">Enter the shop’s site address to connect this device.</p>' +
      '<input id="eposBase" type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
      'placeholder="https://your-shop.pages.dev" value="' + current.replace(/"/g, '&quot;') + '" ' +
      'style="width:100%;padding:14px;border-radius:12px;border:0;font-size:15px;margin-bottom:10px;color:#0B1A2E" />' +
      '<div id="eposProvErr" style="color:#ff9b9b;font-size:13px;min-height:18px;margin-bottom:8px;font-weight:600"></div>' +
      '<button id="eposProvSave" style="width:100%;padding:14px;border-radius:12px;border:0;' +
      'background:#0070F0;color:#fff;font-size:15px;font-weight:700">Connect</button>' +
      '</div>';
    document.body.appendChild(ov);

    document.getElementById('eposProvSave').addEventListener('click', function () {
      var v = (document.getElementById('eposBase').value || '').trim().replace(/\/+$/, '');
      if (!/^https:\/\/.+/.test(v)) {
        document.getElementById('eposProvErr').textContent = 'Enter a full https:// address.';
        return;
      }
      try { localStorage.setItem('epos_api_base', v); } catch (e) {}
      try {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
          window.Capacitor.Plugins.Preferences.set({ key: 'epos_api_base', value: v });
        }
      } catch (e) {}
      location.reload();
    });
  }

  window.EPOSProvision = { show: show };
})();
