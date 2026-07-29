/* inject-native.mjs — after `cap add android`, wire the EposHardware native plugin
   (Sunmi T2 printer + cash drawer) into the generated, gitignored android project:

     1. copy app/native/android/EposHardwarePlugin.java into the app's package source
     2. register it in MainActivity (Capacitor auto-loads installed plugin *packages*,
        but an app-local plugin must be registered explicitly)
     3. add the Sunmi printer SDK dependency (com.sunmi:printerlibrary, Maven Central)

   android/ is generated (gitignored) and recreated by every `cap add android`, so
   this runs as part of prepare:android / sync. Idempotent; fails loud. Run from app/. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // app/scripts
const appDir = resolve(here, '..');                   // app
const androidDir = resolve(appDir, 'android');
const PKG = 'uk.co.ricos.epos';                       // must match appId in capacitor.config.json
const PKG_PATH = PKG.replace(/\./g, '/');
const SUNMI_DEP = 'com.sunmi:printerlibrary:1.0.24';  // Maven Central (jcenter is dead)

if (!existsSync(androidDir)) {
  console.error('✗ inject-native: app/android not found — run `cap add android` first.');
  process.exit(1);
}

let ok = true;
const srcDir = resolve(androidDir, 'app/src/main/java', PKG_PATH);

// 1) Plugin source -------------------------------------------------------------
const pluginSrc = resolve(appDir, 'native/android/EposHardwarePlugin.java');
if (!existsSync(pluginSrc)) {
  console.error('✗ inject-native: app/native/android/EposHardwarePlugin.java missing.');
  ok = false;
} else {
  mkdirSync(srcDir, { recursive: true });
  copyFileSync(pluginSrc, resolve(srcDir, 'EposHardwarePlugin.java'));
  console.log('✓ inject-native: copied EposHardwarePlugin.java');
}

// 2) Register in MainActivity (whichever language Capacitor generated) ----------
const javaMain = resolve(srcDir, 'MainActivity.java');
const ktMain = resolve(srcDir, 'MainActivity.kt');
if (existsSync(javaMain)) {
  writeFileSync(javaMain,
`package ${PKG};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EposHardwarePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);
  console.log('✓ inject-native: registered plugin in MainActivity.java');
} else if (existsSync(ktMain)) {
  writeFileSync(ktMain,
`package ${PKG}

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(EposHardwarePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
`);
  console.log('✓ inject-native: registered plugin in MainActivity.kt');
} else {
  console.error('✗ inject-native: MainActivity.{java,kt} not found in ' + srcDir);
  ok = false;
}

// 3) Sunmi printer SDK dependency ----------------------------------------------
// Maven Central is already in the Capacitor project's repositories, so a plain
// implementation line resolves. Inserted once at the top of the dependencies block.
const appGradle = resolve(androidDir, 'app/build.gradle');
if (!existsSync(appGradle)) {
  console.error('✗ inject-native: android/app/build.gradle not found.');
  ok = false;
} else {
  let g = readFileSync(appGradle, 'utf8');
  if (g.includes('com.sunmi:printerlibrary')) {
    console.log('• inject-native: Sunmi dependency already present');
  } else {
    const m = g.match(/dependencies\s*\{/);
    if (!m) {
      console.error('✗ inject-native: no dependencies { } block in app/build.gradle.');
      ok = false;
    } else {
      const at = m.index + m[0].length;
      g = g.slice(0, at) +
        `\n    implementation '${SUNMI_DEP}' // Sunmi T2 printer + cash drawer (woyou service)` +
        g.slice(at);
      writeFileSync(appGradle, g);
      console.log('✓ inject-native: added ' + SUNMI_DEP);
    }
  }

  // 4) ZCS SmartPos SDK ---------------------------------------------------------
  // Vendor .aar (not on Maven), so it is committed under app/native/android/libs/
  // and copied into the generated Android project. One APK then drives BOTH the
  // Sunmi T2 (woyou service) and ZCS terminals like the Z93 — the plugin picks the
  // backend at runtime, so a till only needs the right hardware, not its own build.
  const libsSrc = resolve(here, '..', 'native', 'android', 'libs');
  const libsDst = resolve(androidDir, 'app', 'libs');
  if (existsSync(libsSrc)) {
    mkdirSync(libsDst, { recursive: true });
    let copied = 0;
    for (const f of readdirSync(libsSrc)) {
      if (!/\.(aar|jar)$/i.test(f)) continue;
      copyFileSync(resolve(libsSrc, f), resolve(libsDst, f));
      copied++;
    }
    let g2 = readFileSync(appGradle, 'utf8');
    if (!g2.includes("fileTree(dir: 'libs'")) {
      const m2 = g2.match(/dependencies\s*\{/);
      if (m2) {
        const at2 = m2.index + m2[0].length;
        g2 = g2.slice(0, at2) +
          `\n    implementation fileTree(dir: 'libs', include: ['*.jar', '*.aar']) // ZCS SmartPos SDK (Z93 printer)` +
          g2.slice(at2);
        writeFileSync(appGradle, g2);
      }
    }
    console.log(`✓ inject-native: copied ${copied} vendor lib(s) + wired libs/ fileTree`);
  } else {
    console.log('• inject-native: no app/native/android/libs — skipping vendor SDKs');
  }
}

if (!ok) {
  console.error('✗ inject-native: FAILED — printer/drawer would be missing from the APK.');
  process.exit(1);
}
console.log('inject-native: done (printer + drawer wired).');
