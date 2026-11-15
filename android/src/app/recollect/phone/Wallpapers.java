package app.recollect.phone;

import android.Manifest;
import android.app.WallpaperManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.util.DisplayMetrics;
import android.view.Display;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Setting the picture, and the copy of the wallpaper he had before, so turning a screen off or
 * Disconnect can put it back. Reading the current wallpaper needs the storage permission on Android
 * 8–12 (asked only when he ticks "Keep a copy"); newer Android doesn't let apps read it. The lock
 * screen comes back without a copy too: without its own picture it shows the home wallpaper.
 */
final class Wallpapers {
    private static final String OLD_HOME = "old-home-wallpaper";
    private static final String OLD_LOCK = "old-lock-wallpaper";
    private static final String HOME_BUILT_IN = "old-home-built-in";
    /** Marks that the first picture was set (copies are made only before it). */
    private static final String STARTED = "pictures-started";

    private Wallpapers() {}

    /** The screen's real size in pixels, portrait (Display works from a background job; window metrics need a screen). */
    @SuppressWarnings("deprecation")
    static int[] screenSize(Context ctx) {
        DisplayManager dm = ctx.getSystemService(DisplayManager.class);
        Display d = dm.getDisplay(Display.DEFAULT_DISPLAY);
        DisplayMetrics m = new DisplayMetrics();
        d.getRealMetrics(m);
        return new int[] {Math.min(m.widthPixels, m.heightPixels), Math.max(m.widthPixels, m.heightPixels)};
    }

    static void set(Context ctx, Bitmap picture, boolean home, boolean lock) throws IOException {
        int which = (home ? WallpaperManager.FLAG_SYSTEM : 0) | (lock ? WallpaperManager.FLAG_LOCK : 0);
        if (which == 0) return;
        WallpaperManager.getInstance(ctx).setBitmap(picture, null, true, which);
    }

    // ── The copy of his own wallpaper ─────────────────────────────────────────────────

    /** What putBack did. */
    static final int NOTHING = 0;
    /** His own picture is back. */
    static final int RESTORED = 1;
    /** No copy of the lock screen's own picture: it shows the home wallpaper again. */
    static final int LOCK_SHOWS_HOME = 2;
    /** The home screen had the phone's built-in picture, and has it again. */
    static final int HOME_BUILT_IN_BACK = 3;

    static boolean canKeepCopy() {
        return Build.VERSION.SDK_INT <= 32;
    }

    static boolean mayRead(Context ctx) {
        return canKeepCopy() && ctx.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    /** True once the first picture was set: any copy after that would be our own picture. */
    private static boolean started(Context ctx) {
        return new File(ctx.getFilesDir(), STARTED).exists();
    }

    /** "Keep a copy" makes sense only before the first picture, where Android lets the app read it. */
    static boolean offerCopy(Context ctx) {
        return canKeepCopy() && !started(ctx);
    }

    static boolean hasCopy(Context ctx) {
        File dir = ctx.getFilesDir();
        return new File(dir, OLD_HOME).exists() || new File(dir, OLD_LOCK).exists() || new File(dir, HOME_BUILT_IN).exists();
    }

    /**
     * Right before the first picture: copies the home and lock wallpapers as they are (when he ticked
     * "Keep a copy" and Android lets the app read them), then never again.
     */
    static void beforeFirstPicture(Context ctx, boolean keep) {
        if (started(ctx)) return;
        File dir = ctx.getFilesDir();
        if (keep && mayRead(ctx)) {
            WallpaperManager wm = WallpaperManager.getInstance(ctx);
            // No file and no live wallpaper means the phone shows its own built-in picture (Android
            // keeps no file until a wallpaper is set): clear() brings exactly that back.
            if (!copy(wm, WallpaperManager.FLAG_SYSTEM, new File(dir, OLD_HOME)) && wm.getWallpaperInfo() == null) touch(new File(dir, HOME_BUILT_IN));
            // No file here means the lock screen showed the home wallpaper.
            copy(wm, WallpaperManager.FLAG_LOCK, new File(dir, OLD_LOCK));
        }
        touch(new File(dir, STARTED));
    }

    private static void touch(File f) {
        try {
            f.createNewFile();
        } catch (IOException ignored) {
            // Only a marker.
        }
    }

    private static boolean copy(WallpaperManager wm, int which, File to) {
        try (ParcelFileDescriptor pfd = wm.getWallpaperFile(which)) {
            if (pfd == null) return false;
            try (InputStream in = new FileInputStream(pfd.getFileDescriptor()); OutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            }
            return true;
        } catch (IOException | SecurityException e) {
            to.delete();
            return false;
        }
    }

    /**
     * Takes our picture off the screens named: his own picture from the copy; for the lock screen
     * without one, its own picture is removed so it shows the home wallpaper again. The home screen
     * without a copy keeps the last picture (NOTHING).
     */
    static int putBack(Context ctx, boolean home, boolean lock) {
        if (!started(ctx)) return NOTHING;
        File dir = ctx.getFilesDir();
        File oldHome = new File(dir, OLD_HOME);
        File oldLock = new File(dir, OLD_LOCK);
        WallpaperManager wm = WallpaperManager.getInstance(ctx);
        int result = NOTHING;
        try {
            if (home) {
                if (oldHome.exists()) {
                    try (InputStream in = new FileInputStream(oldHome)) {
                        wm.setStream(in, null, true, WallpaperManager.FLAG_SYSTEM);
                    }
                    result = RESTORED;
                } else if (new File(dir, HOME_BUILT_IN).exists()) {
                    wm.clear(WallpaperManager.FLAG_SYSTEM);
                    result = HOME_BUILT_IN_BACK;
                }
            }
            if (lock) {
                if (oldLock.exists()) {
                    try (InputStream in = new FileInputStream(oldLock)) {
                        wm.setStream(in, null, true, WallpaperManager.FLAG_LOCK);
                    }
                    result = RESTORED;
                } else {
                    wm.clear(WallpaperManager.FLAG_LOCK);
                    if (result == NOTHING) result = hasCopy(ctx) ? RESTORED : LOCK_SHOWS_HOME;
                }
            }
        } catch (IOException | SecurityException e) {
            return result;
        }
        return result;
    }

    /** After Disconnect: the copies go, and the next connection starts fresh. */
    static void forgetCopy(Context ctx) {
        File dir = ctx.getFilesDir();
        for (String name : new String[] {OLD_HOME, OLD_LOCK, HOME_BUILT_IN, STARTED}) new File(dir, name).delete();
    }

    // ── The preview the settings screen shows ─────────────────────────────────────────

    static File preview(Context ctx) {
        return new File(ctx.getFilesDir(), "preview.png");
    }

    static void savePreview(Context ctx, byte[] png) {
        File tmp = new File(ctx.getFilesDir(), "preview.png.tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(png);
        } catch (IOException e) {
            tmp.delete();
            return;
        }
        if (!tmp.renameTo(preview(ctx))) tmp.delete();
    }
}
