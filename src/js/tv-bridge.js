// On the Fire TV / Android build, the native app exposes `DTVAndroid`.
// This wraps it in the same `window.dtv` API the desktop app uses, so the
// rest of DTV runs unchanged. On desktop this file does nothing.
(function () {
  const A = window.DTVAndroid;
  if (!A || window.dtv) return;

  const pending = new Map();
  let seq = 0;
  window.__dtvResolve = (id, metaJson, body) => {
    const cb = pending.get(id);
    if (!cb) return;
    pending.delete(id);
    let meta;
    try {
      meta = JSON.parse(metaJson);
    } catch {
      meta = { ok: false, error: 'bridge' };
    }
    if (body !== null && body !== undefined) meta.text = body;
    cb(meta);
  };
  const call = (method, args) =>
    new Promise((resolve) => {
      const id = 'c' + ++seq;
      pending.set(id, resolve);
      A.request(id, method, JSON.stringify(args || []));
    });
  const parse = (t) => {
    if (t == null) return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };

  window.dtv = {
    tv: true,
    nativePlayer: true,
    platform: 'android-tv',
    async getJSON(url, opts) {
      const r = await call('getJSON', [url, (opts && opts.timeout) || 30000]);
      if (!r.ok) return r;
      try {
        return { ok: true, data: JSON.parse(r.text) };
      } catch {
        return { ok: false, status: r.status, error: 'not-json' };
      }
    },
    setUserAgent: (ua) => call('setUserAgent', [ua || '']),
    defaultUserAgent: async () => '',
    kvGet: async (k) => parse((await call('kvGet', [k])).text),
    kvSet: (k, v) => call('kvSet', [k, JSON.stringify(v)]),
    cacheGet: async (k) => parse((await call('cacheGet', [k])).text),
    cacheSet: (k, v) => call('cacheSet', [k, JSON.stringify(v)]),
    cacheClear: (p) => call('cacheClear', [p || '']),
    copy: (t) => call('copy', [String(t)]),
    openExternal: async () => ({ ok: false, error: 'na' }),
    toggleFullscreen: async () => true,
    setFullscreen: async () => true,
    info: async () => {
      const r = await call('info', []);
      return { version: r.version || '', platform: 'android-tv' };
    },
    onFullscreen() {},
    /** Hand playback to the native full-screen player. Resolves when the viewer comes back. */
    nativePlay: async (opts) => parse((await call('play', [JSON.stringify(opts)])).text) || {},
  };

  // Lay the page out for a TV screen, then let the native side scale it.
  const vp = document.querySelector('meta[name=viewport]');
  if (vp) vp.setAttribute('content', 'width=1200, user-scalable=no');
})();
