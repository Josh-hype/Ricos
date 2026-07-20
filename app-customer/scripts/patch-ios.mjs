/* patch-ios.mjs — after `cap add ios`, drop the shop's Firebase iOS config
   into the generated project so FCM-routed push can work.

   What this DOES: copies gen/GoogleService-Info.plist into ios/App/App/.
   What it DOESN'T do (one-time clicks in Xcode, listed by the runbook
   docs/ADDING_A_SHOP_APP.md — scripting the .pbxproj is brittle and `cap add
   ios` regenerates it anyway):
     - add the Push Notifications capability (Signing & Capabilities)
     - add Background Modes -> Remote notifications
     - set the signing team
   ios/ is generated (gitignored). Idempotent. Run from app-customer/. */
import { existsSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // app-customer/scripts
const appDir = resolve(here, '..');                   // app-customer
const iosApp = resolve(appDir, 'ios', 'App', 'App');

if (!existsSync(iosApp)) {
  console.error('✗ patch-ios: app-customer/ios not found — run `cap add ios` first (needs a Mac + Xcode).');
  process.exit(1);
}

const plist = resolve(appDir, 'gen', 'GoogleService-Info.plist');
if (existsSync(plist)) {
  copyFileSync(plist, resolve(iosApp, 'GoogleService-Info.plist'));
  console.log('✓ patch-ios: GoogleService-Info.plist -> ios/App/App/');
  console.log('  Remember (once, in Xcode): add it to the App target if it isn\'t, enable the');
  console.log('  Push Notifications capability + Background Modes -> Remote notifications,');
  console.log('  and upload the APNs auth key (.p8) to the Firebase iOS app.');
} else {
  console.warn('⚠️  patch-ios: no gen/GoogleService-Info.plist — building WITHOUT push (add the shop\'s Firebase file and re-run).');
}

console.log('patch-ios: done.');
