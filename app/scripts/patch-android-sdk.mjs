/* patch-android-sdk.mjs — after `cap add android`, raise the generated Android
   project so the OTA plugin (@capgo/capacitor-updater) actually builds.

   The Capgo AAR is built against compileSdk 35, so the APK build dies at
   checkDebugAarMetadata unless the app compiles against 35 too. Capacitor 6
   generates compileSdk 34 on AGP 8.2.1 / Gradle 8.2.1 — and AGP 8.2.1 does NOT
   support compileSdk 35. So we bump the whole trio to a combination that does:

     compileSdk             34    -> 35
     Android Gradle plugin  8.2.1 -> 8.6.0   (first AGP that supports compileSdk 35)
     Gradle wrapper         8.2.1 -> 8.7      (minimum Gradle for AGP 8.6)

   Bonus: Gradle 8.7 runs on JDK 21, so this also clears the recurring
   "Gradle 8.2.1 is incompatible with the Gradle JVM version 21" error that a
   fresh `cap add` causes (it resets the Gradle JDK to the embedded JDK 21).

   android/ is generated (gitignored) and recreated by every `cap add android`,
   so this runs as part of prepare:android / sync. It is idempotent. Run from app/. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // app/scripts
const appDir = resolve(here, '..');                   // app
const androidDir = resolve(appDir, 'android');

if (!existsSync(androidDir)) {
  console.error('✗ patch-android: app/android not found — run `cap add android` first.');
  process.exit(1);
}

const COMPILE_SDK = '35';
const AGP = '8.6.0';
const GRADLE = '8.7';
const esc = (v) => v.replace(/\./g, '\\.');

let ok = true;

// Find `re`, replace it, write back, then verify the result matches `verifyRe`.
// Idempotent: re-running replaces 35->35 / 8.6.0->8.6.0 / 8.7->8.7 (no-ops).
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

// 1) compileSdk 35 — clears the checkDebugAarMetadata gate (Capgo AAR needs 35).
patch('variables.gradle',
  /(compileSdkVersion\s*=\s*)\d+/, (_m, p1) => p1 + COMPILE_SDK,
  `compileSdkVersion -> ${COMPILE_SDK}`,
  new RegExp(`compileSdkVersion\\s*=\\s*${esc(COMPILE_SDK)}\\b`));

// 2) AGP 8.6.0 — first Android Gradle plugin that supports compileSdk 35.
patch('build.gradle',
  /(com\.android\.tools\.build:gradle:)[0-9.]+/, (_m, p1) => p1 + AGP,
  `Android Gradle plugin -> ${AGP}`,
  new RegExp(`com\\.android\\.tools\\.build:gradle:${esc(AGP)}`));

// 3) Gradle wrapper 8.7 — minimum Gradle for AGP 8.6; also fixes the JDK-21 clash.
patch('gradle/wrapper/gradle-wrapper.properties',
  /(gradle-)[0-9.]+(-(?:all|bin)\.zip)/, (_m, p1, p2) => p1 + GRADLE + p2,
  `Gradle wrapper -> ${GRADLE}`,
  new RegExp(`gradle-${esc(GRADLE)}-(?:all|bin)\\.zip`));

if (!ok) {
  console.error('✗ patch-android: FAILED — stopping so a broken APK never ships.');
  process.exit(1);
}
console.log('patch-android: done (compileSdk ' + COMPILE_SDK + ', AGP ' + AGP + ', Gradle ' + GRADLE + ').');
