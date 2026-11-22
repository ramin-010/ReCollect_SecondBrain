package app.recollect.phone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;

/**
 * 11-23 (the owner): a refresh when he looks at the phone. The 15-minute chain stays as it is; when the screen
 * comes on and the last good refresh is more than 5 minutes old, the day is read again (new pictures follow only
 * if something changed). Android delivers "screen on" only to a receiver registered by a running component, so
 * the two that run all day register one: the live wallpaper, and the notification listener (when he allowed it).
 */
final class ScreenOn {
    static final long STALE_MS = 5 * 60_000L;
    private static long lastTry;

    private ScreenOn() {}

    /** Pure: is a refresh due, given the last good refresh and the last try (ms)? */
    static boolean due(long now, long okAt, long lastTry) {
        return now - Math.max(okAt, lastTry) >= STALE_MS;
    }

    /** Reads the day again if it is stale; the caller's `after` runs on the refresh's thread once it is done. */
    static void check(Context ctx, Runnable after) {
        final Context app = ctx.getApplicationContext();
        Prefs p = Prefs.of(app);
        if (!p.connected()) return;
        synchronized (ScreenOn.class) {
            long now = System.currentTimeMillis();
            if (!due(now, p.okAt(), lastTry)) return;
            lastTry = now;
        }
        new Thread(() -> {
            Refresher.run(app, false);
            Live.decide(app);
            if (after != null) after.run();
        }, "recollect-screen-on").start();
    }

    /** A receiver for a component that runs all day (register in its start, unregister in its end). */
    static BroadcastReceiver register(Context ctx) {
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                if (Intent.ACTION_SCREEN_ON.equals(intent.getAction())) check(c, null);
            }
        };
        ctx.registerReceiver(r, new IntentFilter(Intent.ACTION_SCREEN_ON));
        return r;
    }

    static void unregister(Context ctx, BroadcastReceiver r) {
        if (r == null) return;
        try {
            ctx.unregisterReceiver(r);
        } catch (IllegalArgumentException ignored) {
            // never registered
        }
    }
}
