package app.recollect.phone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a restart or an update of the app: the refresh chain and the widget come back. */
public final class Wake extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        Schedule.ensure(ctx);
        DayWidget.updateAll(ctx);
    }
}
