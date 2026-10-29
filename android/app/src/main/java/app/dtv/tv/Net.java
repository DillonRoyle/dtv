package app.dtv.tv;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Minimal HTTP GET that follows redirects between http and https (Xtream panels often do). */
final class Net {
    static final class Result {
        int status;
        String body;
    }

    private Net() {}

    static Result get(String url, int timeoutMs, String userAgent) throws IOException {
        String current = url;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(Math.min(timeoutMs, 15000));
            c.setReadTimeout(timeoutMs);
            c.setRequestProperty("User-Agent", userAgent);
            c.setRequestProperty("Accept", "application/json,text/plain,*/*");
            try {
                int code = c.getResponseCode();
                if (code >= 300 && code < 400 && code != 304) {
                    String loc = c.getHeaderField("Location");
                    if (loc == null) {
                        Result r = new Result();
                        r.status = code;
                        r.body = "";
                        return r;
                    }
                    current = new URL(new URL(current), loc).toString();
                    continue;
                }
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                Result r = new Result();
                r.status = code;
                r.body = in == null ? "" : readAll(in);
                return r;
            } finally {
                c.disconnect();
            }
        }
        throw new IOException("Too many redirects");
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
