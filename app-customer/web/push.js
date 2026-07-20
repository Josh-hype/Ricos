/* push.js — order-status push notifications for the customer app. Loaded after
   native.js; safe no-op in a plain browser (window.LuminNative still exists so
   the page can feature-test it).

   Flow (transactional-only — never a marketing opt-in):
   - The thank-you screen calls LuminNative.enableOrderPush(orderId, statusToken)
     after the customer's FIRST successful order — the moment the value is
     obvious ("get told when it's ready"), and the best acceptance rate.
   - That registers with FCM/APNs, attaches the device token to the just-placed
     order via POST /api/order/:id/push (statusToken-authenticated), and caches
     the token; native.js then injects it into every FUTURE order automatically.
   - Tapping a status notification reopens the app on the tracking screen.

   iOS note: @capacitor/push-notifications surfaces the raw APNs token on iOS,
   but the backend sends via FCM — install @capacitor-community/fcm alongside
   it for iOS builds and this file will prefer FCM.getToken() automatically. */
(function () {
  'use strict';

  var inApp = !!(window.Capacitor &&
    (typeof window.Capacitor.isNativePlatform === 'function'
      ? window.Capacitor.isNativePlatform()
      : window.Capacitor.platform && window.Capacitor.platform !== 'web'));

  function plugin(name) {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;
  }

  var platform = 'android';
  try { platform = window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'android'; } catch (e) {}

  // Resolve the send-to token: FCM registration token. On Android the plain
  // registration event value IS the FCM token; on iOS it's the APNs token, so
  // prefer the FCM community plugin's getToken() there.
  function resolveToken(registrationValue) {
    var FCM = plugin('FCM');
    if (platform === 'ios' && FCM && FCM.getToken) {
      return FCM.getToken().then(function (r) { return (r && r.token) || registrationValue; },
        function () { return registrationValue; });
    }
    return Promise.resolve(registrationValue);
  }

  function registerForPush() {
    var PN = plugin('PushNotifications');
    if (!PN) return Promise.reject(new Error('push plugin unavailable'));
    return PN.requestPermissions().then(function (perm) {
      if (!perm || perm.receive !== 'granted') throw new Error('permission denied');
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(new Error('registration timed out')); }, 10000);
        PN.addListener('registration', function (t) {
          clearTimeout(timer);
          resolveToken(t && t.value).then(resolve, reject);
        });
        PN.addListener('registrationError', function (err) {
          clearTimeout(timer);
          reject(new Error('registration failed: ' + JSON.stringify(err)));
        });
        PN.register();
      });
    });
  }

  window.LuminNative = {
    isApp: inApp,

    // Has the customer already enabled push on this device?
    pushReady: function () {
      var P = plugin('Preferences');
      if (!P) return Promise.resolve(false);
      return P.get({ key: 'push_token' }).then(function (r) { return !!(r && r.value); },
        function () { return false; });
    },

    /* Ask permission, register the device, attach the token to the just-placed
       order, and cache it for all future orders. Resolves { ok, reason? } —
       never rejects, so the thank-you UI can fire-and-forget. */
    enableOrderPush: function (orderId, statusToken) {
      if (!inApp) return Promise.resolve({ ok: false, reason: 'not-app' });
      return registerForPush().then(function (token) {
        if (!token) return { ok: false, reason: 'no-token' };
        if (window.__luminSetPushToken) window.__luminSetPushToken(token, platform);
        if (!orderId || !statusToken) return { ok: true };
        // Relative URL on purpose — native.js rewrites it to the shop origin.
        return fetch('/api/order/' + encodeURIComponent(orderId) + '/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ t: statusToken, token: token, platform: platform }),
        }).then(function (res) { return { ok: res.ok }; }, function () { return { ok: true }; });
        // (A failed attach still returns ok:true — the token is cached, so
        // future orders get pushes even if this one missed.)
      }).catch(function (e) {
        try { console.log('[push] ' + (e && e.message)); } catch (_) {}
        return { ok: false, reason: (e && e.message) || 'failed' };
      });
    },
  };

  // A tapped status notification reopens the app — land on the tracking screen
  // for that order (the bundled thank-you page polls /api/order/:id/status).
  if (inApp) {
    var PN = plugin('PushNotifications');
    if (PN && PN.addListener) {
      PN.addListener('pushNotificationActionPerformed', function (event) {
        var orderId = event && event.notification && event.notification.data && event.notification.data.orderId;
        if (orderId) {
          try { window.location.href = '/thank-you.html?ref=' + encodeURIComponent(orderId); } catch (e) {}
        }
      });
    }
  }
})();
