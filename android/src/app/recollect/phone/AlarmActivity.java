package app.recollect.phone;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.format.DateFormat;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Date;

/**
 * 0.7.5: the ringing alarm's own screen, over the lock screen: the time, the reminder's words, Snooze (10 minutes)
 * and Dismiss. The sound and vibration belong to AlarmService; this screen closes when it stops.
 */
public final class AlarmActivity extends Activity {
    private final BroadcastReceiver stopped = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            finish();
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (AlarmService.ringingId == null) {
            // Opened after it stopped (from an old notification): nothing to show.
            finish();
            return;
        }
        setContentView(build());
        IntentFilter f = new IntentFilter(AlarmService.ACTION_STOPPED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(stopped, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(stopped, f);
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private View build() {
        int ink = Color.parseColor("#F2EFE9");
        int soft = Color.parseColor("#B9B4AA");
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#141311"));
        root.setPadding(dp(28), dp(96), dp(28), dp(48));

        TextView label = new TextView(this);
        label.setText(getString(R.string.alarm_title));
        label.setTextColor(soft);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        label.setLetterSpacing(0.04f);
        root.addView(label);

        TextView time = new TextView(this);
        time.setText(DateFormat.getTimeFormat(this).format(new Date()));
        time.setTextColor(ink);
        time.setTextSize(TypedValue.COMPLEX_UNIT_SP, 72);
        time.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        time.setPadding(0, dp(8), 0, dp(24));
        root.addView(time);

        String words = AlarmService.ringingText;
        TextView text = new TextView(this);
        text.setText(words == null || words.isEmpty() ? getString(R.string.reminder_plain) : words);
        text.setTextColor(ink);
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        text.setGravity(Gravity.CENTER);
        text.setLineSpacing(0, 1.2f);
        root.addView(text, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        Button snooze = button(getString(R.string.alarm_snooze), Color.parseColor("#2A2824"), ink);
        snooze.setOnClickListener((v) -> send(AlarmService.ACTION_SNOOZE));
        root.addView(snooze, buttonParams());
        Button dismiss = button(getString(R.string.alarm_dismiss), ink, Color.parseColor("#141311"));
        dismiss.setOnClickListener((v) -> send(AlarmService.ACTION_DISMISS));
        LinearLayout.LayoutParams p = buttonParams();
        p.topMargin = dp(12);
        root.addView(dismiss, p);
        return root;
    }

    private Button button(String text, int fill, int textColor) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(textColor);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(fill);
        bg.setCornerRadius(dp(28));
        b.setBackground(bg);
        b.setStateListAnimator(null);
        return b;
    }

    private LinearLayout.LayoutParams buttonParams() {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56));
    }

    private void send(String action) {
        startService(new Intent(this, AlarmService.class).setAction(action));
        finish();
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(stopped);
        } catch (IllegalArgumentException ignored) {
            // never registered (it finished at once)
        }
        super.onDestroy();
    }

    /** Back doesn't dismiss by accident: the alarm keeps ringing until Snooze or Dismiss. */
    @Override
    public void onBackPressed() {
        KeyguardManager km = getSystemService(KeyguardManager.class);
        if (km != null && km.isKeyguardLocked()) return;
        moveTaskToBack(true);
    }
}
