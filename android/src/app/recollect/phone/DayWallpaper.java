package app.recollect.phone;

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Canvas;
import android.os.Handler;
import android.os.Looper;
import android.service.wallpaper.WallpaperService;
import android.util.Log;
import android.view.SurfaceHolder;

/**
 * The live wallpaper (0.4.0): the day's pictures drawn by the app, the lock picture while the phone is
 * locked (with the waiting notifications' icons under its words) and the home picture once he unlocks.
 * It draws only when something changes (a new picture, a notification, locking or unlocking), never
 * animates, and asks no zoom of the system (so the pictures are drawn at zoom 1).
 */
public final class DayWallpaper extends WallpaperService {
    @Override
    public Engine onCreateEngine() {
        return new DayEngine();
    }

    private final class DayEngine extends Engine implements Live.Listener, NotifIcons.Listener {
        private final Handler main = new Handler(Looper.getMainLooper());
        private boolean visible;
        private boolean locked = true;

        private final BroadcastReceiver screen = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                String a = intent.getAction();
                // Off: draw the lock picture now, so it is there the moment the screen comes on.
                if (Intent.ACTION_SCREEN_OFF.equals(a)) locked = true;
                else if (Intent.ACTION_USER_PRESENT.equals(a)) locked = false;
                else if (Intent.ACTION_SCREEN_ON.equals(a)) locked = keyguardLocked();
                draw();
            }
        };

        @Override
        public void onCreate(SurfaceHolder holder) {
            super.onCreate(holder);
            setTouchEventsEnabled(false);
            IntentFilter f = new IntentFilter();
            f.addAction(Intent.ACTION_SCREEN_OFF);
            f.addAction(Intent.ACTION_SCREEN_ON);
            f.addAction(Intent.ACTION_USER_PRESENT);
            registerReceiver(screen, f);
            Live.addListener(this);
            NotifIcons.addListener(this);
            locked = isPreview() || keyguardLocked();
        }

        @Override
        public void onDestroy() {
            try {
                unregisterReceiver(screen);
            } catch (IllegalArgumentException ignored) {
                // never registered
            }
            Live.removeListener(this);
            NotifIcons.removeListener(this);
            super.onDestroy();
        }

        @Override
        public void onVisibilityChanged(boolean v) {
            visible = v;
            if (v) {
                // The system's picker shows the lock picture (what this wallpaper is for).
                locked = isPreview() || keyguardLocked();
                draw();
            }
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height) {
            super.onSurfaceChanged(holder, format, width, height);
            draw();
        }

        @Override
        public void onSurfaceRedrawNeeded(SurfaceHolder holder) {
            draw();
        }

        @Override
        public void onPicturesChanged() {
            main.post(this::draw);
        }

        @Override
        public void onIconsChanged() {
            if (locked) main.post(this::draw);
        }

        private boolean keyguardLocked() {
            KeyguardManager km = getSystemService(KeyguardManager.class);
            return km != null && km.isKeyguardLocked();
        }

        private void draw() {
            SurfaceHolder holder = getSurfaceHolder();
            if (holder == null || holder.getSurface() == null || !holder.getSurface().isValid()) return;
            Canvas c = null;
            try {
                try {
                    c = holder.lockHardwareCanvas();
                } catch (RuntimeException e) {
                    c = holder.lockCanvas();
                }
                if (c == null) return;
                Live.draw(DayWallpaper.this, c, locked, NotifIcons.items());
                // Counts only (never what a notification or the picture says): enough to check it works.
                Log.i(Live.TAG, (locked ? "lock" : "home") + " drawn · icons " + NotifIcons.items().size() + (visible ? " · visible" : " · not visible") + (keyguardLocked() ? " · keyguard" : ""));
            } catch (RuntimeException e) {
                Log.w(Live.TAG, "a frame could not be drawn: " + e.getClass().getSimpleName());
            } finally {
                if (c != null) {
                    try {
                        holder.unlockCanvasAndPost(c);
                    } catch (RuntimeException ignored) {
                        // the surface went away
                    }
                }
            }
        }
    }
}
