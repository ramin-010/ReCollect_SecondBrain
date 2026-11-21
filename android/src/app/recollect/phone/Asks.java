package app.recollect.phone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;

/**
 * The buddy's questions on the phone (ECOSYSTEM_V2_PLAN §4.14, stage 6; app 0.6.0): each a silent notification
 * with its quick answers and a reply box, gone by itself at its end time, never in quiet hours. A notification
 * shows on the lock screen too, so its words are the question's only when the server's lock check passed them;
 * otherwise the lock screen says only that there is a question. His answer is kept on the phone first: the
 * pictures, the widget and the notification follow at once (in flight mode too), and it is sent when the
 * server can be reached (at once if it can, else at the next refresh).
 */
public final class Asks extends BroadcastReceiver {
    static final String CHANNEL = "buddy_asks";
    static final String ACTION_ANSWER = "app.recollect.phone.ASK_ANSWER";
    static final String KEY_REPLY = "reply";
    /** Notification ids: 100 + the question's place, kept per question id in prefs. */
    private static final int BASE_ID = 100;
    private static final String PREFS = "asks";

    // ── Shown ────────────────────────────────────────────────────────────────────────

    /** After a refresh: a notification for each open question not answered here (outside quiet hours); the others go. */
    static void show(Context ctx, Ambient a) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        Prefs p = Prefs.of(ctx);
        Set<String> keep = new HashSet<>();
        boolean quiet = p.inQuietHours(Calendar.getInstance());
        long now = System.currentTimeMillis();
        if (a != null && !quiet && p.notesOn() && nm.areNotificationsEnabled()) {
            channel(ctx, nm);
            for (Ambient.Ask q : a.asks) {
                if (answered(ctx, q.id) || (q.until > 0 && q.until <= now)) continue;
                keep.add(q.id);
                nm.notify(idFor(ctx, q.id), build(ctx, a, q, now));
            }
        }
        // Questions no longer open, answered here or elsewhere, or in quiet hours: their notifications go.
        SharedPreferences s = store(ctx);
        JSONObject ids = json(s.getString("ids", "{}"));
        JSONArray names = ids.names();
        if (names != null) for (int i = 0; i < names.length(); i++) {
            String id = names.optString(i);
            if (!keep.contains(id)) {
                nm.cancel(ids.optInt(id, 0));
                ids.remove(id);
            }
        }
        s.edit().putString("ids", ids.toString()).apply();
    }

    private static Notification build(Context ctx, Ambient a, Ambient.Ask q, long now) {
        String title = a.buddy != null ? a.buddy.title(ctx) : ctx.getString(R.string.buddy_title);
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        Notification.Builder b = new Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_buddy)
                .setColor(ctx.getColor(R.color.accent_fill))
                .setContentTitle(title)
                .setContentText(q.text)
                .setStyle(new Notification.BigTextStyle().bigText(q.text))
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setOnlyAlertOnce(true)
                .setContentIntent(PendingIntent.getActivity(ctx, 30, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        // Its words on the lock screen only when the lock check passed them.
        if (q.lockOk) b.setVisibility(Notification.VISIBILITY_PUBLIC);
        else {
            b.setVisibility(Notification.VISIBILITY_PRIVATE);
            b.setPublicVersion(new Notification.Builder(ctx, CHANNEL)
                    .setSmallIcon(R.drawable.ic_stat_buddy)
                    .setColor(ctx.getColor(R.color.accent_fill))
                    .setContentTitle(title)
                    .setContentText(ctx.getString(R.string.ask_private))
                    .build());
        }
        if (q.until > now) b.setTimeoutAfter(q.until - now);
        int code = idFor(ctx, q.id) * 10;
        for (int i = 0; i < q.answers.size(); i++) {
            Intent tap = new Intent(ctx, Asks.class).setAction(ACTION_ANSWER).putExtra("askId", q.id).putExtra("choice", i);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, code + i, tap, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.addAction(new Notification.Action.Builder(null, q.answers.get(i), pi).build());
        }
        // The reply box: his own words go to the same answer (the server reads them like any of his messages).
        RemoteInput box = new RemoteInput.Builder(KEY_REPLY).setLabel(ctx.getString(R.string.ask_reply_hint)).build();
        Intent reply = new Intent(ctx, Asks.class).setAction(ACTION_ANSWER).putExtra("askId", q.id).putExtra("choice", -1);
        PendingIntent rpi = PendingIntent.getBroadcast(ctx, code + 9, reply, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        b.addAction(new Notification.Action.Builder(null, ctx.getString(R.string.ask_reply), rpi).addRemoteInput(box).build());
        return b.build();
    }

    /** Silent: no sound, no vibration, no heads-up. */
    static void channel(Context ctx, NotificationManager nm) {
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel c = new NotificationChannel(CHANNEL, ctx.getString(R.string.ask_channel_name), NotificationManager.IMPORTANCE_LOW);
        c.setDescription(ctx.getString(R.string.ask_channel_description));
        c.setShowBadge(false);
        c.setSound(null, null);
        c.enableVibration(false);
        nm.createNotificationChannel(c);
    }

    private static int idFor(Context ctx, String askId) {
        SharedPreferences s = store(ctx);
        JSONObject ids = json(s.getString("ids", "{}"));
        int id = ids.optInt(askId, 0);
        if (id == 0) {
            id = BASE_ID + (s.getInt("next", 0) % 50);
            s.edit().putInt("next", s.getInt("next", 0) + 1).apply();
            try {
                ids.put(askId, id);
            } catch (JSONException ignored) {
                // an id the JSON can't hold: the notification still shows, under the base id
            }
            s.edit().putString("ids", ids.toString()).apply();
        }
        return id;
    }

    // ── His answer ───────────────────────────────────────────────────────────────────

    /** A notification's quick answer or reply. */
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!ACTION_ANSWER.equals(intent.getAction())) return;
        String askId = intent.getStringExtra("askId");
        int choice = intent.getIntExtra("choice", -1);
        String text = null;
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        if (results != null) {
            CharSequence typed = results.getCharSequence(KEY_REPLY);
            text = typed == null ? null : typed.toString().trim();
        }
        if (askId == null || (choice < 0 && (text == null || text.isEmpty()))) return;
        PendingResult pending = goAsync();
        final String words = text;
        new Thread(() -> {
            try {
                answer(ctx.getApplicationContext(), askId, choice, words);
            } finally {
                pending.finish();
            }
        }, "recollect-answer").start();
    }

    /**
     * His answer (a notification or the app's screen), kept here first: the question's notification goes, the
     * pictures and the widget drop it at once (offline too), then it is sent; one that can't be sent now waits
     * for the next refresh. Off the main thread.
     */
    static void answer(Context ctx, String askId, int choice, String text) {
        SharedPreferences s = store(ctx);
        JSONObject done = json(s.getString("answered", "{}"));
        JSONArray outbox = array(s.getString("outbox", "[]"));
        try {
            done.put(askId, System.currentTimeMillis());
            outbox.put(new JSONObject().put("askId", askId).put("choice", choice).put("text", text == null ? JSONObject.NULL : text));
        } catch (JSONException e) {
            return;
        }
        s.edit().putString("answered", done.toString()).putString("outbox", outbox.toString()).apply();
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(idFor(ctx, askId));
        Pictures.apply(ctx);
        DayWidget.updateAll(ctx);
        Prefs p = Prefs.of(ctx);
        if (p.server() != null && p.token() != null) flush(ctx, new Api(p.server(), p.token()));
    }

    /** Answered on this phone (its words drop from the pictures and the widget at once, before the server knows). */
    static boolean answered(Context ctx, String askId) {
        return askId != null && json(store(ctx).getString("answered", "{}")).has(askId);
    }

    /** Sends the answers that wait (at each refresh, and right after an answer). One the server refuses for good is dropped. */
    static synchronized void flush(Context ctx, Api api) {
        SharedPreferences s = store(ctx);
        JSONArray outbox = array(s.getString("outbox", "[]"));
        if (outbox.length() == 0) return;
        JSONArray left = new JSONArray();
        for (int i = 0; i < outbox.length(); i++) {
            JSONObject x = outbox.optJSONObject(i);
            if (x == null) continue;
            try {
                api.answer(x.optString("askId"), x.optInt("choice", -1), x.isNull("text") ? null : x.optString("text"));
            } catch (Api.Failure f) {
                // Unreachable or the server's own trouble: it waits. A refusal (gone, not his) is final.
                if (f.kind == Api.Failure.UNREACHABLE || f.status >= 500) left.put(x);
            }
        }
        s.edit().putString("outbox", left.toString()).apply();
        prune(s);
    }

    /** Answered marks older than two days go (their questions ended long ago). */
    private static void prune(SharedPreferences s) {
        JSONObject done = json(s.getString("answered", "{}"));
        JSONArray names = done.names();
        if (names == null) return;
        long cutoff = System.currentTimeMillis() - 2 * 86_400_000L;
        for (int i = 0; i < names.length(); i++) if (done.optLong(names.optString(i), 0) < cutoff) done.remove(names.optString(i));
        s.edit().putString("answered", done.toString()).apply();
    }

    /** Disconnect: nothing of the questions stays. */
    static void clear(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        JSONObject ids = json(store(ctx).getString("ids", "{}"));
        JSONArray names = ids.names();
        if (nm != null && names != null) for (int i = 0; i < names.length(); i++) nm.cancel(ids.optInt(names.optString(i), 0));
        store(ctx).edit().clear().apply();
    }

    private static SharedPreferences store(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject json(String raw) {
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static JSONArray array(String raw) {
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }
}
