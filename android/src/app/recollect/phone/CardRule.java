package app.recollect.phone;

/**
 * The widget's pure rules (ECOSYSTEM_V2_PLAN stage 19, app 0.7.0): which size of the card fits, what the Later button
 * shows, how long a Later tapped on this phone counts, what happens to a tap the server could not take, and the look the
 * widget wears. Plain Java (no Android), run on the PC: `node build.mjs --test`.
 */
final class CardRule {
    private CardRule() {}

    /** The three layouts by the widget's height. */
    enum Size { ONE_ROW, SHORT, FULL }

    /** Below this height (dp) only one row fits: the label and the title. */
    static final int ONE_ROW_BELOW_DP = 100;
    /** Below this height (dp) the line under the title goes and the title keeps one line. */
    static final int SHORT_BELOW_DP = 140;
    /** A Later tapped here and not yet sent stays shown at most this long (its own time usually ends it first). */
    static final long MARK_MAX_MS = 2 * 86_400_000L;

    /** The size for a height the launcher gave (0: not known, the full card). */
    static Size size(int heightDp) {
        if (heightDp <= 0) return Size.FULL;
        if (heightDp < ONE_ROW_BELOW_DP) return Size.ONE_ROW;
        if (heightDp < SHORT_BELOW_DP) return Size.SHORT;
        return Size.FULL;
    }

    /** What the Later row shows. */
    enum Later { NONE, BUTTON, SET }

    /**
     * NONE: no card, the one-row widget, or no time left before the item's own day (the server sends no `later`);
     * SET: this phone already took a Later on this item (shown at once, offline too); else the BUTTON.
     */
    static Later later(boolean card, Size size, String laterLabel, boolean setHere) {
        if (!card || size == Size.ONE_ROW) return Later.NONE;
        if (setHere) return Later.SET;
        return laterLabel == null || laterLabel.isEmpty() ? Later.NONE : Later.BUTTON;
    }

    /** A Later tapped here still counts (its time is ahead; a time not known counts until the mark is two days old). */
    static boolean markLive(long tappedAt, long laterAt, long now) {
        if (now - tappedAt > MARK_MAX_MS) return false;
        return laterAt <= 0 || laterAt > now;
    }

    /** A tap the server did not take: kept for the next refresh when it could not be reached or failed itself; a refusal (gone, malformed, no time left) is final. */
    static boolean keepAfterFailure(boolean unreachable, int status) {
        return unreachable || status >= 500;
    }

    /** "paper" or "slate" from the ground colour the app's page sent (Shell.setBars), or null for a colour it doesn't know (the last look stays). */
    static String lookOfGround(String hex) {
        if (hex == null) return null;
        if ("#F5F0E6".equalsIgnoreCase(hex) || "#181613".equalsIgnoreCase(hex)) return "paper";
        if ("#FFFFFF".equalsIgnoreCase(hex) || "#191919".equalsIgnoreCase(hex)) return "slate";
        return null;
    }
}
