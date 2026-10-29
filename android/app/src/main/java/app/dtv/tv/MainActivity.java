package app.dtv.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/** Hosts the DTV interface (the same one as the desktop app) in a full-screen WebView. */
public class MainActivity extends Activity {
    private static final int REQ_PLAY = 7;

    private WebView web;
    private Bridge bridge;
    private String playCallId;
    private long lastBack;

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
        web.loadUrl("file:///android_asset/www/src/index.html");
    }

    String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

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
        }
    }

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

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.requestFocus();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("DTVAndroid");
            web.destroy();
        }
        super.onDestroy();
    }
}
