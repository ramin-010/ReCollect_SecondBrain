package app.recollect.phone;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.text.format.DateFormat;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.RemoteViews;

/**
 * "Your day" on the home screen, from the last refresh (it never fetches by itself). 4 x 2 (0.3.0): the
 * date, the buddy's line for now (only one its lock check passed; else the day's one line), the day in
 * numbers, and two thumbs for the line ("more like this", "not this") that reach the server without
 * opening anything. 4 x 1: the date and the line. A tap elsewhere opens Recollect.
 */
public final class DayWidget extends AppWidgetProvider {
    /** A thumb tapped on the widget (an explicit broadcast to this receiver). */
    static final String ACTION_THUMB = "app.recollect.phone.THUMB";
    /** Below this height (dp) the one-row layout fits. */
    private static final int SMALL_BELOW_DP = 100;
    /** Older than this, the widget says when it was last updated. */
    private static final long STALE_MS = 3 * DateUtils.HOUR_IN_MILLIS;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(ctx, manager, id);
        Schedule.ensure(ctx);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager manager, int id, Bundle options) {
        render(ctx, manager, id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!ACTION_THUMB.equals(intent.getAction())) {
            super.onReceive(ctx, intent);
            return;
        }
        final String dayId = intent.getStringExtra("dayId");
        final String target = intent.getStringExtra("target");
        final String verdict = intent.getStringExtra("verdict");
        if (dayId == null || target == null || verdict == null) return;
        final Context app = ctx.getApplicationContext();
        final PendingResult done = goAsync();
        new Thread(() -> {
            try {
                // Shown at once; taken back if the server didn't take it.
                Thumbs.give(app, dayId, target, verdict, () -> updateAll(app));
            } finally {
                done.finish();
            }
        }, "thumb").start();
    }

    static void updateAll(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        if (manager == null) return;
        for (int id : manager.getAppWidgetIds(new ComponentName(ctx, DayWidget.class))) render(ctx, manager, id);
    }

    private static boolean small(Context ctx, AppWidgetManager manager, int id) {
        Bundle o = manager.getAppWidgetOptions(id);
        boolean portrait = ctx.getResources().getConfiguration().orientation != Configuration.ORIENTATION_LANDSCAPE;
        int h = o.getInt(portrait ? AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        return h > 0 && h < SMALL_BELOW_DP;
    }

    static void render(Context ctx, AppWidgetManager manager, int id) {
        manager.updateAppWidget(id, views(ctx, small(ctx, manager, id)));
    }

    /** The widget's views at one size (also the QA app's preview of it). */
    static RemoteViews views(Context ctx, boolean small) {
        Prefs p = Prefs.of(ctx);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layout(small, p.theme()));
        Ambient a = p.connected() ? p.ambient() : null;

        if (a == null) {
            v.setTextViewText(R.id.w_date, "");
            v.setViewVisibility(R.id.w_date, View.GONE);
            v.setTextViewText(R.id.w_headline, ctx.getString(R.string.widget_connect));
            if (!small) {
                v.setTextViewText(R.id.w_numbers, ctx.getString(R.string.widget_connect_line));
                thumbs(ctx, v, null, null);
                v.setViewVisibility(R.id.w_status, View.GONE);
            }
        } else {
            v.setViewVisibility(R.id.w_date, View.VISIBLE);
            v.setTextViewText(R.id.w_date, a.date);
            String day = a.headline.isEmpty() && a.done() ? ctx.getString(R.string.done_today) : a.headline;
            v.setTextViewText(R.id.w_headline, a.line != null ? a.line.text : day);
            if (!small) {
                String numbers = a.numbers != null ? a.numbers : (a.lines.isEmpty() ? "" : a.lines.get(0));
                v.setTextViewText(R.id.w_numbers, numbers);
                thumbs(ctx, v, a.line, a.buddy);
                long at = p.okAt();
                boolean stale = at > 0 && System.currentTimeMillis() - at > STALE_MS;
                v.setViewVisibility(R.id.w_status, stale ? View.VISIBLE : View.GONE);
                if (stale) v.setTextViewText(R.id.w_status, ctx.getString(R.string.widget_stale, when(ctx, at)));
            }
        }
        v.setOnClickPendingIntent(android.R.id.background, tap(ctx, p, a));
        return v;
    }

    /** The line's two thumbs: shown with a line from the buddy, the one he gave filled. */
    private static void thumbs(Context ctx, RemoteViews v, Ambient.Line line, Ambient.Buddy buddy) {
        boolean show = line != null && buddy != null && !line.dayId.isEmpty() && !line.slot.isEmpty();
        v.setViewVisibility(R.id.w_more, show ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.w_less, show ? View.VISIBLE : View.GONE);
        if (!show) return;
        String given = buddy.thumb(line.dayId, line.slot);
        v.setImageViewResource(R.id.w_more, "more".equals(given) ? R.drawable.ic_thumb_up_on : R.drawable.ic_thumb_up);
        v.setImageViewResource(R.id.w_less, "less".equals(given) ? R.drawable.ic_thumb_down_on : R.drawable.ic_thumb_down);
        v.setOnClickPendingIntent(R.id.w_more, thumbIntent(ctx, line, "more", 11));
        v.setOnClickPendingIntent(R.id.w_less, thumbIntent(ctx, line, "less", 12));
    }

    private static PendingIntent thumbIntent(Context ctx, Ambient.Line line, String verdict, int code) {
        Intent i = new Intent(ctx, DayWidget.class).setAction(ACTION_THUMB)
                .putExtra("dayId", line.dayId).putExtra("target", line.slot).putExtra("verdict", verdict);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * One layout per theme. System's colours follow the phone (values-night) whenever the launcher
     * draws it; Light and Dark have their own. Colours are never set on a layout: a launcher re-applies
     * a new update onto the old views, so colours set once would stay after a switch back to System.
     */
    private static int layout(boolean small, String theme) {
        if (Prefs.THEME_LIGHT.equals(theme)) return small ? R.layout.widget_day_small_light : R.layout.widget_day_light;
        if (Prefs.THEME_DARK.equals(theme)) return small ? R.layout.widget_day_small_dark : R.layout.widget_day_dark;
        return small ? R.layout.widget_day_small : R.layout.widget_day;
    }

    /** Opens the web app; before it is connected (or without its address), this app. */
    private static PendingIntent tap(Context ctx, Prefs p, Ambient a) {
        Intent open = null;
        String url = a == null ? null : MainActivity.appUrl(a.appUrl, p.server());
        if (url != null) open = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        if (open == null) open = new Intent(ctx, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** "14:05", or "Sun 14:05" when it was another day. */
    static String when(Context ctx, long at) {
        String time = DateFormat.getTimeFormat(ctx).format(new java.util.Date(at));
        if (DateUtils.isToday(at)) return time;
        return DateUtils.formatDateTime(ctx, at, DateUtils.FORMAT_SHOW_WEEKDAY | DateUtils.FORMAT_ABBREV_WEEKDAY) + " " + time;
    }
}
