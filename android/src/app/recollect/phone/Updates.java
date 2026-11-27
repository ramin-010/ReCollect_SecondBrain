package app.recollect.phone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The app updates itself from its server (PHONE_UPDATE_PLAN §3, app 0.9.0). It asks the server what its release is
 * (`/phone/kaaga.json`, the QA app `/phone/kaaga-qa.json`), tells the person once per version, and on their tap downloads
 * the file, checks its SHA-256, that it is this app and a higher build, and hands it to Android's own installer, which
 * asks them to confirm. Android refuses a file signed with another key, so the server can't replace the app with
 * another. The pure rules are in UpdateRule.
 *
 * As a receiver it takes the installer's answer (its PendingIntent is ours alone: not exported).
 */
public final class Updates extends BroadcastReceiver {
    static final String CHANNEL = "app_updates";
    private static final int READY_ID = 41;
    private static final int INSTALL_ID = 42;
    private static final String ACTION_STATUS = "app.recollect.phone.UPDATE_STATUS";

    /** What runs now, for the page (the bridge reads it): idle, checking, downloading, installing or failed. */
    static volatile String stage = "idle";
    static volatile int progress;
    /** After a failure: a code the page words (UpdateRule.errorOf, or the steps before Android: offline, damaged…). */
    static volatile String error;
    /** Told after every step: the shell turns it into a "changed" event for the page. */
    static volatile Runnable listener;

    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();

    private static final class Failed extends Exception {
        final String code;

        Failed(String code) {
            super(code);
            this.code = code;
        }
    }

    private static SharedPreferences sp(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences("updates", Context.MODE_PRIVATE);
    }

    private static void tell() {
        Runnable l = listener;
        if (l != null) l.run();
    }

    /** The release description this app reads. */
    private static String releasePath() {
        return BuildConfig.QA ? "/phone/kaaga-qa.json" : "/phone/kaaga.json";
    }

    /** Where to ask: the connected server, else the API address the page gave last (an app not connected still checks). */
    static String base(Context ctx) {
        String server = Prefs.of(ctx).server();
        return server != null ? server : sp(ctx).getString("api", null);
    }

    /** The page's API address, kept when the app may use it (https, or http on the home network). */
    static void setApi(Context ctx, String api) {
        if (api == null) return;
        String clean = api.trim().replaceAll("/+$", "");
        if (UpdateRule.usableBase(clean)) sp(ctx).edit().putString("api", clean).apply();
    }

    /** The server's last answer about this app's release, or null (none, or not this app's). */
    static JSONObject latest(Context ctx) {
        String raw = sp(ctx).getString("latest", null);
        if (raw == null) return null;
        try {
            JSONObject r = new JSONObject(raw);
            return ctx.getPackageName().equals(r.optString("package")) ? r : null;
        } catch (JSONException e) {
            return null;
        }
    }

    static long checkedAt(Context ctx) {
        return sp(ctx).getLong("checked_at", 0);
    }

    // ── Checking ──────────────────────────────────────────────────────────────────────

    /** Asks the server now (never on the main thread). False when it couldn't be asked; the last answer then stays. */
    static boolean check(Context ctx) {
        String base = base(ctx);
        String url = base == null ? null : UpdateRule.fileUrl(base, releasePath());
        if (url == null) return false;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(10_000);
            c.setReadTimeout(15_000);
            c.setUseCaches(false);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "KaagaPhone/" + BuildConfig.VERSION);
            int code = c.getResponseCode();
            SharedPreferences.Editor e = sp(ctx).edit().putLong("checked_at", System.currentTimeMillis());
            if (code == 404) {
                // No release on this server: nothing to offer.
                e.remove("latest").apply();
                return true;
            }
            if (code != 200) return false;
            byte[] body;
            try (InputStream in = c.getInputStream()) {
                body = readAll(in, 64 * 1024);
            }
            JSONObject data = new JSONObject(new String(body, StandardCharsets.UTF_8)).getJSONObject("data");
            // Another package's release (the QA app reading the real app's, or the other way round) is no update.
            if (!ctx.getPackageName().equals(data.optString("package")) || data.optLong("versionCode") <= 0) e.remove("latest");
            else e.putString("latest", data.toString());
            e.apply();
            return true;
        } catch (IOException | JSONException ex) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** "Check now" and opening the app: on the updates thread, then the page is told. `ifOlderMs` > 0 skips a fresh answer. */
    static void checkSoon(Context ctx, long ifOlderMs) {
        final Context app = ctx.getApplicationContext();
        if (ifOlderMs > 0 && !UpdateRule.checkDue(checkedAt(app), System.currentTimeMillis(), ifOlderMs)) return;
        if (!"downloading".equals(stage) && !"installing".equals(stage)) {
            stage = "checking";
            tell();
        }
        WORK.execute(() -> {
            check(app);
            if ("checking".equals(stage)) stage = "idle";
            tell();
        });
    }

    /** From the background refresh: a check when 12 hours have passed, then the notification for a newer version. */
    static void maybeCheck(Context ctx) {
        if (UpdateRule.checkDue(checkedAt(ctx), System.currentTimeMillis(), UpdateRule.BACKGROUND_GAP_MS)) check(ctx);
        maybeNotify(ctx);
    }

    /** One silent notification per version (U3): never in quiet hours, never while the app is on screen. */
    static void maybeNotify(Context ctx) {
        JSONObject r = latest(ctx);
        if (r == null) return;
        long served = r.optLong("versionCode");
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        boolean allowed = nm != null && nm.areNotificationsEnabled();
        boolean quiet = Prefs.of(ctx).inQuietHours(Calendar.getInstance());
        if (!UpdateRule.shouldNotify(BuildConfig.VERSION_CODE, served, sp(ctx).getLong("notified", 0), allowed, quiet, Session.inFront)) return;
        channel(ctx, nm);
        String title = UpdateRule.title(ctx.getString(R.string.app_name), BuildConfig.VERSION, r.optString("version"));
        Intent open = new Intent(ctx, Shell.class).putExtra(Shell.EXTRA_PAGE, "/m/settings").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        Notification n = new Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_buddy)
                .setColor(ctx.getColor(R.color.accent_fill))
                .setContentTitle(title)
                .setContentText(ctx.getString(R.string.update_ready_text))
                .setContentIntent(PendingIntent.getActivity(ctx, READY_ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .build();
        nm.notify(READY_ID, n);
        sp(ctx).edit().putLong("notified", served).apply();
    }

    private static void channel(Context ctx, NotificationManager nm) {
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel c = new NotificationChannel(CHANNEL, ctx.getString(R.string.update_channel_name), NotificationManager.IMPORTANCE_LOW);
        c.setDescription(ctx.getString(R.string.update_channel_description));
        c.setShowBadge(false);
        nm.createNotificationChannel(c);
    }

    /** Today's row: the × hides this version there (Settings keeps it; the next version shows again). */
    static void hide(Context ctx) {
        JSONObject r = latest(ctx);
        if (r != null) sp(ctx).edit().putLong("hidden", r.optLong("versionCode")).apply();
    }

    // ── Installing ────────────────────────────────────────────────────────────────────

    /** The person tapped Update: download, check, hand it to Android (on the updates thread). */
    static void start(Context ctx) {
        final Context app = ctx.getApplicationContext();
        if ("downloading".equals(stage) || "installing".equals(stage)) return;
        stage = "downloading";
        progress = 0;
        error = null;
        tell();
        WORK.execute(() -> {
            try {
                install(app);
            } catch (Failed f) {
                fail(f.code);
            }
        });
    }

    private static void fail(String code) {
        // "No" in Android's dialog is the person's answer, not a problem: the row offers Update again, without words.
        boolean declined = "aborted".equals(code);
        stage = declined ? "idle" : "failed";
        error = declined ? null : code;
        progress = 0;
        tell();
    }

    private static void install(Context app) throws Failed {
        JSONObject r = latest(app);
        if (r == null) throw new Failed("no_release");
        long code = r.optLong("versionCode");
        if (!UpdateRule.isNewer(BuildConfig.VERSION_CODE, code)) throw new Failed("not_newer");
        String base = base(app);
        String url = base == null ? null : UpdateRule.fileUrl(base, r.optString("url"));
        if (url == null) throw new Failed("no_release");
        if (!app.getPackageManager().canRequestPackageInstalls()) throw new Failed("not_allowed");
        File dir = new File(app.getCacheDir(), "updates");
        File file = new File(dir, "kaaga-" + code + ".apk");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new Failed("storage");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) if (!f.equals(file)) f.delete();
        download(url, file, r.optLong("size"));
        boolean intact;
        try (InputStream in = new FileInputStream(file)) {
            intact = UpdateRule.sha256Hex(in).equalsIgnoreCase(r.optString("sha256"));
        } catch (IOException e) {
            intact = false;
        }
        if (!intact) {
            // A damaged file goes; a good one stays until Android has it.
            file.delete();
            throw new Failed("damaged");
        }
        PackageInfo info = app.getPackageManager().getPackageArchiveInfo(file.getPath(), 0);
        if (info == null || !app.getPackageName().equals(info.packageName)) {
            file.delete();
            throw new Failed("not_this_app");
        }
        @SuppressWarnings("deprecation")
        long fileCode = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        if (!UpdateRule.isNewer(BuildConfig.VERSION_CODE, fileCode)) {
            file.delete();
            throw new Failed("not_newer");
        }
        stage = "installing";
        progress = 100;
        tell();
        PackageInstaller installer = app.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(app.getPackageName());
        params.setSize(file.length());
        // Android 12+: the person's tap on Update is the consent; Android may skip its own dialog for an app updating itself.
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id;
        try {
            id = installer.createSession(params);
        } catch (IOException | RuntimeException e) {
            throw new Failed("storage");
        }
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (OutputStream out = session.openWrite("kaaga.apk", 0, file.length()); InputStream in = new FileInputStream(file)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent status = new Intent(app, Updates.class).setAction(ACTION_STATUS).putExtra("version", r.optString("version"));
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            session.commit(PendingIntent.getBroadcast(app, id, status, flags).getIntentSender());
        } catch (IOException | RuntimeException e) {
            try {
                installer.abandonSession(id);
            } catch (RuntimeException ignored) {
                // already gone
            }
            throw new Failed("failed");
        }
    }

    private static void download(String url, File file, long expected) throws Failed {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(10_000);
            c.setReadTimeout(30_000);
            c.setUseCaches(false);
            // The same server's file only: a redirect elsewhere is not followed.
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", "KaagaPhone/" + BuildConfig.VERSION);
            if (c.getResponseCode() != 200) throw new Failed("download");
            long total = c.getContentLengthLong() > 0 ? c.getContentLengthLong() : expected;
            long got = 0;
            int shown = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(file)) {
                byte[] buf = new byte[32 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    got += n;
                    if (got > UpdateRule.MAX_BYTES) throw new Failed("download");
                    int pct = total > 0 ? (int) Math.min(99, got * 100 / total) : 0;
                    if (pct >= shown + 3) {
                        shown = pct;
                        progress = pct;
                        tell();
                    }
                }
            }
            if (expected > 0 && got != expected) throw new Failed("damaged");
        } catch (IOException e) {
            file.delete();
            throw new Failed("offline");
        } catch (Failed f) {
            file.delete();
            throw f;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    // ── Android's answer ──────────────────────────────────────────────────────────────

    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context ctx, Intent intent) {
        if (!ACTION_STATUS.equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class) : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm == null) {
                fail("failed");
                return;
            }
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (Session.inFront) {
                try {
                    ctx.startActivity(confirm);
                    return;
                } catch (RuntimeException ignored) {
                    // the notification below carries it
                }
            }
            // Not on screen (the person left while it downloaded): a notification carries Android's question.
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm == null) return;
            channel(ctx, nm);
            String version = UpdateRule.base(intent.getStringExtra("version"));
            Notification n = new Notification.Builder(ctx, CHANNEL)
                    .setSmallIcon(R.drawable.ic_stat_buddy)
                    .setColor(ctx.getColor(R.color.accent_fill))
                    .setContentTitle(ctx.getString(R.string.update_downloaded_title, ctx.getString(R.string.app_name), version))
                    .setContentText(ctx.getString(R.string.update_downloaded_text))
                    .setContentIntent(PendingIntent.getActivity(ctx, INSTALL_ID, confirm, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                    .setAutoCancel(true)
                    .build();
            nm.notify(INSTALL_ID, n);
            return;
        }
        String code = UpdateRule.errorOf(status);
        if (code == null) {
            stage = "idle";
            tell();
        } else fail(code);
    }

    /** After the app was replaced (Wake, MY_PACKAGE_REPLACED): the downloaded file and the update's notifications go. */
    static void afterUpdate(Context ctx) {
        File[] files = new File(ctx.getCacheDir(), "updates").listFiles();
        if (files != null) for (File f : files) f.delete();
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.cancel(READY_ID);
            nm.cancel(INSTALL_ID);
        }
    }

    // ── For the page ──────────────────────────────────────────────────────────────────

    /** What the page shows (the bridge's state().update). */
    static JSONObject state(Context ctx) throws JSONException {
        JSONObject r = latest(ctx);
        long served = r == null ? 0 : r.optLong("versionCode");
        boolean available = r != null && UpdateRule.isNewer(BuildConfig.VERSION_CODE, served);
        JSONObject o = new JSONObject()
                .put("available", available)
                .put("checkedAt", checkedAt(ctx))
                .put("stage", stage)
                .put("progress", progress)
                .put("error", error == null ? JSONObject.NULL : error)
                .put("canInstall", ctx.getPackageManager().canRequestPackageInstalls())
                .put("hidden", available && sp(ctx).getLong("hidden", 0) == served);
        if (available) {
            JSONArray notes = r.optJSONArray("notes");
            o.put("version", r.optString("version")).put("versionCode", served).put("size", r.optLong("size")).put("notes", notes == null ? new JSONArray() : notes);
        }
        return o;
    }

    private static byte[] readAll(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
            if (out.size() > max) throw new IOException("too long");
        }
        return out.toByteArray();
    }
}
