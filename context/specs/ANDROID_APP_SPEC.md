# Our own Android app: the wallpaper, the lock screen and a widget (short spec)

_2026-11-15, Opus 5.5, written before building, as Ramin asked ("our own Android app, a short spec first"; decided 2026-11-15, [ECOSYSTEM_PLAN](ECOSYSTEM_PLAN.md) §10 step c). **Developed and tested before any deploy**, on his phone over USB (`adb reverse` gives it the local server); using it away from the PC needs Ramin's deploy, which is his own work. The server side exists already (ALWAYS_ON_SPEC 6.6)._

## Ramin's go (2026-11-15 ~15:00)

- **The build tools: OK, with full consent** for the development, his phone and installing on it.
- **Where it lives:** its own folder, `second_brain/android/`, next to `recollect/` and `backend/` (not inside either), in the root repo with `mcp/`. The toolchain sits in `android/.toolchain/` and the signing key beside it, both kept out of git.
- **How it gets on the phone:** the APK file, installed over USB (`adb install`) or copied to the phone and opened. **No Play Store** (it is for him only), and **nothing is hosted for the APK**: it is a file, not a website.
- **What it needs to reach:** the backend, for the day's picture and the widget's lines. Now: over USB (`adb reverse`) or the network his laptop shares with the phone (the laptop runs on the **phone's hotspot**; the backend's port needs a Windows firewall rule for the local network, asked) while the PC runs; after his deploy: the public address (the deploy is his). Settings → Phone app can also offer the APK as a download once that exists.
- **Built lean (the builder's call, 11-15 ~15:20), replacing "How it is built" below:** the laptop's internet is the phone's hotspot, so the ~2 GB Gradle/Kotlin/AndroidX toolchain is out. **Java** (javac 23 is already installed; compiled for Java 11 class files) with **Android's own parts only**: `WallpaperManager`, an `AppWidgetProvider` with `RemoteViews` (what Glance makes underneath), `JobScheduler` for the refreshes, `SharedPreferences` + the `AndroidKeyStore` for the token, `HttpURLConnection`. The build is a short script over Android's `aapt2`, `d8`, `zipalign` and `apksigner` (no Gradle), so only **Android's platform and build tools come down: about 130 MB** into `android/.toolchain/` (adb is already installed). **The QR is read by the phone's own camera**: it holds a `recollect://connect?server=…&token=…` link that opens our app (no camera code, no ZXing, no `CAMERA` permission).

## Bottom line

A small Kotlin app, installed from a file (no store). It does three things the installed web app can't:
1. **Sets the home and lock screen wallpaper** to Recollect's picture of his day, a few times a day.
2. **A home-screen widget** with the same few lines.
3. **Settings**: what shows and when.

Opening Recollect itself stays the installed web app. The app only launches it.

Size: about 2–3 days. **Needs Ramin's OK first:** the Android build tools go onto his PC (about 2 GB, inside the project folder; details below).

## What it does

| Piece | How | Notes |
|---|---|---|
| **Connect** | Settings → Phone app on the web shows a QR code (the server's address + a new token that can only read the day's picture and widget). The Android app scans it once. Pasting the token works too | A new token scope, **`ambient`** (only `wallpaper.png` and `widget`). Today these routes take the general `read` scope, which can read everything: too much to leave on a phone. Revoke from Settings → Agents like any token |
| **Wallpaper** | WorkManager: at the start of his day, midday, evening and after midnight (his day's states: morning, working, evening, done, rest), plus "Refresh now". It fetches `GET /api/ambient/wallpaper.png?w&h&theme` at the screen's exact size and sets it with `WallpaperManager` | Home, lock or both, his choice. Light, dark or follow the phone. **Unchanged if the server can't be reached** (no error image). Never red, no counts as a headline, text clear of the clock and the icons (already in the drawing) |
| **Widget** | Jetpack Glance, 4×2 and 4×1: the state's headline and up to three lines from `GET /api/ambient/widget`, refreshed with the wallpaper. A tap opens Recollect | Plain type on the theme's surfaces (DESIGN.md); no streaks, no badges |
| **Settings** | One native screen: the server and account it is connected to; wallpaper on/off for home and lock; theme; "Hide titles" (ECOSYSTEM_PLAN §10's open point); quiet hours (no change at night); Refresh now; Disconnect | Words as in the web app |
| **Open Recollect** | Launches the installed web app (or Chrome at the address if it isn't installed) | A full-screen wrapper (a Trusted Web Activity) is a later option: it needs the domain's `assetlinks.json`, easy after the deploy |

## How it is built

**Language and libraries** (all Apache-2.0: nothing GPL or paid):
- Kotlin, Gradle and the Android Gradle Plugin.
- AndroidX: Glance, WorkManager, DataStore and Activity.
- OkHttp, and ZXing (Apache-2.0) to read the QR code (no Google Play services).

**Phones:** minSdk 26 (Android 8). His Realme XT runs Android 11 (realme UI 2).

**Security:**
- The token is kept with the Android Keystore.
- The app holds only the `ambient` scope.
- Permissions: `SET_WALLPAPER`, `INTERNET`, and `CAMERA` only while scanning.

**Building, on his PC:**
- A JDK 21 and the Android SDK command-line tools, in `second_brain/android/.toolchain/` (no Android Studio, nothing in Program Files). About 2 GB.
- **This changes his machine, so it waits for his OK.** A note: the JDK itself is GPL with the Classpath Exception, as every JDK is. That covers the tool that compiles, not anything that ships in the app.
- The APK is signed with a key kept beside the toolchain (never in git).

**Testing:**
- On his phone over USB (his consent covers the phone): `adb install`, then `adb shell` to trigger the jobs, `screencap` for screens, the QA account.
- Light and dark, the lock screen and the home screen, and the widget at both sizes.
- **Realme quirk to check:** realme's "lock screen magazine" can override the lock screen picture. If it does, the settings screen says how to turn it off.

## Server work it needs (small)

- **The `ambient` token scope:** the two routes accept it, and Settings → Agents lists it as "Phone app: the day's picture".
- **Settings → Phone app:** a QR code with the address and a new `ambient` token, plus the app's file to download once the APK exists.
- **`wallpaper.png` gains `titles=0`** for "Hide titles", if the drawing does not have it yet.

## Not in this app

- Recollect's screens: the web app has them, and two copies would drift apart.
- Notifications: Web Push already arrives (ALWAYS_ON_SPEC 6.3).
- Sharing into Recollect: the web app's share target does that once it is installed after the deploy.
