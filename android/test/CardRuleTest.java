package app.recollect.phone;

/**
 * The widget's pure rules of app 0.7.0 (ECOSYSTEM_V2_PLAN stage 19, "done when"): the card's size by height, the Later
 * row, a Later tapped here (shown until its time), a tap the server could not take, the look. `node build.mjs --test`.
 */
public final class CardRuleTest {
    private static int passed;
    private static int failed;

    private static void check(String name, boolean ok) {
        if (ok) passed++;
        else failed++;
        System.out.println((ok ? "pass " : "FAIL ") + name);
    }

    public static void main(String[] args) {
        // The size by the launcher's height.
        check("4 x 1 is one row", CardRule.size(64) == CardRule.Size.ONE_ROW);
        check("99 dp is one row", CardRule.size(99) == CardRule.Size.ONE_ROW);
        check("110 dp (a 4 x 2 at its least) is short", CardRule.size(110) == CardRule.Size.SHORT);
        check("140 dp is the full card", CardRule.size(140) == CardRule.Size.FULL);
        check("a height not known is the full card", CardRule.size(0) == CardRule.Size.FULL);
        // The Later row.
        check("a card with a time: the button", CardRule.later(true, CardRule.Size.FULL, "Tonight · 8:30 pm", false) == CardRule.Later.BUTTON);
        check("the short card keeps the button", CardRule.later(true, CardRule.Size.SHORT, "Tomorrow · 9 am", false) == CardRule.Later.BUTTON);
        check("tapped here: set at once (offline too)", CardRule.later(true, CardRule.Size.FULL, "Tonight · 8:30 pm", true) == CardRule.Later.SET);
        check("no time left before its day: no button", CardRule.later(true, CardRule.Size.FULL, null, false) == CardRule.Later.NONE);
        check("one row: never a button", CardRule.later(true, CardRule.Size.ONE_ROW, "Tonight · 8:30 pm", false) == CardRule.Later.NONE);
        check("no card (the day's numbers): no button", CardRule.later(false, CardRule.Size.FULL, "Tonight · 8:30 pm", false) == CardRule.Later.NONE);
        // A Later tapped here.
        long now = 1_000_000_000_000L;
        check("its time ahead: shown", CardRule.markLive(now - 60_000, now + 3_600_000, now));
        check("its time passed: gone", !CardRule.markLive(now - 3_600_000, now - 1, now));
        check("time not known: shown for now", CardRule.markLive(now - 60_000, 0, now));
        check("two days old: gone", !CardRule.markLive(now - 2 * 86_400_000L - 1, 0, now));
        // A tap the server did not take.
        check("unreachable: kept for the next refresh", CardRule.keepAfterFailure(true, 0));
        check("the server's own failure: kept", CardRule.keepAfterFailure(false, 502));
        check("gone from their day (404): dropped", !CardRule.keepAfterFailure(false, 404));
        check("no time left (409): dropped", !CardRule.keepAfterFailure(false, 409));
        // The look from the app's page.
        check("Paper light", "paper".equals(CardRule.lookOfGround("#F5F0E6")));
        check("Paper dark", "paper".equals(CardRule.lookOfGround("#181613")));
        check("Slate light, any case", "slate".equals(CardRule.lookOfGround("#ffffff")));
        check("Slate dark", "slate".equals(CardRule.lookOfGround("#191919")));
        check("a colour it doesn't know keeps the last look", CardRule.lookOfGround("#123456") == null);
        System.out.println(passed + "/" + (passed + failed) + " passed");
        if (failed > 0) System.exit(1);
    }
}
