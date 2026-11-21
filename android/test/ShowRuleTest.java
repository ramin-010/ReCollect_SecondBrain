package app.recollect.phone;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * The pure rules of app 0.6.0 (ECOSYSTEM_V2_PLAN stage 6, "done when"): which picture now (the buddy's words or
 * the plain twin) and when the next switch is. Plain Java, run on the PC: `node build.mjs --test`.
 */
public final class ShowRuleTest {
    private static int passed;
    private static int failed;

    private static void check(String name, boolean ok) {
        if (ok) passed++;
        else failed++;
        System.out.println((ok ? "pass " : "FAIL ") + name);
    }

    /** 2026-11-16 at hh:mm in Kolkata. */
    private static Calendar at(int hh, int mm) {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Kolkata"));
        c.clear();
        c.set(2026, Calendar.NOVEMBER, 16, hh, mm, 0);
        return c;
    }

    private static long ms(int hh, int mm) {
        return at(hh, mm).getTimeInMillis();
    }

    public static void main(String[] args) {
        long now = ms(19, 0);
        // Which picture now.
        check("words before their end time", ShowRule.wordsNow(now, ms(22, 30), false, false));
        check("plain at their end time", !ShowRule.wordsNow(ms(22, 30), ms(22, 30), false, false));
        check("plain after it", !ShowRule.wordsNow(ms(23, 0), ms(22, 30), false, false));
        check("plain in quiet hours", !ShowRule.wordsNow(now, ms(22, 30), true, false));
        check("plain once answered on this phone", !ShowRule.wordsNow(now, ms(22, 30), false, true));
        check("no end time known (an older server): words", ShowRule.wordsNow(now, 0, false, false));
        // Quiet hours, across midnight or not.
        check("23:00-07:00 holds 23:30", ShowRule.inQuiet(23 * 60 + 30, 23 * 60, 7 * 60));
        check("23:00-07:00 holds 06:59", ShowRule.inQuiet(6 * 60 + 59, 23 * 60, 7 * 60));
        check("23:00-07:00 not 07:00", !ShowRule.inQuiet(7 * 60, 23 * 60, 7 * 60));
        check("13:00-14:00 holds 13:30", ShowRule.inQuiet(13 * 60 + 30, 13 * 60, 14 * 60));
        check("from == to: never quiet", !ShowRule.inQuiet(0, 600, 600));
        // When the next switch is.
        check("the earliest end time to come", ShowRule.nextSwitch(at(19, 0), new long[] {ms(22, 30), ms(21, 0)}, false, 0, 0) == ms(21, 0));
        check("an end time passed is not a switch", ShowRule.nextSwitch(at(19, 0), new long[] {ms(18, 0)}, false, 0, 0) == 0);
        check("quiet hours starting come first", ShowRule.nextSwitch(at(19, 0), new long[] {ms(23, 30)}, true, 23 * 60, 7 * 60) == ms(23, 0));
        check("in quiet hours: their end is the next switch", ShowRule.nextSwitch(at(23, 30), new long[] {}, true, 23 * 60, 7 * 60) == at(23, 30).getTimeInMillis() + (7 * 60 + 30) * 60_000L);
        check("quiet hours off: only end times", ShowRule.nextSwitch(at(19, 0), new long[] {ms(22, 30)}, false, 23 * 60, 7 * 60) == ms(22, 30));
        check("nothing to switch", ShowRule.nextSwitch(at(19, 0), new long[] {}, false, 0, 0) == 0);
        check("tomorrow's start when today's passed", ShowRule.nextAt(at(23, 30), 23 * 60) == at(23, 0).getTimeInMillis() + 86_400_000L);
        System.out.println(passed + "/" + (passed + failed) + " passed");
        if (failed > 0) System.exit(1);
    }
}
