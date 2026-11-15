package app.recollect.phone;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;

/** What the app keeps: the connection (the token sealed by Vault), his choices, the last day it read. */
final class Prefs {
    static final String THEME_LIGHT = "light";
    static final String THEME_DARK = "dark";
    static final String THEME_SYSTEM = "system";

    private final SharedPreferences sp;

    private Prefs(Context ctx) {
        sp = ctx.getApplicationContext().getSharedPreferences("recollect", Context.MODE_PRIVATE);
    }

    static Prefs of(Context ctx) {
        return new Prefs(ctx);
    }

    // ── The connection ────────────────────────────────────────────────────────────────

    String server() {
        return sp.getString("server", null);
    }

    /** The plain token, or null (not connected, or the keystore can't open it). */
    String token() {
        return Vault.open(sp.getString("token", null));
    }

    boolean connected() {
        return server() != null && sp.contains("token");
    }

    void connect(String server, String token) {
        sp.edit().putString("server", server).putString("token", Vault.seal(token)).remove("failure").remove("failure_at").remove("picture_key").apply();
    }

    /** Forgets the server's side; his choices (screens, theme, quiet hours) stay for next time. */
    void disconnect() {
        sp.edit().remove("server").remove("token").remove("ambient").remove("ok_at").remove("failure").remove("failure_at").remove("picture_key").apply();
    }

    // ── His choices ───────────────────────────────────────────────────────────────────

    /** The lock screen is where the picture helps most (no icons over it): on by default. */
    boolean lock() {
        return sp.getBoolean("lock", true);
    }

    /** The home screen has the widget for the same lines: off by default. */
    boolean home() {
        return sp.getBoolean("home", false);
    }

    void setLock(boolean on) {
        sp.edit().putBoolean("lock", on).remove("picture_key").apply();
    }

    void setHome(boolean on) {
        sp.edit().putBoolean("home", on).remove("picture_key").apply();
    }

    String theme() {
        return sp.getString("theme", THEME_SYSTEM);
    }

    void setTheme(String theme) {
        sp.edit().putString("theme", theme).apply();
    }

    boolean quiet() {
        return sp.getBoolean("quiet", true);
    }

    void setQuiet(boolean on) {
        sp.edit().putBoolean("quiet", on).apply();
    }

    /** Minutes after midnight; 23:00 to 07:00 by default. */
    int quietFrom() {
        return sp.getInt("quiet_from", 23 * 60);
    }

    int quietTo() {
        return sp.getInt("quiet_to", 7 * 60);
    }

    void setQuietTimes(int from, int to) {
        sp.edit().putInt("quiet_from", from).putInt("quiet_to", to).apply();
    }

    boolean hideTitles() {
        return sp.getBoolean("hide_titles", false);
    }

    void setHideTitles(boolean on) {
        sp.edit().putBoolean("hide_titles", on).apply();
    }

    /** He ticked "Keep a copy of my wallpaper" when connecting. */
    boolean keepCopy() {
        return sp.getBoolean("keep_copy", false);
    }

    void setKeepCopy(boolean on) {
        sp.edit().putBoolean("keep_copy", on).apply();
    }

    boolean inQuietHours(Calendar now) {
        return quiet() && Schedule.inQuiet(now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE), quietFrom(), quietTo());
    }

    // ── What it last read ─────────────────────────────────────────────────────────────

    void saveAmbient(JSONObject data, long at) {
        sp.edit().putString("ambient", data.toString()).putLong("ok_at", at).remove("failure").remove("failure_at").apply();
    }

    /** The last day it read, or null. */
    Ambient ambient() {
        String raw = sp.getString("ambient", null);
        if (raw == null) return null;
        try {
            return Ambient.parse(new JSONObject(raw));
        } catch (JSONException e) {
            return null;
        }
    }

    long okAt() {
        return sp.getLong("ok_at", 0);
    }

    void saveFailure(String text, long at) {
        sp.edit().putString("failure", text).putLong("failure_at", at).apply();
    }

    /** The last problem, worded for him, or null when the last try worked. */
    String failure() {
        return sp.getString("failure", null);
    }

    String pictureKey() {
        return sp.getString("picture_key", null);
    }

    void setPictureKey(String key) {
        sp.edit().putString("picture_key", key).apply();
    }
}
