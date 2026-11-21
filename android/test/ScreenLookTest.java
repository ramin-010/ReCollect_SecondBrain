package app.recollect.phone;

/**
 * Stage 11's pure rules on the PC (`node build.mjs --test`): each screen its own look, an update keeping the shared look,
 * the visible crop of a plain wallpaper, and the permissions checklist's verdicts.
 */
public final class ScreenLookTest {
    private static int passed;
    private static int failed;

    private static void check(String name, boolean ok) {
        if (ok) passed++;
        else failed++;
        System.out.println((ok ? "pass " : "FAIL ") + name);
    }

    private static boolean same(int[] a, int... b) {
        return java.util.Arrays.equals(a, b);
    }

    public static void main(String[] args) {
        // Each screen its own look; before one is chosen, the look both screens shared (an update keeps what he had).
        ScreenLook kept = ScreenLook.of(null, null, "glow", "amber");
        check("no look of its own: the shared one", "glow".equals(kept.style) && "amber".equals(kept.color));
        ScreenLook own = ScreenLook.of("peaks", "blue", "glow", "amber");
        check("its own look wins", "peaks".equals(own.style) && "blue".equals(own.color));
        ScreenLook ownNoColor = ScreenLook.of("peaks", null, "glow", "amber");
        check("its own style without a colour: the style's first, never the other screen's", "peaks".equals(ownNoColor.style) && ownNoColor.color == null);
        ScreenLook fresh = ScreenLook.of(null, null, null, null);
        check("nothing chosen anywhere: the sky", "sky".equals(fresh.style) && fresh.color == null);
        ScreenLook bad = ScreenLook.of("Not An Id!", "x y", "orb", "BAD");
        check("a stored value that isn't an id falls back", "orb".equals(bad.style) && bad.color == null);
        check("the key changes when only the home look changes", !ScreenLook.key(own, kept).equals(ScreenLook.key(own, own)));
        check("the key is the same for the same looks", ScreenLook.key(own, kept).equals(ScreenLook.key(ScreenLook.of("peaks", "blue", null, null), ScreenLook.of(null, null, "glow", "amber"))));

        // The visible part of a plain wallpaper: the picture drawn at the screen's size shows whole.
        check("crop: a picture at the screen's size shows whole", same(ScreenLook.cropHint(1080, 2340, 1080, 2340), 0, 0, 1080, 2340));
        check("crop: a wider picture shows its middle at the screen's shape", same(ScreenLook.cropHint(2160, 2340, 1080, 2340), 540, 0, 1620, 2340));
        check("crop: a taller picture shows its middle", same(ScreenLook.cropHint(1080, 2400, 1080, 1920), 0, 240, 1080, 2160));
        check("crop: an empty size is never a crash", same(ScreenLook.cropHint(0, 0, 1080, 2340), 0, 0, 0, 0));

        // The permissions checklist.
        check("exact alarms before Android 12: nothing to ask", ScreenLook.NOT_ASKED.equals(ScreenLook.exactAlarms(30, false)));
        check("exact alarms on 14, not allowed: needed", ScreenLook.NEEDED.equals(ScreenLook.exactAlarms(34, false)));
        check("exact alarms allowed: ok", ScreenLook.OK.equals(ScreenLook.exactAlarms(33, true)));
        check("notifications on 13+ without the permission: needed", ScreenLook.NEEDED.equals(ScreenLook.notifications(33, false, true)));
        check("notifications on 11, switched off for the app: needed", ScreenLook.NEEDED.equals(ScreenLook.notifications(30, true, false)));
        check("notifications on and allowed: ok", ScreenLook.OK.equals(ScreenLook.notifications(34, true, true)));
        check("battery optimised: needed", ScreenLook.NEEDED.equals(ScreenLook.battery(false)));
        check("auto-start on a realme: check it", ScreenLook.UNKNOWN.equals(ScreenLook.autoStart("realme")));
        check("auto-start on a Xiaomi (any case): check it", ScreenLook.UNKNOWN.equals(ScreenLook.autoStart(" Xiaomi ")));
        check("auto-start on a Pixel: nothing to ask", ScreenLook.NOT_ASKED.equals(ScreenLook.autoStart("Google")));

        System.out.println(passed + " passed, " + failed + " failed");
        if (failed > 0) System.exit(1);
    }
}
