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
 * "Your day" on the home screen, from the last refresh (it never fetches by itself). 0.7.0 (ECOSYSTEM_V2_PLAN stage 19,
 * mockups/phone-app/widget.html): one card for one item, chosen by the server (`next`): what Buddy's line is about, else
 * something due within two days, else what they left off. Its label says what and when, the line under the title where
 * they stopped, and one button, Later: it brings the item back at a time they can act (Laters keeps the tap, offline
 * too). A tap elsewhere opens the item (the problem's page, the doc in the app) or the app. With nothing ahead: the date,
 * the buddy's line (in the serif) or the day's words, and the day in numbers. The thumbs live in the app and on the web.
 * Sizes by height (CardRule): the full card, a short one (no line under the title), and 4 x 1 (the label and the title).
 * The app's look (Paper or Slate, from its page) and the theme (System, Light, Dark) pick the layout.
 */
public final class DayWidget extends AppWidgetProvider {
    /** A thumb tapped on an older widget's drawing (0.3.0-0.6.0): still taken. */
    static final String ACTION_THUMB = "app.recollect.phone.THUMB";
    /** 0.7.0: Later tapped on the card (an explicit broadcast to this receiver). */
    static final String ACTION_LATER = "app.recollect.phone.LATER";
    /** 0.7.1: a tap on the set pill: taken, and nothing happens. */
    static final String ACTION_QUIET = "app.recollect.phone.QUIET";
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
        String action = intent.getAction();
        if (ACTION_QUIET.equals(action)) return;
        final Context app = ctx.getApplicationContext();
        if (ACTION_LATER.equals(action)) {
            final String id = intent.getStringExtra("id");
            final String label = intent.getStringExtra("label");
            final long at = intent.getLongExtra("at", 0);
            if (id == null) return;
            final PendingResult done = goAsync();
            new Thread(() -> {
                try {
                    // Shown set at once (offline too), then sent; one that can't go now waits for the next refresh.
                    Laters.tap(app, id, label, at);
                } finally {
                    done.finish();
                }
            }, "later").start();
            return;
        }
        if (!ACTION_THUMB.equals(action)) {
            super.onReceive(ctx, intent);
            return;
        }
        final String dayId = intent.getStringExtra("dayId");
        final String target = intent.getStringExtra("target");
        final String verdict = intent.getStringExtra("verdict");
        if (dayId == null || target == null || verdict == null) return;
        final PendingResult done = goAsync();
        new Thread(() -> {
            try {
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

    /** A widget is on a home screen: the home picture then leaves the card's item out (`card=0`, nothing shown twice). */
    static boolean placed(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        return manager != null && manager.getAppWidgetIds(new ComponentName(ctx, DayWidget.class)).length > 0;
    }

    /** The widget's height now (dp; 0: not known). */
    private static int heightDp(Context ctx, AppWidgetManager manager, int id) {
        Bundle o = manager.getAppWidgetOptions(id);
        boolean portrait = ctx.getResources().getConfiguration().orientation != Configuration.ORIENTATION_LANDSCAPE;
        return o.getInt(portrait ? AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
    }

    static void render(Context ctx, AppWidgetManager manager, int id) {
        manager.updateAppWidget(id, views(ctx, CardRule.size(heightDp(ctx, manager, id))));
    }

    /** The QA app's preview (MainActivity): the full card or the one-row widget. */
    static RemoteViews views(Context ctx, boolean small) {
        return views(ctx, small ? CardRule.Size.ONE_ROW : CardRule.Size.FULL);
    }

    /** The widget's views at one size. */
    static RemoteViews views(Context ctx, CardRule.Size size) {
        Prefs p = Prefs.of(ctx);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layout(size, p.widgetLook(), p.theme()));
        Ambient a = p.connected() ? p.ambient() : null;
        boolean oneRow = size == CardRule.Size.ONE_ROW;
        v.setViewVisibility(R.id.w_voice, View.GONE);
        v.setViewVisibility(R.id.w_title, View.VISIBLE);
        if (!oneRow) {
            v.setViewVisibility(R.id.w_status, View.GONE);
            v.setViewVisibility(R.id.w_later_row, View.GONE);
        }
        PendingIntent tap;
        if (a == null) {
            text(v, R.id.w_label, null);
            v.setTextViewText(R.id.w_title, ctx.getString(R.string.widget_connect));
            if (!oneRow) text(v, R.id.w_detail, size == CardRule.Size.FULL ? ctx.getString(R.string.widget_connect_line) : null);
            tap = open(ctx, p, null, null);
        } else if (a.next != null) {
            Ambient.Next n = a.next;
            text(v, R.id.w_label, n.label);
            v.setTextViewText(R.id.w_title, n.title);
            if (!oneRow) {
                text(v, R.id.w_detail, size == CardRule.Size.FULL ? n.detail : null);
                boolean setHere = Laters.isSet(ctx, n.id);
                CardRule.Later later = CardRule.later(true, size, n.laterLabel, setHere);
                if (later != CardRule.Later.NONE) {
                    v.setViewVisibility(R.id.w_later_row, View.VISIBLE);
                    v.setViewVisibility(R.id.w_later, later == CardRule.Later.BUTTON ? View.VISIBLE : View.GONE);
                    v.setViewVisibility(R.id.w_later_set, later == CardRule.Later.SET ? View.VISIBLE : View.GONE);
                    String kept = later == CardRule.Later.SET ? Laters.label(ctx, n.id) : null;
                    v.setTextViewText(R.id.w_later_when, kept != null && !kept.isEmpty() ? kept : n.laterLabel == null ? "" : n.laterLabel);
                    if (later == CardRule.Later.BUTTON) v.setOnClickPendingIntent(R.id.w_later, laterIntent(ctx, n));
                    // The set pill keeps its own taps (device pass 11-20: a tap on the tick fell through to the card and opened the app).
                    else v.setOnClickPendingIntent(R.id.w_later_set, quiet(ctx));
                }
                stale(ctx, v, p);
            }
            tap = open(ctx, p, a, n.link);
        } else {
            text(v, R.id.w_label, a.date);
            String day = a.headline.isEmpty() && a.done() ? ctx.getString(R.string.done_today) : a.headline;
            // 0.6.0: the buddy's line only while it may show (its end time, quiet hours, a question answered here).
            Ambient.Line line = Pictures.lockWords(ctx, a, java.util.Calendar.getInstance()) ? a.line : null;
            if (line != null) {
                v.setViewVisibility(R.id.w_title, View.GONE);
                v.setViewVisibility(R.id.w_voice, View.VISIBLE);
                v.setTextViewText(R.id.w_voice, line.text);
            } else v.setTextViewText(R.id.w_title, day);
            if (!oneRow) {
                String numbers = a.numbers != null ? a.numbers : (a.lines.isEmpty() ? "" : a.lines.get(0));
                text(v, R.id.w_detail, size == CardRule.Size.FULL ? numbers : null);
                stale(ctx, v, p);
            }
            tap = open(ctx, p, a, null);
        }
        v.setOnClickPendingIntent(android.R.id.background, tap);
        return v;
    }

    /** A text view with these words, or gone without any. */
    private static void text(RemoteViews v, int id, String words) {
        boolean show = words != null && !words.trim().isEmpty();
        v.setViewVisibility(id, show ? View.VISIBLE : View.GONE);
        v.setTextViewText(id, show ? words : "");
    }

    /** "Updated 14:05" beside the label when the last refresh is over three hours old. */
    private static void stale(Context ctx, RemoteViews v, Prefs p) {
        long at = p.okAt();
        boolean old = at > 0 && System.currentTimeMillis() - at > STALE_MS;
        v.setViewVisibility(R.id.w_status, old ? View.VISIBLE : View.GONE);
        if (old) v.setTextViewText(R.id.w_status, ctx.getString(R.string.widget_stale, when(ctx, at)));
    }

    /** A tap that does nothing (the set pill), so it never reaches the card under it. */
    private static PendingIntent quiet(Context ctx) {
        Intent i = new Intent(ctx, DayWidget.class).setAction(ACTION_QUIET);
        return PendingIntent.getBroadcast(ctx, 22, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** The Later button: this card's item and what the button said, so a tap kept offline lands when it said. */
    private static PendingIntent laterIntent(Context ctx, Ambient.Next n) {
        Intent i = new Intent(ctx, DayWidget.class).setAction(ACTION_LATER)
                .putExtra("id", n.id).putExtra("label", n.laterLabel).putExtra("at", n.laterAt);
        return PendingIntent.getBroadcast(ctx, 21, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * One layout per look and theme (widget-themes.py). System's colours follow the phone (values-night) whenever the
     * launcher draws it; Light and Dark have their own. Colours are never set on a layout: a launcher re-applies a new
     * update onto the old views, so colours set once would stay after a switch back to System.
     */
    private static int layout(CardRule.Size size, String look, String theme) {
        boolean paper = "paper".equals(look);
        boolean light = Prefs.THEME_LIGHT.equals(theme);
        boolean dark = Prefs.THEME_DARK.equals(theme);
        switch (size) {
            case ONE_ROW:
                if (paper) return light ? R.layout.widget_day_small_paper_light : dark ? R.layout.widget_day_small_paper_dark : R.layout.widget_day_small_paper;
                return light ? R.layout.widget_day_small_light : dark ? R.layout.widget_day_small_dark : R.layout.widget_day_small;
            case SHORT:
                if (paper) return light ? R.layout.widget_day_short_paper_light : dark ? R.layout.widget_day_short_paper_dark : R.layout.widget_day_short_paper;
                return light ? R.layout.widget_day_short_light : dark ? R.layout.widget_day_short_dark : R.layout.widget_day_short;
            default:
                if (paper) return light ? R.layout.widget_day_paper_light : dark ? R.layout.widget_day_paper_dark : R.layout.widget_day_paper;
                return light ? R.layout.widget_day_light : dark ? R.layout.widget_day_dark : R.layout.widget_day;
        }
    }

    /** The app's own Today when the shell is this app's launcher (the QA app; the release from 0.7.0), else null. */
    private static Intent shell(Context ctx) {
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch == null || launch.getComponent() == null || !Shell.class.getName().equals(launch.getComponent().getClassName())) return null;
        return launch;
    }

    /**
     * What a tap opens: the card's link (the web app's own pages in the app when the shell is the app, with its
     * signed-in session; a problem's page in its own app or the browser); without one, the app's Today, else the web
     * app, else this app's settings.
     */
    private static PendingIntent open(Context ctx, Prefs p, Ambient a, String link) {
        Intent shell = shell(ctx);
        String app = a == null ? null : MainActivity.appUrl(a.appUrl, p.server());
        Intent open;
        if (link != null) {
            // A link the server built from its own address is reached through this phone's address for the web app.
            String here = a != null && a.appUrl != null && app != null && link.startsWith(a.appUrl) ? app + link.substring(a.appUrl.length()) : link;
            Uri u = Uri.parse(here);
            open = shell != null && app != null && here.startsWith(app) ? new Intent(ctx, Shell.class).setAction(Intent.ACTION_VIEW).setData(u) : new Intent(Intent.ACTION_VIEW, u);
        } else if (shell != null) open = shell;
        else if (app != null) open = new Intent(Intent.ACTION_VIEW, Uri.parse(app));
        else open = new Intent(ctx, MainActivity.class);
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
