package app.recollect.phone;

import android.app.WallpaperInfo;
import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * The live lock screen (0.4.0; the owner 11-16: "notifications cover the picture; can they show as small
 * icons under it, so it feels like the phone's own lock screen?"). Android lets no app move another
 * app's notification cards, but a live wallpaper draws itself: this one draws the day's pictures (the
 * server's, as before) and, on the lock screen, the waiting notifications' small icons in the band the
 * server leaves under the words (`icons=1`, its place in X-Ambient-Icons). With the phone's own lock
 * screen notifications turned off, the icons are the only sign of them there. Pictures and the band's
 * place are kept in files; the wallpaper and the app's preview draw them with the same code.
 */
final class Live {
    static final String TAG = "RecollectLive";
    private static final String LOCK = "live-lock.png";
    private static final String HOME = "live-home.png";
    private static final String SLOT = "live-slot.txt";
    /** 0.6.0: the plain twins (no words from the buddy), with the lock picture's own band. */
    private static final String LOCK_PLAIN = "live-lock-plain.png";
    private static final String HOME_PLAIN = "live-home-plain.png";
    private static final String SLOT_PLAIN = "live-slot-plain.txt";
    /** Which variant each screen draws now (Pictures decides: end times, quiet hours, answers on this phone). */
    private static volatile boolean plainLock;
    private static volatile boolean plainHome;
    /** At most this many apps' icons; more say "+n". */
    static final int ICONS_MAX = 7;

    interface Listener {
        void onPicturesChanged();
    }

    private static final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final Map<String, Bitmap> cache = new HashMap<>();
    private static final Map<String, Long> cachedAt = new HashMap<>();
    /** Each app's icon, and whether it is the app's own (in colour) or its notification symbol (tinted). */
    private static final Map<String, Drawable> iconCache = new HashMap<>();
    private static final Map<String, Boolean> iconIsApp = new HashMap<>();

    private Live() {}

    static void addListener(Listener l) {
        listeners.addIfAbsent(l);
    }

    static void removeListener(Listener l) {
        listeners.remove(l);
    }

    /** Is the phone's wallpaper this app's live one right now? */
    static boolean active(Context ctx) {
        try {
            WallpaperInfo info = WallpaperManager.getInstance(ctx).getWallpaperInfo();
            return info != null && info.getComponent().equals(new ComponentName(ctx, DayWallpaper.class));
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** The band for the icons: centre y and icon size in picture pixels, and their ink. */
    static final class Slot {
        final float cy;
        final float size;
        final int ink;

        Slot(float cy, float size, int ink) {
            this.cy = cy;
            this.size = size;
            this.ink = ink;
        }

        /** "cy,size,#AARRGGBB" (the server's header), or null. */
        static Slot parse(String s) {
            if (s == null) return null;
            String[] p = s.split(",");
            if (p.length != 3) return null;
            try {
                return new Slot(Float.parseFloat(p[0]), Float.parseFloat(p[1]), Color.parseColor(p[2].trim()));
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
    }

    /** Keeps the new pictures (either may be null: that screen keeps its last) and tells the wallpaper. */
    static void save(Context ctx, byte[] lockPng, String slot, byte[] homePng) throws IOException {
        File dir = ctx.getFilesDir();
        if (lockPng != null) write(new File(dir, LOCK), lockPng);
        if (homePng != null) write(new File(dir, HOME), homePng);
        if (lockPng != null) write(new File(dir, SLOT), (slot == null ? "" : slot).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        synchronized (cache) {
            cache.clear();
            cachedAt.clear();
        }
        main.post(() -> {
            for (Listener l : listeners) l.onPicturesChanged();
        });
    }

    private static void write(File to, byte[] bytes) throws IOException {
        File tmp = new File(to.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(bytes);
        }
        if (!tmp.renameTo(to)) {
            to.delete();
            if (!tmp.renameTo(to)) throw new IOException("could not keep " + to.getName());
        }
    }

    /** 0.6.0: keeps the plain twins (either may be null: kept as it was). */
    static void savePlain(Context ctx, byte[] lockPng, String slot, byte[] homePng) throws IOException {
        File dir = ctx.getFilesDir();
        if (lockPng != null) write(new File(dir, LOCK_PLAIN), lockPng);
        if (homePng != null) write(new File(dir, HOME_PLAIN), homePng);
        if (lockPng != null) write(new File(dir, SLOT_PLAIN), (slot == null ? "" : slot).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        changed();
    }

    /** Decides again which variant each screen draws (Pictures' rule), and redraws when it changed or new files came. */
    static void changed() {
        main.post(() -> {
            for (Listener l : listeners) l.onPicturesChanged();
        });
    }

    /** The rule for each screen now (called before a frame is drawn on screen-on, and by Pictures.apply). */
    static void decide(Context ctx) {
        Ambient a = Prefs.of(ctx).ambient();
        java.util.Calendar now = java.util.Calendar.getInstance();
        // The plain twin only when the day has words there that may not show now (a day without words: its own picture).
        plainLock = Pictures.hasWords(a, true) && !Pictures.lockWords(ctx, a, now) && new File(ctx.getFilesDir(), LOCK_PLAIN).exists();
        plainHome = Pictures.hasWords(a, false) && !Pictures.homeWords(ctx, a, now) && new File(ctx.getFilesDir(), HOME_PLAIN).exists();
    }

    static boolean hasPictures(Context ctx) {
        return new File(ctx.getFilesDir(), LOCK).exists();
    }

    static Slot slot(Context ctx) {
        File f = new File(ctx.getFilesDir(), plainLock ? SLOT_PLAIN : SLOT);
        if (!f.exists()) return null;
        try {
            return Slot.parse(new String(java.nio.file.Files.readAllBytes(f.toPath()), java.nio.charset.StandardCharsets.UTF_8).trim());
        } catch (IOException e) {
            return null;
        }
    }

    /** The lock or home picture, decoded once per change. */
    static Bitmap picture(Context ctx, boolean lock) {
        String name = lock ? (plainLock ? LOCK_PLAIN : LOCK) : (plainHome ? HOME_PLAIN : HOME);
        File f = new File(ctx.getFilesDir(), name);
        if (!f.exists()) f = new File(ctx.getFilesDir(), lock ? HOME : LOCK); // one screen's picture for both until the other comes
        if (!f.exists()) return null;
        synchronized (cache) {
            Bitmap b = cache.get(f.getName());
            Long at = cachedAt.get(f.getName());
            if (b != null && at != null && at == f.lastModified()) return b;
            Bitmap fresh = BitmapFactory.decodeFile(f.getPath());
            if (fresh != null) {
                cache.put(f.getName(), fresh);
                cachedAt.put(f.getName(), f.lastModified());
            }
            return fresh;
        }
    }

    // ── Drawing ───────────────────────────────────────────────────────────────────────

    private static final Paint bitmapPaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private static final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    /**
     * One frame: the lock or home picture filling the surface (cropped from its centre), and on the lock
     * screen the apps' icons in the band, centred, tinted with the picture's own ink.
     */
    static void draw(Context ctx, Canvas c, boolean lock, List<NotifIcons.Item> icons) {
        int w = c.getWidth();
        int h = c.getHeight();
        c.drawColor(Color.BLACK);
        Bitmap pic = picture(ctx, lock);
        float scale = 1f;
        float dx = 0;
        float dy = 0;
        if (pic != null) {
            scale = Math.max(w / (float) pic.getWidth(), h / (float) pic.getHeight());
            float pw = pic.getWidth() * scale;
            float ph = pic.getHeight() * scale;
            dx = (w - pw) / 2f;
            dy = (h - ph) / 2f;
            c.drawBitmap(pic, null, new RectF(dx, dy, dx + pw, dy + ph), bitmapPaint);
        }
        if (!lock || icons == null || icons.isEmpty()) return;
        Slot slot = slot(ctx);
        if (slot == null) return;
        drawIcons(ctx, c, icons, w / 2f, dy + slot.cy * scale, slot.size * scale, slot.ink);
    }

    /**
     * The icons in a row centred on (cx, cy): each app once, newest first, "+n" past ICONS_MAX. Each app's
     * own icon in colour (0.4.1, the owner: the notification symbols looked like placeholders), a little larger
     * than the band's symbol size; an app without one shows its notification symbol in the picture's ink.
     */
    static void drawIcons(Context ctx, Canvas c, List<NotifIcons.Item> icons, float cx, float cy, float band, int ink) {
        int n = Math.min(icons.size(), ICONS_MAX);
        int more = icons.size() - n;
        float size = band * 1.3f;
        float gap = size * 0.42f;
        String moreText = more > 0 ? "+" + more : null;
        textPaint.setColor(ink);
        textPaint.setTextSize(size * 0.62f);
        textPaint.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        float moreW = moreText == null ? 0 : textPaint.measureText(moreText);
        float total = n * size + (n - 1) * gap + (moreText == null ? 0 : gap + moreW);
        float x = cx - total / 2f;
        for (int i = 0; i < n; i++) {
            NotifIcons.Item item = icons.get(i);
            Drawable d = icon(ctx, item);
            if (d != null) {
                boolean app = Boolean.TRUE.equals(iconIsApp.get(iconKey(item)));
                if (app) {
                    // Round (0.4.2, the owner: "more rounded, less like default icons"): an adaptive icon's own
                    // layers drawn full bleed inside a circle; any other icon cut to the circle.
                    d.setTintList(null);
                    c.save();
                    android.graphics.Path circle = new android.graphics.Path();
                    circle.addCircle(x + size / 2f, cy, size / 2f, android.graphics.Path.Direction.CW);
                    c.clipPath(circle);
                    if (d instanceof android.graphics.drawable.AdaptiveIconDrawable) {
                        android.graphics.drawable.AdaptiveIconDrawable ad = (android.graphics.drawable.AdaptiveIconDrawable) d;
                        // The layers are 108 units with the visible 72 in the middle: draw them 1.5 times the circle.
                        float full = size * 1.5f;
                        int l = Math.round(x + size / 2f - full / 2f);
                        int t = Math.round(cy - full / 2f);
                        for (Drawable layer : new Drawable[] {ad.getBackground(), ad.getForeground()}) {
                            if (layer == null) continue;
                            layer.setBounds(l, t, l + Math.round(full), t + Math.round(full));
                            layer.draw(c);
                        }
                    } else {
                        float grow = size * 0.08f;
                        d.setBounds(Math.round(x - grow), Math.round(cy - size / 2f - grow), Math.round(x + size + grow), Math.round(cy + size / 2f + grow));
                        d.draw(c);
                    }
                    c.restore();
                    d = null;
                } else {
                    // A notification symbol: drawn at the band's size, centred in the app icon's place.
                    float s = band;
                    float ox = x + (size - s) / 2f;
                    d.setTint(ink);
                    d.setBounds(Math.round(ox), Math.round(cy - s / 2f), Math.round(ox + s), Math.round(cy + s / 2f));
                }
                if (d != null) d.draw(c);
            }
            x += size + gap;
        }
        if (moreText != null) c.drawText(moreText, x, cy + textPaint.getTextSize() * 0.36f, textPaint);
    }

    private static String iconKey(NotifIcons.Item item) {
        return item.pkg + "|" + item.icon.hashCode();
    }

    /** The app's own icon (the one on the home screen), else its notification's symbol. */
    private static Drawable icon(Context ctx, NotifIcons.Item item) {
        String key = iconKey(item);
        synchronized (iconCache) {
            Drawable d = iconCache.get(key);
            if (d != null) return d;
            boolean app = false;
            try {
                d = ctx.getPackageManager().getApplicationIcon(item.pkg);
                app = d != null;
            } catch (android.content.pm.PackageManager.NameNotFoundException | RuntimeException e) {
                d = null;
            }
            if (d == null) {
                try {
                    d = item.icon.loadDrawable(ctx);
                } catch (RuntimeException e) {
                    Log.w(TAG, "an icon could not be loaded");
                    d = null;
                }
            }
            if (d != null) {
                d = d.mutate();
                if (iconCache.size() > 64) {
                    iconCache.clear();
                    iconIsApp.clear();
                }
                iconCache.put(key, d);
                iconIsApp.put(key, app);
            }
            return d;
        }
    }

    /** The QA app's preview: the lock picture as the live wallpaper draws it, at a small size. */
    static Bitmap preview(Context ctx, int width, List<NotifIcons.Item> icons) {
        Bitmap pic = picture(ctx, true);
        if (pic == null) return null;
        int height = Math.round(width * pic.getHeight() / (float) pic.getWidth());
        Bitmap out = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        draw(ctx, new Canvas(out), true, icons);
        return out;
    }
}
