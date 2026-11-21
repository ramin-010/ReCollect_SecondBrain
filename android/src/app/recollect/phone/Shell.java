package app.recollect.phone;

import android.Manifest;
import android.app.Activity;
import android.app.TimePickerDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.text.format.DateFormat;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The phone app's shell (PHONE_APP_REDESIGN_PLAN §7 step 5): the web app's phone world (/m/...) in a full-screen
 * WebView, with the phone's own parts reached through a small bridge (window.RcShell): the system bars in the look's
 * colours, the app's own settings (the lock screen's style, what shows on the screens, quiet hours, notifications,
 * the connection), and voice for the mic. The native parts (refresh, alarms, questions, the pictures, the widget)
 * work as before; the old settings screen opens from Settings › More on this phone.
 *
 * Its first frame is the last look's ground colour (kept here), so it never opens blank or in the wrong colour. Back
 * closes a sheet first; on a tab it goes to Today, and on Today it leaves; a page under a tab goes back one page
 * (the tabs replace each other in the page's history, so Back never walks through old tabs). A text shared to the app opens the chat
 * with it in the field. In the test app only for now ("Your day QA", where build.mjs --qa makes it the launcher and
 * the share target); his app closes it at once until his OK.
 *
 *   adb shell am start -n app.recollect.phone.qa/app.recollect.phone.Shell                      (Today)
 *   adb shell am start -n app.recollect.phone.qa/app.recollect.phone.Shell -d <url> --ez overLock true   (tests)
 */
public final class Shell extends Activity {
    /** The web app on this computer, over USB (adb reverse tcp:3005 tcp:3005; its API on 8002, live editing on 1234). */
    static final String HOME = "http://localhost:3005";
    private static final int ASK_VOICE = 21;
    private static final int ASK_NOTIFY = 22;
    /** Paper's ground in light (mockups/phone-app/tokens.css): the default look's, until the page says another. */
    private static final int PAPER = Color.rgb(0xF5, 0xF0, 0xE6);

    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private SharedPreferences kept;
    private WebView web;
    private View offline;
    private TextView offlineTitle, offlineBody;
    private Button retry;
    /** The web app's origin: this computer, or another on the home network when a test opens the app with a page. */
    private String origin = HOME;
    /** The page now (the bridge answers only our own pages). */
    private volatile String pageUrl = "";
    private boolean lastWasLogin;
    private boolean failed;
    private volatile boolean refreshing;
    private boolean voice;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (!BuildConfig.QA) {
            finish();
            return;
        }
        kept = getSharedPreferences("shell", MODE_PRIVATE);
        // Tests run with his phone locked: the test app may show over the lock screen (it never unlocks it), on ask only.
        if (getIntent().getBooleanExtra("overLock", false) && Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
        // A test build lets the computer's DevTools look at the page (never his app: it never gets here).
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        voice = !getPackageManager().queryIntentActivities(new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), 0).isEmpty();

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        CookieManager.getInstance().setAcceptCookie(true);
        // The API is the same computer on another port (the same site): its sign-in cookie must ride along.
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new Client());
        web.addJavascriptInterface(new Bridge(), "RcShell");
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        offline = offlineView();
        root.addView(offline, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        paint(kept.getInt("ground", PAPER), kept.getBoolean("dark_icons", true));
        web.loadUrl(urlFor(getIntent()));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        boolean share = Intent.ACTION_SEND.equals(intent.getAction());
        if (web != null && (share || intent.getData() != null)) web.loadUrl(urlFor(intent));
    }

    @Override
    protected void onResume() {
        super.onResume();
        // The old settings screen may have changed something while it was open.
        emit("changed", null);
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        work.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** The page to open: a text shared to the app goes to the chat's field; a test may name a page; else Today. */
    private String urlFor(Intent i) {
        if (i != null && Intent.ACTION_SEND.equals(i.getAction())) {
            String text = i.getStringExtra(Intent.EXTRA_TEXT);
            String subject = i.getStringExtra(Intent.EXTRA_SUBJECT);
            if (text != null && !text.trim().isEmpty()) {
                String words = subject != null && !subject.trim().isEmpty() && !text.contains(subject.trim()) ? subject.trim() + "\n" + text.trim() : text.trim();
                if (words.length() > 4000) words = words.substring(0, 4000);
                return origin + "/m/buddy?q=" + Uri.encode(words);
            }
        }
        Uri data = i == null ? null : i.getData();
        // Only a page of the web app on this computer or the home network (any app may open an exported activity).
        if (data != null && ("http".equals(data.getScheme()) || "https".equals(data.getScheme())) && data.getHost() != null && ConnectLink.isLocal(data.getHost())) {
            origin = data.getScheme() + "://" + data.getEncodedAuthority();
            return data.toString();
        }
        return origin + "/m/today";
    }

    private boolean ours(Uri u) {
        return u != null && origin.equals(u.getScheme() + "://" + u.getEncodedAuthority());
    }

    // ── The look ──────────────────────────────────────────────────────────────────────

    /** The window, the page's background and the system bars in the look's ground colour; dark icons on a light one. */
    @SuppressWarnings("deprecation")
    private void paint(int ground, boolean darkIcons) {
        getWindow().getDecorView().setBackgroundColor(ground);
        getWindow().setStatusBarColor(ground);
        getWindow().setNavigationBarColor(ground);
        getWindow().getDecorView().setSystemUiVisibility(darkIcons ? View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
        web.setBackgroundColor(ground);
        offline.setBackgroundColor(ground);
        int ink = darkIcons ? Color.rgb(0x23, 0x20, 0x1B) : Color.rgb(0xEE, 0xE8, 0xDC);
        offlineTitle.setTextColor(ink);
        offlineBody.setTextColor(Color.argb(0xB0, Color.red(ink), Color.green(ink), Color.blue(ink)));
        retry.setTextColor(ink);
    }

    // ── When the page can't load ──────────────────────────────────────────────────────

    private View offlineView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        int pad = dp(32);
        box.setPadding(pad, pad, pad, pad);
        offlineTitle = new TextView(this);
        offlineTitle.setText(R.string.shell_offline_title);
        offlineTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        offlineTitle.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        offlineTitle.setGravity(Gravity.CENTER);
        offlineBody = new TextView(this);
        offlineBody.setText(R.string.shell_offline_body);
        offlineBody.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        offlineBody.setGravity(Gravity.CENTER);
        offlineBody.setLineSpacing(0, 1.2f);
        offlineBody.setPadding(0, dp(8), 0, dp(20));
        retry = new Button(this, null, android.R.attr.borderlessButtonStyle);
        retry.setText(R.string.shell_retry);
        retry.setAllCaps(false);
        retry.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        retry.setOnClickListener(v -> {
            failed = false;
            web.reload();
        });
        box.addView(offlineTitle);
        box.addView(offlineBody);
        box.addView(retry);
        box.setVisibility(View.GONE);
        box.setClickable(true);
        return box;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            if (ours(r.getUrl())) return false;
            // Anything else opens in the phone's browser, never inside the app (the bridge stays with our pages).
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl()));
            } catch (ActivityNotFoundException ignored) {
                // nothing can open it
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView v, String url, Bitmap icon) {
            pageUrl = url;
        }

        @Override
        public void doUpdateVisitedHistory(WebView v, String url, boolean reload) {
            pageUrl = url;
            boolean login = url.contains("/login");
            // After signing in, the login page is no step back.
            if (lastWasLogin && !login) main.post(v::clearHistory);
            lastWasLogin = login;
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            // The web app's service worker answers a page it can't load with its own offline page (public/offline.html):
            // the shell shows its own instead, in the look's colours, with what to check.
            v.evaluateJavascript("document.title.indexOf('Offline')===0", answer -> {
                if ("true".equals(answer)) failed = true;
                offline.setVisibility(failed ? View.VISIBLE : View.GONE);
            });
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (!r.isForMainFrame()) return;
            failed = true;
            offline.setVisibility(View.VISIBLE);
        }

        @Override
        public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
            // The page's process died (memory): start again rather than let the app go with it.
            main.post(Shell.this::recreate);
            return true;
        }
    }

    // ── Back ──────────────────────────────────────────────────────────────────────────

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null || offline.getVisibility() == View.VISIBLE) {
            moveTaskToBack(true);
            return;
        }
        // The page decides: a sheet closes; a tab other than Today goes to Today; Today leaves the app; a page under a
        // tab (Settings, Look, a doc) goes back one page. Pages outside the phone world (the login) go back, or leave.
        web.evaluateJavascript("window.__rcBack?window.__rcBack():'back'", answer -> {
            String step = answer == null ? "" : answer.replace("\"", "");
            if (step.equals("closed") || step.equals("today")) return;
            if (!step.equals("leave") && web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }

    // ── Voice ─────────────────────────────────────────────────────────────────────────

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != ASK_VOICE) return;
        ArrayList<String> heard = result == RESULT_OK && data != null ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        if (heard != null && !heard.isEmpty() && heard.get(0) != null && !heard.get(0).trim().isEmpty()) emit("heard", heard.get(0).trim());
        else emit("voice-none", null);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code != ASK_NOTIFY) return;
        if (results.length == 0 || results[0] != PackageManager.PERMISSION_GRANTED) {
            Prefs p = Prefs.of(this);
            p.setNotesOn(false);
            Toast.makeText(this, R.string.notify_denied, Toast.LENGTH_LONG).show();
        }
        emit("changed", null);
    }

    /** Tells the page something happened: window.__rcShell(kind, text). */
    private void emit(String kind, String text) {
        main.post(() -> {
            if (web == null || isDestroyed()) return;
            web.evaluateJavascript("window.__rcShell&&window.__rcShell(" + JSONObject.quote(kind) + "," + (text == null ? "null" : JSONObject.quote(text)) + ")", null);
        });
    }

    // ── The app's own settings, as the old screen sets them (MainActivity) ─────────────

    private void refreshInBackground() {
        final Context app = getApplicationContext();
        refreshing = true;
        emit("changed", null);
        work.execute(() -> {
            Refresher.Outcome out = Refresher.run(app, true);
            if (out.revoked) MainActivity.forget(app);
            refreshing = false;
            emit("changed", null);
        });
    }

    // ── Stage 11 (his items 10c, 10d): the permissions checklist and the diagnostics ──────────

    /** Each permission the app needs, with its state (ScreenLook's verdicts: ok, needed, not_asked, unknown). */
    private JSONObject permissions() throws JSONException {
        return permissionsOf(this);
    }

    static JSONObject permissionsOf(Context ctx) throws JSONException {
        android.app.AlarmManager am = ctx.getSystemService(android.app.AlarmManager.class);
        boolean exact = Build.VERSION.SDK_INT < 31 || (am != null && am.canScheduleExactAlarms());
        android.app.NotificationManager nm = ctx.getSystemService(android.app.NotificationManager.class);
        boolean granted = Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        android.os.PowerManager pm = ctx.getSystemService(android.os.PowerManager.class);
        boolean battery = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        JSONObject o = new JSONObject();
        o.put("exactAlarms", ScreenLook.exactAlarms(Build.VERSION.SDK_INT, exact));
        o.put("notifications", ScreenLook.notifications(Build.VERSION.SDK_INT, granted, nm != null && nm.areNotificationsEnabled()));
        o.put("battery", ScreenLook.battery(battery));
        o.put("autoStart", ScreenLook.autoStart(Build.MANUFACTURER));
        // Only the live lock screen needs it (its notification icons): optional.
        o.put("notificationAccess", NotifIcons.allowed(ctx) ? ScreenLook.OK : ScreenLook.NEEDED);
        return o;
    }

    /** The system's own screen for one permission; the app's details page when the phone has no better one. */
    private void openPermission(String kind) {
        String pkg = getPackageName();
        android.net.Uri pkgUri = android.net.Uri.parse("package:" + pkg);
        java.util.List<Intent> tries = new java.util.ArrayList<>();
        switch (kind) {
            case "exactAlarms":
                if (Build.VERSION.SDK_INT >= 31) tries.add(new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkgUri));
                break;
            case "notifications":
                if (Build.VERSION.SDK_INT >= 33 && !mayNotify()) {
                    requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, ASK_NOTIFY);
                    return;
                }
                tries.add(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, pkg));
                break;
            case "battery":
                tries.add(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                break;
            case "notificationAccess":
                tries.add(new Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
                break;
            case "autoStart":
                // The makers' own auto-start screens (each may move between versions: the next one is tried).
                String[][] makers = {
                    {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
                    {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
                    {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
                    {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
                    {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
                    {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
                    {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
                    {"com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"},
                    {"com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"},
                    {"com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"},
                };
                for (String[] m : makers) tries.add(new Intent().setComponent(new android.content.ComponentName(m[0], m[1])));
                break;
            default:
                return;
        }
        tries.add(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri));
        for (Intent i : tries) {
            try {
                startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            } catch (RuntimeException ignored) {
                // Not on this phone: the next.
            }
        }
    }

    /** The phone's facts for the owner (his item 10d): model, Android, screen, the wallpapers, permissions, last times. Nothing personal. */
    static JSONObject diagnostics(Context ctx, Prefs p) throws JSONException {
        int[] size = Wallpapers.screenSize(ctx);
        JSONObject screen = new JSONObject().put("width", size[0]).put("height", size[1]).put("density", ctx.getResources().getDisplayMetrics().density);
        ScreenLook lock = p.lockLook();
        ScreenLook home = p.homeLook();
        JSONObject wallpaper = new JSONObject()
            .put("lock", p.lock() ? lock.style : "own")
            .put("home", p.home() ? home.style : "own")
            .put("live", p.live())
            .put("zoom", Math.round(Wallpapers.homeZoom() * 100) / 100.0);
        JSONObject last = new JSONObject().put("read", p.okAt()).put("pictures", p.picturesAt());
        return new JSONObject()
            .put("appVersion", BuildConfig.VERSION)
            .put("maker", Build.MANUFACTURER == null ? JSONObject.NULL : Build.MANUFACTURER.trim())
            .put("model", Build.MODEL == null ? JSONObject.NULL : Build.MODEL.trim())
            .put("android", Build.VERSION.RELEASE)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("screen", screen)
            .put("wallpaper", wallpaper)
            .put("permissions", permissionsOf(ctx))
            .put("lastUpdates", last);
    }

    /** A screen switched off: our picture comes off it (his own back from the copy, when there is one). */
    private void takeOff(boolean home, boolean lock) {
        final Context app = getApplicationContext();
        final Prefs p = Prefs.of(app);
        work.execute(() -> {
            int result = Wallpapers.putBack(app, home, lock);
            if (p.home() || p.lock()) Refresher.run(app, true);
            int words = result == Wallpapers.RESTORED ? R.string.put_back
                    : result == Wallpapers.HOME_BUILT_IN_BACK ? R.string.home_built_in
                    : result == Wallpapers.LOCK_SHOWS_HOME ? R.string.lock_shows_home
                    : home ? R.string.home_kept : R.string.lock_kept;
            main.post(() -> Toast.makeText(app, words, Toast.LENGTH_LONG).show());
            emit("changed", null);
        });
    }

    private boolean mayNotify() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void pickTime(boolean from) {
        Prefs p = Prefs.of(this);
        int m = from ? p.quietFrom() : p.quietTo();
        new TimePickerDialog(this, (picker, hour, minute) -> {
            int value = hour * 60 + minute;
            if (from) p.setQuietTimes(value, p.quietTo());
            else p.setQuietTimes(p.quietFrom(), value);
            Schedule.next(this);
            emit("changed", null);
        }, m / 60, m % 60, DateFormat.is24HourFormat(this)).show();
    }

    private void connect(ConnectLink link) {
        final Context app = getApplicationContext();
        final Prefs p = Prefs.of(app);
        refreshing = true;
        emit("changed", null);
        work.execute(() -> {
            String failedWhy = null;
            try {
                JSONObject data = new Api(link.server, link.token).widget(!p.hideTitles()); // the code works
                p.connect(link.server, link.token);
                p.saveAmbient(data, System.currentTimeMillis());
            } catch (Api.Failure f) {
                failedWhy = Refresher.words(app, f, link.server);
            }
            if (failedWhy == null) {
                Refresher.run(app, true);
                Schedule.next(app);
                DayWidget.updateAll(app);
            }
            refreshing = false;
            final String why = failedWhy;
            main.post(() -> Toast.makeText(app, why == null ? getString(R.string.connected_toast_off) : why, Toast.LENGTH_LONG).show());
            emit("changed", null);
        });
    }

    private void disconnect() {
        final Context app = getApplicationContext();
        final Prefs p = Prefs.of(app);
        final String server = p.server();
        final String token = p.token();
        final boolean home = p.home();
        final boolean lock = p.lock();
        work.execute(() -> {
            if (server != null && token != null) {
                try {
                    new Api(server, token).disconnect();
                } catch (Api.Failure ignored) {
                    // Unreachable: the token still ends when it is revoked in Settings › Agents.
                }
            }
            Wallpapers.putBack(app, home, lock);
            Wallpapers.forgetCopy(app);
            Asks.clear(app);
            Laters.clear(app);
            Pictures.clear(app);
            MainActivity.forget(app);
            main.post(() -> Toast.makeText(app, R.string.disconnected, Toast.LENGTH_SHORT).show());
            emit("changed", null);
        });
    }

    /** The bridge (window.RcShell). Its calls come on a thread of their own; anything on screen goes to the main one. */
    private final class Bridge {
        private boolean trusted() {
            return ours(Uri.parse(pageUrl));
        }

        @JavascriptInterface
        public String state() {
            if (!trusted()) return "{}";
            Prefs p = Prefs.of(Shell.this);
            JSONObject o = new JSONObject();
            try {
                o.put("version", BuildConfig.VERSION);
                o.put("connected", p.connected());
                o.put("server", p.server() == null ? JSONObject.NULL : ConnectLink.hostOf(p.server()));
                o.put("okAt", p.okAt());
                o.put("failure", p.failure() == null ? JSONObject.NULL : p.failure());
                o.put("lock", p.lock());
                o.put("home", p.home());
                o.put("live", p.live());
                o.put("hideTitles", p.hideTitles());
                o.put("style", p.style());
                o.put("color", p.color() == null ? JSONObject.NULL : p.color());
                // Stage 11 (his decision 4): each screen its own look.
                ScreenLook lockLook = p.lockLook();
                ScreenLook homeLook = p.homeLook();
                o.put("lockStyle", lockLook.style);
                o.put("lockColor", lockLook.color == null ? JSONObject.NULL : lockLook.color);
                o.put("homeStyle", homeLook.style);
                o.put("homeColor", homeLook.color == null ? JSONObject.NULL : homeLook.color);
                // Stage 11 (his item 10c): the permissions checklist and when things last happened.
                o.put("permissions", permissions());
                o.put("picturesAt", p.picturesAt());
                o.put("pictureTheme", Refresher.pictureTheme(Shell.this, p.theme()));
                o.put("quiet", p.quiet());
                o.put("quietFrom", p.quietFrom());
                o.put("quietTo", p.quietTo());
                o.put("notes", p.notesOn());
                o.put("reminders", p.remindersOn());
                o.put("voice", voice);
                o.put("busy", refreshing);
            } catch (JSONException e) {
                return "{}";
            }
            return o.toString();
        }

        /** The look changed: `ground` as #RRGGBB, dark icons on a light ground. Kept for the next first frame. */
        @JavascriptInterface
        public void setBars(String ground, boolean darkIcons) {
            if (!trusted() || ground == null || !ground.matches("#[0-9a-fA-F]{6}")) return;
            int color = Color.parseColor(ground);
            kept.edit().putInt("ground", color).putBoolean("dark_icons", darkIcons).apply();
            main.post(() -> paint(color, darkIcons));
            // 0.7.0 (stage 19): the widget wears the same look (Paper or Slate); its light or dark stays the theme's.
            if (Prefs.of(Shell.this).setWidgetLook(CardRule.lookOfGround(ground))) DayWidget.updateAll(getApplicationContext());
        }

        @JavascriptInterface
        public void setSwitch(String key, boolean on) {
            if (!trusted() || key == null) return;
            main.post(() -> {
                Prefs p = Prefs.of(Shell.this);
                switch (key) {
                    case "lock":
                        p.setLock(on);
                        // The live lock screen lives on the lock screen: off with it.
                        if (!on && p.live()) p.setLive(false);
                        if (on) refreshInBackground();
                        else takeOff(false, true);
                        break;
                    case "home":
                        p.setHome(on);
                        if (on) refreshInBackground();
                        else takeOff(true, false);
                        break;
                    case "hideTitles":
                        p.setHideTitles(on);
                        refreshInBackground();
                        break;
                    case "notes":
                        p.setNotesOn(on);
                        if (on && !mayNotify() && Build.VERSION.SDK_INT >= 33) requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, ASK_NOTIFY);
                        break;
                    case "reminders":
                        // Off cancels every alarm (the email then covers them); on sets them from the next read.
                        p.setRemindersOn(on);
                        if (on) {
                            if (!mayNotify() && Build.VERSION.SDK_INT >= 33) requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, ASK_NOTIFY);
                            refreshInBackground();
                        } else Reminders.cancelAll(Shell.this);
                        break;
                    case "quiet":
                        p.setQuiet(on);
                        Schedule.next(Shell.this);
                        break;
                    default:
                        return;
                }
                emit("changed", null);
            });
        }

        /** The pictures' style and its colour (the server's words: a few lowercase letters each). */
        @JavascriptInterface
        public void setStyle(String style, String color) {
            if (!trusted() || style == null || !style.matches("[a-z]{1,20}") || (color != null && !color.matches("[a-z]{1,20}"))) return;
            Prefs.of(Shell.this).setLook(style, color);
            main.post(Shell.this::refreshInBackground);
        }

        /** Stage 11 (his decision 4): one screen's style and colour ("lock" or "home"); the other keeps its own. */
        @JavascriptInterface
        public void setScreenStyle(String screen, String style, String color) {
            if (!trusted() || !("lock".equals(screen) || "home".equals(screen)) || !ScreenLook.valid(style) || (color != null && !ScreenLook.valid(color))) return;
            Prefs.of(Shell.this).setScreenLook(screen, style, color);
            main.post(Shell.this::refreshInBackground);
        }

        /** Stage 11 (his item 10c): opens the system's own screen for one permission of the checklist. */
        @JavascriptInterface
        public void openPermission(String kind) {
            if (!trusted() || kind == null) return;
            main.post(() -> Shell.this.openPermission(kind));
        }

        /** Stage 11 (his item 10d): sends the phone's facts to the server (the owner's People page); answers "diagnostics". */
        @JavascriptInterface
        public void sendDiagnostics() {
            if (!trusted()) return;
            final Context app = getApplicationContext();
            work.execute(() -> {
                Prefs p = Prefs.of(app);
                String token = p.token();
                boolean ok = false;
                if (p.connected() && token != null) {
                    try {
                        new Api(p.server(), token).diagnostics(diagnostics(app, p));
                        ok = true;
                    } catch (Api.Failure | JSONException f) {
                        ok = false;
                    }
                }
                emit("diagnostics", ok ? "sent" : "failed");
            });
        }

        /** Quiet hours' start ("from") or end ("to"), on Android's own clock. */
        @JavascriptInterface
        public void pickTime(String which) {
            if (!trusted()) return;
            main.post(() -> Shell.this.pickTime("from".equals(which)));
        }

        @JavascriptInterface
        public void refresh() {
            if (!trusted() || !Prefs.of(Shell.this).connected()) return;
            main.post(Shell.this::refreshInBackground);
        }

        /** Connects this phone with a code the signed-in page just made (the `ambient` scope, as the QR's). */
        @JavascriptInterface
        public void connect(String server, String token) {
            if (!trusted() || server == null || token == null) return;
            ConnectLink link;
            try {
                link = ConnectLink.parse("recollect://connect?server=" + Uri.encode(server) + "&token=" + Uri.encode(token));
            } catch (ConnectLink.Refused r) {
                emit("changed", null);
                return;
            }
            main.post(() -> Shell.this.connect(link));
        }

        @JavascriptInterface
        public void disconnect() {
            if (!trusted()) return;
            main.post(Shell.this::disconnect);
        }

        /** The old settings screen: the widget, the live lock screen, the pictures' theme, the phone's own steps. */
        @JavascriptInterface
        public void openSettings() {
            if (!trusted()) return;
            main.post(() -> startActivity(new Intent(Shell.this, MainActivity.class)));
        }

        /** Android's own speech recognizer; the words come back as window.__rcShell('heard', text). */
        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void listen() {
            if (!trusted()) return;
            main.post(() -> {
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                try {
                    startActivityForResult(i, ASK_VOICE);
                } catch (ActivityNotFoundException e) {
                    emit("voice-none", null);
                }
            });
        }
    }
}
