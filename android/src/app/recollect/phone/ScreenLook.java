package app.recollect.phone;

/**
 * The phone's pure rules of stage 11 (ECOSYSTEM_V2_PLAN, his decisions 4 and 10): each screen its own look (our design
 * in its own style and colour, or the person's own wallpaper), the visible part of a picture set as a plain wallpaper,
 * and the permissions checklist's verdicts. Plain Java (no Android), so `node build.mjs --test` runs them on the PC.
 */
final class ScreenLook {
    final String style;
    final String color;

    ScreenLook(String style, String color) {
        this.style = style;
        this.color = color;
    }

    /** A style or colour id as the server writes them (a few lowercase letters). */
    static boolean valid(String id) {
        return id != null && id.matches("[a-z]{1,20}");
    }

    /**
     * One screen's look: its own once one was chosen for it, else the look both screens shared before 0.7.x (so an
     * update keeps what the person had on both), else the sky. A colour that isn't an id falls back to the style's first.
     */
    static ScreenLook of(String screenStyle, String screenColor, String sharedStyle, String sharedColor) {
        if (valid(screenStyle)) return new ScreenLook(screenStyle, valid(screenColor) ? screenColor : null);
        return new ScreenLook(valid(sharedStyle) ? sharedStyle : "sky", valid(sharedColor) ? sharedColor : null);
    }

    /** What the pictures' key holds of the two looks: a change of either fetches that screen's picture again. */
    static String key(ScreenLook lock, ScreenLook home) {
        return lock.style + "/" + lock.color + "|" + home.style + "/" + home.color;
    }

    /**
     * The part of a picture the screen must show (setBitmap's visible crop hint): the middle of the picture at the
     * screen's own shape, so a launcher that scrolls or zooms never cuts the words at the sides. {left, top, right, bottom}.
     */
    static int[] cropHint(int pictureW, int pictureH, int screenW, int screenH) {
        if (pictureW <= 0 || pictureH <= 0 || screenW <= 0 || screenH <= 0) return new int[] {0, 0, Math.max(0, pictureW), Math.max(0, pictureH)};
        // The widest part at the screen's shape that fits in the picture.
        long wantW = (long) pictureH * screenW / screenH;
        if (wantW <= pictureW) {
            int w = (int) wantW;
            int left = (pictureW - w) / 2;
            return new int[] {left, 0, left + w, pictureH};
        }
        int h = (int) ((long) pictureW * screenH / screenW);
        int top = (pictureH - h) / 2;
        return new int[] {0, top, pictureW, top + h};
    }

    // ── The permissions checklist (his item 10c) ─────────────────────────────────────

    /** A permission's state: what the app needs, and whether the phone gives it. */
    static final String OK = "ok";
    static final String NEEDED = "needed";
    /** Not on this Android (older than the version that asks for it): nothing to do. */
    static final String NOT_ASKED = "not_asked";
    /** The phone doesn't tell apps (the maker's auto-start): the person checks it once. */
    static final String UNKNOWN = "unknown";

    /** Exact alarms: asked from Android 12 (API 31); reminders ring late without them. */
    static String exactAlarms(int sdk, boolean canSchedule) {
        if (sdk < 31) return NOT_ASKED;
        return canSchedule ? OK : NEEDED;
    }

    /** Notifications: a permission from Android 13 (API 33); before it, only the app's own switch in the system. */
    static String notifications(int sdk, boolean granted, boolean enabled) {
        if (sdk >= 33 && !granted) return NEEDED;
        return enabled ? OK : NEEDED;
    }

    /** Battery: the 15-minute refresh and the alarms run on time only when the app isn't optimised away. */
    static String battery(boolean ignoringOptimizations) {
        return ignoringOptimizations ? OK : NEEDED;
    }

    /** The makers that stop apps from starting by themselves unless the person allows it, by Build.MANUFACTURER. */
    static boolean makerLimitsAutoStart(String manufacturer) {
        if (manufacturer == null) return false;
        String m = manufacturer.trim().toLowerCase(java.util.Locale.ROOT);
        return m.equals("xiaomi") || m.equals("redmi") || m.equals("poco") || m.equals("oppo") || m.equals("realme") || m.equals("oneplus") || m.equals("vivo") || m.equals("iqoo") || m.equals("huawei") || m.equals("honor") || m.equals("samsung") || m.equals("asus") || m.equals("meizu") || m.equals("tecno") || m.equals("infinix") || m.equals("itel");
    }

    /** Auto-start: the phone never says; shown only on the makers that limit it. */
    static String autoStart(String manufacturer) {
        return makerLimitsAutoStart(manufacturer) ? UNKNOWN : NOT_ASKED;
    }
}
