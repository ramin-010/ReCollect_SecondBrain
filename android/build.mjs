#!/usr/bin/env node
// Builds the phone app without Gradle (ANDROID_APP_SPEC, "the lean build"): javac, then Android's own
// aapt2, d8, aapt, zipalign and apksigner. Needs a JDK 17+ and the Android SDK's build tools and one
// platform (android.jar); nothing is downloaded.
//
//   node build.mjs             -> build/recollect.apk
//   node build.mjs --install   -> and installs it on the phone over USB (adb install -r)
//   node build.mjs --qa        -> build/recollect-qa.apk: "Your day QA" (app.recollect.phone.qa), a second
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
const VERSION = '0.4.0';
const MIN_SDK = 26;
const TARGET_SDK = 34;
/** Grows with every build (minutes since 2026-01-01), so `adb install -r` always takes the new one. */
/** --debug: a test build Android lets adb look inside (run-as); never for daily use. */
const DEBUG = process.argv.includes('--debug');
/** --qa: the test app beside his (its own package, label and data). */
const QA = process.argv.includes('--qa');
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

const started = Date.now();
const { tools, androidJar } = findSdk();
const jdk = findJdk();
console.log(`SDK build tools: ${tools}\nPlatform: ${androidJar}\nJDK: ${jdk}`);

// Start clean, but keep the other variant's APK (his app's and the QA app's sit side by side).
const keep = path.join(BUILD, QA ? 'recollect.apk' : 'recollect-qa.apk');
const kept = fs.existsSync(keep) ? fs.readFileSync(keep) : null;
fs.rmSync(BUILD, { recursive: true, force: true });
for (const d of ['gen', 'classes', 'dex']) fs.mkdirSync(path.join(BUILD, d), { recursive: true });
if (kept) fs.writeFileSync(keep, kept);

// 1. BuildConfig
const pkgDir = path.join(BUILD, 'gen', 'app', 'recollect', 'phone');
fs.mkdirSync(pkgDir, { recursive: true });
fs.writeFileSync(path.join(pkgDir, 'BuildConfig.java'), `package app.recollect.phone;\n\n/** Made by build.mjs. */\npublic final class BuildConfig {\n    public static final String VERSION = "${VERSION}${QA ? '-qa' : ''}";\n    public static final int VERSION_CODE = ${VERSION_CODE};\n    /** The test app beside his (build.mjs --qa): no wallpaper unless switched on. */\n    public static final boolean QA = ${QA};\n\n    private BuildConfig() {}\n}\n`);

// 2. Resources: compile, then link with the manifest (writes R.java)
const aapt2 = path.join(tools, exe('aapt2'));
run(aapt2, ['compile', '--dir', path.join(ROOT, 'res'), '-o', path.join(BUILD, 'res.zip')]);
// The QA app: its own package and name, laid over the same resources (R stays app.recollect.phone).
const qaRes = [];
if (QA) {
    const dir = path.join(BUILD, 'qa-res', 'values');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'strings.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">Your day QA</string>\n    <string name="widget_name">Your day QA</string>\n</resources>\n');
    run(aapt2, ['compile', '--dir', path.join(BUILD, 'qa-res'), '-o', path.join(BUILD, 'qa.zip')]);
    qaRes.push('--rename-manifest-package', 'app.recollect.phone.qa', '-R', path.join(BUILD, 'qa.zip'));
}
run(aapt2, ['link', '-o', path.join(BUILD, 'base.apk'), '-I', androidJar, '--manifest', path.join(ROOT, 'AndroidManifest.xml'), '--java', path.join(BUILD, 'gen'), '--custom-package', 'app.recollect.phone',
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
const apk = path.join(BUILD, QA ? 'recollect-qa.apk' : 'recollect.apk');
run(path.join(jdk, exe('java')), ['-jar', apksigner, 'sign', '--ks', key.store, '--ks-key-alias', 'recollect', '--ks-pass', `file:${key.pass}`, '--out', apk, path.join(BUILD, 'aligned.apk')]);
run(path.join(jdk, exe('java')), ['-jar', apksigner, 'verify', apk]);
for (const f of ['base.apk', 'unaligned.apk', 'aligned.apk', 'res.zip', 'qa.zip', 'classes.jar', 'sources.txt']) fs.rmSync(path.join(BUILD, f), { force: true });
fs.rmSync(path.join(BUILD, 'qa-res'), { recursive: true, force: true });

console.log(`\nBuilt ${path.relative(process.cwd(), apk)}: ${(fs.statSync(apk).size / 1024).toFixed(0)} KB, version ${VERSION} (${VERSION_CODE}), in ${((Date.now() - started) / 1000).toFixed(1)} s`);

if (process.argv.includes('--install')) {
    run('adb', ['install', '-r', apk]);
    console.log('Installed on the phone.');
}
