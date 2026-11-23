package app.recollect.phone;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

/**
 * 0.7.5 (the owner, 11-23: "a real alarm, not only an in-app one"): a reminder that rings is a real alarm. At its time
 * this service plays the phone's alarm sound in a loop on the alarm stream and vibrates, and shows a full-screen alarm
 * over the lock screen (AlarmActivity) through its notification, with Snooze and Dismiss on both. Nothing answered in
 * RING_MS: it goes quiet and leaves the plain reminder notification. Any failure falls back to that notification, so a
 * reminder never goes silent because of this.
 */
public final class AlarmService extends Service {
    static final String CHANNEL = "alarms";
    static final String ACTION_RING = "app.recollect.phone.ALARM_RING";
    static final String ACTION_SNOOZE = "app.recollect.phone.ALARM_SNOOZE";
    static final String ACTION_DISMISS = "app.recollect.phone.ALARM_DISMISS";
    /** The activity listens for this to close itself. */
    static final String ACTION_STOPPED = "app.recollect.phone.ALARM_STOPPED";
    static final long SNOOZE_MS = 10 * 60_000L;
    static final long RING_MS = 10 * 60_000L;
    private static final int NOTE_ID = 0x5a1a;

    /** What is ringing now (the activity reads it). */
    static volatile String ringingId;
    static volatile String ringingText;

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wake;
    private final Runnable timeout = () -> stopRinging(true);

    /** From ReminderAlarm: ring this reminder (false when the service could not start: the caller notifies instead). */
    static boolean start(Context ctx, String id, String text) {
        try {
            Intent i = new Intent(ctx, AlarmService.class).setAction(ACTION_RING).putExtra(Reminders.EXTRA_ID, id).putExtra(Reminders.EXTRA_TEXT, text);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
            return true;
        } catch (RuntimeException e) {
            // Android 12+ may refuse a foreground service from the background (an inexact alarm): the notification rings.
            return false;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_SNOOZE.equals(action)) {
            snooze();
            return START_NOT_STICKY;
        }
        if (ACTION_DISMISS.equals(action)) {
            stopRinging(false);
            return START_NOT_STICKY;
        }
        String id = intent == null ? null : intent.getStringExtra(Reminders.EXTRA_ID);
        if (id == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String text = intent.getStringExtra(Reminders.EXTRA_TEXT);
        try {
            // A second alarm while one rings: the newer one takes the screen.
            if (ringingId != null) silence();
            ringingId = id;
            ringingText = text;
            startForeground(NOTE_ID, notification(id, text));
            play();
            main.removeCallbacks(timeout);
            main.postDelayed(timeout, RING_MS);
        } catch (RuntimeException e) {
            ringingId = null;
            Reminders.ring(this, id, text);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private Notification notification(String id, String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel c = new NotificationChannel(CHANNEL, getString(R.string.alarm_channel), NotificationManager.IMPORTANCE_HIGH);
            c.setDescription(getString(R.string.alarm_channel_description));
            // The sound and vibration are played by the service (in a loop), not by the notification.
            c.setSound(null, null);
            c.enableVibration(false);
            c.setBypassDnd(true);
            c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(c);
        }
        String body = text == null || text.isEmpty() ? getString(R.string.reminder_plain) : text;
        PendingIntent full = PendingIntent.getActivity(this, 11, new Intent(this, AlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent snooze = PendingIntent.getService(this, 12, new Intent(this, AlarmService.class).setAction(ACTION_SNOOZE), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent dismiss = PendingIntent.getService(this, 13, new Intent(this, AlarmService.class).setAction(ACTION_DISMISS), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_buddy)
                .setColor(getColor(R.color.accent_fill))
                .setContentTitle(getString(R.string.alarm_title))
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setFullScreenIntent(full, true)
                .setContentIntent(full)
                .addAction(new Notification.Action.Builder(null, getString(R.string.alarm_snooze), snooze).build())
                .addAction(new Notification.Action.Builder(null, getString(R.string.alarm_dismiss), dismiss).build())
                .build();
    }

    private void play() {
        PowerManager pm = getSystemService(PowerManager.class);
        if (pm != null && wake == null) {
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "recollect:alarm");
            wake.acquire(RING_MS + 30_000L);
        }
        AudioAttributes alarm = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        Uri sound = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(alarm);
            player.setDataSource(this, sound);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            // No sound to play (a phone without one): the vibration and the screen still ring.
            releasePlayer();
        }
        vibrator = getSystemService(Vibrator.class);
        if (vibrator != null && vibrator.hasVibrator()) vibrator.vibrate(VibrationEffect.createWaveform(new long[] {0, 700, 600}, 0), alarm);
    }

    private void releasePlayer() {
        if (player == null) return;
        try {
            player.stop();
        } catch (IllegalStateException ignored) {
            // not started
        }
        player.release();
        player = null;
    }

    /** The sound and the vibration stop (the service may ring again for another alarm). */
    private void silence() {
        releasePlayer();
        if (vibrator != null) vibrator.cancel();
    }

    /** Snooze: the same reminder rings again in 10 minutes (an alarm-clock alarm the app sets itself). */
    private void snooze() {
        String id = ringingId;
        String text = ringingText;
        if (id != null) {
            AlarmManager am = getSystemService(AlarmManager.class);
            if (am != null) {
                long at = System.currentTimeMillis() + SNOOZE_MS;
                PendingIntent pi = Reminders.intent(this, "snooze:" + id, text, PendingIntent.FLAG_UPDATE_CURRENT);
                boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
                PendingIntent show = PendingIntent.getActivity(this, 7, new Intent(this, Shell.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                if (exact) am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pi);
                else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        }
        stopRinging(false);
    }

    /** Stop ringing; `missed`: nobody answered, so the plain reminder notification stays. */
    private void stopRinging(boolean missed) {
        String id = ringingId;
        String text = ringingText;
        main.removeCallbacks(timeout);
        silence();
        ringingId = null;
        ringingText = null;
        if (wake != null && wake.isHeld()) wake.release();
        wake = null;
        sendBroadcast(new Intent(ACTION_STOPPED).setPackage(getPackageName()));
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        if (missed && id != null) Reminders.ring(this, id, text);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(timeout);
        silence();
        if (wake != null && wake.isHeld()) wake.release();
        super.onDestroy();
    }
}
