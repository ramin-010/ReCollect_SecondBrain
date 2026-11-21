package app.recollect.phone;

import java.util.Calendar;

/**
 * True when shown, on the phone (ECOSYSTEM_V2_PLAN §4.13, stage 6; app 0.6.0). The buddy's words show only
 * before their end time, outside quiet hours and while not answered on this phone; otherwise the plain
 * picture (the same day without them). The app sets itself an alarm for the next moment that changes, so this
 * holds offline and with or without the live wallpaper. Pure (no Android): tested on the PC
 * (android/test/ShowRuleTest.java, run by `node build.mjs --test`).
 */
final class ShowRule {
    private ShowRule() {}

    /** The words may show now: not past their end time (0: none known, an older server), not in quiet hours, not answered here. */
    static boolean wordsNow(long now, long until, boolean quiet, boolean answeredHere) {
        if (quiet || answeredHere) return false;
        return until <= 0 || now < until;
    }

    /** Is minute-of-day `m` inside quiet hours from..to (they may cross midnight; from == to: none)? */
    static boolean inQuiet(int m, int from, int to) {
        if (from == to) return false;
        return from < to ? (m >= from && m < to) : (m >= from || m < to);
    }

    /** The next time at minute-of-day `minute` after `now` (today's when still to come, else tomorrow's), in millis. */
    static long nextAt(Calendar now, int minute) {
        Calendar c = (Calendar) now.clone();
        c.set(Calendar.HOUR_OF_DAY, minute / 60);
        c.set(Calendar.MINUTE, minute % 60);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= now.getTimeInMillis()) c.add(Calendar.DAY_OF_MONTH, 1);
        return c.getTimeInMillis();
    }

    /**
     * The next moment a picture must change by itself: the earliest end time still to come, or quiet hours
     * starting or ending (when they are on); 0 when there is none.
     */
    static long nextSwitch(Calendar now, long[] untils, boolean quietOn, int from, int to) {
        long t = now.getTimeInMillis();
        long next = 0;
        for (long u : untils) if (u > t && (next == 0 || u < next)) next = u;
        if (quietOn && from != to) {
            long start = nextAt(now, from);
            long end = nextAt(now, to);
            if (next == 0 || start < next) next = start;
            if (end < next) next = end;
        }
        return next;
    }
}
