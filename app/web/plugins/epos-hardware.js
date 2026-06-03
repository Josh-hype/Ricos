/* epos-hardware.js — JS interface to the native EposHardware Capacitor plugin.
   Present only inside the app (window.Capacitor.Plugins.EposHardware). On the
   web, `available` is false and native.js routes around it. */
(function () {
  'use strict';
  // Resolve the native plugin at CALL time, not once at load: the Capacitor bridge
  // can register EposHardware just after this shim runs, and capturing it once would
  // pin available=false forever (printReceipt/kickDrawer would silently no-op).
  function P() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.EposHardware) || null;
  }
  var noPlugin = function () { return Promise.resolve({ ok: false, reason: 'no-plugin' }); };

  window.EposHardware = {
    get available() { return !!P(); },
    // payload: { ops:[...] } — rich receipt (text align/size/bold, rows, rule, image,
    // feed, cut). Primary path; the web builds the ops so design is OTA-tweakable.
    printDoc: function (payload) { var p = P(); return p ? p.printDoc(payload || {}) : noPlugin(); },
    // payload: { text } — plain-text/ESC-POS receipt body (fallback for old bundles).
    printReceipt: function (payload) { var p = P(); return p ? p.printReceipt(payload || {}) : noPlugin(); },
    kickDrawer: function () { var p = P(); return p ? p.kickDrawer() : noPlugin(); },
    // payload: { amountP, currency, orderDraft } — Stripe Terminal Tap-to-Pay.
    collectCardPayment: function (payload) { var p = P(); return p ? p.collectCardPayment(payload || {}) : noPlugin(); }
  };
})();
