// Persistence: profiles, per-playlist user data (favourites, progress), settings, list cache
const N = typeof window !== 'undefined' && window.dtv;
const LS = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

async function kvGet(key) {
  if (N) return window.dtv.kvGet(key);
  try {
    return JSON.parse(LS.getItem('dtv:' + key));
  } catch {
    return null;
  }
}
async function kvSet(key, val, encrypt) {
  if (N) return window.dtv.kvSet(key, val, encrypt);
  try {
    LS.setItem('dtv:' + key, JSON.stringify(val));
  } catch {}
}

const memCache = new Map();
export const cache = {
  async get(key) {
    if (memCache.has(key)) return memCache.get(key);
    const v = N ? await window.dtv.cacheGet(key) : null;
    if (v) memCache.set(key, v);
    return v;
  },
  async set(key, v) {
    memCache.set(key, v);
    if (N) await window.dtv.cacheSet(key, v);
  },
  async clear(prefix) {
    for (const k of [...memCache.keys()]) if (!prefix || k.startsWith(prefix)) memCache.delete(k);
    if (N) await window.dtv.cacheClear(prefix);
  },
};

export const profiles = {
  async list() {
    return (await kvGet('profiles')) || [];
  },
  async save(list) {
    await kvSet('profiles', list, true);
  },
};

export const DEFAULT_SETTINGS = { liveFormat: 'auto', userAgent: '', vlcPath: '', lastProfile: null, volume: 1, autoNext: true };
export async function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...((await kvGet('settings')) || {}) };
}
export async function saveSettings(s) {
  await kvSet('settings', s);
}

/** Favourites, watch progress and recents for one playlist. Saves are debounced. */
export class UserData {
  constructor(profileId) {
    this.key = 'user_' + profileId;
    this.d = { fav: { live: [], movie: [], series: [] }, progress: {}, recentLive: [], lastLive: null };
    this.t = null;
  }
  async load() {
    const v = await kvGet(this.key);
    if (v) this.d = { ...this.d, ...v, fav: { ...this.d.fav, ...(v.fav || {}) } };
    this.favSets = Object.fromEntries(Object.entries(this.d.fav).map(([k, a]) => [k, new Set(a.map(String))]));
    return this;
  }
  save(now) {
    clearTimeout(this.t);
    const run = () => kvSet(this.key, this.d);
    if (now) return run();
    this.t = setTimeout(run, 800);
  }
  isFav(kind, id) {
    return this.favSets[kind].has(String(id));
  }
  toggleFav(kind, id) {
    const s = this.favSets[kind];
    const k = String(id);
    s.has(k) ? s.delete(k) : s.add(k);
    this.d.fav[kind] = [...s];
    this.save();
    return s.has(k);
  }
  getProgress(key) {
    return this.d.progress[key];
  }
  setProgress(key, pos, dur, meta) {
    if (!dur || dur < 60) return;
    if (pos / dur > 0.95) delete this.d.progress[key];
    else this.d.progress[key] = { p: Math.floor(pos), d: Math.floor(dur), t: Date.now(), ...meta };
    this.save();
  }
  pushRecentLive(id) {
    const k = String(id);
    this.d.recentLive = [k, ...this.d.recentLive.filter((x) => x !== k)].slice(0, 40);
    this.d.lastLive = k;
    this.save();
  }
}
