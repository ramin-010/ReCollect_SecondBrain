package app.recollect.phone;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Later on the widget's card (ECOSYSTEM_V2_PLAN stage 19, app 0.7.0), kept on the phone first, as answers to the buddy's
 * questions are (Asks): the widget shows the tick at once (offline too), then the tap is sent; one that can't be sent
 * now goes at the next refresh, with the time it was made, so the reminder lands when the button said. The server then
 * takes the item off the widget and the home picture until its time (the next refresh shows the next card).
 */
final class Laters {
    private static final String PREFS = "laters";

    private Laters() {}

    /** His tap: marked here, the widget redrawn, then sent (off the main thread). */
    static void tap(Context ctx, String id, String label, long laterAt) {
        if (id == null || id.isEmpty()) return;
        long now = System.currentTimeMillis();
        synchronized (Laters.class) {
            SharedPreferences s = store(ctx);
            JSONObject marks = json(s.getString("marks", "{}"));
            JSONArray outbox = array(s.getString("outbox", "[]"));
            JSONObject old = marks.optJSONObject(id);
            if (old != null && CardRule.markLive(old.optLong("tappedAt"), old.optLong("at"), now)) return; // a second tap on a set card
            try {
                marks.put(id, new JSONObject().put("tappedAt", now).put("at", laterAt).put("label", label == null ? "" : label));
                outbox.put(new JSONObject().put("id", id).put("tappedAt", now).put("shownAt", laterAt));
            } catch (JSONException e) {
                return;
            }
            s.edit().putString("marks", marks.toString()).putString("outbox", outbox.toString()).apply();
        }
        DayWidget.updateAll(ctx);
        Prefs p = Prefs.of(ctx);
        if (p.server() != null && p.token() != null) flush(ctx, new Api(p.server(), p.token()));
    }

    /** A Later tapped on this phone for this item, still counting (the widget shows it set). */
    static boolean isSet(Context ctx, String id) {
        if (id == null) return false;
        JSONObject m = json(store(ctx).getString("marks", "{}")).optJSONObject(id);
        return m != null && CardRule.markLive(m.optLong("tappedAt"), m.optLong("at"), System.currentTimeMillis());
    }

    /** The words of a Later tapped here ("Tonight · 8:30 pm"; the server's once it answered), or null. */
    static String label(Context ctx, String id) {
        if (id == null) return null;
        JSONObject m = json(store(ctx).getString("marks", "{}")).optJSONObject(id);
        return m == null ? null : m.optString("label", null);
    }

    /**
     * Sends the taps that wait (at each refresh, before the day is read, and right after a tap). A refusal for good
     * (the item gone from their day, no time left) drops the tap and its mark, so the card shows again as it is.
     */
    static synchronized void flush(Context ctx, Api api) {
        SharedPreferences s = store(ctx);
        JSONArray outbox = array(s.getString("outbox", "[]"));
        JSONObject marks = json(s.getString("marks", "{}"));
        boolean redraw = false;
        if (outbox.length() > 0) {
            JSONArray left = new JSONArray();
            for (int i = 0; i < outbox.length(); i++) {
                JSONObject x = outbox.optJSONObject(i);
                if (x == null) continue;
                String id = x.optString("id");
                try {
                    JSONObject done = api.later(id, x.optLong("tappedAt", System.currentTimeMillis()), x.optLong("shownAt", 0));
                    // The server's own time for it (it may differ from the button's, when the tap waited past it).
                    JSONObject m = marks.optJSONObject(id);
                    long at = Ambient.millis(done.optString("at", null));
                    String label = done.optString("label", "");
                    if (m != null && at > 0) {
                        if (!label.isEmpty() && !label.equals(m.optString("label"))) redraw = true; // redrawn with the server's words
                        m.put("at", at).put("label", label.isEmpty() ? m.optString("label") : label);
                    }
                } catch (Api.Failure f) {
                    if (CardRule.keepAfterFailure(f.kind == Api.Failure.UNREACHABLE, f.status)) left.put(x);
                    else {
                        marks.remove(id);
                        redraw = true;
                    }
                } catch (JSONException ignored) {
                    // the mark keeps the button's time
                }
            }
            outbox = left;
        }
        // Marks whose time has passed (or two days old) go.
        JSONArray names = marks.names();
        long now = System.currentTimeMillis();
        if (names != null) for (int i = 0; i < names.length(); i++) {
            JSONObject m = marks.optJSONObject(names.optString(i));
            if (m == null || !CardRule.markLive(m.optLong("tappedAt"), m.optLong("at"), now)) marks.remove(names.optString(i));
        }
        s.edit().putString("outbox", outbox.toString()).putString("marks", marks.toString()).apply();
        if (redraw) DayWidget.updateAll(ctx);
    }

    /** Disconnect: nothing of them stays. */
    static void clear(Context ctx) {
        store(ctx).edit().clear().apply();
    }

    private static SharedPreferences store(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject json(String raw) {
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static JSONArray array(String raw) {
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }
}
