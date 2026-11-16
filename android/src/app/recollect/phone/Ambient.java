package app.recollect.phone;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** GET /api/ambient/widget's `data`: what the day holds now (backend ambient.service.ts). */
final class Ambient {
    /** morning | working | evening | done | rest */
    final String state;
    /** "Sunday 15 November" */
    final String date;
    /** The one line that matters now; empty on a done day. */
    final String headline;
    /** Up to three quieter lines. */
    final List<String> lines;
    /** The web app's address, or null. */
    final String appUrl;
    final String accountName;
    final String accountEmail;
    /** The server's fingerprint of both pictures (`key`), or null from an older server. */
    final String serverKey;
    /** The day in numbers ("3 left today · about 21 min"), or null from an older server. */
    final String numbers;
    /** What is left by kind ("7 reviews · 2 tasks"; 0.3.1), or null (a free or done day, or an older server). */
    final String breakdown;
    /** The buddy's line for now, only one its lock check passed (the widget's main words), or null. */
    final Line line;
    /** The buddy's part of the app's screen (0.3.0), or null while it is off. */
    final Buddy buddy;

    /** One of the buddy's lines: which step said it, for which part of the day, and when in words. */
    static final class Line {
        final String dayId;
        final String slot;
        final String text;
        /** "This morning", "Yesterday evening" (empty for the widget's line). */
        final String when;
        final boolean current;

        Line(String dayId, String slot, String text, String when, boolean current) {
            this.dayId = dayId;
            this.slot = slot;
            this.text = text;
            this.when = when;
            this.current = current;
        }
    }

    /** The night's (or a pulse's) note. `lockOk`: its words may show in a notification. */
    static final class Note {
        final String id;
        final String dayId;
        final String text;
        final boolean lockOk;

        Note(String id, String dayId, String text, boolean lockOk) {
            this.id = id;
            this.dayId = dayId;
            this.text = text;
            this.lockOk = lockOk;
        }
    }

    static final class Buddy {
        final String name;
        final Note note;
        /** Newest first; the first one is the line for now when `current`. */
        final List<Line> lines;
        /** "dayId|target" → "more" | "less" */
        final JSONObject thumbs;

        Buddy(String name, Note note, List<Line> lines, JSONObject thumbs) {
            this.name = name;
            this.note = note;
            this.lines = lines;
            this.thumbs = thumbs;
        }

        /** His thumb on a line or the note ("more", "less"), or null. */
        String thumb(String dayId, String target) {
            return thumbs.optString(dayId + "|" + target, null);
        }

        /** "From your buddy", or "From <its name>". */
        String title(android.content.Context ctx) {
            return name == null || name.isEmpty() ? ctx.getString(R.string.buddy_title) : ctx.getString(R.string.buddy_title_named, name);
        }
    }

    private Ambient(String state, String date, String headline, List<String> lines, String appUrl, String accountName, String accountEmail, String serverKey, String numbers, String breakdown, Line line, Buddy buddy) {
        this.state = state;
        this.date = date;
        this.headline = headline;
        this.lines = lines;
        this.appUrl = appUrl;
        this.accountName = accountName;
        this.accountEmail = accountEmail;
        this.serverKey = serverKey;
        this.numbers = numbers;
        this.breakdown = breakdown;
        this.line = line;
        this.buddy = buddy;
    }

    private static String str(JSONObject o, String key) {
        if (o == null || o.isNull(key)) return null;
        String v = o.optString(key, null);
        return v == null || v.trim().isEmpty() ? null : v;
    }

    static Ambient parse(JSONObject d) throws JSONException {
        List<String> lines = new ArrayList<>();
        JSONArray arr = d.optJSONArray("lines");
        if (arr != null) for (int i = 0; i < arr.length() && lines.size() < 3; i++) {
            String l = arr.optString(i, "").trim();
            if (!l.isEmpty()) lines.add(l);
        }
        JSONObject account = d.optJSONObject("account");
        JSONObject l = d.optJSONObject("line");
        Line line = l == null || str(l, "text") == null ? null : new Line(l.optString("dayId", ""), l.optString("slot", ""), str(l, "text"), "", true);
        return new Ambient(
                d.getString("state"),
                d.optString("date", ""),
                d.optString("headline", ""),
                Collections.unmodifiableList(lines),
                str(d, "appUrl"),
                account == null ? null : account.optString("name", null),
                account == null ? null : account.optString("email", null),
                str(d, "key"),
                str(d, "numbers"),
                str(d, "breakdown"),
                line,
                parseBuddy(d.optJSONObject("buddy")));
    }

    private static Buddy parseBuddy(JSONObject b) {
        if (b == null) return null;
        JSONObject n = b.optJSONObject("note");
        Note note = n == null || str(n, "text") == null ? null : new Note(n.optString("id", ""), n.optString("dayId", ""), str(n, "text"), n.optBoolean("lockOk", false));
        List<Line> lines = new ArrayList<>();
        JSONArray arr = b.optJSONArray("lines");
        if (arr != null) for (int i = 0; i < arr.length(); i++) {
            JSONObject x = arr.optJSONObject(i);
            if (x == null || str(x, "text") == null) continue;
            lines.add(new Line(x.optString("dayId", ""), x.optString("slot", ""), str(x, "text"), x.optString("when", ""), x.optBoolean("current", false)));
        }
        JSONObject thumbs = new JSONObject();
        JSONArray t = b.optJSONArray("thumbs");
        if (t != null) for (int i = 0; i < t.length(); i++) {
            JSONObject x = t.optJSONObject(i);
            if (x == null) continue;
            try {
                thumbs.put(x.optString("dayId", "") + "|" + x.optString("target", ""), x.optString("verdict", ""));
            } catch (JSONException ignored) {
                // a key the JSON can't hold: that thumb isn't shown
            }
        }
        return new Buddy(str(b, "name"), note, Collections.unmodifiableList(lines), thumbs);
    }

    boolean done() {
        return "done".equals(state);
    }

    /**
     * What the pictures show: the same key means the same pictures, so nothing is fetched again. The
     * server sends one (`key`) that covers the list and the dial too; an older server, the words only.
     */
    String pictureKey() {
        if (serverKey != null) return "v2|" + serverKey;
        StringBuilder b = new StringBuilder(state).append('|').append(date).append('|').append(headline);
        for (String l : lines) b.append('|').append(l);
        return b.toString();
    }

    /**
     * A thumb he just gave (from the widget or the app's screen), written into the day's saved JSON so
     * the widget and the screen show it before the next refresh brings the server's own list.
     */
    static void putThumb(JSONObject data, String dayId, String target, String verdict) throws JSONException {
        JSONObject b = data.optJSONObject("buddy");
        if (b == null) return;
        JSONArray old = b.optJSONArray("thumbs");
        JSONArray next = new JSONArray();
        if (old != null) for (int i = 0; i < old.length(); i++) {
            JSONObject x = old.optJSONObject(i);
            if (x != null && !(dayId.equals(x.optString("dayId")) && target.equals(x.optString("target")))) next.put(x);
        }
        if (verdict != null) next.put(new JSONObject().put("dayId", dayId).put("target", target).put("verdict", verdict));
        b.put("thumbs", next);
    }
}
