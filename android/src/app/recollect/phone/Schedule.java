package app.recollect.phone;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

import java.util.Calendar;

/**
 * When the picture refreshes: every 15 minutes while he is awake (0.5.1: was half an hour, so a reminder
 * reaches the phone sooner), and on the day's turns exactly (just
 * after midnight for the new date, noon and 18:00, when the server's states change: morning, working,
 * evening). Quiet hours wait for their end. One chained job (RefreshJob schedules the next), persisted
 * across restarts; a refresh that can't reach the server leaves everything as it was.
 */
final class Schedule {
    static final int JOB_ID = 1;
    /** Minutes between refreshes while awake. */
    static final int EVERY = 15;
    /** The day's turns, in minutes after midnight. */
    private static final int[] TURNS = {1, 12 * 60, 18 * 60};

    private Schedule() {}

    /** Is minute-of-day `m` inside quiet hours from..to (which may wrap past midnight)? Equal ends mean none. */
    static boolean inQuiet(int m, int from, int to) {
        if (from == to) return false;
        return from < to ? (m >= from && m < to) : (m >= from || m < to);
    }

    /** Minutes from `m` forward to minute-of-day `target` (1..1440; never 0). */
    static int until(int m, int target) {
        int d = ((target - m) % 1440 + 1440) % 1440;
        return d == 0 ? 1440 : d;
    }

    /** Pure: minutes until the next refresh, from minute-of-day `m`. */
    static int nextInMinutes(int m, boolean quiet, int from, int to) {
        int next = EVERY;
        for (int t : TURNS) next = Math.min(next, until(m, t));
        if (quiet && from != to && inQuiet((m + next) % 1440, from, to)) {
            // Asleep: the next one is the end of quiet hours (a minute after, so the morning shows).
            next = until(m, (to + 1) % 1440);
        }
        return next;
    }

    static void next(Context ctx) {
        Prefs p = Prefs.of(ctx);
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        if (js == null) return;
        if (!p.connected()) {
            js.cancel(JOB_ID);
            return;
        }
        Calendar now = Calendar.getInstance();
        int m = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        long delay = nextInMinutes(m, p.quiet(), p.quietFrom(), p.quietTo()) * 60_000L - now.get(Calendar.SECOND) * 1000L;
        js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(ctx, RefreshJob.class))
                .setMinimumLatency(Math.max(30_000L, delay))
                // Runs by then even without a network (it then fails quietly and tries the next turn).
                .setOverrideDeadline(Math.max(30_000L, delay) + 15 * 60_000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build());
    }

    /** Schedules the next refresh unless one is already waiting. */
    static void ensure(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        if (js == null) return;
        if (js.getPendingJob(JOB_ID) == null) next(ctx);
    }

    static void cancel(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        if (js != null) js.cancel(JOB_ID);
    }
}
