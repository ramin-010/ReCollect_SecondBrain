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
import android.content.pm.PackageManager;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.Calendar;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The one screen: connect (from the server's page, or a pasted link), then the buddy's line and note
 * (0.3.0: thumbs, "Tell your buddy", what it said lately), the picture of the day, and where it shows,
 * its theme, quiet hours, titles and the notes' notifications; Refresh now; Disconnect.
 */
public final class MainActivity extends Activity {
    private static final int ASK_READ = 7;
    private static final int ASK_NOTIFY = 8;
    /** Lines under "Lately" (with the line for now: the last seven). */
    private static final int LATELY_MAX = 6;
    /** The screen is open: it shows a new note itself, so no notification for it. */
    static volatile boolean inFront;
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
    private Switch swLock, swHome, swQuiet, swTitles, swNotify, swReminders;
    private View buddy, lineRow, noteRow, latelyTitle;
    private TextView buddyTitle, buddyLine, buddyEmpty, buddyNote;
    private ImageButton lineMore, lineLess, noteMore, noteLess;
    private EditText tell;
    private View tellGo;
    /** The live lock screen (0.4.0). */
    private Switch swLive;
    private TextView liveNote;
    private View liveGroup, liveActions, liveAccess, liveSet;
    private LinearLayout lately;
    /** The styles' small pictures, by style, colour and theme (filled in the background). */
    private final java.util.Map<String, Bitmap> styleThumbs = new java.util.concurrent.ConcurrentHashMap<>();
    /** The picture theme the thumbnails were last fetched for (once per theme while the screen is open). */
    private String thumbsFor;
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
        // 0.5.2: after the system stops the app, Android recreates it with the intent it was first opened
        // with, the connect link, so a connected app showed "Connect to Recollect?" again. A recreated
        // screen (`state`) or one opened from Recents never replays its link.
        boolean replay = state != null || (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
        if (replay) show();
        else handle(getIntent());
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
        inFront = true;
        if (pending == null && !busy) show();
        if (prefs.server() != null && prefs.lock() && prefs.live() && NotifIcons.allowed(this) && Live.active(this) && !Live.hasPictures(this)) refreshNow(false);
    }

    @Override
    protected void onPause() {
        inFront = false;
        super.onPause();
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
        swNotify = findViewById(R.id.sw_notify);
        swReminders = findViewById(R.id.sw_reminders);
        buddy = findViewById(R.id.buddy);
        buddyTitle = findViewById(R.id.buddy_title);
        lineRow = findViewById(R.id.line_row);
        buddyLine = findViewById(R.id.buddy_line);
        lineMore = findViewById(R.id.line_more);
        lineLess = findViewById(R.id.line_less);
        buddyEmpty = findViewById(R.id.buddy_empty);
        noteRow = findViewById(R.id.note_row);
        buddyNote = findViewById(R.id.buddy_note);
        noteMore = findViewById(R.id.note_more);
        noteLess = findViewById(R.id.note_less);
        tell = findViewById(R.id.tell);
        tellGo = findViewById(R.id.tell_go);
        latelyTitle = findViewById(R.id.lately_title);
        lately = findViewById(R.id.lately);
        tellGo.setOnClickListener(v -> tell());
        swLive = findViewById(R.id.sw_live);
        liveNote = findViewById(R.id.live_note);
        liveGroup = findViewById(R.id.live_group);
        liveActions = findViewById(R.id.live_actions);
        liveAccess = findViewById(R.id.live_access);
        liveSet = findViewById(R.id.live_set);
        liveAccess.setOnClickListener(v -> openListenerAccess());
        liveSet.setOnClickListener(v -> openLivePicker());
        tell.setOnEditorActionListener((v, action, event) -> {
            if (action != EditorInfo.IME_ACTION_SEND) return false;
            tell();
            return true;
        });

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
            // 0.5.2: the link this phone already holds is no news: the app shows where it is.
            if (prefs.connected() && pending.server.equals(prefs.server()) && pending.token.equals(prefs.token())) {
                pending = null;
                showSettings();
                return;
            }
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
        if (code == ASK_NOTIFY) {
            boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            if (!granted) {
                prefs.setNotesOn(false);
                toast(R.string.notify_denied);
            }
            if (prefs.connected()) showSettings();
        }
    }

    /** Android 13 and newer ask for notifications; once on his first visit, and when he turns them on. */
    private boolean mayNotify() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void askNotify() {
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, ASK_NOTIFY);
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
        // One headline, what is left and how long ("9 left today · about 56 min"), and under it what by
        // kind ("7 reviews · 2 tasks"; 0.3.1: the card said the same thing twice). An older server: its
        // headline and quieter lines.
        String headline = a == null ? getString(R.string.status_never)
                : a.numbers != null ? a.numbers
                : (a.headline.isEmpty() && a.done() ? getString(R.string.done_today) : a.headline);
        dayHeadline.setText(headline);
        String lines = a == null ? "" : a.numbers != null ? (a.breakdown == null ? "" : a.breakdown) : String.join("\n", a.lines);
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
        showBuddy(a == null ? null : a.buddy);
        showAsks(a);
        showStyles();
        if (BuildConfig.QA) showWidgetPreview();
        toggle(swNotify, prefs.notesOn(), on -> {
            prefs.setNotesOn(on);
            if (on && !mayNotify()) askNotify();
        });
        // 0.5.0: reminders ring on this phone; off cancels every alarm (the email then covers them).
        toggle(swReminders, prefs.remindersOn(), on -> {
            prefs.setRemindersOn(on);
            if (on) {
                if (!mayNotify()) askNotify();
                refreshNow(false);
            } else Reminders.cancelAll(this);
        });
        if (prefs.notesOn() && !mayNotify() && !prefs.askedNotify()) {
            prefs.setAskedNotify();
            askNotify();
        }

        toggle(swLock, prefs.lock(), this::setLock);
        toggle(swHome, prefs.home(), this::setHome);
        toggle(swLive, prefs.live(), this::setLive);
        showLive();
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

    // ── The buddy (0.3.0) ─────────────────────────────────────────────────────────────

    /** Its line for now and its note (each with thumbs), what it said lately; hidden while it is off. */
    private void showBuddy(Ambient.Buddy b) {
        buddy.setVisibility(b == null ? View.GONE : View.VISIBLE);
        if (b == null) return;
        buddyTitle.setText(b.title(this));
        Ambient.Line now = !b.lines.isEmpty() && b.lines.get(0).current ? b.lines.get(0) : null;
        lineRow.setVisibility(now == null ? View.GONE : View.VISIBLE);
        if (now != null) {
            buddyLine.setText(now.text);
            thumbs(lineMore, lineLess, b, now.dayId, now.slot);
        }
        buddyEmpty.setVisibility(now == null ? View.VISIBLE : View.GONE);
        buddyEmpty.setText(b.lines.isEmpty() && b.note == null ? R.string.buddy_first : R.string.buddy_nothing);
        noteRow.setVisibility(b.note == null ? View.GONE : View.VISIBLE);
        if (b.note != null) {
            buddyNote.setText(b.note.text);
            thumbs(noteMore, noteLess, b, b.note.dayId, "note");
            Notes.seen(this, b.note); // read here: no notification for it
        }
        lately.removeAllViews();
        int shown = 0;
        for (Ambient.Line l : b.lines) {
            if (l == now || shown == LATELY_MAX) continue;
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(0, dp(16), 0, 0);
            TextView when = new TextView(this, null, 0, R.style.Text_Meta);
            when.setText(l.when);
            TextView text = new TextView(this, null, 0, R.style.Text_Body);
            text.setText(l.text);
            text.setTextIsSelectable(true);
            row.addView(when);
            row.addView(text);
            lately.addView(row);
            shown++;
        }
        latelyTitle.setVisibility(shown > 0 ? View.VISIBLE : View.GONE);
        lately.setVisibility(shown > 0 ? View.VISIBLE : View.GONE);
    }

    /** 0.6.0: the buddy's open questions on the app's screen, above its line, each with its quick answers. */
    private LinearLayout askBox;

    private void showAsks(Ambient a) {
        if (askBox == null) {
            askBox = new LinearLayout(this);
            askBox.setOrientation(LinearLayout.VERTICAL);
            android.view.ViewGroup parent = (android.view.ViewGroup) lineRow.getParent();
            parent.addView(askBox, parent.indexOfChild(lineRow));
        }
        askBox.removeAllViews();
        if (a == null || a.buddy == null) return;
        long now = System.currentTimeMillis();
        for (Ambient.Ask q : a.asks) {
            if (Asks.answered(this, q.id) || (q.until > 0 && q.until <= now)) continue;
            TextView text = new TextView(this, null, 0, R.style.Text_Body);
            text.setText(q.text);
            text.setPadding(0, dp(8), 0, dp(6));
            askBox.addView(text);
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setPadding(0, 0, 0, dp(12));
            for (int i = 0; i < q.answers.size(); i++) {
                final int choice = i;
                Button b = new Button(this);
                b.setText(q.answers.get(i));
                b.setAllCaps(false);
                b.setOnClickListener(v -> {
                    v.setEnabled(false);
                    new Thread(() -> {
                        Asks.answer(getApplicationContext(), q.id, choice, null);
                        runOnUiThread(() -> showAsks(prefs.ambient()));
                    }, "recollect-answer").start();
                });
                row.addView(b);
            }
            askBox.addView(row);
        }
    }

    // ── The pictures' style (0.3.0) ───────────────────────────────────────────────────

    private static JSONArray parseStyles(String json) {
        if (json == null) return null;
        try {
            return new JSONArray(json);
        } catch (org.json.JSONException e) {
            return null;
        }
    }

    private static String thumbKey(String style, String color, String theme) {
        return style + "|" + color + "|" + theme;
    }

    /** The styles as small lock pictures (the server draws them), the chosen one ringed, then its colours. */
    private void showStyles() {
        LinearLayout list = findViewById(R.id.style_list);
        LinearLayout colors = findViewById(R.id.color_list);
        TextView note = findViewById(R.id.style_note);
        String theme = Refresher.pictureTheme(this, prefs.theme());
        if (!theme.equals(thumbsFor)) loadStyles(theme);
        JSONArray arr = parseStyles(prefs.stylesJson());
        list.removeAllViews();
        colors.removeAllViews();
        if (arr == null) {
            note.setText(R.string.style_loading);
            return;
        }
        String chosen = prefs.style();
        JSONObject chosenStyle = null;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject st = arr.optJSONObject(i);
            if (st == null) continue;
            String id = st.optString("id");
            boolean on = id.equals(chosen);
            if (on) chosenStyle = st;
            LinearLayout cell = new LinearLayout(this);
            cell.setOrientation(LinearLayout.VERTICAL);
            cell.setPadding(dp(4), 0, dp(6), 0);
            android.widget.FrameLayout frame = new android.widget.FrameLayout(this);
            frame.setBackgroundResource(R.drawable.bg_style);
            frame.setPadding(dp(3), dp(3), dp(3), dp(3));
            frame.setSelected(on);
            ImageView img = new ImageView(this);
            img.setScaleType(ImageView.ScaleType.CENTER_CROP);
            img.setOutlineProvider(new android.view.ViewOutlineProvider() {
                @Override
                public void getOutline(View v, android.graphics.Outline o) {
                    o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), dp(13));
                }
            });
            img.setClipToOutline(true);
            Bitmap b = styleThumbs.get(thumbKey(id, on ? prefs.color() : null, theme));
            if (b != null) img.setImageBitmap(b);
            else img.setBackgroundColor(getColor(R.color.surface_2));
            frame.addView(img, new android.widget.FrameLayout.LayoutParams(dp(82), dp(178)));
            cell.addView(frame);
            TextView name = new TextView(this, null, 0, R.style.Text_Meta);
            name.setText(st.optString("name", id));
            name.setGravity(android.view.Gravity.CENTER_HORIZONTAL);
            name.setPadding(0, dp(8), 0, 0);
            name.setTextColor(getColor(on ? R.color.ink_1 : R.color.ink_3));
            cell.addView(name, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
            cell.setContentDescription(st.optString("name", id));
            cell.setOnClickListener(v -> choose(id, null));
            list.addView(cell);
        }
        // The chosen style's colours: round swatches, the chosen one ringed (the sky follows the hour).
        JSONArray cs = chosenStyle == null ? null : chosenStyle.optJSONArray("colors");
        String color = prefs.color();
        for (int i = 0; cs != null && cs.length() > 1 && i < cs.length(); i++) {
            JSONObject c = cs.optJSONObject(i);
            if (c == null) continue;
            String id = c.optString("id");
            boolean on = id.equals(color) || (color == null && i == 0);
            View dot = new View(this);
            android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
            g.setShape(android.graphics.drawable.GradientDrawable.OVAL);
            try {
                g.setColor(android.graphics.Color.parseColor(c.optString("swatch", "#888888")));
            } catch (IllegalArgumentException e) {
                g.setColor(0xFF888888);
            }
            g.setStroke(dp(on ? 3 : 1), getColor(on ? R.color.accent_fill : R.color.line_strong));
            dot.setBackground(g);
            dot.setContentDescription(c.optString("name", id));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(32), dp(32));
            lp.setMarginEnd(dp(12));
            final String styleId = chosen;
            dot.setOnClickListener(v -> choose(styleId, id));
            colors.addView(dot, lp);
        }
        colors.setVisibility(colors.getChildCount() > 0 ? View.VISIBLE : View.GONE);
        String colorName = null;
        for (int i = 0; cs != null && i < cs.length(); i++) {
            JSONObject c = cs.optJSONObject(i);
            if (c != null && (c.optString("id").equals(color) || (color == null && i == 0))) colorName = c.optString("name");
        }
        note.setText(chosenStyle == null ? "" : getString(R.string.style_note, chosenStyle.optString("name"), chosenStyle.optString("blurb") + (colorName != null && cs.length() > 1 ? " · " + colorName : "")));
    }

    /** The styles from the server and their small pictures, in the background (once per theme while open). */
    private void loadStyles(String theme) {
        thumbsFor = theme;
        final String server = prefs.server();
        final String token = prefs.token();
        if (server == null || token == null) return;
        final boolean titles = !prefs.hideTitles();
        final String chosen = prefs.style();
        final String chosenColor = prefs.color();
        work.execute(() -> {
            Api api = new Api(server, token);
            try {
                prefs.saveStyles(api.styles());
            } catch (Api.Failure f) {
                return; // an older server or none: the section says it is loading, the sky stays
            }
            main.post(this::showStylesIfOpen);
            JSONArray arr = parseStyles(prefs.stylesJson());
            for (int i = 0; arr != null && i < arr.length(); i++) {
                String id = arr.optJSONObject(i) == null ? null : arr.optJSONObject(i).optString("id");
                if (id == null) continue;
                String color = id.equals(chosen) ? chosenColor : null;
                if (styleThumbs.containsKey(thumbKey(id, color, theme))) continue;
                try {
                    byte[] png = api.wallpaper(216, 468, theme, titles, "lock", id, color);
                    Bitmap b = BitmapFactory.decodeByteArray(png, 0, png.length);
                    if (b != null) styleThumbs.put(thumbKey(id, color, theme), b);
                } catch (Api.Failure f) {
                    break;
                }
                main.post(this::showStylesIfOpen);
            }
        });
    }

    private void showStylesIfOpen() {
        if (!isDestroyed() && paneSettings.getVisibility() == View.VISIBLE) showStyles();
    }

    /** His pick: the style (its first colour) or a colour of the chosen style; the pictures change now. */
    private void choose(String style, String color) {
        if (style.equals(prefs.style()) && java.util.Objects.equals(color, prefs.color())) return;
        prefs.setLook(style, color);
        String theme = Refresher.pictureTheme(this, prefs.theme());
        if (!styleThumbs.containsKey(thumbKey(style, color, theme))) {
            final String server = prefs.server();
            final String token = prefs.token();
            final boolean titles = !prefs.hideTitles();
            if (server != null && token != null) work.execute(() -> {
                try {
                    byte[] png = new Api(server, token).wallpaper(216, 468, theme, titles, "lock", style, color);
                    Bitmap b = BitmapFactory.decodeByteArray(png, 0, png.length);
                    if (b != null) styleThumbs.put(thumbKey(style, color, theme), b);
                    main.post(this::showStylesIfOpen);
                } catch (Api.Failure ignored) {
                    // the thumbnail stays empty; the picture itself still changes below
                }
            });
        }
        refreshNow(false);
    }

    /** The QA app: the widget's two sizes, inflated from the same views the launcher gets. */
    private void showWidgetPreview() {
        LinearLayout box = findViewById(R.id.widget_preview);
        box.setVisibility(View.VISIBLE);
        box.removeAllViews();
        TextView title = new TextView(this, null, 0, R.style.Text_Section);
        title.setText("Widget preview (QA app)");
        box.addView(title);
        for (boolean small : new boolean[] {false, true}) {
            View w = DayWidget.views(this, small).apply(this, box);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(small ? 72 : 168));
            lp.topMargin = dp(10);
            box.addView(w, lp);
        }
        java.util.List<NotifIcons.Item> sample = new java.util.ArrayList<>();
        int[] res = {android.R.drawable.stat_notify_chat, android.R.drawable.sym_action_email, android.R.drawable.stat_sys_download_done, android.R.drawable.stat_notify_more};
        for (int i = 0; i < res.length; i++) sample.add(new NotifIcons.Item("android", android.graphics.drawable.Icon.createWithResource("android", res[i]), 1, i));
        Bitmap live = Live.preview(this, dp(150) * 2, sample);
        if (live != null) {
            TextView t2 = new TextView(this, null, 0, R.style.Text_Section);
            t2.setText(R.string.live_preview_title);
            t2.setPadding(0, dp(20), 0, 0);
            box.addView(t2);
            ImageView img = new ImageView(this);
            img.setImageBitmap(live);
            img.setAdjustViewBounds(true);
            img.setScaleType(ImageView.ScaleType.FIT_START);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(150), LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(10);
            box.addView(img, lp);
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /** Two thumbs for one line or the note: the one he gave filled, on the selected fill. */
    private void thumbs(ImageButton more, ImageButton less, Ambient.Buddy b, String dayId, String target) {
        String given = b.thumb(dayId, target);
        more.setSelected("more".equals(given));
        less.setSelected("less".equals(given));
        more.setImageResource("more".equals(given) ? R.drawable.ic_thumb_up_on : R.drawable.ic_thumb_up);
        less.setImageResource("less".equals(given) ? R.drawable.ic_thumb_down_on : R.drawable.ic_thumb_down);
        more.setOnClickListener(v -> thumb(dayId, target, "more"));
        less.setOnClickListener(v -> thumb(dayId, target, "less"));
    }

    private void thumb(String dayId, String target, String verdict) {
        final Context app = getApplicationContext();
        work.execute(() -> {
            String problem = Thumbs.give(app, dayId, target, verdict, () -> main.post(() -> {
                if (isDestroyed()) return;
                showSettings();
                DayWidget.updateAll(app);
            }));
            if (problem != null) main.post(() -> Toast.makeText(app, problem, Toast.LENGTH_SHORT).show());
        });
    }

    /** "Tell your buddy": his words go in as a private note for tonight. */
    private void tell() {
        String text = tell.getText().toString().replaceAll("\\s+", " ").trim();
        if (text.isEmpty() || !tellGo.isEnabled()) return;
        String server = prefs.server();
        String token = prefs.token();
        if (server == null || token == null) return;
        tellGo.setEnabled(false);
        tellGo.setAlpha(0.6f);
        // Sent: the keyboard goes, so the screen is his again.
        android.view.inputmethod.InputMethodManager ime = getSystemService(android.view.inputmethod.InputMethodManager.class);
        if (ime != null) ime.hideSoftInputFromWindow(tell.getWindowToken(), 0);
        tell.clearFocus();
        work.execute(() -> {
            int said;
            try {
                said = new Api(server, token).tell(text) ? R.string.told : R.string.tell_paused;
            } catch (Api.Failure f) {
                said = R.string.tell_failed;
            }
            final int result = said;
            main.post(() -> {
                if (isDestroyed()) return;
                tellGo.setEnabled(true);
                tellGo.setAlpha(1f);
                if (result == R.string.told) tell.setText("");
                toast(result);
            });
        });
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
        // The live lock screen lives on the lock screen: off with it.
        if (!on && prefs.live()) prefs.setLive(false);
        if (on) refreshNow(false);
        else takeOff(false, true);
    }

    // ── The live lock screen (0.4.0) ──────────────────────────────────────────────────

    /**
     * On: two steps of Android's own (notification access; the live wallpaper set in its picker), one
     * at a time, then the pictures come as files. Off: the pictures are set as plain wallpapers again.
     */
    private void setLive(boolean on) {
        prefs.setLive(on);
        showLive();
        if (!on) {
            // Plain pictures again; with the home screen off, his own home wallpaper comes back in place of the live one.
            refreshNow(false);
            if (!prefs.home()) takeOff(true, false);
            return;
        }
        if (!NotifIcons.allowed(this)) openListenerAccess();
        else if (!Live.active(this)) openLivePicker();
        else refreshNow(false);
    }

    /** The row's words and buttons say what is left to do. */
    private void showLive() {
        // The QA app shows the row with its lock screen off too (it never sets a wallpaper unless asked).
        liveGroup.setVisibility(prefs.lock() || BuildConfig.QA ? View.VISIBLE : View.GONE);
        if (!prefs.live()) {
            liveNote.setText(R.string.live_note_off);
            liveActions.setVisibility(View.GONE);
            return;
        }
        boolean allowed = NotifIcons.allowed(this);
        boolean active = Live.active(this);
        liveAccess.setVisibility(allowed ? View.GONE : View.VISIBLE);
        liveSet.setVisibility(active ? View.GONE : View.VISIBLE);
        liveActions.setVisibility(allowed && active ? View.GONE : View.VISIBLE);
        if (!allowed && !active) liveNote.setText(R.string.live_note_access_and_set);
        else if (!allowed) liveNote.setText(R.string.live_note_access);
        else if (!active) liveNote.setText(R.string.live_note_set);
        else liveNote.setText(lockScreenCardsHidden() ? R.string.live_note_on_hidden : R.string.live_note_on);
    }

    /** Are the phone's own notification cards off on the lock screen? (Readable on Android 11; else unknown: false.) */
    private boolean lockScreenCardsHidden() {
        try {
            return android.provider.Settings.Secure.getInt(getContentResolver(), "lock_screen_show_notifications", 1) == 0;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private void openListenerAccess() {
        Intent i;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            i = new Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS);
            i.putExtra(android.provider.Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, new ComponentName(this, NotifIcons.class).flattenToString());
        } else {
            i = new Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        }
        try {
            startActivity(i);
        } catch (android.content.ActivityNotFoundException e) {
            startActivity(new Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
        }
    }

    private void openLivePicker() {
        Intent i = new Intent(android.app.WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
        i.putExtra(android.app.WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, new ComponentName(this, DayWallpaper.class));
        try {
            startActivity(i);
        } catch (android.content.ActivityNotFoundException e) {
            startActivity(new Intent(android.app.WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER));
        }
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
            // 0.6.0: the questions' notifications, the answers kept here, the kept pictures and their alarm go.
            Asks.clear(app);
            Laters.clear(app);
            Pictures.clear(app);
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
        // 0.5.0: no alarms ring for an account this phone no longer reads.
        Reminders.cancelAll(ctx);
        Prefs.of(ctx).disconnect();
        // The last picture belonged to that connection (another account may connect next).
        Wallpapers.preview(ctx).delete();
        Schedule.cancel(ctx);
        DayWidget.updateAll(ctx);
    }
}
