package app.recollect.phone;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import org.json.JSONObject;

import java.io.IOException;
import java.util.Calendar;

/**
 * One refresh: read the day's lines, update the widget, and (outside quiet hours, when something
 * changed) fetch the picture at the screen's size and set it where he chose. If the server can't be
 * reached, nothing on the phone changes: no error picture, the last one stays.
 */
final class Refresher {
    static final String TAG = "Recollect";

    /** What a refresh did, for the settings screen. */
    static final class Outcome {
        final boolean ok;
        final String problem;
        final boolean revoked;

        Outcome(boolean ok, String problem, boolean revoked) {
            this.ok = ok;
            this.problem = problem;
            this.revoked = revoked;
        }
    }

    private Refresher() {}

    /** "light" or "dark" for the picture: his choice, or the phone's dark mode for System. */
    static String pictureTheme(Context ctx, String choice) {
        if (Prefs.THEME_LIGHT.equals(choice) || Prefs.THEME_DARK.equals(choice)) return choice;
        int night = ctx.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return night == Configuration.UI_MODE_NIGHT_YES ? Prefs.THEME_DARK : Prefs.THEME_LIGHT;
    }

    /** Sets the reminders' alarms from the day's JSON and tells the server when the set it holds changed (a failure waits for the next refresh). */
    private static void reminders(Context ctx, Prefs p, Api api, JSONObject data) {
        if (!p.remindersOn()) {
            Reminders.cancelAll(ctx);
            return;
        }
        java.util.List<String> held = Reminders.schedule(ctx, Reminders.parse(data.optJSONArray("alarms")));
        String key = android.text.TextUtils.join(",", held);
        if (held.isEmpty() || key.equals(p.alarmsAcked())) return;
        try {
            api.remindersScheduled(held);
            p.setAlarmsAcked(key);
        } catch (Api.Failure ignored) {
            // told at the next refresh; meanwhile the server may still email one of them
        }
    }

    /** `force`: Refresh now and his own changes (they set the picture even in quiet hours, and fetch it again). */
    static synchronized Outcome run(Context ctx, boolean force) {
        Prefs p = Prefs.of(ctx);
        String server = p.server();
        String token = p.token();
        if (server == null || token == null) return new Outcome(false, null, false);
        // 0.7.0 (stage 19): with a widget on a home screen, the home picture leaves the widget's item out (card=0).
        boolean placed = DayWidget.placed(ctx);
        Api api = new Api(server, token).withoutCard(placed);
        boolean titles = !p.hideTitles();
        long now = System.currentTimeMillis();
        long started = System.currentTimeMillis();
        int fetched = 0;
        try {
            // 0.7.0: a Later tapped on the widget that waits goes first, so the day read next already moved on from it.
            Laters.flush(ctx, api);
            JSONObject data = api.widget(titles, p.inQuietHours(Calendar.getInstance()));
            p.clearRefusals();
            long dayMs = System.currentTimeMillis() - started;
            p.saveAmbient(data, now);
            DayWidget.updateAll(ctx);
            Ambient a = Ambient.parse(data);
            // 0.6.0: the answers given on this phone that wait go first, then the questions' notifications.
            Asks.flush(ctx, api);
            Asks.show(ctx, a);
            // A new note from the buddy: one notification (quiet hours and the day's limit allowing).
            if (!MainActivity.inFront) Notes.maybeNotify(ctx, a);
            // 0.5.0: the reminders to come ring on this phone; the server is told which, so no email goes for them.
            reminders(ctx, p, api, data);
            boolean anywhere = p.home() || p.lock();
            // The QA app (build.mjs --qa) fetches the home picture for its preview even with both screens
            // off, and sets nothing: a test of the pictures never touches his wallpapers.
            boolean previewOnly = BuildConfig.QA && !anywhere;
            if ((anywhere || previewOnly) && (force || !p.inQuietHours(Calendar.getInstance()))) {
                String theme = pictureTheme(ctx, p.theme());
                int[] size = Wallpapers.screenSize(ctx);
                // The live lock screen (0.4.0): the app's live wallpaper draws both pictures itself (no
                // system zoom), with a band under the lock picture's words for the notification icons.
                boolean live = p.lock() && p.live() && Live.active(ctx);
                // The home screen shows its wallpaper zoomed (Android 11+); the lock screen doesn't (checked on his phone 11-16).
                float zoom = live ? 1f : Wallpapers.homeZoom();
                // His choices that shape every picture; each picture's own key comes from the server.
                // Stage 11: each screen its own look (his decision 4).
                ScreenLook lockLook = p.lockLook();
                ScreenLook homeLook = p.homeLook();
                // 0.7.0: which item the home picture leaves out (the widget's card) is one of them too.
                String choices = theme + "|" + size[0] + "x" + size[1] + "|" + titles + "|" + p.home() + "|" + p.lock() + "|" + ScreenLook.key(lockLook, homeLook) + "|" + zoom + "|" + live
                        + "|card:" + (placed ? (a.next != null ? a.next.id : "-") : "off");
                String key = a.pictureKey() + "|" + choices;
                // 0.5.2: pictures are fetched only when they changed (the server's key, his choices), even for
                // Refresh now (it re-downloaded both full-screen pictures every time); `force` still sets them in quiet hours.
                boolean changed = !key.equals(p.pictureKey()) || (live && !Live.hasPictures(ctx));
                // 0.6.0: the plain twins (no words from the buddy), fetched when the day has words and they changed:
                // their own key (the server's, without the words) and his choices, so new words alone fetch nothing more.
                boolean words = a.line != null || a.hasInsight;
                String plainKey = a.plainKey == null ? null : a.plainKey + "|" + choices;
                boolean plainChanged = words && plainKey != null && !plainKey.equals(p.plainKey());
                if (live && changed) {
                    // Both at once, each on its own connection (the lock call's icon band stays its own).
                    byte[][] lockAndHome = both(api, new Api(server, token).withoutCard(placed),size, theme, titles, lockLook, homeLook, 1f, true, true, true);
                    fetched = 2;
                    byte[] lockPng = lockAndHome[0];
                    String slot = api.lastIcons;
                    byte[] homePng = lockAndHome[1];
                    Live.save(ctx, lockPng, slot, homePng);
                    Wallpapers.clearLock(ctx);
                    Wallpapers.savePreview(ctx, lockPng);
                    p.setPictureKey(key);
                }
                if (live && plainChanged) {
                    Api plainApi = new Api(server, token).withoutCard(placed);
                    byte[] lockPlain = plainApi.wallpaper(size[0], size[1], theme, titles, "lock", lockLook.style, lockLook.color, 1f, true, true);
                    String plainSlot = plainApi.lastIcons;
                    byte[] homePlain = plainApi.wallpaper(size[0], size[1], theme, titles, "home", homeLook.style, homeLook.color, 1f, false, true);
                    fetched += 2;
                    Live.savePlain(ctx, lockPlain, plainSlot, homePlain);
                    p.setPlainKey(plainKey);
                } else if (!live && (changed || plainChanged) && !previewOnly) {
                    // 0.6.0: all four pictures are kept; Pictures shows the right one now and switches at the next end time.
                    byte[][] lockAndHome = changed ? both(api, new Api(server, token).withoutCard(placed),size, theme, titles, lockLook, homeLook, zoom, p.lock(), p.home(), false) : new byte[2][];
                    Pictures.keep(ctx, Pictures.LOCK, lockAndHome[0]);
                    Pictures.keep(ctx, Pictures.HOME, lockAndHome[1]);
                    fetched = (lockAndHome[0] == null ? 0 : 1) + (lockAndHome[1] == null ? 0 : 1);
                    if (plainChanged) {
                        Api plainApi = new Api(server, token).withoutCard(placed);
                        if (p.lock()) Pictures.keep(ctx, Pictures.LOCK_PLAIN, plainApi.wallpaper(size[0], size[1], theme, titles, "lock", lockLook.style, lockLook.color, 1f, false, true));
                        if (p.home()) Pictures.keep(ctx, Pictures.HOME_PLAIN, plainApi.wallpaper(size[0], size[1], theme, titles, "home", homeLook.style, homeLook.color, zoom, false, true));
                        fetched += (p.lock() ? 1 : 0) + (p.home() ? 1 : 0);
                        p.setPlainKey(plainKey);
                    }
                    if (changed) {
                        Wallpapers.beforeFirstPicture(ctx, p.keepCopy());
                        if (lockAndHome[0] != null) Wallpapers.savePreview(ctx, lockAndHome[0]);
                        else Wallpapers.savePreview(ctx, lockAndHome[1], zoom);
                        p.setPictureKey(key);
                    }
                    Pictures.forget(ctx);
                } else if (!live && changed) {
                    // Each screen its own picture: the lock screen the ring and the buddy's line, the home screen the day in numbers.
                    // The QA app also keeps the live lock picture (with its band) for its preview.
                    byte[][] lockAndHome = both(api, new Api(server, token).withoutCard(placed),size, theme, titles, lockLook, homeLook, zoom, p.lock() || previewOnly, p.home() || previewOnly, previewOnly);
                    byte[] lockPng = lockAndHome[0];
                    byte[] homePng = lockAndHome[1];
                    fetched = (lockPng == null ? 0 : 1) + (homePng == null ? 0 : 1);
                    if (previewOnly && lockPng != null) Live.save(ctx, lockPng, api.lastIcons, null);
                    Bitmap lockPicture = lockPng == null ? null : BitmapFactory.decodeByteArray(lockPng, 0, lockPng.length);
                    Bitmap homePicture = homePng == null ? null : BitmapFactory.decodeByteArray(homePng, 0, homePng.length);
                    if ((lockPng != null && lockPicture == null) || (homePng != null && homePicture == null)) throw new Api.Failure(Api.Failure.BAD_DATA, 200, null);
                    if (!previewOnly) Wallpapers.beforeFirstPicture(ctx, p.keepCopy());
                    if (homePicture != null && !previewOnly) {
                        Wallpapers.set(ctx, homePicture, true, false);
                        homePicture.recycle();
                    }
                    if (lockPicture != null && !previewOnly) Wallpapers.set(ctx, lockPicture, false, true);
                    if (lockPicture != null) lockPicture.recycle();
                    if (homePicture != null && previewOnly) homePicture.recycle();
                    // The app's own preview shows the lock picture when it is on (he sees it most); a home
                    // picture as the home screen shows it (its zoom).
                    if (lockPng != null && !previewOnly) Wallpapers.savePreview(ctx, lockPng);
                    else Wallpapers.savePreview(ctx, homePng, zoom);
                    p.setPictureKey(key);
                }
            }
            // 0.6.0: the right picture on each screen now (the words, or the plain twin), and the alarm for the next change.
            Pictures.apply(ctx);
            // Stage 11 (his item 10c): when the pictures last changed, for the permissions checklist and the diagnostics.
            if (fetched > 0) p.setPicturesAt(System.currentTimeMillis());
            // Times and counts only (never what the day holds): enough to see what a refresh costs.
            android.util.Log.i(TAG, "refresh: day " + dayMs + " ms, " + fetched + " picture(s), total " + (System.currentTimeMillis() - started) + " ms" + (force ? " (asked)" : ""));
            return new Outcome(true, null, false);
        } catch (Api.Failure f) {
            // 0.5.2: one refusal keeps the connection (it ends after 3, at least 30 minutes apart).
            boolean refused = f.kind == Api.Failure.REVOKED;
            boolean giveUp = refused && p.noteRefusal(now);
            String problem = refused && !giveUp ? ctx.getString(R.string.fail_refused) : words(ctx, f, server);
            p.saveFailure(problem, now);
            DayWidget.updateAll(ctx);
            android.util.Log.i(TAG, "refresh failed: kind " + f.kind + (refused ? giveUp ? " (refused: gave up)" : " (refused: kept)" : ""));
            return new Outcome(false, problem, giveUp);
        } catch (IOException | RuntimeException e) {
            String problem = ctx.getString(R.string.fail_wallpaper);
            p.saveFailure(problem, now);
            return new Outcome(false, problem, false);
        } catch (Exception e) {
            String problem = ctx.getString(R.string.fail_data);
            p.saveFailure(problem, now);
            return new Outcome(false, problem, false);
        }
    }

    /**
     * The lock and home pictures at once (0.5.2: they came one after another), each on its own Api so the
     * lock call's icon band stays its own; null for a screen not wanted. A failure of either is the refresh's.
     */
    private static byte[][] both(Api lockApi, Api homeApi, int[] size, String theme, boolean titles, ScreenLook lockLook, ScreenLook homeLook, float homeZoom, boolean lock, boolean home, boolean lockIcons) throws Api.Failure {
        final byte[][] out = new byte[2][];
        final Api.Failure[] homeFailed = new Api.Failure[1];
        Thread second = null;
        if (home) {
            second = new Thread(() -> {
                try {
                    out[1] = homeApi.wallpaper(size[0], size[1], theme, titles, "home", homeLook.style, homeLook.color, homeZoom);
                } catch (Api.Failure f) {
                    homeFailed[0] = f;
                }
            }, "recollect-home-picture");
            second.start();
        }
        if (lock) out[0] = lockApi.wallpaper(size[0], size[1], theme, titles, "lock", lockLook.style, lockLook.color, 1f, lockIcons);
        if (second != null) {
            try {
                second.join();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new Api.Failure(Api.Failure.UNREACHABLE, 0, e);
            }
            if (homeFailed[0] != null) throw homeFailed[0];
        }
        return out;
    }

    /** A failure in his words: what went wrong and what to do next. */
    static String words(Context ctx, Api.Failure f, String server) {
        switch (f.kind) {
            case Api.Failure.UNREACHABLE:
                return ctx.getString(R.string.fail_unreachable, ConnectLink.hostOf(server));
            case Api.Failure.REVOKED:
                return ctx.getString(R.string.fail_revoked);
            case Api.Failure.FORBIDDEN:
                return ctx.getString(R.string.fail_forbidden);
            case Api.Failure.BAD_DATA:
                return ctx.getString(R.string.fail_data);
            default:
                return ctx.getString(R.string.fail_server, f.status);
        }
    }
}
