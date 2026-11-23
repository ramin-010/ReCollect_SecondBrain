package app.recollect.phone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A reminder's alarm went off (Reminders): a real alarm (0.7.5, AlarmService), else the notification; nothing if ringing is off. */
public final class ReminderAlarm extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Prefs.of(ctx).remindersOn()) return;
        String id = intent.getStringExtra(Reminders.EXTRA_ID);
        if (id == null) return;
        String text = intent.getStringExtra(Reminders.EXTRA_TEXT);
        if (!AlarmService.start(ctx, id, text)) Reminders.ring(ctx, id, text);
    }
}
