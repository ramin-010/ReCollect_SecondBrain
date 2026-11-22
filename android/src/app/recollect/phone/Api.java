package app.recollect.phone;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * The calls the app's `ambient` token may make (backend tokenRoutes.ts): the day's lines (with the
 * buddy's part), the picture, Disconnect, and since 0.3.0 the buddy's thumbs and "Tell your buddy".
 * Nothing else answers it.
 */
final class Api {
    static final class Failure extends Exception {
        static final int UNREACHABLE = 1;
        static final int REVOKED = 2;
        static final int FORBIDDEN = 3;
        static final int SERVER = 4;
        static final int BAD_DATA = 5;
        final int kind;
        final int status;

        Failure(int kind, int status, Throwable cause) {
            super("kind " + kind + ", status " + status, cause);
            this.kind = kind;
            this.status = status;
        }
    }

    private final String server;
    private final String token;

    Api(String server, String token) {
        this.server = server;
        this.token = token;
    }

    /** GET /api/ambient/widget → its `data`. 0.6.0 names its version: from it the day carries the questions and each word's end time. */
    JSONObject widget(boolean titles) throws Failure {
        return widget(titles, false);
    }

    /** `quiet` (0.6.0): in the phone's quiet hours no question comes, and none is marked as shown. */
    JSONObject widget(boolean titles, boolean quiet) throws Failure {
        byte[] body = call("GET", "/api/ambient/widget?app=" + BuildConfig.VERSION + (titles ? "" : "&titles=0") + (quiet ? "&quiet=1" : ""), "application/json");
        try {
            JSONObject data = new JSONObject(new String(body, StandardCharsets.UTF_8)).getJSONObject("data");
            Ambient.parse(data); // fails early on a shape this app can't read
            return data;
        } catch (JSONException e) {
            throw new Failure(Failure.BAD_DATA, 200, e);
        }
    }

    /**
     * GET /api/ambient/wallpaper.png at the screen's exact size, for one screen: "home" (the sky of
     * the day and its list) or "lock" (the dial). Each screen has its own picture.
     */
    byte[] wallpaper(int width, int height, String theme, boolean titles, String screen) throws Failure {
        return wallpaper(width, height, theme, titles, screen, null, null);
    }

    /** The picture in a style and colour (the server's list; null: the sky). */
    byte[] wallpaper(int width, int height, String theme, boolean titles, String screen, String style, String color) throws Failure {
        return wallpaper(width, height, theme, titles, screen, style, color, 1f);
    }

    /** `zoom` (0.3.1): how much larger the screen shows the picture at rest; the server draws the words for it. */
    byte[] wallpaper(int width, int height, String theme, boolean titles, String screen, String style, String color, float zoom) throws Failure {
        return wallpaper(width, height, theme, titles, screen, style, color, zoom, false);
    }

    /**
     * `icons` (0.4.0, the live lock screen): the server leaves a band under the words for the phone's
     * notification icons and says where in X-Ambient-Icons (kept in `lastIcons`).
     */
    byte[] wallpaper(int width, int height, String theme, boolean titles, String screen, String style, String color, float zoom, boolean icons) throws Failure {
        return wallpaper(width, height, theme, titles, screen, style, color, zoom, icons, false);
    }

    /** `plain` (0.6.0): the plain twin, the same picture without the buddy's words (shown when they end, in quiet hours, once answered). */
    byte[] wallpaper(int width, int height, String theme, boolean titles, String screen, String style, String color, float zoom, boolean icons, boolean plain) throws Failure {
        String q = "?w=" + width + "&h=" + height + "&theme=" + theme + (titles ? "" : "&titles=0") + "&screen=" + screen
                + (style == null ? "" : "&style=" + style) + (color == null ? "" : "&color=" + color)
                + (zoom > 1.001f ? "&zoom=" + String.format(java.util.Locale.ROOT, "%.3f", zoom) : "")
                + (icons ? "&icons=1" : "") + "&app=" + BuildConfig.VERSION + (plain ? "&plain=1" : "")
                + (withoutCard && "home".equals(screen) ? "&card=0" : "")
                // 0.7.3: WebP, a tenth of the PNG's size (a full-screen PNG is about 3 MB); BitmapFactory decodes it the same.
                + "&format=webp";
        lastIcons = null;
        return call("GET", "/api/ambient/wallpaper.png" + q, "image/webp");
    }

    /** The last picture's band for the notification icons ("cy,size,#AARRGGBB"), or null. */
    volatile String lastIcons;

    /** GET /api/ambient/styles → the JSON array (the styles and their colours, the sky first). */
    String styles() throws Failure {
        byte[] body = call("GET", "/api/ambient/styles", "application/json");
        try {
            return new JSONObject(new String(body, StandardCharsets.UTF_8)).getJSONArray("data").toString();
        } catch (JSONException e) {
            throw new Failure(Failure.BAD_DATA, 200, e);
        }
    }

    /** POST /api/ambient/disconnect: ends this token on the server. */
    void disconnect() throws Failure {
        call("POST", "/api/ambient/disconnect", "application/json");
    }

    /** POST /api/buddy/feedback: a thumb ("more" or "less") on a line (its slot) or the note of one step. */
    void feedback(String dayId, String target, String verdict) throws Failure {
        try {
            post("/api/buddy/feedback", new JSONObject().put("buddyDayId", dayId).put("target", target).put("verdict", verdict));
        } catch (JSONException e) {
            throw new Failure(Failure.BAD_DATA, 0, e);
        }
    }

    /** POST /api/ambient/reminders/scheduled: the reminders this phone will ring for (no email goes for them). */
    void remindersScheduled(java.util.List<String> ids) throws Failure {
        try {
            post("/api/ambient/reminders/scheduled", new JSONObject().put("ids", new org.json.JSONArray(ids)));
        } catch (JSONException e) {
            throw new Failure(Failure.BAD_DATA, 0, e);
        }
    }

    /** POST /api/buddy/asks/:id/answer (0.6.0): his quick answer (its place) or his own words to one of the buddy's questions. */
    void answer(String askId, int choice, String text) throws Failure {
        try {
            JSONObject body = new JSONObject();
            if (text != null) body.put("text", text);
            else body.put("choice", choice);
            post("/api/buddy/asks/" + java.net.URLEncoder.encode(askId, "UTF-8") + "/answer", body);
        } catch (JSONException | java.io.UnsupportedEncodingException e) {
            throw new Failure(Failure.BAD_DATA, 0, e);
        }
    }

    /** POST /api/buddy/tell: his words, a private note for tonight. False when the buddy is paused. */
    boolean tell(String text) throws Failure {
        try {
            byte[] body = post("/api/buddy/tell", new JSONObject().put("text", text));
            JSONObject data = new JSONObject(new String(body, StandardCharsets.UTF_8)).optJSONObject("data");
            return data == null || data.optBoolean("saved", true);
        } catch (JSONException e) {
            throw new Failure(Failure.BAD_DATA, 0, e);
        }
    }

    /**
     * Stage 19 (0.7.0): POST /api/ambient/later, Later on the widget's card. `tappedAt` (millis) is when he tapped, so a
     * tap kept while offline lands when the button said. Returns the server's answer ({id, at, label}).
     */
    JSONObject later(String id, long tappedAt, long shownAt) throws Failure {
        try {
            JSONObject body0 = new JSONObject().put("id", id).put("tappedAt", java.time.Instant.ofEpochMilli(tappedAt).toString());
            // 0.7.1: the time the button showed; the server keeps it while it still holds (the owner: "at the time shown").
            if (shownAt > 0) body0.put("at", java.time.Instant.ofEpochMilli(shownAt).toString());
            byte[] body = post("/api/ambient/later", body0);
            JSONObject data = new JSONObject(new String(body, StandardCharsets.UTF_8)).optJSONObject("data");
            return data == null ? new JSONObject() : data;
        } catch (JSONException e) {
            throw new Failure(Failure.BAD_DATA, 0, e);
        }
    }

    /** Stage 19: the home picture without the widget's item (`card=0`) while a widget is on a home screen. */
    private boolean withoutCard;

    Api withoutCard(boolean on) {
        withoutCard = on;
        return this;
    }

    /** Stage 11 (his item 10d): POST /api/phone/diagnostics, the phone's facts for the owner's People page. */
    void diagnostics(JSONObject facts) throws Failure {
        post("/api/phone/diagnostics", facts);
    }

    private byte[] post(String path, JSONObject body) throws Failure {
        return call("POST", path, "application/json", body.toString());
    }

    private byte[] call(String method, String path, String accept) throws Failure {
        return call(method, path, accept, method.equals("POST") ? "{}" : null);
    }

    private byte[] call(String method, String path, String accept, String json) throws Failure {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(server + path).openConnection();
            c.setRequestMethod(method);
            c.setConnectTimeout(10_000);
            c.setReadTimeout(25_000);
            c.setUseCaches(false);
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setRequestProperty("Accept", accept);
            c.setRequestProperty("User-Agent", "RecollectPhone/" + BuildConfig.VERSION);
            if (json != null) {
                byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int code = c.getResponseCode();
            if (code == 401) throw new Failure(Failure.REVOKED, code, null);
            if (code == 403) throw new Failure(Failure.FORBIDDEN, code, null);
            if (code < 200 || code >= 300) throw new Failure(Failure.SERVER, code, null);
            String icons = c.getHeaderField("X-Ambient-Icons");
            if (icons != null) lastIcons = icons;
            byte[] body;
            try (InputStream in = c.getInputStream()) {
                body = readAll(in);
            }
            // 0.5.2: a connection read to its end goes back to the pool and the next call reuses it (no new
            // secure handshake each time); only a failed one is closed.
            c = null;
            return body;
        } catch (IOException e) {
            throw new Failure(Failure.UNREACHABLE, 0, e);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        return out.toByteArray();
    }
}
