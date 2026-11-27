package app.recollect.phone;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

/**
 * The updater's pure rules of app 0.9.0 (PHONE_UPDATE_PLAN §3): newer or not, when to check and tell, where the file may
 * come from, the checksum, what Android's answers mean, the words. `node build.mjs --test`.
 */
public final class UpdateRuleTest {
    private static int passed;
    private static int failed;

    private static void check(String name, boolean ok) {
        if (ok) passed++;
        else failed++;
        System.out.println((ok ? "pass " : "FAIL ") + name);
    }

    private static boolean same(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

    public static void main(String[] args) throws Exception {
        // Newer is a higher build number; the same or lower never is (Android refuses to go down).
        check("a higher build is newer", UpdateRule.isNewer(480_000, 480_001));
        check("the same build is not", !UpdateRule.isNewer(480_000, 480_000));
        check("a lower build is not", !UpdateRule.isNewer(480_000, 479_999));

        // When to check.
        long now = 1_000_000_000_000L;
        check("never checked: due", UpdateRule.checkDue(0, now, UpdateRule.BACKGROUND_GAP_MS));
        check("an hour ago, in the background: not due", !UpdateRule.checkDue(now - 3_600_000L, now, UpdateRule.BACKGROUND_GAP_MS));
        check("12 hours ago: due", UpdateRule.checkDue(now - UpdateRule.BACKGROUND_GAP_MS, now, UpdateRule.BACKGROUND_GAP_MS));
        check("opening the app: over an hour ago is due", UpdateRule.checkDue(now - 3_600_001L, now, UpdateRule.OPEN_GAP_MS));
        check("the clock went back: due", UpdateRule.checkDue(now + 60_000, now, UpdateRule.BACKGROUND_GAP_MS));

        // One notification per version.
        check("newer, not told, allowed: tell", UpdateRule.shouldNotify(1, 2, 0, true, false, false));
        check("told for this version already: not again", !UpdateRule.shouldNotify(1, 2, 2, true, false, false));
        check("a newer one after the last told: tell", UpdateRule.shouldNotify(1, 3, 2, true, false, false));
        check("notifications off: never", !UpdateRule.shouldNotify(1, 2, 0, false, false, false));
        check("quiet hours: it waits", !UpdateRule.shouldNotify(1, 2, 0, true, true, false));
        check("the app is open: its own row says it", !UpdateRule.shouldNotify(1, 2, 0, true, false, true));
        check("not newer: never", !UpdateRule.shouldNotify(2, 2, 0, true, false, false));

        // Where the file may come from.
        check("a path on the server", same(UpdateRule.fileUrl("https://api.kaaga.in", "/phone/kaaga.apk"), "https://api.kaaga.in/phone/kaaga.apk"));
        check("a full address of the same origin", same(UpdateRule.fileUrl("https://api.kaaga.in", "https://api.kaaga.in/phone/kaaga.apk"), "https://api.kaaga.in/phone/kaaga.apk"));
        check("the default port written out is the same origin", same(UpdateRule.fileUrl("https://api.kaaga.in", "https://api.kaaga.in:443/phone/kaaga.apk"), "https://api.kaaga.in:443/phone/kaaga.apk"));
        check("another host: refused", UpdateRule.fileUrl("https://api.kaaga.in", "https://evil.example/kaaga.apk") == null);
        check("a protocol-relative other host: refused", UpdateRule.fileUrl("https://api.kaaga.in", "//evil.example/kaaga.apk") == null);
        check("another port: refused", UpdateRule.fileUrl("https://api.kaaga.in", "https://api.kaaga.in:8443/kaaga.apk") == null);
        check("down to http on the internet: refused", UpdateRule.fileUrl("https://api.kaaga.in", "http://api.kaaga.in/phone/kaaga.apk") == null);
        check("plain http on the internet: refused", UpdateRule.fileUrl("http://api.kaaga.in", "/phone/kaaga.apk") == null);
        check("http over USB: allowed", same(UpdateRule.fileUrl("http://localhost:8002", "/phone/kaaga-qa.apk"), "http://localhost:8002/phone/kaaga-qa.apk"));
        check("http on the hotspot: allowed", same(UpdateRule.fileUrl("http://192.168.43.20:8002", "/phone/kaaga.json"), "http://192.168.43.20:8002/phone/kaaga.json"));
        check("not a web address: refused", UpdateRule.fileUrl("https://api.kaaga.in", "file:///sdcard/kaaga.apk") == null);
        check("no path: refused", UpdateRule.fileUrl("https://api.kaaga.in", "  ") == null);
        check("no server: refused", UpdateRule.fileUrl(null, "/phone/kaaga.apk") == null);
        check("the page's API address over https is usable", UpdateRule.usableBase("https://api.kaaga.in"));
        check("the laptop's over USB is usable", UpdateRule.usableBase("http://localhost:8002"));
        check("plain http on the internet is not", !UpdateRule.usableBase("http://api.kaaga.in"));
        check("an empty one is not", !UpdateRule.usableBase(""));

        // The checksum.
        String abc = UpdateRule.sha256Hex(new ByteArrayInputStream("abc".getBytes(StandardCharsets.UTF_8)));
        check("SHA-256 of abc", abc.equals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
        check("SHA-256 of nothing", UpdateRule.sha256Hex(new ByteArrayInputStream(new byte[0])).equals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));

        // Android's answers.
        check("its question: no error", UpdateRule.errorOf(UpdateRule.STATUS_PENDING_USER_ACTION) == null);
        check("success: no error", UpdateRule.errorOf(UpdateRule.STATUS_SUCCESS) == null);
        check("the person said no", same(UpdateRule.errorOf(UpdateRule.STATUS_FAILURE_ABORTED), "aborted"));
        check("another key", same(UpdateRule.errorOf(UpdateRule.STATUS_FAILURE_CONFLICT), "conflict"));
        check("no room", same(UpdateRule.errorOf(UpdateRule.STATUS_FAILURE_STORAGE), "storage"));
        check("blocked (a policy or Play Protect)", same(UpdateRule.errorOf(UpdateRule.STATUS_FAILURE_BLOCKED), "blocked"));
        check("an answer not known: failed", same(UpdateRule.errorOf(99), "failed"));

        // The words.
        check("a new version", UpdateRule.title("Kaaga", "0.9.0", "0.9.1").equals("Kaaga 0.9.1 is ready"));
        check("the QA app's", UpdateRule.title("Kaaga QA", "0.9.0-qa", "0.9.1-qa").equals("Kaaga QA 0.9.1 is ready"));
        check("only the build moved", UpdateRule.title("Kaaga", "0.9.0", "0.9.0").equals("A newer build of 0.9.0 is ready"));

        System.out.println("\nUpdateRuleTest: " + passed + " passed, " + failed + " failed");
        if (failed > 0) System.exit(1);
    }
}
