/* epos-hardware.js — JS interface to the native EposHardware Capacitor plugin.
   Present only inside the app (window.Capacitor.Plugins.EposHardware). On the
   web, `available` is false and native.js routes around it. */
(function () {
  'use strict';
  var Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  var P = Plugins.EposHardware || null;

  window.EposHardware = {
    available: !!P,
    // payload: { text } — plain-text/ESC-POS receipt body.
    printReceipt: function (payload) {
      if (!P) return Promise.resolve({ ok: false, reason: 'no-plugin' });
      return P.printReceipt(payload || {});
    },
    kickDrawer: function () {
      if (!P) return Promise.resolve({ ok: false, reason: 'no-plugin' });
      return P.kickDrawer();
    },
    // payload: { amountP, currency, orderDraft } — Stripe Terminal Tap-to-Pay.
    collectCardPayment: function (payload) {
      if (!P) return Promise.resolve({ ok: false, reason: 'no-plugin' });
      return P.collectCardPayment(payload || {});
    }
  };
})();
