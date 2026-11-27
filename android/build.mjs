#!/usr/bin/env node
// Builds the phone app without Gradle (ANDROID_APP_SPEC, "the lean build"): javac, then Android's own
// aapt2, d8, aapt, zipalign and apksigner. Needs a JDK 17+ and the Android SDK's build tools and one
// platform (android.jar); nothing is downloaded.
//
//   node build.mjs             -> build/kaaga.apk (the web address it opens: --home <url>, default https://kaaga.in)
//   node build.mjs --install   -> and installs it on the phone over USB (adb install -r)
//   node build.mjs --qa        -> build/kaaga-qa.apk: "Kaaga QA" (app.recollect.phone.qa), a second
//                                 app beside his for tests with the QA account; it never sets a wallpaper
//                                 unless switched on, so his own app, connection and screens stay as they are
//
// The signing key is made on the first build in keys/ (never in git). Keep it: an update signed with
// another key can't install over the app (Android asks to uninstall it first).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(ROOT, 'build');
const KEYS = path.join(ROOT, 'keys');
/**
 * The test app is the next version (0.7.0: the shell, the new screens; 0.7.1: stage 19's widget card with Later); his
 * app stays 0.6.0 until his OK, and gets all of it as 0.7.0 after his deploy.
 */
const QA_BUILD = process.argv.includes('--qa');
// 0.8.0 (11-26): Kaaga (KAAGA_REBRAND_PLAN): its name, icon and address. The package id stays app.recollect.phone, so it
// installs over the app already on a phone.
// 0.9.0 (11-27, PHONE_UPDATE_PLAN): the app updates itself from its server.
const VERSION = '0.9.0';
/**
 * What is new in VERSION, in up to three short lines for the people who use the app: the phone's Settings shows them under
 * "Kaaga x.y.z is ready" (PHONE_UPDATE_PLAN U8). Write them with every new VERSION.
 */
const NOTES = ['Kaaga now updates itself: when a new version is out, it says so and installs it in a tap.'];
const MIN_SDK = 26;
const TARGET_SDK = 34;
/** Grows with every build (minutes since 2026-01-01), so `adb install -r` always takes the new one. */
/** --debug: a test build Android lets adb look inside (run-as); never for daily use. */
const DEBUG = process.argv.includes('--debug');
/** --qa: the test app beside his (its own package, label and data). */
const QA = process.argv.includes('--qa');
/** --home <url>: the web app his app opens (the QA app opens the computer's). */
const HOME = (() => {
    const i = process.argv.indexOf('--home');
    return (i > 0 && process.argv[i + 1] ? process.argv[i + 1] : 'https://kaaga.in').replace(/\/+$/, '');
})();
const VERSION_CODE = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60000);

const win = process.platform === 'win32';
const exe = (name) => (win ? `${name}.exe` : name);
const isDir = (p) => {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
};

/** The newest subfolder of `dir` (by version number) that passes `ok`. */
function newest(dir, ok) {
    if (!isDir(dir)) return null;
    const key = (name) => (name.match(/\d+/g) ?? []).map(Number);
    const names = fs.readdirSync(dir).filter((n) => isDir(path.join(dir, n)));
    names.sort((a, b) => {
        const x = key(a);
        const y = key(b);
        for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
        return 0;
    });
    for (const n of names) if (ok(path.join(dir, n))) return path.join(dir, n);
    return null;
}

function findSdk() {
    const tried = [
        process.env.ANDROID_SDK_ROOT,
        process.env.ANDROID_HOME,
        path.join(ROOT, '.toolchain'),
        win ? 'C:/Android/sdk' : null,
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
        process.env.HOME ? path.join(process.env.HOME, 'Android', 'Sdk') : null,
    ].filter(Boolean);
    for (const sdk of tried) {
        const tools = newest(path.join(sdk, 'build-tools'), (d) => fs.existsSync(path.join(d, exe('aapt2'))) && fs.existsSync(path.join(d, 'lib', 'd8.jar')));
        const platform = newest(path.join(sdk, 'platforms'), (d) => fs.existsSync(path.join(d, 'android.jar')));
        if (tools && platform) return { tools, androidJar: path.join(platform, 'android.jar') };
    }
    throw new Error(`No Android SDK with build-tools and a platform in: ${tried.join(', ')}. Set ANDROID_SDK_ROOT (README.md).`);
}

function findJdk() {
    const homes = [process.env.JAVA_HOME];
    if (win) {
        for (const base of ['C:/Program Files/Java', 'C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Microsoft']) {
            const jdk = newest(base, (d) => fs.existsSync(path.join(d, 'bin', 'javac.exe')));
            if (jdk) homes.push(jdk);
        }
    }
    for (const home of homes.filter(Boolean)) {
        const bin = path.join(home, 'bin');
        if (['javac', 'jar', 'keytool', 'java'].every((t) => fs.existsSync(path.join(bin, exe(t))))) return bin;
    }
    throw new Error('No JDK (17 or newer) found. Set JAVA_HOME to it (README.md).');
}

function run(cmd, args, opts = {}) {
    execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
}

function javaFiles(dir) {
    if (!isDir(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? javaFiles(path.join(dir, e.name)) : e.name.endsWith('.java') ? [path.join(dir, e.name)] : []));
}

/** The signing key: made once, kept in keys/ (git-ignored). */
function signingKey(jdk) {
    const store = path.join(KEYS, 'recollect.p12');
    const pass = path.join(KEYS, 'password.txt');
    if (fs.existsSync(store) && fs.existsSync(pass)) return { store, pass };
    fs.mkdirSync(KEYS, { recursive: true });
    fs.writeFileSync(pass, crypto.randomBytes(24).toString('base64url'));
    run(path.join(jdk, exe('keytool')), ['-genkeypair', '-keystore', store, '-storetype', 'PKCS12', '-alias', 'recollect', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10950', '-dname', 'CN=Recollect phone app', '-storepass:file', pass, '-keypass:file', pass]);
    console.log(`Made the signing key: ${path.relative(ROOT, store)} (keep it; back it up with keys/password.txt)`);
    return { store, pass };
}

/**
 * Every component the manifest names (the activity, receivers, services) must be a public class: Android makes
 * them by reflection, and a package-private one crashes the app the first time it is used (0.6.0 on his phone,
 * 11-18: the picture switch's alarm, and the questions' quick answers would have too).
 */
function checkComponents() {
    const manifest = fs.readFileSync(path.join(ROOT, 'AndroidManifest.xml'), 'utf8');
    const names = [...new Set([...manifest.matchAll(/android:name="\.([A-Za-z0-9_$]+)"/g)].map((m) => m[1]))];
    const bad = names.filter((n) => {
        const f = path.join(ROOT, 'src', 'app', 'recollect', 'phone', `${n}.java`);
        return !fs.existsSync(f) || !new RegExp(`^public\\s+(final\\s+|abstract\\s+)*class\\s+${n}\\b`, 'm').test(fs.readFileSync(f, 'utf8'));
    });
    if (bad.length) {
        console.error(`The manifest names classes that are missing or not public (Android makes them by reflection): ${bad.join(', ')}`);
        process.exit(1);
    }
    console.log(`Manifest components public: ${names.length}`);
}

// --test (0.6.0): the pure rules' tests on the PC, no Android needed (which picture now, when the next switch is),
// and the manifest's components public.
if (process.argv.includes('--test')) {
    checkComponents();
    const bin = findJdk();
    const out = path.join(BUILD, 'test-classes');
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    run(path.join(bin, exe('javac')), ['--release', '11', '-encoding', 'UTF-8', '-d', out, path.join(ROOT, 'src', 'app', 'recollect', 'phone', 'ShowRule.java'), path.join(ROOT, 'test', 'ShowRuleTest.java')]);
    run(path.join(bin, exe('java')), ['-cp', out, 'app.recollect.phone.ShowRuleTest']);
    // Stage 11: each screen its own look, the plain wallpaper's visible crop, the permissions checklist.
    run(path.join(bin, exe('javac')), ['--release', '11', '-encoding', 'UTF-8', '-d', out, path.join(ROOT, 'src', 'app', 'recollect', 'phone', 'ScreenLook.java'), path.join(ROOT, 'test', 'ScreenLookTest.java')]);
    run(path.join(bin, exe('java')), ['-cp', out, 'app.recollect.phone.ScreenLookTest']);
    // Stage 19 (0.7.0): the widget's card: its size by height, the Later row, a Later kept here, the look.
    run(path.join(bin, exe('javac')), ['--release', '11', '-encoding', 'UTF-8', '-d', out, path.join(ROOT, 'src', 'app', 'recollect', 'phone', 'CardRule.java'), path.join(ROOT, 'test', 'CardRuleTest.java')]);
    run(path.join(bin, exe('java')), ['-cp', out, 'app.recollect.phone.CardRuleTest']);
    // 0.9.0 (PHONE_UPDATE_PLAN): the updater's rules (newer, when, where from, the checksum, Android's answers, the words).
    run(path.join(bin, exe('javac')), ['--release', '11', '-encoding', 'UTF-8', '-d', out, path.join(ROOT, 'src', 'app', 'recollect', 'phone', 'Hosts.java'), path.join(ROOT, 'src', 'app', 'recollect', 'phone', 'UpdateRule.java'), path.join(ROOT, 'test', 'UpdateRuleTest.java')]);
    run(path.join(bin, exe('java')), ['-cp', out, 'app.recollect.phone.UpdateRuleTest']);
    process.exit(0);
}

const started = Date.now();
checkComponents();
const { tools, androidJar } = findSdk();
const jdk = findJdk();
console.log(`SDK build tools: ${tools}\nPlatform: ${androidJar}\nJDK: ${jdk}`);

// Start clean, but keep the other variant's APK and its description (his app's and the QA app's sit side by side).
const keeps = (QA ? ['kaaga.apk', 'kaaga.json'] : ['kaaga-qa.apk', 'kaaga-qa.json']).map((name) => path.join(BUILD, name));
const kept = keeps.map((file) => (fs.existsSync(file) ? fs.readFileSync(file) : null));
fs.rmSync(BUILD, { recursive: true, force: true });
for (const d of ['gen', 'classes', 'dex']) fs.mkdirSync(path.join(BUILD, d), { recursive: true });
keeps.forEach((file, i) => kept[i] && fs.writeFileSync(file, kept[i]));

// 1. BuildConfig
const pkgDir = path.join(BUILD, 'gen', 'app', 'recollect', 'phone');
fs.mkdirSync(pkgDir, { recursive: true });
fs.writeFileSync(path.join(pkgDir, 'BuildConfig.java'), `package app.recollect.phone;\n\n/** Made by build.mjs. */\npublic final class BuildConfig {\n    public static final String VERSION = "${VERSION}${QA ? '-qa' : ''}";\n    public static final int VERSION_CODE = ${VERSION_CODE};\n    /** The test app beside his (build.mjs --qa): no wallpaper unless switched on. */\n    public static final boolean QA = ${QA};\n    /** The web app his app opens (build.mjs --home). */\n    public static final String HOME = "${HOME}";\n\n    private BuildConfig() {}\n}\n`);

// 2. Resources: compile, then link with the manifest (writes R.java)
const aapt2 = path.join(tools, exe('aapt2'));
run(aapt2, ['compile', '--dir', path.join(ROOT, 'res'), '-o', path.join(BUILD, 'res.zip')]);
// The QA app: its own package and name, laid over the same resources (R stays app.recollect.phone).
const qaRes = [];
if (QA) {
    const dir = path.join(BUILD, 'qa-res', 'values');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'strings.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">Kaaga QA</string>\n    <string name="widget_name">Kaaga QA</string>\n</resources>\n');
    run(aapt2, ['compile', '--dir', path.join(BUILD, 'qa-res'), '-o', path.join(BUILD, 'qa.zip')]);
    qaRes.push('--rename-manifest-package', 'app.recollect.phone.qa', '-R', path.join(BUILD, 'qa.zip'));
}
// The manifest as it is: the shell is the launcher, the share target and the connect link's (0.7.3: the old settings screen is gone).
const manifest = path.join(ROOT, 'AndroidManifest.xml');
run(aapt2, ['link', '-o', path.join(BUILD, 'base.apk'), '-I', androidJar, '--manifest', manifest, '--java', path.join(BUILD, 'gen'), '--custom-package', 'app.recollect.phone',
    '--min-sdk-version', String(MIN_SDK), '--target-sdk-version', String(TARGET_SDK), '--version-code', String(VERSION_CODE), '--version-name', VERSION, ...(DEBUG ? ['--debug-mode'] : []), path.join(BUILD, 'res.zip'), ...qaRes]);

// 3. Java → classes (Java 11 class files; string concatenation without invokedynamic, for d8)
const sources = [...javaFiles(path.join(ROOT, 'src')), ...javaFiles(path.join(BUILD, 'gen'))];
fs.writeFileSync(path.join(BUILD, 'sources.txt'), sources.map((s) => `"${s.replace(/\\/g, '/')}"`).join('\n'));
run(path.join(jdk, exe('javac')), ['--release', '11', '-XDstringConcat=inline', '-encoding', 'UTF-8', '-Xlint:all,-options,-serial', '-classpath', androidJar, '-d', path.join(BUILD, 'classes'), `@${path.join(BUILD, 'sources.txt')}`]);
run(path.join(jdk, exe('jar')), ['--create', '--file', path.join(BUILD, 'classes.jar'), '-C', path.join(BUILD, 'classes'), '.']);

// 4. classes → classes.dex
run(path.join(jdk, exe('java')), ['-cp', path.join(tools, 'lib', 'd8.jar'), 'com.android.tools.r8.D8', '--release', '--min-api', String(MIN_SDK), '--lib', androidJar, '--output', path.join(BUILD, 'dex'), path.join(BUILD, 'classes.jar')]);

// 5. The APK: resources + classes.dex, aligned, signed
fs.copyFileSync(path.join(BUILD, 'base.apk'), path.join(BUILD, 'unaligned.apk'));
run(path.join(tools, exe('aapt')), ['add', path.join(BUILD, 'unaligned.apk'), 'classes.dex'], { cwd: path.join(BUILD, 'dex'), stdio: ['ignore', 'ignore', 'inherit'] });
run(path.join(tools, exe('zipalign')), ['-f', '4', path.join(BUILD, 'unaligned.apk'), path.join(BUILD, 'aligned.apk')]);
const key = signingKey(jdk);
const apksigner = path.join(tools, 'lib', 'apksigner.jar');
const apk = path.join(BUILD, QA ? 'kaaga-qa.apk' : 'kaaga.apk');
run(path.join(jdk, exe('java')), ['-jar', apksigner, 'sign', '--ks', key.store, '--ks-key-alias', 'recollect', '--ks-pass', `file:${key.pass}`, '--out', apk, path.join(BUILD, 'aligned.apk')]);
run(path.join(jdk, exe('java')), ['-jar', apksigner, 'verify', apk]);
for (const f of ['base.apk', 'unaligned.apk', 'aligned.apk', 'res.zip', 'qa.zip', 'classes.jar', 'sources.txt', 'AndroidManifest.xml']) fs.rmSync(path.join(BUILD, f), { force: true });
fs.rmSync(path.join(BUILD, 'qa-res'), { recursive: true, force: true });

// The file's description beside it (PHONE_UPDATE_PLAN §2): the app's updater compares the build number with its own; the
// server measures the size and the SHA-256 from the file itself.
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
const sidecar = apk.replace(/\.apk$/, '.json');
fs.writeFileSync(sidecar, `${JSON.stringify({ package: QA ? 'app.recollect.phone.qa' : 'app.recollect.phone', version: `${VERSION}${QA ? '-qa' : ''}`, versionCode: VERSION_CODE, minSdk: MIN_SDK, notes: NOTES, builtAt: new Date().toISOString() }, null, 2)}\n`);

console.log(`\nBuilt ${path.relative(process.cwd(), apk)}: ${(fs.statSync(apk).size / 1024).toFixed(0)} KB, version ${VERSION} (${VERSION_CODE}), opens ${QA ? 'http://localhost:3005' : HOME}, in ${((Date.now() - started) / 1000).toFixed(1)} s\nSHA-256 ${sha256}`);

// The release build rides with the backend (the owner, 11-23 night): backend/assets/phone/kaaga.apk and its description
// kaaga.json are committed in the backend's repo, so every backend deploy carries the newest app, Settings > Phone app
// offers it and the apps on phones offer to update to it. Never the QA one (the laptop's server serves that from build/).
if (!QA) {
    const served = path.join(ROOT, '..', 'backend', 'assets', 'phone', 'kaaga.apk');
    fs.mkdirSync(path.dirname(served), { recursive: true });
    fs.copyFileSync(apk, served);
    fs.copyFileSync(sidecar, served.replace(/\.apk$/, '.json'));
    // The file before the rename goes, so the server serves this one.
    fs.rmSync(path.join(path.dirname(served), 'recollect.apk'), { force: true });
    console.log(`Copied to ${path.relative(process.cwd(), served)} with kaaga.json: commit both in the backend repo; its next deploy serves them.`);
}

if (process.argv.includes('--install')) {
    run('adb', ['install', '-r', apk]);
    console.log('Installed on the phone.');
}
