package app.dtv.tv;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The page talks to Android through this object (window.DTVAndroid).
 * Every call is asynchronous: the answer comes back through window.__dtvResolve(id, meta, body).
 */
public class Bridge {
    static final String DEFAULT_UA =
            "Mozilla/5.0 (Linux; Android 9; AFTKA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    static volatile String userAgent = DEFAULT_UA;

    private final MainActivity act;
    private final WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);

    Bridge(MainActivity act, WebView web) {
        this.act = act;
        this.web = web;
    }

    @JavascriptInterface
    public void request(final String id, final String method, final String argsJson) {
        pool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    handle(id, method, new JSONArray(argsJson == null ? "[]" : argsJson));
                } catch (Throwable t) {
                    resolve(id, error(String.valueOf(t)), null);
                }
            }
        });
    }

    private void handle(final String id, String method, JSONArray a) throws Exception {
        switch (method) {
            case "getJSON":
                getJSON(id, a.getString(0), a.optInt(1, 30000));
                return;
            case "setUserAgent": {
                String ua = a.optString(0, "").trim();
                userAgent = ua.isEmpty() ? DEFAULT_UA : ua;
                resolve(id, ok(), null);
                return;
            }
            case "kvGet":
                resolve(id, ok(), read(file("kv", a.getString(0))));
                return;
            case "kvSet":
                write(file("kv", a.getString(0)), a.getString(1));
                resolve(id, ok(), null);
                return;
            case "cacheGet":
                resolve(id, ok(), read(file("lists", a.getString(0))));
                return;
            case "cacheSet":
                write(file("lists", a.getString(0)), a.getString(1));
                resolve(id, ok(), null);
                return;
            case "cacheClear": {
                String prefix = safe(a.optString(0, ""));
                File dir = new File(act.getFilesDir(), "lists");
                File[] files = dir.listFiles();
                if (files != null) {
                    for (File f : files) if (prefix.isEmpty() || f.getName().startsWith(prefix)) f.delete();
                }
                resolve(id, ok(), null);
                return;
            }
            case "copy": {
                final String text = a.optString(0, "");
                act.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        ClipboardManager cm = (ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
                        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("DTV", text));
                    }
                });
                resolve(id, ok(), null);
                return;
            }
            case "info": {
                JSONObject o = ok();
                o.put("version", act.versionName());
                resolve(id, o, null);
                return;
            }
            case "play": {
                final String opts = a.getString(0);
                act.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        act.startPlayer(id, opts);
                    }
                });
                return; // answered when the player closes
            }
            default:
                resolve(id, error("unknown method " + method), null);
        }
    }

    private void getJSON(String id, String url, int timeout) throws JSONException {
        try {
            Net.Result r = Net.get(url, timeout, userAgent);
            boolean good = r.status >= 200 && r.status < 300;
            JSONObject m = new JSONObject();
            m.put("ok", good);
            m.put("status", r.status);
            if (!good) m.put("error", "Server replied " + r.status);
            resolve(id, m, good ? r.body : null);
        } catch (UnknownHostException e) {
            resolve(id, error("ENOTFOUND"), null);
        } catch (SocketTimeoutException e) {
            resolve(id, error("timeout"), null);
        } catch (ConnectException e) {
            resolve(id, error("ECONNREFUSED"), null);
        } catch (javax.net.ssl.SSLException e) {
            resolve(id, error("CERT " + e.getMessage()), null);
        } catch (IOException e) {
            resolve(id, error(e.getClass().getSimpleName() + ": " + e.getMessage()), null);
        } catch (OutOfMemoryError e) {
            resolve(id, error("The list from this server is too big for this device"), null);
        }
    }

    /** Send an answer back to the page. Safe to call from any thread. */
    void resolve(String id, JSONObject meta, String body) {
        final String js = "window.__dtvResolve&&window.__dtvResolve(" + JSONObject.quote(id) + "," + jsString(meta.toString()) + ","
                + (body == null ? "null" : jsString(body)) + ")";
        web.post(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(js, null);
            }
        });
    }

    static String jsString(String s) {
        return JSONObject.quote(s).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }

    static JSONObject ok() {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
        } catch (JSONException ignored) {
        }
        return o;
    }

    static JSONObject error(String msg) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("error", msg);
        } catch (JSONException ignored) {
        }
        return o;
    }

    // ---- small file store ----
    private static String safe(String key) {
        String s = key.replaceAll("[^A-Za-z0-9_.-]", "_");
        return s.length() > 120 ? s.substring(0, 120) : s;
    }

    private File file(String dir, String key) {
        File d = new File(act.getFilesDir(), dir);
        if (!d.exists()) d.mkdirs();
        return new File(d, safe(key) + ".json");
    }

    private static String read(File f) {
        if (!f.exists()) return null;
        InputStream in = null;
        try {
            in = new FileInputStream(f);
            ByteArrayOutputStream bo = new ByteArrayOutputStream((int) Math.max(1024, f.length()));
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toString("UTF-8");
        } catch (IOException e) {
            return null;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private static void write(File f, String text) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        FileOutputStream out = new FileOutputStream(tmp);
        try {
            out.write(text.getBytes("UTF-8"));
            out.getFD().sync();
        } finally {
            out.close();
        }
        if (!tmp.renameTo(f)) {
            f.delete();
            if (!tmp.renameTo(f)) throw new IOException("Couldn't save " + f.getName());
        }
    }
}
