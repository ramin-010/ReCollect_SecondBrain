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
        Api api = new Api(server, token);
        boolean titles = !p.hideTitles();
        long now = System.currentTimeMillis();
        try {
            JSONObject data = api.widget(titles);
            p.saveAmbient(data, now);
            DayWidget.updateAll(ctx);
            Ambient a = Ambient.parse(data);
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
                String key = a.pictureKey() + "|" + theme + "|" + size[0] + "x" + size[1] + "|" + titles + "|" + p.home() + "|" + p.lock() + "|" + p.style() + "|" + p.color() + "|" + zoom + "|" + live;
                if (live && (force || !key.equals(p.pictureKey()))) {
                    byte[] lockPng = api.wallpaper(size[0], size[1], theme, titles, "lock", p.style(), p.color(), 1f, true);
                    String slot = api.lastIcons;
                    byte[] homePng = api.wallpaper(size[0], size[1], theme, titles, "home", p.style(), p.color(), 1f, false);
                    Live.save(ctx, lockPng, slot, homePng);
                    Wallpapers.clearLock(ctx);
                    Wallpapers.savePreview(ctx, lockPng);
                    p.setPictureKey(key);
                } else if (force || !key.equals(p.pictureKey())) {
                    // Each screen its own picture: the lock screen the ring and the buddy's line, the home screen the day in numbers.
                    // The QA app also keeps the live lock picture (with its band) for its preview.
                    byte[] lockPng = p.lock() || previewOnly ? api.wallpaper(size[0], size[1], theme, titles, "lock", p.style(), p.color(), 1f, previewOnly) : null;
                    if (previewOnly && lockPng != null) Live.save(ctx, lockPng, api.lastIcons, null);
                    byte[] homePng = p.home() || previewOnly ? api.wallpaper(size[0], size[1], theme, titles, "home", p.style(), p.color(), zoom) : null;
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
            return new Outcome(true, null, false);
        } catch (Api.Failure f) {
            String problem = words(ctx, f, server);
            p.saveFailure(problem, now);
            DayWidget.updateAll(ctx);
            return new Outcome(false, problem, f.kind == Api.Failure.REVOKED);
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
