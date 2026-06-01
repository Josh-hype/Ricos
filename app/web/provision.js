/* provision.js — first-run "set up this till" screen.

   Primary flow (friendly for shop owners): enter a 6-digit Restaurant ID + the shop's
   setup password. The ID is looked up in DIRECTORY below → the shop's backend URL (so
   nobody types a URL), then the password is verified by POST <url>/api/staff/device-setup
   before we store the URL. Per-operator PINs still gate staff actions after setup.

   Fallback flow ("site address instead"): enter the https:// backend URL directly — the
   original behaviour, kept so a till is never locked out of setup (e.g. a shop not yet in
   DIRECTORY, or before its setup password is configured in Cloudflare).

   The backend URL is written to @capacitor/preferences (the store native.js reads on
   boot) and the write is AWAITED before reload (P2-15). Adding a shop = add its ID→URL
   here (and set TILL_SETUP_PASSWORD on that Cloudflare project). */
(function () {
  'use strict';

  // 6-digit Restaurant ID → shop backend origin. MUST be the shop's reachable custom
  // domain — the *.pages.dev hostnames are firewalled on this Cloudflare setup ("Host
  // not in allowlist", 403), so never use them here. (Food Station needs its own custom
  // domain before its ID will work; it isn't launched yet.)
  var DIRECTORY = {
    '190059': 'https://ricosyork.co.uk',
    '833541': 'https://food-station.pages.dev'
  };

  function prefs() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;
  }

  // Persist the resolved backend URL, then reload into the staff login.
  async function connectTo(url, btn, err) {
    try {
      var P = prefs();
      if (P) await P.set({ key: 'epos_api_base', value: url });
      else { try { localStorage.setItem('epos_api_base', url); } catch (e) {} } // browser fallback
    } catch (e) {
      err.textContent = 'Could not save — please try again.';
      if (btn) btn.disabled = false;
      return;
    }
    location.reload();
  }

  var INPUT = 'width:100%;padding:14px;border-radius:12px;border:0;font-size:15px;margin-bottom:10px;color:#0B1A2E';
  var BTN = 'width:100%;padding:14px;border-radius:12px;border:0;background:#C2A269;color:#16243C;font-size:15px;font-weight:700';
  var LINK = 'display:inline-block;margin-top:16px;color:#9fb2c9;font-size:13px;text-decoration:underline;cursor:pointer';

  function show() {
    if (document.getElementById('eposProvision')) return;

    var ov = document.createElement('div');
    ov.id = 'eposProvision';
    ov.style.cssText =
      // Explicit offsets (NOT `inset:0` — the Sunmi T2s WebView doesn't honour the
      // inset shorthand, which left this overlay collapsed below the 100vh PIN screen).
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;background:#0B1A2E;color:#fff;overflow:auto;' +
      'display:flex;align-items:center;justify-content:center;padding:24px;' +
      "font-family:'Hanken Grotesk',system-ui,-apple-system,sans-serif";
    ov.innerHTML =
      '<div style="max-width:380px;width:100%;text-align:center">' +
      '<svg width="60" height="60" viewBox="0 0 140 140" style="display:block;margin:0 auto 12px" aria-hidden="true">' +
      '<rect width="140" height="140" rx="30" fill="#F2EFE6"/>' +
      '<rect x="35" y="32" width="26" height="76" fill="#16243C"/>' +
      '<rect x="35" y="82" width="70" height="26" fill="#16243C"/>' +
      '<rect x="70" y="39" width="8" height="42" fill="#C2A269"/>' +
      '</svg>' +
      '<div style="font-weight:800;font-size:14px;letter-spacing:.22em;color:#C2A269;margin:0 0 14px">LUMIPOS</div>' +
      '<h1 style="font-size:22px;font-weight:800;margin:0 0 6px;letter-spacing:-.02em">Set up this till</h1>' +
      '<p style="opacity:.7;font-size:14px;margin:0 0 20px;line-height:1.5">Enter your Restaurant ID and password to connect this device.</p>' +
      // ID + password mode (primary)
      '<div id="eposIdMode">' +
      '<input id="eposId" type="text" inputmode="numeric" autocomplete="off" maxlength="6" ' +
      'placeholder="Restaurant ID (6 digits)" style="' + INPUT + ';text-align:center;letter-spacing:.3em;font-weight:700" />' +
      '<input id="eposPw" type="password" autocomplete="off" placeholder="Password" style="' + INPUT + '" />' +
      '<div id="eposErr" style="color:#ff9b9b;font-size:13px;min-height:18px;margin:2px 0 8px;font-weight:600"></div>' +
      '<button id="eposIdBtn" style="' + BTN + '">Connect</button>' +
      '<div><span id="eposToUrl" style="' + LINK + '">Use a site address instead</span></div>' +
      '</div>' +
      // URL mode (fallback)
      '<div id="eposUrlMode" hidden>' +
      '<input id="eposBase" type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
      'placeholder="https://your-shop.pages.dev" style="' + INPUT + '" />' +
      '<div id="eposErr2" style="color:#ff9b9b;font-size:13px;min-height:18px;margin:2px 0 8px;font-weight:600"></div>' +
      '<button id="eposUrlBtn" style="' + BTN + '">Connect</button>' +
      '<div><span id="eposToId" style="' + LINK + '">Use a Restaurant ID instead</span></div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(ov);
    try { console.log('[provision] show() appended overlay'); } catch (e) {}
    setTimeout(function () {
      try { var r = ov.getBoundingClientRect(); console.log('[provision] overlay rect top=' + Math.round(r.top) + ' left=' + Math.round(r.left) + ' w=' + Math.round(r.width) + ' h=' + Math.round(r.height)); } catch (e) {}
    }, 200);

    var idMode = document.getElementById('eposIdMode');
    var urlMode = document.getElementById('eposUrlMode');
    document.getElementById('eposToUrl').addEventListener('click', function () { idMode.hidden = true; urlMode.hidden = false; });
    document.getElementById('eposToId').addEventListener('click', function () { urlMode.hidden = true; idMode.hidden = false; });

    // Primary: Restaurant ID + password.
    var idBtn = document.getElementById('eposIdBtn');
    idBtn.addEventListener('click', async function () {
      var err = document.getElementById('eposErr');
      var id = (document.getElementById('eposId').value || '').replace(/\D/g, '');
      var pw = document.getElementById('eposPw').value || '';
      if (!/^\d{6}$/.test(id)) { err.textContent = 'Restaurant ID is 6 digits.'; return; }
      var url = DIRECTORY[id];
      if (!url) { err.textContent = 'Restaurant ID not recognised.'; return; }
      if (!pw) { err.textContent = 'Enter your password.'; return; }
      idBtn.disabled = true; err.textContent = '';
      try {
        var res = await fetch(url + '/api/staff/device-setup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
        });
        if (res.ok) { await connectTo(url, idBtn, err); return; }
        if (res.status === 503) { err.textContent = 'This shop isn’t set up for ID login yet — use “site address” below.'; }
        else if (res.status === 429) { err.textContent = 'Too many attempts. Try again in 10 minutes.'; }
        else { err.textContent = 'Incorrect password.'; }
      } catch (e) {
        err.textContent = 'Couldn’t reach the shop. Check the internet and try again.';
      }
      idBtn.disabled = false;
    });

    // Fallback: type the site address directly (https only).
    var urlBtn = document.getElementById('eposUrlBtn');
    urlBtn.addEventListener('click', async function () {
      var err = document.getElementById('eposErr2');
      var v = (document.getElementById('eposBase').value || '').trim().replace(/\/+$/, '');
      if (!/^https:\/\/.+/.test(v)) { err.textContent = 'Enter a full https:// address.'; return; }
      urlBtn.disabled = true; err.textContent = '';
      await connectTo(v, urlBtn, err);
    });
  }

  window.EPOSProvision = { show: show };
})();
