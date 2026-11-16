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

    /** GET /api/ambient/widget → its `data`. */
    JSONObject widget(boolean titles) throws Failure {
        byte[] body = call("GET", "/api/ambient/widget" + (titles ? "" : "?titles=0"), "application/json");
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
        String q = "?w=" + width + "&h=" + height + "&theme=" + theme + (titles ? "" : "&titles=0") + "&screen=" + screen
                + (style == null ? "" : "&style=" + style) + (color == null ? "" : "&color=" + color)
                + (zoom > 1.001f ? "&zoom=" + String.format(java.util.Locale.ROOT, "%.3f", zoom) : "");
        return call("GET", "/api/ambient/wallpaper.png" + q, "image/png");
    }

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
            try (InputStream in = c.getInputStream()) {
                return readAll(in);
            }
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
