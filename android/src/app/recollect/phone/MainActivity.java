package app.recollect.phone;

import android.Manifest;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.TimePickerDialog;
import android.appwidget.AppWidgetManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.format.DateFormat;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.ImageView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.util.Calendar;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The one screen: connect (from the server's page, or a pasted link), then see the picture of the
 * day and choose where it shows, its theme, quiet hours and titles; Refresh now; Disconnect.
 */
public final class MainActivity extends Activity {
    private static final int ASK_READ = 7;
    private static final String TAG = "Recollect";

    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private Prefs prefs;
    /** A connect link waiting for "Connect". */
    private ConnectLink pending;
    private boolean busy;

    private View paneConnect, paneConfirm, paneSettings;
    private View connectProblem, confirmProblem, problem;
    private TextView confirmBody, keepNote, dayDate, dayHeadline, dayLines, dayStatus, connServer, connAccount, quietFrom, quietTo;
    private CheckBox keepCopy;
    private Button confirmGo, refresh;
    private ImageView preview;
    private Switch swLock, swHome, swQuiet, swTitles;
    private TextView themeLight, themeDark, themeSystem;
    private View quietTimes;
    private long previewShown;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Log.i(TAG, "onCreate (again: " + (state != null) + ")");
        setContentView(R.layout.activity_main);
        prefs = Prefs.of(this);
        bind();
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pending == null && !busy) show();
    }

    @Override
    protected void onDestroy() {
        work.shutdown();
        super.onDestroy();
    }

    // ── Views ─────────────────────────────────────────────────────────────────────────

    private void bind() {
        paneConnect = findViewById(R.id.pane_connect);
        paneConfirm = findViewById(R.id.pane_confirm);
        paneSettings = findViewById(R.id.pane_settings);
        connectProblem = findViewById(R.id.connect_problem);
        confirmProblem = findViewById(R.id.confirm_problem);
        problem = findViewById(R.id.problem);
        confirmBody = findViewById(R.id.confirm_body);
        keepCopy = findViewById(R.id.keep_copy);
        keepNote = findViewById(R.id.keep_note);
        confirmGo = findViewById(R.id.confirm_go);
        refresh = findViewById(R.id.refresh);
        preview = findViewById(R.id.preview);
        dayDate = findViewById(R.id.day_date);
        dayHeadline = findViewById(R.id.day_headline);
        dayLines = findViewById(R.id.day_lines);
        dayStatus = findViewById(R.id.day_status);
        swLock = findViewById(R.id.sw_lock);
        swHome = findViewById(R.id.sw_home);
        swQuiet = findViewById(R.id.sw_quiet);
        swTitles = findViewById(R.id.sw_titles);
        themeLight = findViewById(R.id.theme_light);
        themeDark = findViewById(R.id.theme_dark);
        themeSystem = findViewById(R.id.theme_system);
        quietTimes = findViewById(R.id.quiet_times);
        quietFrom = findViewById(R.id.quiet_from);
        quietTo = findViewById(R.id.quiet_to);
        connServer = findViewById(R.id.conn_server);
        connAccount = findViewById(R.id.conn_account);

        findViewById(R.id.preview_frame).setClipToOutline(true);
        findViewById(R.id.paste).setOnClickListener(v -> paste());
        confirmGo.setOnClickListener(v -> confirm());
        findViewById(R.id.confirm_cancel).setOnClickListener(v -> {
            pending = null;
            show();
        });
        refresh.setOnClickListener(v -> refreshNow(true));
        themeLight.setOnClickListener(v -> chooseTheme(Prefs.THEME_LIGHT));
        themeDark.setOnClickListener(v -> chooseTheme(Prefs.THEME_DARK));
        themeSystem.setOnClickListener(v -> chooseTheme(Prefs.THEME_SYSTEM));
        quietFrom.setOnClickListener(v -> pickTime(true));
        quietTo.setOnClickListener(v -> pickTime(false));
        // Android 8+ launchers can take the widget with one tap; otherwise the note says how.
        AppWidgetManager widgets = getSystemService(AppWidgetManager.class);
        boolean canPin = widgets != null && widgets.isRequestPinAppWidgetSupported();
        ((TextView) findViewById(R.id.show_on_note)).setText(canPin ? R.string.show_on_note_pin : R.string.show_on_note);
        View addWidget = findViewById(R.id.add_widget);
        addWidget.setVisibility(canPin ? View.VISIBLE : View.GONE);
        addWidget.setOnClickListener(v -> widgets.requestPinAppWidget(new ComponentName(this, DayWidget.class), null, null));
        findViewById(R.id.open_app).setOnClickListener(v -> openRecollect());
        findViewById(R.id.disconnect).setOnClickListener(v -> askDisconnect());
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        findViewById(R.id.realme).setVisibility(maker.contains("realme") || maker.contains("oppo") ? View.VISIBLE : View.GONE);
        findViewById(R.id.app_info).setOnClickListener(v -> startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        ((TextView) findViewById(R.id.version)).setText(getString(R.string.version, BuildConfig.VERSION));
    }

    private void only(View pane) {
        paneConnect.setVisibility(pane == paneConnect ? View.VISIBLE : View.GONE);
        paneConfirm.setVisibility(pane == paneConfirm ? View.VISIBLE : View.GONE);
        paneSettings.setVisibility(pane == paneSettings ? View.VISIBLE : View.GONE);
    }

    private static void notice(View box, String text) {
        box.setVisibility(text == null ? View.GONE : View.VISIBLE);
        ((TextView) box.findViewById(R.id.notice_text)).setText(text == null ? "" : text);
    }

    private void toast(int text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }

    // ── Which pane ────────────────────────────────────────────────────────────────────

    private void handle(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null) {
            show();
            return;
        }
        intent.setData(null); // a later resume doesn't run it again
        try {
            pending = ConnectLink.parse(data.toString());
            showConfirm(null);
        } catch (ConnectLink.Refused r) {
            pending = null;
            if (prefs.connected()) {
                showSettings();
                toast(r.needsHttps ? R.string.bad_link_http : R.string.bad_link);
            } else {
                showConnect(getString(r.needsHttps ? R.string.bad_link_http : R.string.bad_link));
            }
        }
    }

    private void show() {
        if (pending != null) showConfirm(null);
        else if (prefs.connected()) showSettings();
        else showConnect(null);
    }

    // ── Not connected ─────────────────────────────────────────────────────────────────

    private void showConnect(String text) {
        only(paneConnect);
        notice(connectProblem, text);
    }

    private void paste() {
        ClipboardManager cm = getSystemService(ClipboardManager.class);
        ClipData clip = cm == null ? null : cm.getPrimaryClip();
        CharSequence text = clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).coerceToText(this) : null;
        if (text == null || text.length() == 0) {
            notice(connectProblem, getString(R.string.connect_paste_none));
            return;
        }
        try {
            pending = ConnectLink.parse(text.toString());
            showConfirm(null);
        } catch (ConnectLink.Refused r) {
            notice(connectProblem, getString(r.needsHttps ? R.string.bad_link_http : R.string.connect_paste_none));
        }
    }

    // ── A link arrived ────────────────────────────────────────────────────────────────

    private void showConfirm(String text) {
        only(paneConfirm);
        confirmBody.setText(getString(R.string.confirm_body, ConnectLink.hostOf(pending.server)));
        boolean offer = Wallpapers.offerCopy(this);
        keepCopy.setVisibility(offer ? View.VISIBLE : View.GONE);
        keepNote.setVisibility(offer && !Wallpapers.mayRead(this) ? View.VISIBLE : View.GONE);
        if (offer && text == null) keepCopy.setChecked(true);
        notice(confirmProblem, text);
        busy(confirmGo, false, R.string.confirm_go);
    }

    private void confirm() {
        if (pending == null || busy) return;
        boolean keep = keepCopy.getVisibility() == View.VISIBLE && keepCopy.isChecked();
        prefs.setKeepCopy(keep);
        if (keep && !Wallpapers.mayRead(this)) {
            requestPermissions(new String[] {Manifest.permission.READ_EXTERNAL_STORAGE}, ASK_READ);
            return; // goes on in onRequestPermissionsResult, with or without the copy
        }
        connect();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code == ASK_READ && pending != null) connect();
    }

    private void connect() {
        final ConnectLink link = pending;
        final Context app = getApplicationContext();
        busy(confirmGo, true, R.string.confirm_busy);
        work.execute(() -> {
            String failed = null;
            try {
                JSONObject data = new Api(link.server, link.token).widget(!prefs.hideTitles()); // the code works
                prefs.connect(link.server, link.token);
                prefs.saveAmbient(data, System.currentTimeMillis());
            } catch (Api.Failure f) {
                failed = Refresher.words(app, f, link.server);
            }
            if (failed == null) {
                Refresher.run(app, true); // the picture, now
                Schedule.next(app);
                DayWidget.updateAll(app);
            }
            final String why = failed;
            main.post(() -> {
                if (isDestroyed()) return;
                busy = false;
                if (why != null) {
                    showConfirm(why);
                    return;
                }
                pending = null;
                toast(prefs.lock() ? R.string.connected_toast : R.string.connected_toast_off);
                showSettings();
            });
        });
    }

    private void busy(Button b, boolean on, int text) {
        busy = on;
        b.setEnabled(!on);
        b.setAlpha(on ? 0.6f : 1f);
        b.setText(text);
    }

    // ── Connected ─────────────────────────────────────────────────────────────────────

    private void showSettings() {
        only(paneSettings);
        Ambient a = prefs.ambient();
        dayDate.setText(a == null ? "" : a.date);
        dayHeadline.setText(a == null ? getString(R.string.status_never) : (a.headline.isEmpty() && a.done() ? getString(R.string.done_today) : a.headline));
        String lines = a == null ? "" : String.join("\n", a.lines);
        dayLines.setText(lines);
        dayLines.setVisibility(lines.isEmpty() ? View.GONE : View.VISIBLE);
        long at = prefs.okAt();
        Calendar now = Calendar.getInstance();
        if ((prefs.lock() || prefs.home()) && prefs.inQuietHours(now)) {
            dayStatus.setText(getString(R.string.status_quiet, clock(prefs.quietTo())));
        } else {
            dayStatus.setText(at == 0 ? getString(R.string.status_never) : getString(R.string.status_updated, DayWidget.when(this, at)));
        }
        showPreview();
        notice(problem, prefs.failure());

        toggle(swLock, prefs.lock(), this::setLock);
        toggle(swHome, prefs.home(), this::setHome);
        toggle(swQuiet, prefs.quiet(), on -> {
            prefs.setQuiet(on);
            Schedule.next(this);
            showSettings();
        });
        toggle(swTitles, prefs.hideTitles(), on -> {
            prefs.setHideTitles(on);
            refreshNow(false);
        });
        String theme = prefs.theme();
        themeLight.setSelected(Prefs.THEME_LIGHT.equals(theme));
        themeDark.setSelected(Prefs.THEME_DARK.equals(theme));
        themeSystem.setSelected(Prefs.THEME_SYSTEM.equals(theme));
        quietFrom.setText(clock(prefs.quietFrom()));
        quietTo.setText(clock(prefs.quietTo()));
        quietTimes.setAlpha(prefs.quiet() ? 1f : 0.45f);
        quietFrom.setEnabled(prefs.quiet());
        quietTo.setEnabled(prefs.quiet());

        String server = prefs.server();
        connServer.setText(server == null ? "" : getString(R.string.connected_to, ConnectLink.hostOf(server)));
        String who = a == null ? null : (a.accountName != null && a.accountEmail != null ? a.accountName + " · " + a.accountEmail : a.accountEmail);
        connAccount.setText(who == null ? "" : who);
        connAccount.setVisibility(who == null ? View.GONE : View.VISIBLE);
    }

    private interface OnToggle {
        void changed(boolean on);
    }

    private static void toggle(Switch s, boolean on, OnToggle then) {
        s.setOnCheckedChangeListener(null);
        s.setChecked(on);
        s.setOnCheckedChangeListener((CompoundButton b, boolean now) -> then.changed(now));
    }

    /** The last picture, scaled to the card; it fades in when it changed (the screen's one moment). */
    private void showPreview() {
        File f = Wallpapers.preview(this);
        if (!f.exists()) {
            preview.setImageDrawable(null);
            return;
        }
        if (f.lastModified() == previewShown) return;
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inSampleSize = 4; // 1080 x 2340 → 270 x 585, plenty for an 84 dp card
        Bitmap b = BitmapFactory.decodeFile(f.getPath(), o);
        if (b == null) return;
        boolean changed = previewShown != 0;
        previewShown = f.lastModified();
        preview.setImageBitmap(b);
        if (changed && ValueAnimator.areAnimatorsEnabled()) {
            preview.setAlpha(0f);
            preview.animate().alpha(1f).setDuration(200).start();
        }
    }

    private void setLock(boolean on) {
        prefs.setLock(on);
        if (on) refreshNow(false);
        else takeOff(false, true);
    }

    private void setHome(boolean on) {
        prefs.setHome(on);
        if (on) refreshNow(false);
        else takeOff(true, false);
    }

    /** A screen switched off: our picture comes off it (his own back from the copy, when there is one). */
    private void takeOff(boolean home, boolean lock) {
        final Context app = getApplicationContext();
        work.execute(() -> {
            int result = Wallpapers.putBack(app, home, lock);
            // When the two screens shared our picture, clearing one can take it off both: the other
            // screen, still on, gets it again.
            if (prefs.home() || prefs.lock()) Refresher.run(app, true);
            main.post(() -> toast(result == Wallpapers.RESTORED ? R.string.put_back
                    : result == Wallpapers.HOME_BUILT_IN_BACK ? R.string.home_built_in
                    : result == Wallpapers.LOCK_SHOWS_HOME ? R.string.lock_shows_home
                    : home ? R.string.home_kept : R.string.lock_kept));
        });
        showSettings();
    }

    private void chooseTheme(String theme) {
        if (theme.equals(prefs.theme())) return;
        prefs.setTheme(theme);
        DayWidget.updateAll(this);
        refreshNow(false);
    }

    /** `button`: Refresh now (it says so while it works); otherwise one of his changes. */
    private void refreshNow(boolean button) {
        final Context app = getApplicationContext();
        if (button) busy(refresh, true, R.string.refreshing);
        else showSettings();
        work.execute(() -> {
            final Refresher.Outcome out = Refresher.run(app, true);
            if (out.revoked) forget(app);
            main.post(() -> {
                if (isDestroyed()) return;
                if (button) busy(refresh, false, R.string.refresh);
                if (out.revoked) {
                    showConnect(out.problem);
                    return;
                }
                showSettings();
                if (button && out.ok) toast(R.string.refreshed);
            });
        });
    }

    private void pickTime(boolean from) {
        int m = from ? prefs.quietFrom() : prefs.quietTo();
        new TimePickerDialog(this, (picker, hour, minute) -> {
            int value = hour * 60 + minute;
            if (from) prefs.setQuietTimes(value, prefs.quietTo());
            else prefs.setQuietTimes(prefs.quietFrom(), value);
            Schedule.next(this);
            showSettings();
        }, m / 60, m % 60, DateFormat.is24HourFormat(this)).show();
    }

    private String clock(int minutes) {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, minutes / 60);
        c.set(Calendar.MINUTE, minutes % 60);
        return DateFormat.getTimeFormat(this).format(c.getTime());
    }

    private void openRecollect() {
        Ambient a = prefs.ambient();
        String url = a == null ? null : appUrl(a.appUrl, prefs.server());
        if (url == null) {
            toast(R.string.open_recollect_none);
            return;
        }
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }

    /**
     * The web app's address for this phone: the server names it; when it says localhost but the
     * phone reaches the server elsewhere (the hotspot), the same computer at that address.
     */
    static String appUrl(String appUrl, String server) {
        if (appUrl == null) return null;
        Uri app = Uri.parse(appUrl);
        Uri srv = server == null ? null : Uri.parse(server);
        String host = app.getHost();
        boolean loopback = "localhost".equals(host) || "127.0.0.1".equals(host);
        if (loopback && srv != null && srv.getHost() != null && !"localhost".equals(srv.getHost()) && !"127.0.0.1".equals(srv.getHost())) {
            String port = app.getPort() == -1 ? "" : ":" + app.getPort();
            return app.buildUpon().encodedAuthority(srv.getHost() + port).build().toString();
        }
        return appUrl;
    }

    private void askDisconnect() {
        String body = getString(Wallpapers.hasCopy(this) ? R.string.disconnect_body_back : R.string.disconnect_body_kept);
        if (!Wallpapers.hasCopy(this) && prefs.home()) body += " " + getString(R.string.home_kept);
        new AlertDialog.Builder(this)
                .setTitle(R.string.disconnect_title)
                .setMessage(body)
                .setPositiveButton(R.string.disconnect_go, (d, w) -> disconnect())
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void disconnect() {
        final Context app = getApplicationContext();
        final String server = prefs.server();
        final String token = prefs.token();
        final boolean home = prefs.home();
        final boolean lock = prefs.lock();
        work.execute(() -> {
            if (server != null && token != null) {
                try {
                    new Api(server, token).disconnect();
                } catch (Api.Failure ignored) {
                    // Unreachable: the token still ends when he revokes it in Settings → Agents.
                }
            }
            Wallpapers.putBack(app, home, lock);
            Wallpapers.forgetCopy(app);
            forget(app);
            main.post(() -> {
                if (isDestroyed()) return;
                toast(R.string.disconnected);
                showConnect(null);
            });
        });
    }

    /** Not connected any more (Disconnect, or the server ended the code): stop and forget the server. */
    static void forget(Context ctx) {
        Prefs.of(ctx).disconnect();
        // The last picture belonged to that connection (another account may connect next).
        Wallpapers.preview(ctx).delete();
        Schedule.cancel(ctx);
        DayWidget.updateAll(ctx);
    }
}
