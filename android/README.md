# Kaaga's phone app (Android)

A small Android app that puts **the picture of your day** from Kaaga on the phone's **lock screen** (and the home screen, if you like), and keeps a **home-screen widget** with the same lines. The picture changes with the day: dawn in the morning, daylight while you work, dusk in the evening, a starry night once the day is done, a soft mist on a light day. Kaaga's backend draws it (`src/services/ambient/wallpaperArt.ts` there); the app fetches it at the screen's exact size.

- **What it can read:** only the picture and its lines. It connects with its own token (the `ambient` scope), which opens nothing else.
- **No Play Store, nothing hosted:** it is one APK file, installed over USB or opened on the phone.
- **Built lean:** Java and Android's own APIs, with no Gradle, Kotlin or AndroidX. The APK is about 70 KB.

## Build

You need a JDK (17 or newer) and the Android SDK's **build tools** and **one platform** (`platforms/android-34` or newer, for `android.jar`). The build finds them in `ANDROID_SDK_ROOT`, `ANDROID_HOME`, `android/.toolchain/`, `C:/Android/sdk` or the usual Android Studio folder, and finds the JDK through `JAVA_HOME`.

```sh
node build.mjs             # build/kaaga.apk
node build.mjs --install   # and install it on the phone over USB (adb install -r)
node build.mjs --debug     # a test build adb can look inside (run-as); never for daily use
node build.mjs --qa        # build/kaaga-qa.apk: "Kaaga QA", a second app beside the real one for tests
                           # (its own package and data, no wallpaper unless switched on, a widget preview)
```

The first build creates the signing key in `keys/` (git-ignored). **Back up `keys/`**: Android installs an update over the app only when the same key signed it.

## Connect

1. On the computer: Kaaga → **Settings → Phone app**. Choose where the phone finds Kaaga (the public address after the deploy; before it, the computer's address on the same Wi-Fi or hotspot, or `localhost` over USB with `adb reverse tcp:8002 tcp:8002`). Then **Make the connect code**.
2. Point the phone's camera at the code and open the link. The page that opens offers the APK if the app isn't installed yet.
3. Tap **Open the phone app**, then **Connect**. "Keep a copy of my wallpaper" lets Disconnect put your own wallpaper back.

"Paste a connect link" in the app takes the same link from the clipboard.

## How it works

| Piece | File |
|---|---|
| The screen: connect, the day's picture, where it shows, theme, quiet hours, Hide titles, Refresh now, Disconnect | `MainActivity.java`, `res/layout/activity_main.xml` |
| One refresh: the lines, the widget, then the picture when it changed (outside quiet hours) | `Refresher.java` |
| When: every 15 minutes while awake (0.5.1; it was 30), and exactly at the day's turns (00:01, 12:00, 18:00); one persisted job that chains the next | `Schedule.java`, `RefreshJob.java`, `Wake.java` |
| The widget (0.7.x): one card for one item with Later (`next` in the day's JSON), else the day; full, short and 4 × 1, one layout per look (Paper, Slate) and theme, made from three by `python widget-themes.py`; its pure rules | `DayWidget.java`, `CardRule.java` (`node build.mjs --test`), `res/layout/widget_day*.xml`; the mock-up `mockups/phone-app/widget.html` |
| Later tapped on the widget: kept here first, sent at once or at the next refresh (with the time it was tapped) | `Laters.java`, `Api.later` (`POST /api/ambient/later`) |
| The wallpaper, and the copy of yours | `Wallpapers.java` |
| The token, sealed with a key in the Android Keystore | `Vault.java`, `Prefs.java` |
| The three calls it makes | `Api.java` (`GET /api/ambient/widget`, `GET /api/ambient/wallpaper.png`, `POST /api/ambient/disconnect`) |
| Its own updates (0.9.0): what the server's release is, one notification per version, the download, its checks, Android's installer | `Updates.java`, `UpdateRule.java` (`node build.mjs --test`), the phone pages' `components/phone/update.ts` |

If the server can't be reached, nothing on the phone changes: no error picture; the screen says what went wrong.

## Releasing an update (0.9.0 and later update themselves)

1. In `build.mjs`, raise `VERSION` and write `NOTES`: up to three short lines on what is new, for the people who use it.
2. `node build.mjs`. It writes `backend/assets/phone/kaaga.apk` and its description `kaaga.json` (package, version, build number, notes). Commit **both** in the backend repo.
3. Deploy the backend. Its `GET /phone/kaaga.json` now names the new build (the server measures the file's size and SHA-256 itself).
4. Each phone finds it within 12 hours (its background refresh), or as soon as Today or Settings opens. It shows one silent notification, the row on Today and the row in Settings › This phone. Nothing downloads until the person taps **Update**. The app then checks the file's SHA-256, that it is this app and a newer build, and hands it to Android, which asks them to confirm. The first time, Android asks once to allow "Install unknown apps" for Kaaga.

- **Same key, always:** Android installs an update only when `keys/` signed it, as it signed the app on the phone. An app older than 0.9.0 can't update itself: its pages offer **Download** instead, and the phone's browser installs the file over the app, with its data kept.
- **To stop offering an update,** take `kaaga.json` out of `backend/assets/phone`.
- **Never go down a version:** Android refuses a lower build. To undo a bad release, build again with the fix; the build number grows by itself.
- **The QA app** updates only from the laptop's QA build (`node build.mjs --qa` writes `build/kaaga-qa.apk` and `build/kaaga-qa.json`; the laptop's server serves them at `/phone/kaaga-qa.*`), never from the real app's file.

**realme / OPPO phones:** turn off Glance (Settings → Home screen, Lock screen & Always-On Display → Glance for realme → Activate on Lockscreen), or it shows its own pictures on the lock screen. Also allow the app in the background (App info → Battery usage → Allow background activity, and Allow auto-launch) so the picture changes on its own. The app's screen says both on these phones.

Licence: as the rest of this repository. Inter, the picture's typeface (bundled with the backend), is under the SIL Open Font License 1.1.

## 0.9.0

- The app updates itself from its server (above, "Releasing an update"). Settings › This phone shows its version and, when one is out, the newer version with Update. While a newer version waits, Today shows one slim row; its × closes that row for that version.

## 0.7.1 (the QA app; his app gets it as 0.7.0 after the deploy)

- The widget is one card for one item the server chooses (what Buddy's line is about, else something due within two days, else what you left off) with one button, **Later**: it brings the item back at a time you can act (tonight before 5 pm, else tomorrow) as a silent reminder, and takes it off the widget and the home picture until then. The tap shows set at once, offline too, and is sent with the time it was made. With a widget placed, the home picture leaves the card's item out (`card=0`).

## 0.4.0

- The look: Inter (SIL OFL 1.1; `res/font/`, licence `res/raw/inter_ofl.txt`), the app's own tokens in `res/values*/colors.xml`, styles in `res/values/styles.xml`.
- The live lock screen: `DayWallpaper` (a live wallpaper) and `NotifIcons` (a notification listener: app icons and counts only). Turn it on in the app (Show it on › Notification icons): allow notification access, set it as the wallpaper in Android's picker, then turn off notifications on the lock screen in the phone's settings. Draws are logged as counts: `adb logcat -s RecollectLive`.
