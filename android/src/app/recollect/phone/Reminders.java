package app.recollect.phone;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Reminders ring on the phone (app 0.5.0; the owner 11-16: "if the phone does it, I'm good; we don't need
 * the email"). After each refresh the app sets one exact alarm per reminder still to come (the widget
 * JSON's `alarms`: the next 26 hours), drops the ones it set before that are gone, and tells the server
 * which ones it holds, so no email goes for those. At the time ReminderAlarm posts a notification with
 * sound; nothing is fetched then (the server's database stays asleep). Alarms don't survive a reboot:
 * Wake sets them again from the saved list.
 */
final class Reminders {
    static final String CHANNEL = "reminders";
    static final String EXTRA_ID = "id";
    static final String EXTRA_TEXT = "text";

    private Reminders() {}

    /** One reminder to ring: its id, its time (epoch ms) and its words. */
    static final class Alarm {
        final String id;
        final long at;
        final String text;

        Alarm(String id, long at, String text) {
            this.id = id;
            this.at = at;
            this.text = text;
        }
    }

    private static long parseIso(String iso) {
        // "2026-11-16T13:00:00.000Z" (the server's toISOString)
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            return f.parse(iso).getTime();
        } catch (ParseException | NullPointerException e) {
            return -1;
        }
    }

    /** The widget JSON's `alarms` ([{ id, when, text }]); bad ones are skipped. */
    static List<Alarm> parse(JSONArray arr) {
        List<Alarm> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length() && out.size() < 20; i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            String id = o.optString("id", "");
            long at = o.has("at") ? o.optLong("at", -1) : parseIso(o.optString("when", ""));
            String text = o.optString("text", "").trim();
            if (!id.isEmpty() && at > 0) out.add(new Alarm(id, at, text.isEmpty() ? null : text));
        }
        return out;
    }

    private static JSONArray toJson(List<Alarm> alarms) {
        JSONArray a = new JSONArray();
        for (Alarm x : alarms) {
            try {
                a.put(new JSONObject().put("id", x.id).put("at", x.at).put("text", x.text == null ? "" : x.text));
            } catch (JSONException ignored) {
                // a reminder the JSON can't hold: it isn't saved for a reboot
            }
        }
        return a;
    }

    /** The intent of one reminder's alarm: unique by its id (the data URI), so it can be cancelled alone. */
    static PendingIntent intent(Context ctx, String id, String text, int flags) {
        Intent i = new Intent(ctx, ReminderAlarm.class).setData(Uri.parse("recollect://reminder/" + Uri.encode(id)));
        if (text != null) i.putExtra(EXTRA_TEXT, text);
        i.putExtra(EXTRA_ID, id);
        return PendingIntent.getBroadcast(ctx, 0, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancelIds(Context ctx, AlarmManager am, List<String> ids) {
        for (String id : ids) {
            PendingIntent pi = intent(ctx, id, null, PendingIntent.FLAG_NO_CREATE);
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        }
    }

    /**
     * Sets an alarm for each reminder still to come (cancelling the ones set before), saves the list for
     * a reboot, and answers the ids now held (sorted, so a caller can tell whether they changed).
     */
    static List<String> schedule(Context ctx, List<Alarm> alarms) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        Prefs p = Prefs.of(ctx);
        List<String> held = new ArrayList<>();
        if (am == null) return held;
        cancelIds(ctx, am, idsOf(p.alarmsJson()));
        long now = System.currentTimeMillis();
        List<Alarm> kept = new ArrayList<>();
        // Exact on Android 11 and below (his phone); from 12 only when the system allows it, else close to the time.
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        // Alarm-clock mode (the owner, 11-21): booked as a user's alarm, so no battery saver delays it, the status bar
        // shows the alarm icon and "Next alarm" shows its time; tapping that opens the app.
        PendingIntent show = PendingIntent.getActivity(ctx, 7, new Intent(ctx, Shell.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        for (Alarm a : alarms) {
            if (a.at <= now) continue;
            PendingIntent pi = intent(ctx, a.id, a.text, PendingIntent.FLAG_UPDATE_CURRENT);
            if (exact) am.setAlarmClock(new AlarmManager.AlarmClockInfo(a.at, show), pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, a.at, pi);
            kept.add(a);
            held.add(a.id);
        }
        p.saveAlarms(toJson(kept).toString());
        Collections.sort(held);
        return held;
    }

    /** Ring for reminders turned off (or a disconnect): every alarm the app set goes. */
    static void cancelAll(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        Prefs p = Prefs.of(ctx);
        if (am != null) cancelIds(ctx, am, idsOf(p.alarmsJson()));
        p.saveAlarms("[]");
        p.setAlarmsAcked("");
    }

    /** After a reboot or an update: the saved alarms again, with no network. */
    static void rearm(Context ctx) {
        Prefs p = Prefs.of(ctx);
        if (!p.connected() || !p.remindersOn()) return;
        try {
            schedule(ctx, parse(new JSONArray(p.alarmsJson())));
        } catch (JSONException ignored) {
            // nothing saved: the next refresh sets them
        }
    }

    private static List<String> idsOf(String json) {
        List<String> ids = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(json);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && !o.optString("id", "").isEmpty()) ids.add(o.optString("id"));
            }
        } catch (JSONException ignored) {
            // nothing saved
        }
        return ids;
    }

    /** At the time: the notification, on its own channel (heads-up, sound, vibration); its words hidden on a locked screen. */
    static void ring(Context ctx, String id, String text) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return;
        channel(ctx, nm);
        String title = ctx.getString(R.string.reminder_title);
        String body = text == null || text.isEmpty() ? ctx.getString(R.string.reminder_plain) : text;
        Intent open = new Intent(ctx, Shell.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        Notification publicVersion = new Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_buddy)
                .setContentTitle(title)
                .setContentText(ctx.getString(R.string.reminder_plain))
                .build();
        Notification n = new Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_buddy)
                .setColor(ctx.getColor(R.color.accent_fill))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion)
                .setContentIntent(PendingIntent.getActivity(ctx, 4, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setAutoCancel(true)
                .build();
        nm.notify(("reminder:" + id).hashCode(), n);
    }

    static void channel(Context ctx, NotificationManager nm) {
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel c = new NotificationChannel(CHANNEL, ctx.getString(R.string.reminder_channel), NotificationManager.IMPORTANCE_HIGH);
        c.setDescription(ctx.getString(R.string.reminder_channel_description));
        c.enableVibration(true);
        c.setShowBadge(true);
        nm.createNotificationChannel(c);
    }
}
