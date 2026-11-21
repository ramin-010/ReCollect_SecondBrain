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
    /** 0.6.0: when the lock line's words end (millis; 0: not known, an older server). */
    final long lineUntil;
    /** 0.6.0: the lock line is this question (its id), or null. */
    final String lineAskId;
    /** 0.6.0: the home picture holds a thought from the buddy, and when it ends (millis; 0: not known). */
    final boolean hasInsight;
    final long insightUntil;
    /** 0.6.0: the key of the plain twins (the pictures without the buddy's words), or null (an older server). */
    final String plainKey;
    /** 0.6.0: the buddy's open questions for this phone (never with titles hidden). */
    final List<Ask> asks;
    /** 0.7.0 (stage 19): the widget's card, one item with Later, or null (the widget shows the day). */
    final Next next;

    /** The widget's card (backend later.ts `NextCard`): one item, and what Later would do. */
    static final class Next {
        /** "pu_…", "tk_…", "th_…", "rm_…": what POST /api/ambient/later takes. */
        final String id;
        /** "Pick up", "Coming up · Sun", "Today · 3 pm". */
        final String label;
        final String title;
        /** Where they stopped (a left-off item), or empty. */
        final String detail;
        /** The problem's page or the doc's, or null (the app opens). */
        final String link;
        /** What the button's words say ("Tonight · 8:30 pm"), or null: no time left before its own day. */
        final String laterLabel;
        /** When the Later would bring it back (millis; 0: not known). */
        final long laterAt;

        Next(String id, String label, String title, String detail, String link, String laterLabel, long laterAt) {
            this.id = id;
            this.label = label;
            this.title = title;
            this.detail = detail;
            this.link = link;
            this.laterLabel = laterLabel;
            this.laterAt = laterAt;
        }
    }

    /** One of the buddy's questions (0.6.0): a silent notification with its quick answers and a reply box. */
    static final class Ask {
        final String id;
        final String text;
        final List<String> answers;
        /** Millis: it goes then, by itself. */
        final long until;
        /** The server's lock check passed its words: shown on the lock screen (else hidden there). */
        final boolean lockOk;

        Ask(String id, String text, List<String> answers, long until, boolean lockOk) {
            this.id = id;
            this.text = text;
            this.answers = answers;
            this.until = until;
            this.lockOk = lockOk;
        }
    }

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

    private Ambient(String state, String date, String headline, List<String> lines, String appUrl, String accountName, String accountEmail, String serverKey, String numbers, String breakdown, Line line, Buddy buddy,
            long lineUntil, String lineAskId, boolean hasInsight, long insightUntil, String plainKey, List<Ask> asks, Next next) {
        this.next = next;
        this.lineUntil = lineUntil;
        this.lineAskId = lineAskId;
        this.hasInsight = hasInsight;
        this.insightUntil = insightUntil;
        this.plainKey = plainKey;
        this.asks = asks;
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

    /** An ISO time as millis, or 0 when missing or unreadable. */
    static long millis(String iso) {
        if (iso == null) return 0;
        try {
            return java.time.Instant.parse(iso).toEpochMilli();
        } catch (RuntimeException e) {
            return 0;
        }
    }

    private static List<Ask> parseAsks(JSONArray arr) {
        List<Ask> out = new ArrayList<>();
        if (arr == null) return Collections.unmodifiableList(out);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject q = arr.optJSONObject(i);
            if (q == null || str(q, "_id") == null || str(q, "text") == null) continue;
            List<String> labels = new ArrayList<>();
            JSONArray ans = q.optJSONArray("answers");
            if (ans != null) for (int j = 0; j < ans.length() && labels.size() < 3; j++) {
                JSONObject a = ans.optJSONObject(j);
                String label = a == null ? null : str(a, "label");
                if (label != null) labels.add(label);
            }
            out.add(new Ask(str(q, "_id"), str(q, "text"), Collections.unmodifiableList(labels), millis(str(q, "until")), q.optBoolean("lockOk", false)));
        }
        return Collections.unmodifiableList(out);
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
        // The thumbs' target: a timed line's key (its start, from 0.6.0's day), else its part of the day.
        Line line = l == null || str(l, "text") == null ? null : new Line(l.optString("dayId", ""), l.optString("key", l.optString("slot", "")), str(l, "text"), "", true);
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
                parseBuddy(d.optJSONObject("buddy")),
                l == null ? 0 : millis(str(l, "until")),
                l == null ? null : str(l, "askId"),
                str(d, "insight") != null,
                millis(str(d, "insightUntil")),
                str(d, "plainKey"),
                parseAsks(d.optJSONArray("asks")),
                parseNext(d.optJSONObject("next")));
    }

    /** The card (0.7.0); null when absent, an older server, or without the words a card needs. */
    private static Next parseNext(JSONObject n) {
        if (n == null || str(n, "id") == null || str(n, "title") == null) return null;
        JSONObject later = n.optJSONObject("later");
        String label = str(n, "label");
        return new Next(str(n, "id"), label == null ? "" : label, str(n, "title"), n.optString("detail", "").trim(), str(n, "link"),
                later == null ? null : str(later, "label"), later == null ? 0 : millis(str(later, "at")));
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
            lines.add(new Line(x.optString("dayId", ""), x.optString("key", x.optString("slot", "")), str(x, "text"), x.optString("when", ""), x.optBoolean("current", false)));
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
