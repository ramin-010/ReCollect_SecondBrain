package app.recollect.phone;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/**
 * The updater's pure rules (PHONE_UPDATE_PLAN §3, app 0.9.0): whether a served build is newer, when to check and when to
 * tell, where the file may come from, its checksum, what an installer's answer means, and the words of "is ready". No
 * Android here: `node build.mjs --test` runs them on the PC.
 */
public final class UpdateRule {
    /** The background refresh checks at most every 12 hours (U4). */
    public static final long BACKGROUND_GAP_MS = 12 * 3_600_000L;
    /** Opening Today or Settings checks when the last check is over an hour old. */
    public static final long OPEN_GAP_MS = 3_600_000L;
    /** A release is well under 1 MB: a download past this is refused before it fills the phone. */
    public static final long MAX_BYTES = 64L * 1024 * 1024;

    // PackageInstaller's answers (android.content.pm.PackageInstaller.STATUS_*), kept here so their meaning is tested.
    public static final int STATUS_PENDING_USER_ACTION = -1;
    public static final int STATUS_SUCCESS = 0;
    public static final int STATUS_FAILURE = 1;
    public static final int STATUS_FAILURE_BLOCKED = 2;
    public static final int STATUS_FAILURE_ABORTED = 3;
    public static final int STATUS_FAILURE_INVALID = 4;
    public static final int STATUS_FAILURE_CONFLICT = 5;
    public static final int STATUS_FAILURE_STORAGE = 6;
    public static final int STATUS_FAILURE_INCOMPATIBLE = 7;

    private UpdateRule() {}

    /** Android installs an update only over a lower build number; the same or a lower one is no update. */
    public static boolean isNewer(long installedCode, long servedCode) {
        return servedCode > installedCode;
    }

    /** A check is due: never checked, the gap has passed, or the clock went back. */
    public static boolean checkDue(long lastCheckAt, long now, long gapMs) {
        return lastCheckAt <= 0 || now < lastCheckAt || now - lastCheckAt >= gapMs;
    }

    /** One notification per version (U3): newer, not told yet, notifications on, outside quiet hours, the app not on screen. */
    public static boolean shouldNotify(long installedCode, long servedCode, long notifiedCode, boolean notificationsOn, boolean quietNow, boolean appInFront) {
        return isNewer(installedCode, servedCode) && servedCode != notifiedCode && notificationsOn && !quietNow && !appInFront;
    }

    /**
     * The address of `path` on `server` (U5): a path, or a full address of the same origin; over https unless the server is
     * this computer or the home network. Anything else (another host, another scheme or port, plain http on the internet):
     * null.
     */
    public static String fileUrl(String server, String path) {
        if (server == null || path == null || path.trim().isEmpty()) return null;
        URI base;
        URI target;
        try {
            base = new URI(server.trim());
            target = base.resolve(path.trim());
        } catch (URISyntaxException | IllegalArgumentException e) {
            return null;
        }
        String scheme = lower(target.getScheme());
        String host = target.getHost();
        if (host == null || base.getHost() == null || !(scheme.equals("https") || scheme.equals("http"))) return null;
        if (!scheme.equals(lower(base.getScheme())) || !host.equalsIgnoreCase(base.getHost()) || port(target) != port(base)) return null;
        if (scheme.equals("http") && !Hosts.isLocal(host)) return null;
        return target.toString();
    }

    /** An address the page may give as the API's (an app not connected still checks): https, or http on the home network. */
    public static boolean usableBase(String api) {
        return api != null && fileUrl(api, "/") != null;
    }

    /** The file's SHA-256 as lowercase hex. */
    public static String sha256Hex(InputStream in) throws IOException {
        MessageDigest md;
        try {
            md = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
        byte[] buf = new byte[32 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) md.update(buf, 0, n);
        StringBuilder hex = new StringBuilder(64);
        for (byte b : md.digest()) hex.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return hex.toString();
    }

    /** What an installer's answer means for the page: null for a success or Android's own question, else an error code. */
    public static String errorOf(int status) {
        switch (status) {
            case STATUS_SUCCESS:
            case STATUS_PENDING_USER_ACTION:
                return null;
            case STATUS_FAILURE_ABORTED:
                return "aborted";
            case STATUS_FAILURE_BLOCKED:
                return "blocked";
            case STATUS_FAILURE_CONFLICT:
                return "conflict";
            case STATUS_FAILURE_STORAGE:
                return "storage";
            case STATUS_FAILURE_INCOMPATIBLE:
                return "incompatible";
            case STATUS_FAILURE_INVALID:
                return "invalid";
            default:
                return "failed";
        }
    }

    /** "Kaaga 0.9.1 is ready", or "A newer build of 0.9.0 is ready" when only the build number moved (U9). */
    public static String title(String appName, String installedVersion, String servedVersion) {
        String now = base(installedVersion);
        String next = base(servedVersion);
        return now.equals(next) ? "A newer build of " + next + " is ready" : appName + " " + next + " is ready";
    }

    /** "0.9.1-qa" is "0.9.1" in words. */
    static String base(String version) {
        if (version == null) return "";
        int dash = version.indexOf('-');
        return dash > 0 ? version.substring(0, dash) : version;
    }

    private static String lower(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }

    private static int port(URI u) {
        if (u.getPort() != -1) return u.getPort();
        return "https".equals(lower(u.getScheme())) ? 443 : 80;
    }
}
