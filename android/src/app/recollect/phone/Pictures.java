package app.recollect.phone;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Calendar;

/**
 * Which picture shows now (ECOSYSTEM_V2_PLAN §4.13, stage 6; app 0.6.0): each screen has its picture with the
 * buddy's words and its plain twin. The words show only before their end time, outside quiet hours and while
 * the question they ask is not answered here (ShowRule); otherwise the plain twin. The app keeps all four
 * pictures in its files and sets itself an alarm for the next moment this changes, so it holds offline and
 * with or without the live wallpaper (without it, the alarm sets the plain picture as the wallpaper itself).
 */
public final class Pictures extends BroadcastReceiver {
    static final String ACTION_SWITCH = "app.recollect.phone.PICTURE_SWITCH";
    private static final String PREFS = "pictures";

    /** The kept pictures: the lock and home screen, each with the buddy's words and plain. */
    static final String LOCK = "pic-lock.png";
    static final String LOCK_PLAIN = "pic-lock-plain.png";
    static final String HOME = "pic-home.png";
    static final String HOME_PLAIN = "pic-home-plain.png";

    /** The alarm. */
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!ACTION_SWITCH.equals(intent.getAction())) return;
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                apply(ctx.getApplicationContext());
                DayWidget.updateAll(ctx.getApplicationContext());
                Asks.show(ctx.getApplicationContext(), Prefs.of(ctx).ambient());
            } finally {
                pending.finish();
            }
        }, "recollect-switch").start();
    }

    /** Keeps a screen's picture (`png` null: unchanged). */
    static void keep(Context ctx, String name, byte[] png) throws IOException {
        if (png == null) return;
        File to = new File(ctx.getFilesDir(), name);
        File tmp = new File(to.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(png);
        }
        if (!tmp.renameTo(to)) {
            to.delete();
            if (!tmp.renameTo(to)) throw new IOException("could not keep " + name);
        }
    }

    /** The lock screen's words may show now (the day as last read, this phone's quiet hours and answers). */
    static boolean lockWords(Context ctx, Ambient a, Calendar now) {
        if (a == null || a.line == null) return false;
        return ShowRule.wordsNow(now.getTimeInMillis(), a.lineUntil, Prefs.of(ctx).inQuietHours(now), Asks.answered(ctx, a.lineAskId));
    }

    /** The home screen's words (the buddy's thought) may show now. */
    static boolean homeWords(Context ctx, Ambient a, Calendar now) {
        if (a == null || !a.hasInsight) return false;
        return ShowRule.wordsNow(now.getTimeInMillis(), a.insightUntil, Prefs.of(ctx).inQuietHours(now), false);
    }

    /** The day has words from the buddy on this screen (the lock line, or the home thought). */
    static boolean hasWords(Ambient a, boolean lock) {
        return a != null && (lock ? a.line != null : a.hasInsight);
    }

    /**
     * The name of the picture a screen shows now: the plain twin only when the day has words there that may not
     * show now (and a plain one is kept); otherwise its own picture (on a day without words it is the plain one).
     */
    static String nameFor(Context ctx, boolean lock) {
        Ambient a = Prefs.of(ctx).ambient();
        Calendar now = Calendar.getInstance();
        boolean hide = hasWords(a, lock) && !(lock ? lockWords(ctx, a, now) : homeWords(ctx, a, now));
        String plain = lock ? LOCK_PLAIN : HOME_PLAIN;
        if (hide && new File(ctx.getFilesDir(), plain).exists()) return plain;
        return lock ? LOCK : HOME;
    }

    /**
     * Shows the right picture on each screen now and sets the alarm for the next change. The live wallpaper
     * redraws from the files; a plain system wallpaper is set again only when its variant changed.
     */
    static synchronized void apply(Context ctx) {
        Prefs p = Prefs.of(ctx);
        Ambient a = p.ambient();
        boolean live = p.lock() && p.live() && Live.active(ctx);
        if (live) Live.changed();
        else if (p.lock() || p.home()) {
            SharedPreferences s = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String lock = p.lock() ? nameFor(ctx, true) : null;
            String home = p.home() ? nameFor(ctx, false) : null;
            String shown = lock + "|" + home + "|" + p.pictureKey() + "|" + p.plainKey();
            if (!shown.equals(s.getString("shown", null))) {
                try {
                    if (home != null) set(ctx, home, true, false);
                    if (lock != null) set(ctx, lock, false, true);
                    s.edit().putString("shown", shown).apply();
                } catch (IOException | RuntimeException e) {
                    Log.i(Refresher.TAG, "picture switch failed: " + e.getClass().getSimpleName());
                }
            }
        }
        schedule(ctx, a, p);
    }

    private static void set(Context ctx, String name, boolean home, boolean lock) throws IOException {
        File f = new File(ctx.getFilesDir(), name);
        if (!f.exists()) return;
        Bitmap b = BitmapFactory.decodeFile(f.getPath());
        if (b == null) return;
        try {
            Wallpapers.set(ctx, b, home, lock);
        } finally {
            b.recycle();
        }
    }

    /** The alarm for the next moment a picture changes by itself (an end time, quiet hours starting or ending). */
    static void schedule(Context ctx, Ambient a, Prefs p) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return;
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 40, new Intent(ctx, Pictures.class).setAction(ACTION_SWITCH), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        long[] untils = a == null ? new long[0] : new long[a.asks.size() + 2];
        if (a != null) {
            untils[0] = a.lineUntil;
            untils[1] = a.insightUntil;
            for (int i = 0; i < a.asks.size(); i++) untils[i + 2] = a.asks.get(i).until;
        }
        long next = ShowRule.nextSwitch(Calendar.getInstance(), untils, p.quiet(), p.quietFrom(), p.quietTo());
        if (next == 0) {
            am.cancel(pi);
            return;
        }
        // Allowed while idle: the lock screen must be right the moment the screen turns on. Exact: an inexact alarm
        // may come as much as three quarters of its wait late (on his phone, 11-18: an end time 27 minutes away had a
        // 20-minute window), so words would stay long past their end time offline. Android 12 and later: exact only
        // with the system's permission (as the reminders), else inexact.
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
    }

    /** New pictures came: the next apply sets them even when the variant is the same. */
    static void forget(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("shown").apply();
    }

    /** Disconnect: the alarm and the kept pictures go. */
    static void clear(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am != null) am.cancel(PendingIntent.getBroadcast(ctx, 40, new Intent(ctx, Pictures.class).setAction(ACTION_SWITCH), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        for (String n : new String[] {LOCK, LOCK_PLAIN, HOME, HOME_PLAIN}) new File(ctx.getFilesDir(), n).delete();
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }
}
