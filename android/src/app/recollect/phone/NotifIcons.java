package app.recollect.phone;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.drawable.Icon;
import android.os.Handler;
import android.os.Looper;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Which apps have notifications waiting (0.4.0, the live lock screen): the system tells this listener
 * once he allows it (Settings › Notification access). Only each app's small icon and how many are kept,
 * in memory, never what a notification says; nothing leaves the phone. The live wallpaper draws the
 * icons under the day's words, the way the status bar shows them. Left out: ongoing ones (music,
 * downloads), group summaries, silent ones, those an app hides from the lock screen, and our own.
 */
public final class NotifIcons extends NotificationListenerService {
    /** One app with notifications waiting. */
    static final class Item {
        final String pkg;
        final Icon icon;
        final int count;
        final long when;

        Item(String pkg, Icon icon, int count, long when) {
            this.pkg = pkg;
            this.icon = icon;
            this.count = count;
            this.when = when;
        }
    }

    interface Listener {
        void onIconsChanged();
    }

    private static volatile List<Item> items = Collections.emptyList();
    private static volatile boolean connected;
    private static final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private static final Handler main = new Handler(Looper.getMainLooper());

    static List<Item> items() {
        return items;
    }

    /** The system has bound the listener (access allowed and running). */
    static boolean connected() {
        return connected;
    }

    static void addListener(Listener l) {
        listeners.addIfAbsent(l);
    }

    static void removeListener(Listener l) {
        listeners.remove(l);
    }

    /** Has he allowed it (Settings › Notification access)? */
    static boolean allowed(Context ctx) {
        android.app.NotificationManager nm = ctx.getSystemService(android.app.NotificationManager.class);
        return nm != null && nm.isNotificationListenerAccessGranted(new ComponentName(ctx, NotifIcons.class));
    }

    @Override
    public void onListenerConnected() {
        connected = true;
        refresh();
    }

    @Override
    public void onListenerDisconnected() {
        connected = false;
        items = Collections.emptyList();
        changed();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        refresh();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        refresh();
    }

    @Override
    public void onNotificationRankingUpdate(RankingMap rankingMap) {
        refresh();
    }

    private void refresh() {
        StatusBarNotification[] all;
        RankingMap ranking;
        try {
            all = getActiveNotifications();
            ranking = getCurrentRanking();
        } catch (RuntimeException e) {
            return; // not bound (yet)
        }
        Map<String, Item> byApp = new LinkedHashMap<>();
        Ranking r = new Ranking();
        if (all != null) {
            for (StatusBarNotification sbn : all) {
                Notification n = sbn.getNotification();
                if (n == null || sbn.isOngoing()) continue;
                if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) continue;
                if (n.visibility == Notification.VISIBILITY_SECRET) continue;
                String pkg = sbn.getPackageName();
                if (pkg.startsWith("app.recollect.phone")) continue;
                if (ranking != null && ranking.getRanking(sbn.getKey(), r) && r.isAmbient()) continue; // silent: the status bar shows no icon either
                Icon icon = n.getSmallIcon();
                if (icon == null) continue;
                Item had = byApp.get(pkg);
                if (had == null || sbn.getPostTime() > had.when) byApp.put(pkg, new Item(pkg, icon, (had == null ? 0 : had.count) + 1, Math.max(sbn.getPostTime(), had == null ? 0 : had.when)));
                else byApp.put(pkg, new Item(pkg, had.icon, had.count + 1, had.when));
            }
        }
        List<Item> list = new ArrayList<>(byApp.values());
        // Newest first, as the shade lists them.
        Collections.sort(list, (a, b) -> Long.compare(b.when, a.when));
        items = Collections.unmodifiableList(list);
        changed();
    }

    private static void changed() {
        main.post(() -> {
            for (Listener l : listeners) l.onIconsChanged();
        });
    }
}
