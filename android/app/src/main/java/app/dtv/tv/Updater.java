package app.dtv.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Keeps DTV up to date from the latest GitHub release.
 *
 * Interface (screens, layout, colours, text): downloaded in the background and used from the
 * next start, so no one has to touch the Firestick. The copy inside the APK is always kept as
 * a fallback, and a downloaded copy that fails to start is skipped automatically.
 *
 * Player / native code: can't be installed silently on Fire TV, so we only report that a new
 * APK exists and MainActivity asks the viewer to press Install.
 */
final class Updater {
    interface Listener {
        void onWebUpdated(int version);

        void onApkAvailable(int nativeVersion);
    }

    static final String BUNDLED_URL = "file:///android_asset/www/src/index.html";
    private static final AtomicBoolean checking = new AtomicBoolean(false);
    private static final Handler main = new Handler(Looper.getMainLooper());

    private Updater() {}

    private static File root(Context c) {
        return new File(c.getFilesDir(), "web");
    }

    private static File current(Context c) {
        return new File(root(c), "current");
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("updater", Context.MODE_PRIVATE);
    }

    /** Version of the downloaded interface, or 0 if there isn't a usable one. */
    static int downloadedVersion(Context c) {
        File cur = current(c);
        if (!new File(cur, "src/index.html").exists()) return 0;
        int v = readInt(new File(cur, "version.txt"));
        int minNative = readInt(new File(cur, "min-native.txt"));
        if (minNative > BuildConfig.NATIVE_VERSION) return 0;
        if (v == prefs(c).getInt("badWeb", -1)) return 0;
        return v;
    }

    /** Which interface to load: the downloaded one if it's newer than the one built into the APK. */
    static String startUrl(Context c) {
        int d = downloadedVersion(c);
        if (d > BuildConfig.WEB_VERSION) return "file://" + new File(current(c), "src/index.html").getAbsolutePath();
        return BUNDLED_URL;
    }

    static int activeVersion(Context c) {
        return Math.max(BuildConfig.WEB_VERSION, downloadedVersion(c));
    }

    /** The downloaded interface didn't start properly: never use this version again. */
    static void markBad(Context c, int version) {
        prefs(c).edit().putInt("badWeb", version).apply();
    }

    static long lastCheck(Context c) {
        return prefs(c).getLong("lastCheck", 0);
    }

    static void check(final Context ctx, final Listener l) {
        if (!checking.compareAndSet(false, true)) return;
        final Context c = ctx.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    runCheck(c, l);
                } catch (Throwable ignored) {
                    // offline, GitHub unreachable, etc. – try again next time
                } finally {
                    checking.set(false);
                }
            }
        }, "dtv-update").start();
    }

    private static void runCheck(Context c, final Listener l) throws Exception {
        Net.Result r = Net.get(BuildConfig.UPDATE_BASE + "dtv-version.json", 15000, Bridge.DEFAULT_UA);
        if (r.status != 200) return;
        prefs(c).edit().putLong("lastCheck", System.currentTimeMillis()).apply();
        JSONObject v = new JSONObject(r.body);
        final int web = v.optInt("web", 0);
        final int minNative = v.optInt("minNative", Integer.MAX_VALUE);
        final int apk = v.optInt("apk", 0);

        if (apk > BuildConfig.NATIVE_VERSION) {
            main.post(new Runnable() {
                @Override
                public void run() {
                    l.onApkAvailable(apk);
                }
            });
        }

        if (web <= activeVersion(c)) return;
        if (minNative > BuildConfig.NATIVE_VERSION) return; // needs the new APK first
        if (web == prefs(c).getInt("badWeb", -1)) return;

        File rootDir = root(c);
        rootDir.mkdirs();
        File zip = new File(rootDir, "download.zip");
        Net.download(BuildConfig.UPDATE_BASE + "DTV-web.zip", zip, 60000, Bridge.DEFAULT_UA);

        File staging = new File(rootDir, "staging");
        deleteTree(staging);
        unzip(zip, staging);
        zip.delete();
        if (!new File(staging, "src/index.html").exists() || !new File(staging, "src/app.js").exists()) {
            deleteTree(staging);
            return;
        }
        writeText(new File(staging, "version.txt"), String.valueOf(web));
        writeText(new File(staging, "min-native.txt"), String.valueOf(minNative));

        File cur = current(c);
        File old = new File(rootDir, "old");
        deleteTree(old);
        if (cur.exists() && !cur.renameTo(old)) deleteTree(cur);
        if (!staging.renameTo(cur)) {
            deleteTree(staging);
            return;
        }
        deleteTree(old);
        main.post(new Runnable() {
            @Override
            public void run() {
                l.onWebUpdated(web);
            }
        });
    }

    // ---------------------------------------------------------------- files
    private static void unzip(File zip, File dest) throws IOException {
        dest.mkdirs();
        String base = dest.getCanonicalPath() + File.separator;
        ZipInputStream zin = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip)));
        try {
            ZipEntry e;
            byte[] buf = new byte[1 << 16];
            while ((e = zin.getNextEntry()) != null) {
                File out = new File(dest, e.getName());
                // refuse anything that would land outside the folder
                if (!out.getCanonicalPath().startsWith(base)) throw new IOException("Bad entry in update");
                if (e.isDirectory()) {
                    out.mkdirs();
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null) parent.mkdirs();
                OutputStream os = new FileOutputStream(out);
                try {
                    int n;
                    while ((n = zin.read(buf)) > 0) os.write(buf, 0, n);
                } finally {
                    os.close();
                }
            }
        } finally {
            zin.close();
        }
    }

    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    private static int readInt(File f) {
        if (!f.exists()) return 0;
        InputStream in = null;
        try {
            in = new FileInputStream(f);
            byte[] b = new byte[32];
            int n = in.read(b);
            return n > 0 ? Integer.parseInt(new String(b, 0, n, "UTF-8").trim()) : 0;
        } catch (Exception e) {
            return 0;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private static void writeText(File f, String s) throws IOException {
        OutputStream os = new FileOutputStream(f);
        try {
            os.write(s.getBytes("UTF-8"));
        } finally {
            os.close();
        }
    }
}
