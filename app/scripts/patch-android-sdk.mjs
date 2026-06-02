/* patch-android-sdk.mjs — after `cap add android`, raise the generated Android
   project to compileSdk 35.

   Why: @capgo/capacitor-updater (our OTA plugin) ships an AAR built against
   compileSdk 35. Capacitor 6 generates a project on compileSdk 34, so the moment
   the OTA plugin is present the APK build dies at `checkDebugAarMetadata`
   ("Dependency requires a higher compileSdk"). Bumping the app to 35 clears that
   gate — that's the whole conflict.

   Why NOT also bump AGP / the Gradle wrapper: doing so raises the *minimum Android
   Studio and JDK* the build needs, which is exactly where this project has hit a
   wall before (Gradle/JDK "incompatible JVM" errors). AGP is happy to *compile*
   against an SDK newer than it was "tested up to" — it only prints a warning, which
   we silence with `android.suppressUnsupportedCompileSdk`. So we keep AGP 8.2.1 and
   the bundled Gradle wrapper untouched and change the one thing that matters.

   android/ is generated (gitignored) and recreated by every `cap add android`, so
   this runs as part of `prepare:android` / `sync`. It is idempotent — safe to run
   repeatedly. Run from app/. */
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

const TARGET_SDK = 35;
let changed = 0;
let warned = 0;
let compileSdkOk = false; // load-bearing: the build fails at checkDebugAarMetadata without this

// 1) variables.gradle — raise compileSdkVersion to 35 (leave min/target alone:
//    the app is sideloaded, not on Play, so target 34 is fine and changes nothing
//    at runtime). Matches `compileSdkVersion = 34` with any spacing.
const varsPath = resolve(androidDir, 'variables.gradle');
if (existsSync(varsPath)) {
  let vars = readFileSync(varsPath, 'utf8');
  const re = /(compileSdkVersion\s*=\s*)(\d+)/;
  const m = vars.match(re);
  if (m) {
    if (Number(m[2]) < TARGET_SDK) {
      vars = vars.replace(re, `$1${TARGET_SDK}`);
      writeFileSync(varsPath, vars);
      console.log(`✓ patch-android: compileSdkVersion ${m[2]} -> ${TARGET_SDK} (variables.gradle)`);
      changed++;
      compileSdkOk = true;
    } else {
      console.log(`• patch-android: compileSdkVersion already ${m[2]} (>= ${TARGET_SDK})`);
      compileSdkOk = true;
    }
  } else {
    console.warn('⚠ patch-android: compileSdkVersion not found in variables.gradle — Capacitor template may have changed.');
    warned++;
  }
} else {
  console.warn('⚠ patch-android: variables.gradle not found.');
  warned++;
}

// 2) gradle.properties — let AGP 8.2.1 compile against SDK 35 without the
//    "tested up to compileSdk 34" warning being escalated. Appended once.
const propsPath = resolve(androidDir, 'gradle.properties');
if (existsSync(propsPath)) {
  let props = readFileSync(propsPath, 'utf8');
  if (!/suppressUnsupportedCompileSdk/.test(props)) {
    if (!props.endsWith('\n')) props += '\n';
    props +=
      `\n# Allow compileSdk ${TARGET_SDK} on the bundled AGP (required by @capgo/capacitor-updater).\n` +
      `# AGP is "tested up to 34"; this silences the warning so the build stays clean.\n` +
      `android.suppressUnsupportedCompileSdk=${TARGET_SDK}\n`;
    writeFileSync(propsPath, props);
    console.log(`✓ patch-android: android.suppressUnsupportedCompileSdk=${TARGET_SDK} (gradle.properties)`);
    changed++;
  } else {
    console.log('• patch-android: suppressUnsupportedCompileSdk already set.');
  }
} else {
  console.warn('⚠ patch-android: gradle.properties not found.');
  warned++;
}

console.log(`patch-android: done (${changed} change(s)${warned ? `, ${warned} warning(s)` : ''}).`);

// The compileSdk bump is load-bearing: without it the APK builds on compileSdk 34
// and dies at checkDebugAarMetadata (the OTA AAR needs 35). If we couldn't confirm
// it, fail loudly so the rebuild stops here instead of shipping a broken APK.
if (!compileSdkOk) {
  console.error('✗ patch-android: could NOT set compileSdk to 35 — aborting so the build fails fast.');
  process.exit(1);
}
