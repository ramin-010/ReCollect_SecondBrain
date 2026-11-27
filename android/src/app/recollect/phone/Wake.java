package app.recollect.phone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a restart or an update of the app: the refresh chain and the widget come back. */
public final class Wake extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        // 0.9.0: after the app updated itself, the downloaded file and the update's notifications go.
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) Updates.afterUpdate(ctx);
        Schedule.ensure(ctx);
        DayWidget.updateAll(ctx);
        // Alarms don't survive a restart: the reminders' alarms again, from the saved list (0.5.0).
        Reminders.rearm(ctx);
        // 0.6.0: the right picture now and the alarm for the next switch (end times, quiet hours).
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                Pictures.apply(ctx.getApplicationContext());
            } finally {
                pending.finish();
            }
        }, "recollect-wake").start();
    }
}
