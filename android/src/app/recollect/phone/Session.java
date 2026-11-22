package app.recollect.phone;

import android.content.Context;
import android.net.Uri;

/**
 * The connection's small shared parts (0.7.3: they lived in the old settings screen, now gone): whether the app is on
 * screen, the web app's address for this phone, and forgetting a connection.
 */
final class Session {
    /** The app (the shell) is on screen: a note from the buddy then needs no notification. */
    static volatile boolean inFront;

    private Session() {}

    /**
     * The web app's address for this phone: the server names it; when it says localhost but the phone reaches the
     * server elsewhere (the hotspot), the same computer at that address.
     */
    static String appUrl(String appUrl, String server) {
        if (appUrl == null) return null;
        Uri app = Uri.parse(appUrl);
        Uri srv = server == null ? null : Uri.parse(server);
        String host = app.getHost();
        boolean loopback = "localhost".equals(host) || "127.0.0.1".equals(host);
        if (loopback && srv != null && srv.getHost() != null && !"localhost".equals(srv.getHost()) && !"127.0.0.1".equals(srv.getHost())) {
            String port = app.getPort() == -1 ? "" : ":" + app.getPort();
            return app.buildUpon().encodedAuthority(srv.getHost() + port).build().toString();
        }
        return appUrl;
    }

    /** The connection ends on this phone: no alarms for an account it no longer reads, no picture of it, no schedule. */
    static void forget(Context ctx) {
        Reminders.cancelAll(ctx);
        Prefs.of(ctx).disconnect();
        // The old settings screen's preview (before 0.7.3), if one is still there.
        new java.io.File(ctx.getFilesDir(), "preview.png").delete();
        Schedule.cancel(ctx);
        DayWidget.updateAll(ctx);
    }
}
