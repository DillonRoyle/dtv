package app.dtv.tv;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Minimal HTTP that follows redirects between http, https and different hosts (GitHub and Xtream panels both do). */
final class Net {
    static final class Result {
        int status;
        String body;
    }

    private Net() {}

    /** Opens a connection to the final URL after redirects. Caller must disconnect. */
    private static HttpURLConnection open(String url, int timeoutMs, String userAgent, String accept) throws IOException {
        String current = url;
        for (int hop = 0; hop < 8; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(Math.min(timeoutMs, 15000));
            c.setReadTimeout(timeoutMs);
            c.setRequestProperty("User-Agent", userAgent);
            c.setRequestProperty("Accept", accept);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && code != 304) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("Redirect without a location");
                current = new URL(new URL(current), loc).toString();
                continue;
            }
            return c;
        }
        throw new IOException("Too many redirects");
    }

    static Result get(String url, int timeoutMs, String userAgent) throws IOException {
        HttpURLConnection c = open(url, timeoutMs, userAgent, "application/json,text/plain,*/*");
        try {
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            Result r = new Result();
            r.status = code;
            r.body = in == null ? "" : readAll(in);
            return r;
        } finally {
            c.disconnect();
        }
    }

    /** Downloads a file. Writes to a temp file first, so a half-finished download never replaces anything. */
    static void download(String url, File dest, int timeoutMs, String userAgent) throws IOException {
        HttpURLConnection c = open(url, timeoutMs, userAgent, "*/*");
        File tmp = new File(dest.getPath() + ".part");
        try {
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("Server replied " + code);
            File dir = dest.getParentFile();
            if (dir != null && !dir.exists()) dir.mkdirs();
            InputStream in = c.getInputStream();
            OutputStream out = new FileOutputStream(tmp);
            try {
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            } finally {
                out.close();
                in.close();
            }
            if (dest.exists()) dest.delete();
            if (!tmp.renameTo(dest)) throw new IOException("Couldn't save " + dest.getName());
        } finally {
            c.disconnect();
            if (tmp.exists()) tmp.delete();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream(1 << 16);
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toString("UTF-8");
        } finally {
            in.close();
        }
    }
}
