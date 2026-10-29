package app.dtv.tv;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.LinkedHashMap;

/**
 * Full-screen player for live channels, films and episodes.
 * Live: Up/Down (or Channel +/-) changes channel. Films: Left/Right skip 10 s.
 * Each item can have several stream URLs (e.g. MPEG-TS then HLS); if one fails the next is tried.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends Activity {
    /** Set by MainActivity before starting; too big to pass in an Intent. */
    static volatile String pendingOpts;
    /** Read by MainActivity when this screen closes. */
    static volatile String lastResult;

    private final Handler h = new Handler(Looper.getMainLooper());
    private final LinkedHashMap<String, JSONObject> progress = new LinkedHashMap<>();

    private ExoPlayer player;
    private PlayerView view;
    private View top, osd, error;
    private TextView title, sub, osdNum, osdName, errMsg, errHint;

    private JSONArray items = new JSONArray();
    private boolean live;
    private boolean autoNext;
    private int index;
    private int srcIdx;
    private int retries;
    private int gen; // bumps on every channel change so stale retries are ignored
    private long lastPosMs;
    private boolean done;
    private boolean stopped;

    private DefaultHttpDataSource.Factory http;
    private DefaultExtractorsFactory extractors;

    private final Runnable hideOsd = new Runnable() {
        @Override
        public void run() {
            osd.setVisibility(View.GONE);
        }
    };
    private final Runnable hideTop = new Runnable() {
        @Override
        public void run() {
            if (view != null && !view.isControllerFullyVisible()) top.setVisibility(View.GONE);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_player);
        view = findViewById(R.id.player_view);
        top = findViewById(R.id.top);
        osd = findViewById(R.id.osd);
        error = findViewById(R.id.error);
        title = findViewById(R.id.title);
        sub = findViewById(R.id.sub);
        osdNum = findViewById(R.id.osd_num);
        osdName = findViewById(R.id.osd_name);
        errMsg = findViewById(R.id.error_msg);
        errHint = findViewById(R.id.error_hint);

        JSONObject o;
        try {
            o = new JSONObject(pendingOpts == null ? "{}" : pendingOpts);
        } catch (JSONException e) {
            o = new JSONObject();
        }
        pendingOpts = null;
        JSONArray list = o.optJSONArray("items");
        if (list != null) items = list;
        live = o.optBoolean("live", false);
        autoNext = o.optBoolean("autoNext", true);
        if (items.length() == 0) {
            finishWithResult();
            return;
        }
        index = Math.max(0, Math.min(o.optInt("index", 0), items.length() - 1));
        String ua = o.optString("ua", "").trim();
        if (ua.isEmpty()) ua = Bridge.userAgent;

        http = new DefaultHttpDataSource.Factory()
                .setUserAgent(ua)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(20000);
        extractors = new DefaultExtractorsFactory()
                .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES
                        | DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS)
                .setConstantBitrateSeekingEnabled(true);

        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this).setEnableDecoderFallback(true);
        DefaultLoadControl load = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(15000, 50000, 1000, 2500) // start fast, keep a healthy buffer
                .build();
        player = new ExoPlayer.Builder(this, renderers).setLoadControl(load).build();
        player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build(), true);
        player.addListener(listener);

        view.setPlayer(player);
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS);
        view.setKeepContentOnPlayerReset(true);
        view.setShowNextButton(false);
        view.setShowPreviousButton(false);
        view.setShowFastForwardButton(!live);
        view.setShowRewindButton(!live);
        view.setControllerShowTimeoutMs(3500);
        view.setControllerAutoShow(!live);
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
            h.removeCallbacks(hideTop);
            top.setVisibility(visibility == View.VISIBLE ? View.VISIBLE : View.GONE);
        });
        view.requestFocus();

        load(index);
        if (live) showChannelOsd();
        else flashTitle();
    }

    // ---------------------------------------------------------------- loading
    private JSONObject item() {
        JSONObject it = items.optJSONObject(index);
        return it != null ? it : new JSONObject();
    }

    private void load(int i) {
        saveProgress();
        index = i;
        srcIdx = 0;
        retries = 0;
        gen++;
        hideError();
        JSONObject it = item();
        title.setText(it.optString("title"));
        sub.setText(it.optString("sub"));
        prepare((long) (it.optDouble("startAt", 0) * 1000));
    }

    private void prepare(long startMs) {
        JSONArray src = item().optJSONArray("sources");
        if (src == null || srcIdx >= src.length()) {
            showError();
            return;
        }
        JSONObject s = src.optJSONObject(srcIdx);
        String url = s == null ? "" : s.optString("url");
        String type = s == null ? "" : s.optString("type");
        MediaSource ms;
        if ("hls".equals(type) || url.contains(".m3u8")) {
            ms = new HlsMediaSource.Factory(http).createMediaSource(
                    new MediaItem.Builder().setUri(url).setMimeType(MimeTypes.APPLICATION_M3U8).build());
        } else {
            ms = new ProgressiveMediaSource.Factory(http, extractors).createMediaSource(MediaItem.fromUri(url));
        }
        if (startMs > 0) player.setMediaSource(ms, startMs);
        else player.setMediaSource(ms, true);
        player.prepare();
        player.setPlayWhenReady(true);
    }

    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int state) {
            if (state == Player.STATE_READY) {
                retries = 0;
                hideError();
            } else if (state == Player.STATE_ENDED) {
                if (live) {
                    // a live stream that "ends" has dropped: reconnect
                    reconnect();
                    return;
                }
                markEnded();
                if (autoNext && index + 1 < items.length()) {
                    JSONObject next = items.optJSONObject(index + 1);
                    showOsd("", "Up next: " + (next != null ? next.optString("sub") : ""));
                    load(index + 1);
                } else {
                    finishWithResult();
                }
            }
        }

        @Override
        public void onPlayerError(PlaybackException e) {
            if (e.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                player.seekToDefaultPosition();
                player.prepare();
                return;
            }
            long pos = live ? 0 : Math.max(lastPosMs, player.getCurrentPosition());
            JSONArray src = item().optJSONArray("sources");
            if (src != null && srcIdx + 1 < src.length()) {
                srcIdx++;
                prepare(pos);
                return;
            }
            if (live && retries < 2) {
                reconnect();
                return;
            }
            showError();
        }
    };

    private void reconnect() {
        retries++;
        srcIdx = 0;
        final int g = gen;
        h.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (g == gen && !done) prepare(0);
            }
        }, 700L * Math.max(1, retries));
    }

    private void retry() {
        gen++;
        srcIdx = 0;
        retries = 0;
        hideError();
        prepare(live ? 0 : lastPosMs);
    }

    // ---------------------------------------------------------------- live channel changes
    private void zap(int d) {
        int n = items.length();
        if (n == 0) return;
        load(((index + d) % n + n) % n);
        showChannelOsd();
    }

    private void showChannelOsd() {
        JSONObject it = item();
        showOsd(it.optString("num"), it.optString("title"));
        flashTitle();
    }

    private void showOsd(String num, String name) {
        osdNum.setText(num);
        osdNum.setVisibility(num == null || num.isEmpty() ? View.GONE : View.VISIBLE);
        osdName.setText(name);
        osd.setVisibility(View.VISIBLE);
        h.removeCallbacks(hideOsd);
        h.postDelayed(hideOsd, 3000);
    }

    private void flashTitle() {
        top.setVisibility(View.VISIBLE);
        h.removeCallbacks(hideTop);
        h.postDelayed(hideTop, 3500);
    }

    // ---------------------------------------------------------------- errors
    private void showError() {
        player.stop();
        error.setVisibility(View.VISIBLE);
        if (live) {
            errMsg.setText("This channel isn't playing right now");
            errHint.setText("It may be offline, or your account may be in use on another device.\nPress OK to try again, or ↑ ↓ to change channel.");
        } else {
            errMsg.setText("This video couldn't be played");
            errHint.setText("It may have been removed by your provider, or use a format this device can't play.\nPress OK to try again, or Back to return.");
        }
    }

    private void hideError() {
        error.setVisibility(View.GONE);
    }

    // ---------------------------------------------------------------- progress / result
    private void saveProgress() {
        if (live || player == null) return;
        String key = item().optString("key");
        if (key.isEmpty()) return;
        JSONObject prev = progress.get(key);
        if (prev != null && prev.optBoolean("ended")) return;
        long dur = player.getDuration();
        long pos = player.getCurrentPosition();
        if (dur == C.TIME_UNSET || dur <= 0) return;
        lastPosMs = pos;
        put(key, pos / 1000.0, dur / 1000.0, false);
    }

    private void markEnded() {
        String key = item().optString("key");
        if (key.isEmpty()) return;
        long dur = player.getDuration();
        double d = dur > 0 ? dur / 1000.0 : 1;
        put(key, d, d, true);
    }

    private void put(String key, double pos, double dur, boolean ended) {
        try {
            JSONObject p = new JSONObject();
            p.put("key", key);
            p.put("pos", pos);
            p.put("dur", dur);
            p.put("ended", ended);
            progress.remove(key);
            progress.put(key, p);
        } catch (JSONException ignored) {
        }
    }

    private void writeResult() {
        try {
            JSONObject r = new JSONObject();
            r.put("index", index);
            JSONArray arr = new JSONArray();
            for (JSONObject p : progress.values()) arr.put(p);
            r.put("progress", arr);
            lastResult = r.toString();
        } catch (JSONException e) {
            lastResult = "{}";
        }
    }

    private void finishWithResult() {
        if (done) return;
        done = true;
        saveProgress();
        writeResult();
        setResult(RESULT_OK);
        finish();
    }

    // ---------------------------------------------------------------- remote control
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (player == null) return super.dispatchKeyEvent(e);
        int k = e.getKeyCode();
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        boolean ctrl = view.isControllerFullyVisible();

        if (k == KeyEvent.KEYCODE_BACK) {
            if (!down) {
                if (ctrl && !live) view.hideController();
                else finishWithResult();
            }
            return true;
        }
        if (error.getVisibility() == View.VISIBLE
                && (k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_NUMPAD_ENTER)) {
            if (down) retry();
            return true;
        }
        if (live) {
            if (k == KeyEvent.KEYCODE_CHANNEL_UP || (k == KeyEvent.KEYCODE_DPAD_UP && !ctrl)) {
                if (down) zap(-1);
                return true;
            }
            if (k == KeyEvent.KEYCODE_CHANNEL_DOWN || (k == KeyEvent.KEYCODE_DPAD_DOWN && !ctrl)) {
                if (down) zap(1);
                return true;
            }
            if ((k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_DPAD_RIGHT) && !ctrl) {
                if (down) showChannelOsd();
                return true;
            }
        } else if (!ctrl && (k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_DPAD_RIGHT)) {
            if (down) {
                long step = k == KeyEvent.KEYCODE_DPAD_RIGHT ? 10000 : -10000;
                long dur = player.getDuration();
                long to = Math.max(0, player.getCurrentPosition() + step);
                if (dur > 0 && to > dur - 1000) to = dur - 1000;
                player.seekTo(to);
                view.showController();
            }
            return true;
        }
        return view.dispatchKeyEvent(e) || super.dispatchKeyEvent(e);
    }

    // ---------------------------------------------------------------- lifecycle
    @Override
    protected void onStop() {
        super.onStop();
        if (player != null && !done) {
            saveProgress();
            writeResult();
            player.setPlayWhenReady(false);
            stopped = true;
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (player != null && stopped && !done) {
            stopped = false;
            if (live) retry();
            else player.setPlayWhenReady(true);
        }
    }

    @Override
    protected void onDestroy() {
        h.removeCallbacksAndMessages(null);
        if (player != null) {
            if (!done) {
                saveProgress();
                writeResult();
            }
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
