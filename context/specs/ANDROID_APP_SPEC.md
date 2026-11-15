# Our own Android app: the wallpaper, the lock screen and a widget (short spec)

_2026-11-15, Opus 5.5, written before building, as Ramin asked ("our own Android app, a short spec first"; decided 2026-11-15, [ECOSYSTEM_PLAN](ECOSYSTEM_PLAN.md) §10 step c). **Developed and tested before any deploy**, on his phone over USB (`adb reverse` gives it the local server); using it away from the PC needs Ramin's deploy, which is his own work. The server side exists already (ALWAYS_ON_SPEC 6.6)._

## Ramin's go (2026-11-15 ~15:00)

- **The build tools: OK, with full consent** for the development, his phone and installing on it.
- **Where it lives:** its own folder, `second_brain/android/`, next to `recollect/` and `backend/` (not inside either), in the root repo with `mcp/`. The toolchain sits in `android/.toolchain/` and the signing key beside it, both kept out of git.
- **How it gets on the phone:** the APK file, installed over USB (`adb install`) or copied to the phone and opened. **No Play Store** (it is for him only), and **nothing is hosted for the APK**: it is a file, not a website.
- **What it needs to reach:** the backend, for the day's picture and the widget's lines. Now: over USB (`adb reverse`) or the network his laptop shares with the phone (the laptop runs on the **phone's hotspot**; the backend's port needs a Windows firewall rule for the local network, asked) while the PC runs; after his deploy: the public address (the deploy is his). Settings → Phone app can also offer the APK as a download once that exists.
- **Built lean (the builder's call, 11-15 ~15:20), replacing "How it is built" below:** the laptop's internet is the phone's hotspot, so the ~2 GB Gradle/Kotlin/AndroidX toolchain is out. **Java** (javac 23 is already installed; compiled for Java 11 class files) with **Android's own parts only**: `WallpaperManager`, an `AppWidgetProvider` with `RemoteViews` (what Glance makes underneath), `JobScheduler` for the refreshes, `SharedPreferences` + the `AndroidKeyStore` for the token, `HttpURLConnection`. The build is a short script over Android's `aapt2`, `d8`, `zipalign` and `apksigner` (no Gradle), so only **Android's platform and build tools come down: about 130 MB** into `android/.toolchain/` (adb is already installed). **The QR is read by the phone's own camera**: it holds a `recollect://connect?server=…&token=…` link that opens our app (no camera code, no ZXing, no `CAMERA` permission).

## As built

- **The server side (2026-11-15 ~17:15):** the token scope **`ambient`** (`API_SCOPES`; a token route can now name a second scope that also opens it, `route(…, 'read', 'ambient')`, and `requireScope('read', 'ambient')` takes any of them): an `ambient` token reads `GET /api/ambient/wallpaper.png` and `/api/ambient/widget` and nothing else (403 elsewhere); OAuth sign-in never offers it. `GET /api/ambient/addresses` (cookie only): the public address once `RECOLLECT_SELF_URL` is real, each network address of this computer (his phone's hotspot), then `http://localhost:8002` for USB. **Settings → Phone app** (`components/settings/PhoneAppSettings.tsx`): the addresses as a choice, "Make the connect code" → a new "Phone app" token (ambient) and a QR of `recollect://connect?server=…&token=…` (`qrcode-generator` 2.0.4, MIT, pinned), "Copy the link"; Settings → Agents lists the token's scope as "reads the day's picture (phone app)". Checked: integration `always-on.test.ts` (+1: ambient reads the picture and widget, 403 on today/docs/agent docs; addresses cookie only) + `oauth.test.ts`; `scratchpad/scripts/phone-tab-qa.js` 6/6 light and dark; screens 140-141.
- **The app (2026-11-15 evening), `android/` ("Your day", `app.recollect.phone`, 0.1.0, ~70 KB):** Java + Android's own APIs, built by `android/build.mjs` (javac → aapt2 → d8 → aapt add → zipalign → apksigner; `--install`, `--debug`) with the SDK **already on his PC (`C:\Android\sdk`: build-tools 35, platform 35), so nothing was downloaded**; the signing key in `android/keys/` (git-ignored; back it up). Pieces: the screen (connect, the day's picture with Refresh now, Lock screen on / Home screen off by default, Add the widget (the launcher's pin dialog), theme Light/Dark/System, quiet hours 23:00–07:00, Hide titles, Open Recollect, Disconnect, realme help with Open App info), `Refresher` (lines → widget → the picture only when its key changed, never in quiet hours unless he asks), `Schedule` (every 30 min awake + exactly at 00:01, 12:00, 18:00; one persisted chained JobScheduler job; `Wake` on boot/update), `DayWidget` (4×2 / 4×1 by height, **one layout per theme**: a launcher re-applies updates onto old views, so set colours would stick), `Wallpapers` (sets FLAG_LOCK/SYSTEM; **copies his wallpaper before the first picture only**, and puts it back on Disconnect or a screen switched off: the lock screen without a copy is cleared so it shows the home wallpaper; a home screen with no file is the phone's built-in picture, cleared back), `Vault` (AES-GCM key in the Android Keystore), `Api` (3 calls). **The QR holds a web link, `<server>/phone/connect#t=<token>`** (not `recollect://`: every camera opens web links): the backend's page (CSP with a script hash, token only in the fragment) hands it to the app with one tap (`intent://`), or offers the APK (`/phone/recollect.apk`, `RECOLLECT_APK_PATH`) when the app is missing. Server additions: `POST /api/ambient/disconnect` (the app's own token ends itself; `ambient` only), `?titles=0` (Hide titles: counts, no topic or focus names), the widget JSON's `account` + `appUrl`, `week` (the last 7 days). **Checked on his phone** (Realme XT, QA account): the connect page from Chrome → Open the phone app → Connect → the storage dialog → the lock screen set; Refresh now; Home on/off (his built-in home picture came back); Light/Dark/System for the widget at both sizes; the background job forced (`cmd jobscheduler run`); Disconnect (his own lock picture back, the token ended on the server); the release build installed. **He connected his own account the same evening** (home + lock picture on); his home screen was then tidied on his ask (Drawer mode, one page; HISTORY 2026-11-15 t). Bugs found there and fixed: switches restored stale view state after a relaunch (lock flipped off), a copy taken after the first picture (would have saved our own picture), the widget keeping old colours, all-caps dialog buttons. **Not tested:** a real camera scan of the QR (he does it when he connects his own account); the lock screen itself was never captured (privacy), its setting was checked through `dumpsys wallpaper`; **Glance for realme is on on his phone and may cover the lock picture** (the screen says how to turn it off). **His hotspot needs no firewall rule:** Windows already allows Node on public networks; the phone reached `192.168.194.159:8002`. Screens 142–167.
- **The picture, redesigned (Ramin 11-15 evening: "plain white and black, make it great"):** "the sky of your day" (`backend/src/services/ambient/wallpaperArt.ts`): per state a sky (dawn · daylight · dusk · a starry night with a crescent when done · mist on a light day), soft colour fields, a sun or moon with a halo, three hills with depth, fine film grain from one repeated noise tile (2.4 s → 0.24 s a picture), the state's tag + date, the headline as large as fits in 3 lines (balanced wrapping by Inter's real glyph widths, `interMetrics.ts`; a separator never starts a line, "3 reviews" never splits), up to 3 lines, and the last 7 days as dots with weekday letters. Each date seeds a slightly different sky. Inter 4 (OFL, `backend/assets/fonts/`) bundled so a server without fonts draws the same. `npx tsx scripts/wallpaper-gallery.ts <dir>` draws every state and theme. Screens 162–165.
- **Two pictures, one per screen (Ramin 11-15 night: "make it useful; the lock screen very different from the home screen, centred"):** `GET /api/ambient/wallpaper.png?screen=lock|home` (home by default, so an older app still gets a picture). **Lock: the dial of the day** (`drawLock`): on the open sky (no horizon), centred between the clock and the fingerprint, a ring made of today's things (each review, focus line and task due is a segment; done ones lit, first), what is left inside it ("3 / left today / about 21 min"; a tick on a done day; "A free day"), the counts as tiny icons (book, target, checked box: "1 of 3"), the next step, and the nearest goal (flag, its name whole, "182 days left · 1 of 6 milestones", a thin bar). **Home: the sky and the day's list**: the landscape stays; the words become the day's line and up to five rows with an icon per kind (a tick and struck title once done), the meta at the right, "+ N more", the week's dots. The data: `dayItems()` in `ambient.service.ts` (reviews planned and done today, focus lines, tasks due today or late plus those done today; Hide titles makes every title plain words), the widget JSON's `items`, `counts`, `goal` and `key` (a fingerprint of both pictures). The app (0.2.0) fetches each screen's picture on its own and sets it with its own flag, and fetches again only when the server's `key` changes; installed on his phone 11-15 night (both set: `dumpsys wallpaper` ids 20 and 21; the screens were not captured, his real day is on them).

## Bottom line

A small app (built in Java, see "Built lean" and As built), installed from a file (no store). It does three things the installed web app can't:
1. **Sets the home and lock screen wallpaper** to Recollect's picture of his day, a few times a day.
2. **A home-screen widget** with the same few lines.
3. **Settings**: what shows and when.

Opening Recollect itself stays the installed web app. The app only launches it.

Size: about 2–3 days (built in one evening on 11-15 with the SDK already on his PC; nothing downloaded).

## What it does

| Piece | How | Notes |
|---|---|---|
| **Connect** | Settings → Phone app on the web shows a QR code (the server's address + a new token that can only read the day's picture and widget). The Android app scans it once. Pasting the token works too | A new token scope, **`ambient`** (only `wallpaper.png` and `widget`). Today these routes take the general `read` scope, which can read everything: too much to leave on a phone. Revoke from Settings → Agents like any token |
| **Wallpaper** | WorkManager: at the start of his day, midday, evening and after midnight (his day's states: morning, working, evening, done, rest), plus "Refresh now". It fetches `GET /api/ambient/wallpaper.png?w&h&theme` at the screen's exact size and sets it with `WallpaperManager` | Home, lock or both, his choice. Light, dark or follow the phone. **Unchanged if the server can't be reached** (no error image). Never red, no counts as a headline, text clear of the clock and the icons (already in the drawing) |
| **Widget** | Jetpack Glance, 4×2 and 4×1: the state's headline and up to three lines from `GET /api/ambient/widget`, refreshed with the wallpaper. A tap opens Recollect | Plain type on the theme's surfaces (DESIGN.md); no streaks, no badges |
| **Settings** | One native screen: the server and account it is connected to; wallpaper on/off for home and lock; theme; "Hide titles" (ECOSYSTEM_PLAN §10's open point); quiet hours (no change at night); Refresh now; Disconnect | Words as in the web app |
| **Open Recollect** | Launches the installed web app (or Chrome at the address if it isn't installed) | A full-screen wrapper (a Trusted Web Activity) is a later option: it needs the domain's `assetlinks.json`, easy after the deploy |

## How it is built

_Superseded 11-15 by "Built lean" above (Java, no Gradle/Kotlin/AndroidX, the SDK already on his PC) and As built; kept for the record._

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
