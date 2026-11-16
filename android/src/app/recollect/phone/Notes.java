package app.recollect.phone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/**
 * One notification when the buddy leaves a new note (BUDDY_MEMORY_PLAN §3.4, app 0.3.0): never in
 * quiet hours, at most two a day, never for a note he already read on the app's screen. A notification
 * shows on the lock screen too, so its words are the note's only when the server's lock check passed
 * them (`lockOk`); otherwise it just says there is a note.
 */
final class Notes {
    static final String CHANNEL = "buddy_notes";
    private static final int NOTE_ID = 2;
    static final int PER_DAY = 2;

    private Notes() {}

    /** After a refresh (not while the app's screen is open: it shows the note itself): tell him about a new note, when that's allowed now. */
    static void maybeNotify(Context ctx, Ambient a) {
        Prefs p = Prefs.of(ctx);
        if (a == null || a.buddy == null || a.buddy.note == null || !p.notesOn()) return;
        Ambient.Note note = a.buddy.note;
        if (note.id.equals(p.seenNote())) return;
        Calendar now = Calendar.getInstance();
        if (p.inQuietHours(now)) return; // it waits for the morning's first refresh
        String day = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(now.getTime());
        if (p.notifiedOn(day) >= PER_DAY) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return;
        channel(ctx, nm);
        String title = a.buddy.title(ctx);
        String text = note.lockOk ? note.text : ctx.getString(R.string.note_private);
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        Notification n = new Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_buddy)
                .setColor(ctx.getColor(R.color.accent_fill))
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setContentIntent(PendingIntent.getActivity(ctx, 3, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setAutoCancel(true)
                .build();
        nm.notify(NOTE_ID, n);
        p.setSeenNote(note.id);
        p.countNotified(day);
    }

    /** He read the note on the app's screen: no notification for it, and any shown goes. */
    static void seen(Context ctx, Ambient.Note note) {
        if (note == null) return;
        Prefs.of(ctx).setSeenNote(note.id);
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(NOTE_ID);
    }

    static void channel(Context ctx, NotificationManager nm) {
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel c = new NotificationChannel(CHANNEL, ctx.getString(R.string.channel_name), NotificationManager.IMPORTANCE_DEFAULT);
        c.setDescription(ctx.getString(R.string.channel_description));
        c.setShowBadge(false);
        nm.createNotificationChannel(c);
    }
}
