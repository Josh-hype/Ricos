/* patch-android.mjs — after `cap add android`, raise the generated project so
   the Capgo OTA plugin builds (same trio as the till — see
   app/scripts/patch-android-sdk.mjs for the full why), then wire Firebase
   Cloud Messaging for push:

     compileSdk             34    -> 35
     Android Gradle plugin  8.2.1 -> 8.6.0
     Gradle wrapper         8.2.1 -> 8.7
     minSdk                 >= 23
     + gen/google-services.json -> android/app/  and the google-services
       Gradle plugin (skipped, loudly, when the shop has no Firebase files —
       the app still builds, push registration just fails gracefully).

   android/ is generated (gitignored) and recreated by every `cap add android`,
   so this runs as part of prepare:android / sync. Idempotent. Run from
   app-customer/. */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // app-customer/scripts
const appDir = resolve(here, '..');                   // app-customer
const androidDir = resolve(appDir, 'android');

if (!existsSync(androidDir)) {
  // Not an error: `npm run sync` also runs on iOS-only checkouts (a Mac that
  // never did `cap add android`). prepare:android creates android/ first, so
  // a genuine Android flow can't get here.
  console.warn('⚠️  patch-android: app-customer/android not found — skipping (run `cap add android` for an Android build).');
  process.exit(0);
}

const COMPILE_SDK = '35';
const AGP = '8.6.0';
const GRADLE = '8.7';
const MIN_SDK = 23;
const GMS = '4.4.2';
const esc = (v) => v.replace(/\./g, '\\.');

let ok = true;

function patch(relPath, re, replace, label, verifyRe) {
  const p = resolve(androidDir, relPath);
  if (!existsSync(p)) { console.error(`✗ patch-android: ${relPath} not found.`); ok = false; return; }
  let s = readFileSync(p, 'utf8');
  if (!re.test(s)) {
    console.error(`✗ patch-android: pattern for "${label}" not found in ${relPath} — Capacitor template may have changed.`);
    ok = false; return;
  }
  s = s.replace(re, replace);
  writeFileSync(p, s);
  if (verifyRe && !verifyRe.test(s)) {
    console.error(`✗ patch-android: "${label}" did not take in ${relPath}.`);
    ok = false; return;
  }
  console.log(`✓ patch-android: ${label} (${relPath})`);
}

patch('variables.gradle',
  /(compileSdkVersion\s*=\s*)\d+/, (_m, p1) => p1 + COMPILE_SDK,
  `compileSdkVersion -> ${COMPILE_SDK}`,
  new RegExp(`compileSdkVersion\\s*=\\s*${esc(COMPILE_SDK)}\\b`));

patch('build.gradle',
  /(com\.android\.tools\.build:gradle:)[0-9.]+/, (_m, p1) => p1 + AGP,
  `Android Gradle plugin -> ${AGP}`,
  new RegExp(`com\\.android\\.tools\\.build:gradle:${esc(AGP)}`));

patch('gradle/wrapper/gradle-wrapper.properties',
  /(gradle-)[0-9.]+(-(?:all|bin)\.zip)/, (_m, p1, p2) => p1 + GRADLE + p2,
  `Gradle wrapper -> ${GRADLE}`,
  new RegExp(`gradle-${esc(GRADLE)}-(?:all|bin)\\.zip`));

{
  const p = resolve(androidDir, 'variables.gradle');
  const m = readFileSync(p, 'utf8').match(/(minSdkVersion\s*=\s*)(\d+)/);
  if (!m) {
    console.error('✗ patch-android: minSdkVersion not found in variables.gradle.');
    ok = false;
  } else {
    const cur = Number(m[2]);
    const next = Math.max(cur, MIN_SDK);
    if (next !== cur) {
      const s = readFileSync(p, 'utf8').replace(/(minSdkVersion\s*=\s*)\d+/, (_m, p1) => p1 + next);
      writeFileSync(p, s);
    }
    console.log(`✓ patch-android: minSdkVersion ${cur === next ? `${cur} (already >= ${MIN_SDK})` : `${cur} -> ${next}`} (variables.gradle)`);
  }
}

// ── Firebase (push) wiring — only when the shop ships Firebase files ─────────
const gsJson = resolve(appDir, 'gen', 'google-services.json');
if (existsSync(gsJson)) {
  copyFileSync(gsJson, resolve(androidDir, 'app', 'google-services.json'));
  console.log('✓ patch-android: google-services.json -> android/app/');

  // Root build.gradle: the google-services classpath.
  {
    const p = resolve(androidDir, 'build.gradle');
    let s = readFileSync(p, 'utf8');
    if (!s.includes('com.google.gms:google-services')) {
      if (!/dependencies\s*\{/.test(s)) {
        console.error('✗ patch-android: no dependencies block in root build.gradle.');
        ok = false;
      } else {
        s = s.replace(/dependencies\s*\{/, (m) => `${m}\n        classpath 'com.google.gms:google-services:${GMS}'`);
        writeFileSync(p, s);
      }
    }
    console.log(`✓ patch-android: google-services classpath ${GMS} (build.gradle)`);
  }

  // App build.gradle: apply the plugin (append — Gradle allows it anywhere top-level).
  {
    const p = resolve(androidDir, 'app', 'build.gradle');
    let s = readFileSync(p, 'utf8');
    if (!s.includes("apply plugin: 'com.google.gms.google-services'")) {
      s += "\napply plugin: 'com.google.gms.google-services'\n";
      writeFileSync(p, s);
    }
    console.log('✓ patch-android: google-services plugin applied (app/build.gradle)');
  }
} else {
  console.warn('⚠️  patch-android: no gen/google-services.json — building WITHOUT push (add the shop\'s Firebase file and re-run).');
}

if (!ok) {
  console.error('✗ patch-android: FAILED — stopping so a broken build never ships.');
  process.exit(1);
}
console.log(`patch-android: done (compileSdk ${COMPILE_SDK}, AGP ${AGP}, Gradle ${GRADLE}, minSdk ${MIN_SDK}).`);
