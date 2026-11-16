package app.recollect.phone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A reminder's alarm went off (Reminders): the notification, unless he turned ringing off since. */
public final class ReminderAlarm extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Prefs.of(ctx).remindersOn()) return;
        String id = intent.getStringExtra(Reminders.EXTRA_ID);
        if (id == null) return;
        Reminders.ring(ctx, id, intent.getStringExtra(Reminders.EXTRA_TEXT));
    }
}
