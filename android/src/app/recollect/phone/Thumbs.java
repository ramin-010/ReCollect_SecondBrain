package app.recollect.phone;

import android.content.Context;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * His thumbs on the buddy's words, from the widget or the app's screen (POST /api/buddy/feedback with
 * the app's own token). Shown at once from the saved day; taken back when the server didn't take it.
 */
final class Thumbs {
    private Thumbs() {}

    /** Gives a thumb; `shown` redraws after each change. Returns the problem in his words, or null. Not on the main thread. */
    static String give(Context ctx, String dayId, String target, String verdict, Runnable shown) {
        Prefs p = Prefs.of(ctx);
        String server = p.server();
        String token = p.token();
        if (server == null || token == null) return ctx.getString(R.string.thumb_failed);
        Ambient a = p.ambient();
        String before = a == null || a.buddy == null ? null : a.buddy.thumb(dayId, target);
        write(p, dayId, target, verdict);
        shown.run();
        try {
            new Api(server, token).feedback(dayId, target, verdict);
            return null;
        } catch (Api.Failure f) {
            write(p, dayId, target, before);
            shown.run();
            return ctx.getString(R.string.thumb_failed);
        }
    }

    /** The saved day with this thumb (or without it, for null). */
    private static synchronized void write(Prefs p, String dayId, String target, String verdict) {
        JSONObject data = p.ambientJson();
        if (data == null) return;
        try {
            Ambient.putThumb(data, dayId, target, verdict);
            p.replaceAmbient(data);
        } catch (JSONException ignored) {
            // the saved day stays as it was; the next refresh brings the server's list
        }
    }
}
