package app.dtv.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.KeyEvent;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;

/** Hosts the DTV interface (the same one as the desktop app) in a full-screen WebView. */
public class MainActivity extends Activity implements Updater.Listener {
    private static final int REQ_PLAY = 7;
    private static final long CHECK_EVERY_MS = 30 * 60 * 1000L;

    private final Handler h = new Handler(Looper.getMainLooper());
    private WebView web;
    private Bridge bridge;
    private String playCallId;
    private long lastBack;

    // auto-update state
    private long startedAt;
    private long pausedAt;
    private boolean backFromPlayer;
    private boolean pendingReload;
    private boolean pageReady;
    private int loadedDownloadedVersion; // 0 when the built-in interface is showing
    private boolean apkOffered;
    private File pendingApk;

    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            // a downloaded interface that never finished starting: go back to the built-in one
            if (!pageReady && loadedDownloadedVersion > 0) {
                Updater.markBad(MainActivity.this, loadedDownloadedVersion);
                loadInterface();
            }
        }
    };

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0D1322"));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        bridge = new Bridge(this, web);
        web.addJavascriptInterface(bridge, "DTVAndroid");
        web.setWebViewClient(new WebViewClient() {
            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return url == null || !url.startsWith("file:");
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);

        setContentView(web);
        web.requestFocus();
        startedAt = System.currentTimeMillis();
        loadInterface();
        Updater.check(this, this);
    }

    /** Load the newest interface available on this device (downloaded or built in). */
    private void loadInterface() {
        String url = Updater.startUrl(this);
        boolean downloaded = !Updater.BUNDLED_URL.equals(url);
        loadedDownloadedVersion = downloaded ? Updater.downloadedVersion(this) : 0;
        pageReady = false;
        pendingReload = false;
        h.removeCallbacks(watchdog);
        web.loadUrl(url);
        if (downloaded) h.postDelayed(watchdog, 20000);
    }

    /** The page calls this once it has started properly. */
    void onPageReady() {
        pageReady = true;
        h.removeCallbacks(watchdog);
    }

    int interfaceVersion() {
        return loadedDownloadedVersion > 0 ? loadedDownloadedVersion : BuildConfig.WEB_VERSION;
    }

    String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    // ---------------------------------------------------------------- updates
    @Override
    public void onWebUpdated(int version) {
        // just opened: switch straight away. Otherwise wait until DTV is next opened.
        if (playCallId == null && System.currentTimeMillis() - startedAt < 12000) {
            loadInterface();
        } else {
            pendingReload = true;
        }
    }

    @Override
    public void onApkAvailable(int nativeVersion) {
        if (apkOffered || isFinishing()) return;
        SharedPreferences p = getSharedPreferences("updater", MODE_PRIVATE);
        if (System.currentTimeMillis() < p.getLong("apkLaterUntil", 0)) return;
        apkOffered = true;
        new AlertDialog.Builder(this)
                .setTitle("DTV update ready")
                .setMessage("A new version of DTV is available. Install it now?\n\nYour playlists and favourites are kept.")
                .setPositiveButton("Install", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        downloadApk();
                    }
                })
                .setNegativeButton("Later", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        getSharedPreferences("updater", MODE_PRIVATE).edit()
                                .putLong("apkLaterUntil", System.currentTimeMillis() + 12 * 3600 * 1000L).apply();
                    }
                })
                .show();
    }

    private void downloadApk() {
        Toast.makeText(this, "Downloading the update…", Toast.LENGTH_LONG).show();
        final File dir = Build.VERSION.SDK_INT < 24 && getExternalCacheDir() != null
                ? new File(getExternalCacheDir(), "updates")
                : new File(getCacheDir(), "updates");
        final File apk = new File(dir, "DTV-update.apk");
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Net.download(BuildConfig.UPDATE_BASE + "DTV-FireTV.apk", apk, 120000, Bridge.DEFAULT_UA);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            installApk(apk);
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            apkOffered = false;
                            Toast.makeText(MainActivity.this, "Couldn't download the update. DTV will try again later.", Toast.LENGTH_LONG).show();
                        }
                    });
                }
            }
        }, "dtv-apk").start();
    }

    private void installApk(File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            // one-time permission so DTV can install its own updates
            pendingApk = apk;
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                Toast.makeText(this, "Turn on DTV here, then press Back to finish updating", Toast.LENGTH_LONG).show();
            } catch (Exception e) {
                Toast.makeText(this, "Allow DTV to install updates: Settings > My Fire TV > Developer options > Install unknown apps > DTV", Toast.LENGTH_LONG).show();
            }
            return;
        }
        try {
            Uri uri = Build.VERSION.SDK_INT >= 24
                    ? FileProvider.getUriForFile(this, getPackageName() + ".files", apk)
                    : Uri.fromFile(apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            apkOffered = false;
            Toast.makeText(this, "Couldn't open the installer. Use Downloader to update this time.", Toast.LENGTH_LONG).show();
        }
    }

    // ---------------------------------------------------------------- player
    /** Called by the page to open the native full-screen player. */
    void startPlayer(String callId, String opts) {
        if (playCallId != null) {
            // a player is already open; answer the new call straight away
            bridge.resolve(callId, Bridge.ok(), "{}");
            return;
        }
        playCallId = callId;
        PlayerActivity.pendingOpts = opts;
        PlayerActivity.lastResult = null;
        startActivityForResult(new Intent(this, PlayerActivity.class), REQ_PLAY);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_PLAY && playCallId != null) {
            String res = PlayerActivity.lastResult != null ? PlayerActivity.lastResult : "{}";
            bridge.resolve(playCallId, Bridge.ok(), res);
            playCallId = null;
            PlayerActivity.lastResult = null;
            backFromPlayer = true;
        }
    }

    // ---------------------------------------------------------------- remote
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (k == KeyEvent.KEYCODE_MENU) {
            if (e.getAction() == KeyEvent.ACTION_UP) js("window.__dtvMenu&&window.__dtvMenu()");
            return true;
        }
        if (k == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP) {
                web.evaluateJavascript("(window.__dtvBack?window.__dtvBack():'exit')", new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String v) {
                        if (v == null || v.contains("exit")) exitPressed();
                    }
                });
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private void exitPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBack < 2200) {
            finish();
        } else {
            lastBack = now;
            Toast.makeText(this, "Press Back again to close DTV", Toast.LENGTH_SHORT).show();
        }
    }

    private void js(String code) {
        web.evaluateJavascript(code, null);
    }

    // ---------------------------------------------------------------- lifecycle
    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.requestFocus();
        long now = System.currentTimeMillis();
        boolean fromPlayer = backFromPlayer;
        backFromPlayer = false;

        if (pendingApk != null && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) {
            File apk = pendingApk;
            pendingApk = null;
            installApk(apk);
            return;
        }
        // DTV was in the background for a while: use the new interface now
        if (pendingReload && !fromPlayer && playCallId == null && pausedAt > 0 && now - pausedAt > 60000) {
            startedAt = now;
            loadInterface();
        }
        if (!fromPlayer && now - Updater.lastCheck(this) > CHECK_EVERY_MS) {
            if (pausedAt > 0 && now - pausedAt > 60000) startedAt = now;
            Updater.check(this, this);
        }
    }

    @Override
    protected void onPause() {
        pausedAt = System.currentTimeMillis();
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        h.removeCallbacksAndMessages(null);
        if (web != null) {
            web.removeJavascriptInterface("DTVAndroid");
            web.destroy();
        }
        super.onDestroy();
    }
}
