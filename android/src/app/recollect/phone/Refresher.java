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
            boolean anywhere = p.home() || p.lock();
            if (anywhere && (force || !p.inQuietHours(Calendar.getInstance()))) {
                String theme = pictureTheme(ctx, p.theme());
                int[] size = Wallpapers.screenSize(ctx);
                String key = a.pictureKey() + "|" + theme + "|" + size[0] + "x" + size[1] + "|" + titles + "|" + p.home() + "|" + p.lock();
                if (force || !key.equals(p.pictureKey())) {
                    // Each screen its own picture: the lock screen the dial, the home screen the sky and its list.
                    byte[] lockPng = p.lock() ? api.wallpaper(size[0], size[1], theme, titles, "lock") : null;
                    byte[] homePng = p.home() ? api.wallpaper(size[0], size[1], theme, titles, "home") : null;
                    Bitmap lockPicture = lockPng == null ? null : BitmapFactory.decodeByteArray(lockPng, 0, lockPng.length);
                    Bitmap homePicture = homePng == null ? null : BitmapFactory.decodeByteArray(homePng, 0, homePng.length);
                    if ((lockPng != null && lockPicture == null) || (homePng != null && homePicture == null)) throw new Api.Failure(Api.Failure.BAD_DATA, 200, null);
                    Wallpapers.beforeFirstPicture(ctx, p.keepCopy());
                    if (homePicture != null) {
                        Wallpapers.set(ctx, homePicture, true, false);
                        homePicture.recycle();
                    }
                    if (lockPicture != null) {
                        Wallpapers.set(ctx, lockPicture, false, true);
                        lockPicture.recycle();
                    }
                    // The app's own preview shows the lock picture when it is on (he sees it most).
                    Wallpapers.savePreview(ctx, lockPng != null ? lockPng : homePng);
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
