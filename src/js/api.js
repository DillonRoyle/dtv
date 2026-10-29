// Xtream Codes API client + helpers
const native = typeof window !== 'undefined' && window.dtv;

/** Turn whatever the user pasted into a clean "http(s)://host:port" base. */
export function normalizeHost(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  s = s.replace(/\s+/g, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    // keep any sub-path the provider uses, but drop api/m3u endpoints
    let p = u.pathname.replace(/\/+(player_api\.php|get\.php|xmltv\.php|panel_api\.php|c\/?|live|movie|series)(\/.*)?$/i, '');
    p = p.replace(/\/+$/, '');
    // URL() drops a default port like :80 – keep exactly the port the user typed
    const typedPort = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+):(\d+)/i.exec(s);
    const host = typedPort ? `${u.hostname}:${typedPort[2]}` : u.host;
    return `${u.protocol}//${host}${p}`;
  } catch {
    return '';
  }
}

/** If the text is a full M3U / API link with credentials, pull them out. */
export function parseCredentialLink(text) {
  const s = String(text || '').trim();
  if (!/username=/i.test(s) || !/password=/i.test(s)) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'http://' + s);
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (!username || !password) return null;
    return { host: normalizeHost(s.split(/[?#]/)[0]), username, password };
  } catch {
    return null;
  }
}

export function friendlyHostName(host) {
  try {
    const h = new URL(host).hostname.replace(/^www\./, '');
    const first = h.split('.')[0];
    return first.charAt(0).toUpperCase() + first.slice(1);
  } catch {
    return 'My playlist';
  }
}

async function getJSON(url, opts = {}) {
  if (native) {
    const r = await window.dtv.getJSON(url, opts);
    if (!r.ok) throw Object.assign(new Error(r.error || 'Request failed'), { code: r.error, status: r.status, url });
    return r.data;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw Object.assign(new Error(`Server replied ${res.status}`), { status: res.status });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw Object.assign(new Error('not-json'), { code: 'not-json' });
    }
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('timeout'), { code: 'timeout', url });
    e.url = url;
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const enc = encodeURIComponent;
const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const cleanImg = (v) => {
  const s = typeof v === 'string' ? v.trim() : Array.isArray(v) ? String(v[0] || '').trim() : '';
  return /^https?:\/\//i.test(s) ? s : '';
};

export class Xtream {
  constructor({ host, username, password }) {
    this.host = normalizeHost(host);
    this.username = username;
    this.password = password;
  }
  api(action, params = {}) {
    let u = `${this.host}/player_api.php?username=${enc(this.username)}&password=${enc(this.password)}`;
    if (action) u += `&action=${action}`;
    for (const [k, v] of Object.entries(params)) u += `&${k}=${enc(v)}`;
    return u;
  }
  call(action, params, opts) {
    return getJSON(this.api(action, params), opts);
  }

  async auth() {
    const d = await this.call(null, {}, { timeout: 20000 });
    if (!d || typeof d !== 'object' || !d.user_info) throw Object.assign(new Error('not-xtream'), { code: 'not-xtream' });
    return d;
  }

  // Compact the big lists so they're quick to search, store and render.
  async live() {
    const [cats, items] = await Promise.all([this.call('get_live_categories'), this.call('get_live_streams', {}, { timeout: 90000 })]);
    return {
      cats: arr(cats).map((c) => ({ id: String(c.category_id), n: String(c.category_name || '').trim() })),
      items: arr(items).map((s, idx) => ({
        i: s.stream_id,
        n: String(s.name || '').trim(),
        c: String(s.category_id ?? ''),
        l: cleanImg(s.stream_icon),
        e: s.epg_channel_id || '',
        a: s.tv_archive ? 1 : 0,
        o: num(s.num) || idx + 1,
      })),
    };
  }
  async movies() {
    const [cats, items] = await Promise.all([this.call('get_vod_categories'), this.call('get_vod_streams', {}, { timeout: 120000 })]);
    return {
      cats: arr(cats).map((c) => ({ id: String(c.category_id), n: String(c.category_name || '').trim() })),
      items: arr(items).map((s, idx) => ({
        i: s.stream_id,
        n: String(s.name || '').trim(),
        c: String(s.category_id ?? ''),
        l: cleanImg(s.stream_icon),
        r: num(s.rating_5based) ? num(s.rating_5based) * 2 : num(s.rating),
        x: s.container_extension || 'mp4',
        t: num(s.added),
        o: idx,
      })),
    };
  }
  async series() {
    const [cats, items] = await Promise.all([this.call('get_series_categories'), this.call('get_series', {}, { timeout: 120000 })]);
    return {
      cats: arr(cats).map((c) => ({ id: String(c.category_id), n: String(c.category_name || '').trim() })),
      items: arr(items).map((s, idx) => ({
        i: s.series_id,
        n: String(s.name || '').trim(),
        c: String(s.category_id ?? ''),
        l: cleanImg(s.cover),
        r: num(s.rating_5based) ? num(s.rating_5based) * 2 : num(s.rating),
        t: num(s.last_modified),
        y: String(s.releaseDate || s.release_date || s.year || '').slice(0, 4),
        o: idx,
      })),
    };
  }

  vodInfo(id) {
    return this.call('get_vod_info', { vod_id: id });
  }
  seriesInfo(id) {
    return this.call('get_series_info', { series_id: id });
  }
  async shortEpg(id, limit = 4) {
    const d = await this.call('get_short_epg', { stream_id: id, limit }, { timeout: 12000 });
    return arr(d && d.epg_listings).map((e) => ({
      title: b64(e.title),
      desc: b64(e.description),
      start: toMs(e.start_timestamp, e.start),
      end: toMs(e.stop_timestamp, e.end || e.stop),
    }));
  }

  liveUrl(id, ext = 'ts') {
    return `${this.host}/live/${enc(this.username)}/${enc(this.password)}/${id}.${ext}`;
  }
  movieUrl(id, ext = 'mp4') {
    return `${this.host}/movie/${enc(this.username)}/${enc(this.password)}/${id}.${ext}`;
  }
  episodeUrl(id, ext = 'mp4') {
    return `${this.host}/series/${enc(this.username)}/${enc(this.password)}/${id}.${ext}`;
  }
}

function b64(s) {
  if (!s) return '';
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes).trim();
  } catch {
    return String(s);
  }
}
function toMs(ts, str) {
  if (ts && +ts > 0) return +ts * 1000;
  if (str) {
    const t = Date.parse(String(str).replace(' ', 'T'));
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

export function explainError(e) {
  const c = String((e && (e.code || e.message)) || '');
  let where = 'the server';
  try {
    if (e && e.url) where = new URL(e.url).host;
  } catch {}
  if (c === 'timeout') return `${where} took too long to answer. Check the URL and port, or try again in a moment.`;
  if (c === 'not-json' || c === 'not-xtream')
    return `${where} answered, but it isn't an Xtream Codes server. Check the URL and port with your provider (for example :80 or :8080).`;
  if (e && (e.status === 401 || e.status === 403)) return 'The server refused these details. Check your username and password.';
  if (e && e.status === 404) return `Nothing found at ${where}. Check the URL and port.`;
  if (/ENOTFOUND|EAI_AGAIN|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED/i.test(c))
    return `Your PC couldn't find ${where}. Check the address with your provider. It must match exactly, including any www. or subdomain.`;
  if (/ECONNREFUSED|CONNECTION_REFUSED/i.test(c)) return `${where} refused the connection. The port is probably wrong. Check it with your provider.`;
  if (/ECONNRESET|ETIMEDOUT|EHOSTUNREACH|TIMED_OUT|CONNECTION_RESET|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED|Failed to fetch|fetch failed/i.test(c))
    return `Couldn't connect to ${where}. Check the URL and port, and that you're online.`;
  if (/CERT|SSL/i.test(c)) return `${where} has a security certificate problem. Try the address with http:// instead of https://.`;
  return `Couldn't load from ${where} (${c || 'unknown error'}).`;
}
