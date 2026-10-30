import './tv-bridge.js';
import { installTvNav, focusDefault, focusEl, focusIndex } from './tvnav.js';
import { Xtream, normalizeHost, parseCredentialLink, friendlyHostName, explainError } from './api.js';
import { profiles, cache, loadSettings, saveSettings, UserData } from './store.js';
import { VirtualGrid } from './vgrid.js';
import { Player, fmtTime } from './player.js';
import { icon } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const N = window.dtv;
const TV = !!(N && N.tv);
const STALE_MS = 12 * 3600 * 1000;
const KINDS = ['live', 'movie', 'series'];
const LABEL = { live: 'Live TV', movie: 'Movies', series: 'Series' };

const S = {
  settings: null,
  profiles: [],
  profile: null,
  xt: null,
  user: null,
  view: null,
  data: {}, // kind -> { cats, items, byId, counts, ts }
  loading: {},
  errors: {},
  cat: { live: 'all', movie: 'all', series: 'all' },
  query: { live: '', movie: '', series: '' },
  sort: { movie: 'default', series: 'default' },
  list: {}, // kind -> current filtered items
  liveSel: -1,
  playingLive: null,
  editing: null,
};

// ---------------------------------------------------------------- boot
let booted = false;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

async function boot() {
  if (booted) return;
  booted = true;
  const introDone = playIntro();
  document.body.classList.add(`os-${N?.platform || 'web'}`);
  if (TV) setupTv();
  $$('[data-ic]').forEach((el) => (el.innerHTML = icon(el.dataset.ic)));
  S.settings = await loadSettings();
  if (N) await N.setUserAgent(S.settings.userAgent);
  S.profiles = await profiles.list();

  setupLogin();
  setupMain();
  setupPlayer();
  setupKeys();

  if (N && N.ready) N.ready();
  // Load channels only after the letters have flown off, so the animation gets the device to itself
  await introDone;
  const last = S.profiles.find((p) => p.id === S.settings.lastProfile) || S.profiles[0];
  if (last) openProfile(last);
  else showLogin();
}

/** Plays the DTV opening animation. Resolves as soon as the letters have left the screen. */
function playIntro() {
  const el = document.getElementById('intro');
  if (!el) return Promise.resolve();
  let reduce = false;
  try {
    reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {}
  if (reduce) {
    el.remove();
    return Promise.resolve();
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // wait for DTV's own font (so the letters don't change shape mid-animation), but never long
  const font = document.fonts && document.fonts.load ? document.fonts.load('800 100px "Bricolage Grotesque"').catch(() => {}) : null;
  return Promise.race([font || Promise.resolve(), wait(700)])
    .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    .then(() => {
      el.classList.add('play');
      setTimeout(() => el.remove(), 2400);
      return wait(1850); // letters gone, overlay fading: start loading underneath
    });
}

// ---------------------------------------------------------------- toast
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- login
function showLogin(editProfile = null) {
  stopPlayback();
  $('#main').hidden = true;
  $('#login').hidden = false;
  S.editing = editProfile;
  const f = $('#loginForm');
  f.reset();
  $('#formError').hidden = true;
  $('#formTitle').textContent = editProfile ? 'Edit playlist' : S.profiles.length ? 'Add another playlist' : 'Add a playlist';
  $('#loginSubmit span').textContent = editProfile ? 'Save changes' : 'Connect';
  if (editProfile) {
    f.host.value = editProfile.host;
    f.username.value = editProfile.username;
    f.password.value = editProfile.password;
    f.name.value = editProfile.name;
  }
  $('#loginBack').hidden = !S.profile;
  renderSaved();
  setTimeout(() => (TV ? focusDefault() : f.host.focus()), 50);
}

function renderSaved() {
  const box = $('#saved');
  box.hidden = !S.profiles.length || !!S.editing;
  $('#savedList').innerHTML = S.profiles
    .map(
      (p) => `<button class="saved-item" data-pid="${esc(p.id)}">
        <span class="avatar">${esc(initials(p.name))}</span>
        <span class="saved-text"><b>${esc(p.name)}</b><small>${esc(p.username)} on ${esc(hostLabel(p.host))}</small></span>
        <span class="saved-go">${icon('play')}</span>
      </button>`
    )
    .join('');
}

function initials(name) {
  const w = String(name || '?').trim().split(/\s+/);
  return ((w[0]?.[0] || '') + (w[1]?.[0] || w[0]?.[1] || '')).toUpperCase();
}
function hostLabel(h) {
  try {
    return new URL(h).host;
  } catch {
    return h;
  }
}

function setupLogin() {
  const f = $('#loginForm');
  $('#loginBack').innerHTML = icon('back');
  $('#loginBack').addEventListener('click', () => {
    $('#login').hidden = true;
    $('#main').hidden = false;
    S.editing = null;
  });
  const eye = $('.pw-eye');
  eye.innerHTML = icon('eye');
  eye.addEventListener('click', () => {
    const show = f.password.type === 'password';
    f.password.type = show ? 'text' : 'password';
    eye.innerHTML = icon(show ? 'eyeOff' : 'eye');
  });

  const tryFill = () => {
    const got = parseCredentialLink(f.host.value);
    if (got) {
      f.host.value = got.host;
      f.username.value = got.username;
      f.password.value = got.password;
      if (!f.name.value) f.name.value = friendlyHostName(got.host);
      toast('Filled in from your link');
    }
  };
  f.host.addEventListener('paste', () => setTimeout(tryFill, 0));
  f.host.addEventListener('change', tryFill);
  f.host.addEventListener('blur', () => {
    if (f.host.value && !parseCredentialLink(f.host.value)) f.host.value = normalizeHost(f.host.value) || f.host.value;
  });

  $('#savedList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pid]');
    if (!b) return;
    const p = S.profiles.find((x) => x.id === b.dataset.pid);
    if (p) openProfile(p);
  });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#formError');
    err.hidden = true;
    tryFill();
    const host = normalizeHost(f.host.value);
    const username = f.username.value.trim();
    const password = f.password.value.trim();
    if (!host) return showFormError('Enter your server URL, for example http://example.com:8080');
    if (!username || !password) return showFormError('Enter your username and password.');
    const btn = $('#loginSubmit');
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.querySelector('span').textContent = 'Connecting…';
    try {
      const xt = new Xtream({ host, username, password });
      const d = await xt.auth();
      const ui = d.user_info || {};
      if (+ui.auth === 0) throw Object.assign(new Error('auth'), { code: 'auth' });
      if (ui.status && !/active/i.test(ui.status)) {
        const exp = ui.exp_date ? ` on ${fmtDate(+ui.exp_date * 1000)}` : '';
        throw Object.assign(new Error('status'), {
          code: 'status',
          friendly: /expired/i.test(ui.status) ? `This account expired${exp}. Renew it with your provider, then try again.` : `This account is ${String(ui.status).toLowerCase()}. Contact your provider.`,
        });
      }
      const name = f.name.value.trim() || friendlyHostName(host);
      let p;
      if (S.editing) {
        p = Object.assign(S.editing, { host, username, password, name });
        await cache.clear(p.id);
        S.data = {};
      } else {
        p = { id: 'p' + Date.now().toString(36), host, username, password, name };
        S.profiles.push(p);
      }
      p.info = accountInfo(d);
      await profiles.save(S.profiles);
      S.editing = null;
      openProfile(p, true);
    } catch (ex) {
      showFormError(ex.code === 'auth' ? "Username or password wasn't accepted. Check them and try again." : ex.friendly || explainError(ex));
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.querySelector('span').textContent = S.editing ? 'Save changes' : 'Connect';
    }
  });
}
function showFormError(msg) {
  const el = $('#formError');
  el.textContent = msg;
  el.hidden = false;
}
function accountInfo(d) {
  const u = d.user_info || {};
  const s = d.server_info || {};
  return {
    status: u.status || '',
    exp: u.exp_date ? +u.exp_date * 1000 : null,
    max: u.max_connections ?? '',
    active: u.active_cons ?? '',
    trial: +u.is_trial === 1,
    created: u.created_at ? +u.created_at * 1000 : null,
    tz: s.timezone || '',
    checked: Date.now(),
  };
}
function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------- profile
async function openProfile(p, fresh = false) {
  stopPlayback();
  if (S.profile?.id !== p.id) S.data = {};
  S.profile = p;
  S.xt = new Xtream(p);
  S.user = await new UserData(p.id).load();
  S.loading = {};
  S.errors = {};
  S.cat = { live: 'all', movie: 'all', series: 'all' };
  S.query = { live: '', movie: '', series: '' };
  $$('[data-search]').forEach((i) => (i.value = ''));
  S.settings.lastProfile = p.id;
  saveSettings(S.settings);
  $('#railProfile').innerHTML = `<span class="avatar">${esc(initials(p.name))}</span><span class="rail-profile-name">${esc(p.name)}</span>`;
  $('#login').hidden = true;
  $('#main').hidden = false;
  go('live');
  await loadKind('live', fresh);
  if (TV && (!document.activeElement || document.activeElement === document.body)) focusDefault();
  // warm the other sections in the background so they open instantly
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  idle(() => loadKind('movie', fresh).then(() => loadKind('series', fresh)));
  if (!fresh) refreshAccount();
}

async function refreshAccount() {
  try {
    const d = await S.xt.auth();
    S.profile.info = accountInfo(d);
    profiles.save(S.profiles);
    if (S.view === 'settings') renderSettings();
  } catch {}
}

const fetchers = { live: (xt) => xt.live(), movie: (xt) => xt.movies(), series: (xt) => xt.series() };

function loadKind(kind, force = false) {
  if (S.loading[kind]) return S.loading[kind];
  const pid = S.profile.id;
  const key = `${pid}_${kind}`;
  const run = async () => {
    try {
      if (!force && !S.data[kind]) {
        const c = await cache.get(key);
        if (c && S.profile?.id === pid) {
          setData(kind, c);
          if (Date.now() - c.ts > STALE_MS) backgroundRefresh(kind);
          return;
        }
      }
      if (!force && S.data[kind]) return;
      S.errors[kind] = null;
      if (S.view === kind) renderView(kind);
      const d = await fetchers[kind](S.xt);
      d.ts = Date.now();
      if (S.profile?.id !== pid) return;
      cache.set(key, d);
      setData(kind, d);
    } catch (e) {
      if (S.profile?.id !== pid) return;
      S.errors[kind] = explainError(e);
      if (S.view === kind) renderView(kind);
    } finally {
      S.loading[kind] = null;
    }
  };
  S.loading[kind] = run();
  return S.loading[kind];
}

async function backgroundRefresh(kind) {
  const pid = S.profile.id;
  try {
    const d = await fetchers[kind](S.xt);
    d.ts = Date.now();
    if (S.profile?.id !== pid) return;
    cache.set(`${pid}_${kind}`, d);
    setData(kind, d, true);
  } catch {}
}

function setData(kind, d, keepScroll = false) {
  const byId = new Map();
  const counts = new Map();
  for (const it of d.items) {
    it.s = fold(it.n);
    byId.set(String(it.i), it);
    counts.set(it.c, (counts.get(it.c) || 0) + 1);
  }
  S.data[kind] = { ...d, byId, counts };
  if (S.view === kind) renderView(kind, keepScroll);
}

// ---------------------------------------------------------------- navigation
function setupMain() {
  $('.rail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (b) go(b.dataset.nav);
  });
  $('#railProfile').addEventListener('click', () => go('settings'));

  // category lists
  $$('[data-cats]').forEach(bindCats);
  // search boxes
  document.addEventListener('input', (e) => {
    const k = e.target.dataset?.search;
    if (!k) return;
    clearTimeout(e.target._t);
    e.target._t = setTimeout(() => {
      S.query[k] = e.target.value.trim();
      refreshList(k);
    }, 110);
  });

  buildLiveList();
  buildLibrary('movie');
  buildLibrary('series');

  new ResizeObserver(() => dockPlayer()).observe($('.stage-slot'));
  window.addEventListener('resize', dockPlayer);
}

function go(view) {
  if (S.view === view) return;
  if (S.view === 'live' && view !== 'live') stopPlayback();
  S.view = view;
  $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
  $$('.rail-btn').forEach((b) => b.classList.toggle('is-on', b.dataset.nav === view));
  closeSheet();
  if (KINDS.includes(view)) {
    renderView(view);
    if (!S.data[view]) loadKind(view);
  }
  if (view === 'settings') renderSettings();
  if (view === 'live') requestAnimationFrame(dockPlayer);
}

function renderView(kind, keepScroll = false) {
  renderCats(kind);
  refreshList(kind, keepScroll);
}

function virtualCats(kind) {
  const v = [{ id: 'all', n: kind === 'live' ? 'All channels' : kind === 'movie' ? 'All movies' : 'All series', ic: 'grid' }];
  v.push({ id: 'fav', n: 'Favourites', ic: 'star' });
  v.push({ id: 'recent', n: kind === 'live' ? 'Recently watched' : 'Continue watching', ic: 'clock' });
  return v;
}

function bindCats(el) {
  const kind = el.dataset.cats;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    S.cat[kind] = b.dataset.cat;
    $$('.cat', el).forEach((x) => x.classList.toggle('is-on', x === b));
    // choosing a category clears the search so the list matches the label
    if (S.query[kind]) {
      S.query[kind] = '';
      $(`[data-search="${kind}"]`).value = '';
    }
    refreshList(kind);
  });
}

function renderCats(kind) {
  const el = $(`[data-cats="${kind}"]`);
  const d = S.data[kind];
  if (!d) {
    el.innerHTML = Array.from({ length: 12 }, () => '<div class="cat skel"><span></span></div>').join('');
    return;
  }
  const vc = virtualCats(kind)
    .map((c) => {
      const n = c.id === 'all' ? d.items.length : c.id === 'fav' ? S.user.d.fav[kind].length : recentItems(kind).length;
      return catBtn(kind, c.id, c.n, n, c.ic);
    })
    .join('');
  const real = d.cats
    .filter((c) => d.counts.get(c.id))
    .map((c) => catBtn(kind, c.id, c.n, d.counts.get(c.id)))
    .join('');
  el.innerHTML = `<div class="cat-group">${vc}</div><div class="cat-sep"></div><div class="cat-group">${real}</div>`;
}
function catBtn(kind, id, name, count, ic) {
  return `<button class="cat${S.cat[kind] === id ? ' is-on' : ''}" data-cat="${esc(id)}">${ic ? `<span class="cat-ic">${icon(ic)}</span>` : ''}<span class="cat-name">${esc(name)}</span><span class="cat-n">${count.toLocaleString()}</span></button>`;
}

function recentItems(kind) {
  const d = S.data[kind];
  if (!d) return [];
  if (kind === 'live') return S.user.d.recentLive.map((id) => d.byId.get(id)).filter(Boolean);
  const prog = Object.entries(S.user.d.progress)
    .filter(([k]) => k.startsWith(kind === 'movie' ? 'm:' : 's:'))
    .sort((a, b) => b[1].t - a[1].t);
  const seen = new Set();
  const out = [];
  for (const [k, v] of prog) {
    const id = kind === 'movie' ? k.slice(2) : String(v.sid);
    if (seen.has(id)) continue;
    seen.add(id);
    const it = d.byId.get(id);
    if (it) out.push(it);
  }
  return out;
}

function filtered(kind) {
  const d = S.data[kind];
  if (!d) return [];
  const q = fold(S.query[kind]);
  let list;
  if (q) {
    const words = q.split(/\s+/).filter(Boolean);
    list = d.items.filter((it) => words.every((w) => it.s.includes(w)));
    // names that start with the query come first
    list.sort((a, b) => (b.s.startsWith(words[0]) ? 1 : 0) - (a.s.startsWith(words[0]) ? 1 : 0));
  } else {
    const c = S.cat[kind];
    if (c === 'all') list = d.items;
    else if (c === 'fav') list = S.user.d.fav[kind].map((id) => d.byId.get(id)).filter(Boolean);
    else if (c === 'recent') list = recentItems(kind);
    else list = d.items.filter((it) => it.c === c);
  }
  const sort = S.sort[kind];
  if (kind !== 'live' && sort && sort !== 'default' && !(S.cat[kind] === 'recent' && !q)) {
    list = list.slice();
    if (sort === 'added') list.sort((a, b) => b.t - a.t);
    if (sort === 'az') list.sort((a, b) => a.n.localeCompare(b.n));
    if (sort === 'rating') list.sort((a, b) => b.r - a.r);
  }
  return list;
}

function catLabel(kind) {
  if (S.query[kind]) return `Results for “${S.query[kind]}”`;
  const c = S.cat[kind];
  const v = virtualCats(kind).find((x) => x.id === c);
  if (v) return v.n;
  return S.data[kind]?.cats.find((x) => x.id === c)?.n || '';
}

function refreshList(kind, keepScroll = false) {
  if (kind === 'live') return refreshLive(keepScroll);
  refreshLibrary(kind, keepScroll);
}

function stateMarkup(kind, items) {
  if (S.errors[kind] && !S.data[kind])
    return `<div class="state"><h3>Couldn't load ${LABEL[kind].toLowerCase()}</h3><p>${esc(S.errors[kind])}</p><button class="btn btn-primary" data-retry="${kind}">Try again</button></div>`;
  if (!S.data[kind]) return null; // skeleton shown
  if (items.length) return '';
  if (S.query[kind]) return `<div class="state"><h3>No matches</h3><p>Nothing in ${LABEL[kind]} matches “${esc(S.query[kind])}”. Try fewer words.</p></div>`;
  if (S.cat[kind] === 'fav') return `<div class="state"><h3>No favourites yet</h3><p>Click the star next to anything you watch often and it'll appear here.</p></div>`;
  if (S.cat[kind] === 'recent') return `<div class="state"><h3>Nothing here yet</h3><p>${kind === 'live' ? 'Channels you watch will show up here.' : "Anything you start watching will show up here so you can pick up where you left off."}</p></div>`;
  return `<div class="state"><h3>This category is empty</h3><p>Your provider hasn't added anything here.</p></div>`;
}
document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-retry]');
  if (r) loadKind(r.dataset.retry, true);
});

// ---------------------------------------------------------------- live
let liveGrid;
function buildLiveList() {
  const root = $('#view-live .chan-list');
  liveGrid = new VirtualGrid(root, {
    rowHeight: 56,
    pad: 6,
    create() {
      const el = document.createElement('div');
      el.className = 'ch';
      if (TV) {
        el.tabIndex = 0;
        el.dataset.focus = '';
      }
      el.innerHTML = `<span class="ch-num"></span><span class="ch-logo"><img alt="" decoding="async" draggable="false"><b></b></span><span class="ch-name"></span><button class="ch-fav" data-fav title="Favourite">${icon('star')}</button>`;
      const img = el.querySelector('img');
      img.onerror = () => el.querySelector('.ch-logo').classList.add('noimg');
      img.onload = () => el.querySelector('.ch-logo').classList.remove('noimg');
      return el;
    },
    render(el, it, i) {
      el.querySelector('.ch-num').textContent = it.o;
      el.querySelector('.ch-name').textContent = it.n;
      const logo = el.querySelector('.ch-logo');
      const img = el.querySelector('img');
      logo.querySelector('b').textContent = initials(it.n);
      if (it.l) {
        if (img.getAttribute('src') !== it.l) {
          logo.classList.remove('noimg');
          img.src = it.l;
        }
      } else {
        img.removeAttribute('src');
        logo.classList.add('noimg');
      }
      el.classList.toggle('is-sel', i === S.liveSel);
      el.classList.toggle('is-playing', S.playingLive && String(it.i) === String(S.playingLive.i));
      el.classList.toggle('is-fav', S.user.isFav('live', it.i));
    },
    onActivate(it, i, e) {
      if (e.target.closest('[data-fav]')) {
        const on = S.user.toggleFav('live', it.i);
        toast(on ? `Added ${it.n} to favourites` : `Removed ${it.n} from favourites`);
        if (S.cat.live === 'fav') refreshLive(true);
        else liveGrid.refresh();
        renderCats('live');
        return;
      }
      selectLive(i, true);
    },
    onDouble(it, i, e) {
      if (e.target.closest('[data-fav]')) return;
      selectLive(i, true);
      player.setMode('full');
    },
  });
  root.tabIndex = 0;
}

function refreshLive(keepScroll) {
  const items = filtered('live');
  S.list.live = items;
  const col = $('#view-live .chan-col');
  $('.col-title-name', col).textContent = catLabel('live');
  $('.col-count', col).textContent = S.data.live ? items.length.toLocaleString() : '';
  const st = stateMarkup('live', items);
  const state = $('.col-state', col);
  col.classList.toggle('is-loading', st === null);
  state.hidden = !st;
  if (st) state.innerHTML = st;
  // keep selection pointed at the playing channel if it's in this list
  S.liveSel = S.playingLive ? items.findIndex((x) => x.i === S.playingLive.i) : -1;
  liveGrid.setItems(st === null ? skeletonRows() : items, keepScroll);
  if (st === null) $('.chan-list', col).classList.add('skeleton');
  else $('.chan-list', col).classList.remove('skeleton');
  if (S.liveSel >= 0 && !keepScroll) liveGrid.scrollToIndex(S.liveSel, 'center');
}
function skeletonRows() {
  return Array.from({ length: 14 }, (_, i) => ({ i: 'sk' + i, n: '', o: '', l: '' }));
}

let zapT;
function selectLive(i, now = false) {
  const items = S.list.live;
  if (!items || i < 0 || i >= items.length) return;
  S.liveSel = i;
  liveGrid.scrollToIndex(i);
  liveGrid.refresh();
  clearTimeout(zapT);
  const it = items[i];
  if (now) playLive(it);
  else zapT = setTimeout(() => playLive(it), 380);
}

function liveSources(it) {
  if (S.xt.demo) {
    const url = S.xt.liveUrl(it.i);
    return [{ url, type: /\.m3u8/.test(url) ? 'hls' : 'file' }];
  }
  const f = S.settings.liveFormat;
  const ts = { url: S.xt.liveUrl(it.i, 'ts'), type: 'ts' };
  const hls = { url: S.xt.liveUrl(it.i, 'm3u8'), type: 'hls' };
  return f === 'hls' ? [hls, ts] : [ts, hls];
}

function playLive(it) {
  if (TV) return playLiveNative(it);
  if (S.playingLive && S.playingLive.i === it.i && player.cur) return;
  S.playingLive = it;
  S.user.pushRecentLive(it.i);
  liveGrid.refresh();
  $('.stage-slot').classList.add('has-player');
  const catName = S.data.live.cats.find((c) => c.id === it.c)?.n || '';
  player.play({
    sources: liveSources(it),
    live: true,
    title: it.n,
    subtitle: catName,
    mode: player.mode === 'full' ? 'full' : 'docked',
    onZap: (d) => zap(d),
    onBack: () => player.setMode('docked'),
  });
  if (player.mode === 'hidden') player.setMode('docked');
  dockPlayer();
  renderStageInfo(it);
  if (S.cat.live === 'recent') renderCats('live');
}

function zap(dir) {
  const items = S.list.live;
  if (!items?.length) return;
  let i = S.liveSel < 0 ? 0 : S.liveSel + dir;
  if (i < 0) i = items.length - 1;
  if (i >= items.length) i = 0;
  selectLive(i);
  const it = items[i];
  player.setTitle(it.n, S.data.live.cats.find((c) => c.id === it.c)?.n || '');
  if (player.mode === 'full') player.osd(`<span class="osd-num">${esc(it.o)}</span><span class="osd-name">${esc(it.n)}</span>`, 2200);
}

const epgCache = new Map();
let epgTick;
async function renderStageInfo(it) {
  S.infoLive = it;
  if (TV) $('.stage').classList.add('has-info');
  const box = $('.stage-info');
  box.hidden = false;
  const fav = S.user.isFav('live', it.i);
  const cat = S.data.live.cats.find((c) => c.id === it.c)?.n || '';
  box.innerHTML = `
    <div class="si-head">
      <div class="si-logo ${it.l ? '' : 'noimg'}">${it.l ? `<img src="${esc(it.l)}" alt="" onerror="this.parentNode.classList.add('noimg')">` : ''}<b>${esc(initials(it.n))}</b></div>
      <div class="si-titles"><h2>${esc(it.n)}</h2><p>${esc(cat)}${it.a ? ' <span class="pill">Catch-up</span>' : ''}</p></div>
    </div>
    <div class="si-actions">
      <button class="btn btn-primary" data-si="full">${icon(TV ? 'play' : 'expand')}<span>${TV ? 'Watch' : 'Full screen'}</span></button>
      <button class="btn ${fav ? 'is-on' : ''}" data-si="fav">${icon('star')}<span>${fav ? 'Favourite' : 'Add to favourites'}</span></button>
      ${TV ? '' : `<button class="btn btn-ghost" data-si="vlc" title="Open in VLC">${icon('external')}</button>
      <button class="btn btn-ghost" data-si="copy" title="Copy stream link">${icon('link')}</button>`}
    </div>
    <div class="epg"><div class="epg-loading"><span></span><span></span></div></div>`;
  box.onclick = (e) => {
    const a = e.target.closest('[data-si]')?.dataset.si;
    if (!a) return;
    if (a === 'full') TV ? playLive(it) : player.setMode('full');
    if (a === 'fav') {
      const on = S.user.toggleFav('live', it.i);
      toast(on ? `Added ${it.n} to favourites` : `Removed ${it.n} from favourites`);
      renderStageInfo(it).then(() => TV && focusEl($('.stage-info [data-si="fav"]')));
      liveGrid.refresh();
      renderCats('live');
    }
    if (a === 'vlc') openExternal(liveSources(it)[0].url, it.n);
    if (a === 'copy') copyLink(liveSources(it)[0].url);
  };

  const key = String(it.i);
  let listings = epgCache.get(key);
  if (!listings || Date.now() - listings.ts > 5 * 60 * 1000) {
    try {
      listings = { ts: Date.now(), l: await S.xt.shortEpg(it.i, 4) };
      epgCache.set(key, listings);
    } catch {
      listings = { ts: Date.now(), l: [] };
    }
  }
  if (S.infoLive?.i !== it.i) return;
  drawEpg(listings.l);
  clearInterval(epgTick);
  epgTick = setInterval(() => S.infoLive?.i === it.i && drawEpg(listings.l), 30000);
}

function drawEpg(list) {
  const box = $('.stage-info .epg');
  if (!box) return;
  const now = Date.now();
  const upcoming = list.filter((e) => e.end > now).slice(0, 4);
  if (!upcoming.length) {
    box.innerHTML = `<p class="epg-none">No programme guide for this channel.</p>`;
    return;
  }
  const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const [cur, ...rest] = upcoming;
  const isNow = cur.start <= now;
  const pct = isNow ? Math.min(100, ((now - cur.start) / (cur.end - cur.start)) * 100) : 0;
  const left = Math.max(0, Math.round((cur.end - now) / 60000));
  if (player.mode === 'full' && isNow && S.playingLive) player.setTitle(S.playingLive.n, cur.title);
  box.innerHTML = `
    <div class="epg-now">
      <div class="epg-when"><span class="${isNow ? 'on-air' : ''}">${isNow ? 'On now' : 'Next'}</span><span>${t(cur.start)} – ${t(cur.end)}</span>${isNow ? `<span class="epg-left">${left} min left</span>` : ''}</div>
      <h3>${esc(cur.title)}</h3>
      ${isNow ? `<div class="epg-bar"><i style="width:${pct}%"></i></div>` : ''}
      ${cur.desc ? `<p>${esc(cur.desc)}</p>` : ''}
    </div>
    ${rest.length ? `<ul class="epg-next">${rest.map((e) => `<li><time>${t(e.start)}</time><span>${esc(e.title)}</span></li>`).join('')}</ul>` : ''}`;
}

function dockPlayer() {
  if (player.mode !== 'docked') return;
  const r = $('.stage-slot').getBoundingClientRect();
  const s = player.root.style;
  s.left = r.left + 'px';
  s.top = r.top + 'px';
  s.width = r.width + 'px';
  s.height = r.height + 'px';
}

// ---------------------------------------------------------------- library (movies & series)
const libGrids = {};
function buildLibrary(kind) {
  const v = $('#view-' + kind);
  v.innerHTML = `
    <aside class="cats">
      <div class="cats-head"><h2 class="h-col">${LABEL[kind]}</h2></div>
      <div class="cat-list" data-cats="${kind}"></div>
    </aside>
    <div class="lib-main">
      <div class="lib-head">
        <div class="lib-title"><h2></h2><span class="col-count"></span></div>
        <label class="search"><span>${icon('search')}</span><input data-search="${kind}" placeholder="Search ${LABEL[kind].toLowerCase()}" spellcheck="false"></label>
        <label class="select"><span>Sort</span>
          <select data-sort="${kind}">
            <option value="default">Server order</option>
            <option value="added">Recently added</option>
            <option value="az">Name A–Z</option>
            <option value="rating">Top rated</option>
          </select>
        </label>
      </div>
      <div class="lib-grid"></div>
      <div class="col-state" hidden></div>
    </div>`;
  bindCats($('[data-cats]', v));
  $('[data-sort]', v).addEventListener('change', (e) => {
    S.sort[kind] = e.target.value;
    refreshLibrary(kind);
  });

  libGrids[kind] = new VirtualGrid($('.lib-grid', v), {
    minItemWidth: 156,
    gap: 18,
    pad: 22,
    rowHeight: (w) => Math.round(w * 1.5) + 58,
    create() {
      const el = document.createElement('div');
      el.className = 'card';
      if (TV) {
        el.tabIndex = 0;
        el.dataset.focus = '';
      }
      el.innerHTML = `<div class="card-art"><img alt="" decoding="async" draggable="false"><b></b><span class="card-fav">${icon('star')}</span><span class="card-prog"><i></i></span></div><div class="card-name"></div><div class="card-meta"></div>`;
      const img = el.querySelector('img');
      img.onerror = () => el.querySelector('.card-art').classList.add('noimg');
      img.onload = () => el.querySelector('.card-art').classList.remove('noimg');
      return el;
    },
    render(el, it) {
      const art = el.querySelector('.card-art');
      const img = el.querySelector('img');
      el.querySelector('.card-name').textContent = it.n;
      art.querySelector('b').textContent = it.n;
      art.style.setProperty('--h', hueOf(it.n));
      if (it.l) {
        if (img.getAttribute('src') !== it.l) {
          art.classList.remove('noimg');
          img.src = it.l;
        }
      } else {
        img.removeAttribute('src');
        art.classList.add('noimg');
      }
      const meta = [];
      const yr = it.y || yearFrom(it.n);
      if (yr) meta.push(yr);
      if (it.r) meta.push(`<span class="rating">${icon('star')}${(+it.r).toFixed(1)}</span>`);
      el.querySelector('.card-meta').innerHTML = meta.join('<i></i>');
      el.classList.toggle('is-fav', !!it.i && S.user.isFav(kind, it.i));
      const p = kind === 'movie' ? S.user.getProgress('m:' + it.i) : null;
      const bar = el.querySelector('.card-prog');
      bar.hidden = !p;
      if (p) bar.firstChild.style.width = (p.p / p.d) * 100 + '%';
    },
    onActivate(it) {
      if (!it.i) return;
      kind === 'movie' ? openMovie(it) : openSeries(it);
    },
  });
}
function yearFrom(name) {
  const m = /\((19|20)\d{2}\)|\b(19|20)\d{2}\b/.exec(name);
  return m ? m[0].replace(/[()]/g, '') : '';
}
function hueOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function refreshLibrary(kind, keepScroll) {
  const v = $('#view-' + kind);
  const items = filtered(kind);
  S.list[kind] = items;
  $('.lib-title h2', v).textContent = catLabel(kind);
  $('.lib-title .col-count', v).textContent = S.data[kind] ? items.length.toLocaleString() : '';
  const st = stateMarkup(kind, items);
  const state = $('.col-state', v);
  state.hidden = !st;
  if (st) state.innerHTML = st;
  const grid = $('.lib-grid', v);
  grid.classList.toggle('skeleton', st === null);
  libGrids[kind].setItems(st === null ? Array.from({ length: 24 }, () => ({ n: '' })) : items, keepScroll);
}

// ---------------------------------------------------------------- detail sheets
function openSheet(html) {
  const sh = $('#sheet');
  if (TV && sh.hidden) S.sheetReturn = document.activeElement;
  sh.innerHTML = `<div class="sheet-scrim" data-close></div><div class="sheet-panel" role="dialog" aria-modal="true">${html}</div>`;
  sh.hidden = false;
  requestAnimationFrame(() => sh.classList.add('open'));
  sh.onclick = (e) => {
    if (e.target.closest('[data-close]')) closeSheet();
  };
  return $('.sheet-panel', sh);
}
function closeSheet() {
  const sh = $('#sheet');
  if (sh.hidden) return;
  sh.classList.remove('open');
  setTimeout(() => {
    if (!sh.classList.contains('open')) {
      sh.hidden = true;
      sh.innerHTML = '';
    }
  }, 220);
  if (TV) {
    const back = S.sheetReturn;
    S.sheetReturn = null;
    setTimeout(() => {
      if (back && back.isConnected && back.offsetParent) focusEl(back);
      else focusDefault();
    }, 230);
  }
}

function heroMarkup(it, kind, extra = {}) {
  const yr = extra.year || it.y || yearFrom(it.n);
  const facts = [yr, extra.duration, extra.genre].filter(Boolean);
  const fav = S.user.isFav(kind, it.i);
  return `
    <button class="sheet-close icon-btn" data-close title="Close (Esc)">${icon('close')}</button>
    <div class="hero" style="--bd:url('${esc(extra.backdrop || it.l || '')}')">
      <div class="hero-bd"></div>
      <div class="hero-in">
        <div class="hero-poster card-art ${it.l ? '' : 'noimg'}" style="--h:${hueOf(it.n)}">${it.l ? `<img src="${esc(it.l)}" alt="" onerror="this.parentNode.classList.add('noimg')">` : ''}<b>${esc(it.n)}</b></div>
        <div class="hero-text">
          <h1>${esc(extra.title || it.n)}</h1>
          <div class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}${it.r ? `<span class="rating">${icon('star')}${(+it.r).toFixed(1)}</span>` : ''}</div>
          <div class="hero-actions" data-actions></div>
          <button class="btn fav-btn ${fav ? 'is-on' : ''}" data-favtoggle>${icon('star')}<span>${fav ? 'In favourites' : 'Add to favourites'}</span></button>
        </div>
      </div>
    </div>`;
}

function bindFav(panel, kind, it) {
  $('[data-favtoggle]', panel).addEventListener('click', (e) => {
    const on = S.user.toggleFav(kind, it.i);
    const b = e.currentTarget;
    b.classList.toggle('is-on', on);
    b.querySelector('span').textContent = on ? 'In favourites' : 'Add to favourites';
    libGrids[kind].refresh();
    renderCats(kind);
    if (S.cat[kind] === 'fav') refreshLibrary(kind, true);
  });
}

async function openMovie(it) {
  const panel = openSheet(heroMarkup(it, 'movie') + `<div class="sheet-body"><div class="loading-lines"><span></span><span></span><span></span></div></div>`);
  bindFav(panel, 'movie', it);
  const renderActions = () => {
    const p = S.user.getProgress('m:' + it.i);
    $('[data-actions]', panel).innerHTML = p
      ? `<button class="btn btn-primary btn-lg" data-play="resume">${icon('play')}<span>Resume from ${fmtTime(p.p)}</span></button><button class="btn btn-lg" data-play="start">Start over</button>`
      : `<button class="btn btn-primary btn-lg" data-play="start">${icon('play')}<span>Play</span></button>`;
    if (!TV) $('[data-actions]', panel).insertAdjacentHTML('beforeend', `<button class="btn btn-lg btn-ghost" data-play="vlc" title="Open in VLC">${icon('external')}</button>`);
    if (TV) focusEl($('[data-actions] button', panel));
  };
  renderActions();
  let ext = it.x;
  panel.addEventListener('click', (e) => {
    const a = e.target.closest('[data-play]')?.dataset.play;
    if (!a) return;
    const url = S.xt.movieUrl(it.i, ext);
    if (a === 'vlc') return openExternal(url, it.n);
    const p = S.user.getProgress('m:' + it.i);
    if (TV) {
      return nativeVod(
        [{ key: 'm:' + it.i, title: it.n, sub: 'Movie', sources: [{ url, type: 'file' }], startAt: a === 'resume' && p ? p.p : 0 }],
        () => {
          renderActions();
          libGrids.movie.refresh();
          renderCats('movie');
        }
      );
    }
    player.play({
      sources: [{ url, type: 'file' }],
      live: false,
      title: it.n,
      subtitle: 'Movie',
      startAt: a === 'resume' && p ? p.p : 0,
      mode: 'full',
      onTime: (pos, dur) => S.user.setProgress('m:' + it.i, pos, dur),
      onBack: () => {
        const v = player.v;
        if (v.duration) S.user.setProgress('m:' + it.i, v.currentTime, v.duration);
        stopPlayback();
        renderActions();
        libGrids.movie.refresh();
      },
      onEnded: () => {
        S.user.setProgress('m:' + it.i, 1, 1);
        stopPlayback();
        renderActions();
      },
    });
  });

  try {
    const d = await S.xt.vodInfo(it.i);
    if (!$('#sheet').contains(panel)) return;
    const info = d.info || {};
    const md = d.movie_data || {};
    ext = md.container_extension || ext;
    const dur = info.duration || (info.duration_secs ? fmtTime(+info.duration_secs) : '');
    const bd = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path;
    if (bd) $('.hero', panel).style.setProperty('--bd', `url('${String(bd).replace(/'/g, '%27')}')`);
    const facts = [info.releasedate?.slice(0, 4) || it.y || yearFrom(it.n), prettyDuration(dur), (info.genre || '').split(/[,/]/)[0]?.trim()].filter(Boolean);
    $('.facts', panel).innerHTML = facts.map((f) => `<span>${esc(f)}</span>`).join('') + (it.r ? `<span class="rating">${icon('star')}${(+it.r).toFixed(1)}</span>` : '');
    const plot = info.plot || info.description || '';
    $('.sheet-body', panel).innerHTML = `
      ${plot ? `<p class="plot">${esc(plot)}</p>` : '<p class="plot muted">No description from your provider.</p>'}
      <dl class="credits">
        ${info.genre ? `<dt>Genre</dt><dd>${esc(info.genre)}</dd>` : ''}
        ${info.director ? `<dt>Director</dt><dd>${esc(info.director)}</dd>` : ''}
        ${info.cast || info.actors ? `<dt>Cast</dt><dd>${esc(info.cast || info.actors)}</dd>` : ''}
        ${info.country ? `<dt>Country</dt><dd>${esc(info.country)}</dd>` : ''}
      </dl>`;
  } catch {
    if ($('#sheet').contains(panel)) $('.sheet-body', panel).innerHTML = '<p class="plot muted">Details aren\'t available, but you can still play this movie.</p>';
  }
}

function prettyDuration(d) {
  if (!d) return '';
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(d);
  if (m) {
    const h = +m[1];
    const mi = +m[2];
    return h ? `${h}h ${mi}m` : `${mi}m`;
  }
  return d;
}

async function openSeries(it) {
  const panel = openSheet(heroMarkup(it, 'series') + `<div class="sheet-body"><div class="loading-lines"><span></span><span></span><span></span></div></div>`);
  bindFav(panel, 'series', it);
  let data;
  try {
    data = await S.xt.seriesInfo(it.i);
  } catch (e) {
    if ($('#sheet').contains(panel)) $('.sheet-body', panel).innerHTML = `<div class="state"><h3>Couldn't load episodes</h3><p>${esc(explainError(e))}</p></div>`;
    return;
  }
  if (!$('#sheet').contains(panel)) return;
  const info = data.info || {};
  const bd = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path;
  if (bd) $('.hero', panel).style.setProperty('--bd', `url('${String(bd).replace(/'/g, '%27')}')`);
  const epsObj = data.episodes || {};
  const seasons = Object.keys(epsObj)
    .sort((a, b) => +a - +b)
    .map((k) => ({ n: k, eps: (Array.isArray(epsObj[k]) ? epsObj[k] : Object.values(epsObj[k])).slice().sort((a, b) => (+a.episode_num || 0) - (+b.episode_num || 0)) }));
  const flat = seasons.flatMap((s) => s.eps.map((e) => ({ ...e, _season: s.n })));
  const facts = [String(info.releaseDate || info.release_date || '').slice(0, 4) || it.y, seasons.length ? `${seasons.length} season${seasons.length > 1 ? 's' : ''}` : '', (info.genre || '').split(/[,/]/)[0]?.trim()].filter(Boolean);
  $('.facts', panel).innerHTML = facts.map((f) => `<span>${esc(f)}</span>`).join('') + (it.r ? `<span class="rating">${icon('star')}${(+it.r).toFixed(1)}</span>` : '');

  // find where to resume
  const progressFor = (ep) => S.user.getProgress('s:' + ep.id);
  let lastIdx = -1;
  let lastT = 0;
  flat.forEach((ep, i) => {
    const p = progressFor(ep);
    if (p && p.t > lastT) {
      lastT = p.t;
      lastIdx = i;
    }
  });
  let season = lastIdx >= 0 ? flat[lastIdx]._season : seasons[0]?.n;

  const playEp = (idx, fromStart = false) => {
    const ep = flat[idx];
    if (!ep) return;
    const p = progressFor(ep);
    const url = S.xt.episodeUrl(ep.id, ep.container_extension || 'mp4');
    const label = `S${ep._season} E${ep.episode_num || idx + 1}`;
    if (TV) {
      const list = flat.slice(idx, idx + 60).map((e, k) => ({
        key: 's:' + e.id,
        title: it.n,
        sub: `S${e._season} E${e.episode_num || idx + k + 1}`,
        sources: [{ url: S.xt.episodeUrl(e.id, e.container_extension || 'mp4'), type: 'file' }],
        startAt: k === 0 && !fromStart && p ? p.p : 0,
      }));
      return nativeVod(
        list,
        (res) => {
          lastIdx = idx + (res.index || 0);
          drawEpisodes();
          drawActions();
          focusEl($('[data-ep-main]', panel));
        },
        { sid: it.i }
      );
    }
    player.play({
      sources: [{ url, type: 'file' }],
      live: false,
      title: it.n,
      subtitle: `${label}  ${ep.title && !ep.title.includes(it.n) ? ep.title : ''}`.trim(),
      startAt: !fromStart && p ? p.p : 0,
      mode: 'full',
      onTime: (pos, dur) => S.user.setProgress('s:' + ep.id, pos, dur, { sid: it.i }),
      onBack: () => {
        const v = player.v;
        if (v.duration) S.user.setProgress('s:' + ep.id, v.currentTime, v.duration, { sid: it.i });
        stopPlayback();
        drawEpisodes();
        drawActions();
      },
      onEnded: () => {
        S.user.setProgress('s:' + ep.id, 1, 1, { sid: it.i });
        if (S.settings.autoNext && flat[idx + 1]) {
          player.osd(`<span class="osd-name">Up next: ${esc(`S${flat[idx + 1]._season} E${flat[idx + 1].episode_num}`)}</span>`, 2500);
          playEp(idx + 1, true);
        } else {
          stopPlayback();
          drawEpisodes();
          drawActions();
        }
      },
    });
  };

  const drawActions = () => {
    let target = 0;
    let resume = false;
    if (lastIdx >= 0) {
      const p = progressFor(flat[lastIdx]);
      if (p) {
        target = lastIdx;
        resume = true;
      } else target = Math.min(flat.length - 1, lastIdx + 1);
    }
    const ep = flat[target];
    const lab = ep ? `S${ep._season} E${ep.episode_num || target + 1}` : '';
    $('[data-actions]', panel).innerHTML = flat.length
      ? `<button class="btn btn-primary btn-lg" data-ep-main="${target}">${icon('play')}<span>${resume ? `Resume ${lab}` : lastIdx >= 0 ? `Play ${lab}` : 'Play first episode'}</span></button>`
      : '';
  };
  const drawEpisodes = () => {
    const s = seasons.find((x) => x.n === season);
    const list = $('.episodes', panel);
    if (!s || !list) return;
    list.innerHTML = s.eps
      .map((ep) => {
        const idx = flat.findIndex((x) => x.id === ep.id);
        const p = progressFor(ep);
        const dur = ep.info?.duration || (ep.info?.duration_secs ? fmtTime(+ep.info.duration_secs) : '');
        const img = ep.info?.movie_image || ep.info?.cover_big || '';
        const epTitle = String(ep.title || '').replace(/^.*?\bS\d+\s*E\d+\s*[-–:|]?\s*/i, '').trim() || `Episode ${ep.episode_num}`;
        return `<button class="ep" data-ep="${idx}">
          <span class="ep-thumb ${img ? '' : 'noimg'}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg')">` : ''}<b>${esc(ep.episode_num || '')}</b><span class="ep-play">${icon('play')}</span>${p ? `<span class="card-prog"><i style="width:${(p.p / p.d) * 100}%"></i></span>` : ''}</span>
          <span class="ep-text"><b>${esc(ep.episode_num ? ep.episode_num + '. ' : '')}${esc(epTitle)}</b>
          <small>${esc(prettyDuration(dur))}${p ? ` · ${Math.round((p.p / p.d) * 100)}% watched` : ''}</small>
          ${ep.info?.plot ? `<span class="ep-plot">${esc(ep.info.plot)}</span>` : ''}</span>
        </button>`;
      })
      .join('');
  };

  const plot = info.plot || '';
  $('.sheet-body', panel).innerHTML = `
    ${plot ? `<p class="plot">${esc(plot)}</p>` : ''}
    ${info.cast ? `<dl class="credits"><dt>Cast</dt><dd>${esc(info.cast)}</dd>${info.director ? `<dt>Director</dt><dd>${esc(info.director)}</dd>` : ''}</dl>` : ''}
    ${seasons.length ? `<div class="seasons" role="tablist">${seasons.map((s) => `<button class="season${s.n === season ? ' is-on' : ''}" data-season="${esc(s.n)}">Season ${esc(s.n)}</button>`).join('')}</div><div class="episodes"></div>` : '<div class="state"><h3>No episodes yet</h3><p>Your provider hasn\'t added episodes for this series.</p></div>'}`;
  drawActions();
  drawEpisodes();
  if (TV) focusEl($('[data-ep-main]', panel) || $('[data-favtoggle]', panel));
  panel.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-season]');
    if (sb) {
      season = sb.dataset.season;
      $$('.season', panel).forEach((b) => b.classList.toggle('is-on', b === sb));
      drawEpisodes();
    }
    const eb = e.target.closest('[data-ep]');
    if (eb) playEp(+eb.dataset.ep);
    const mb = e.target.closest('[data-ep-main]');
    if (mb) playEp(+mb.dataset.epMain);
  });
}

// ---------------------------------------------------------------- settings
function renderSettings() {
  const v = $('#view-settings');
  const p = S.profile;
  const i = p?.info || {};
  const exp = i.exp ? fmtDate(i.exp) : 'No expiry date';
  const days = i.exp ? Math.ceil((i.exp - Date.now()) / 86400000) : null;
  const ts = (k) => (S.data[k]?.ts ? new Date(S.data[k].ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not loaded');
  const counts = KINDS.map((k) => `<div class="stat"><b>${S.data[k] ? S.data[k].items.length.toLocaleString() : '–'}</b><span>${LABEL[k]}</span></div>`).join('');
  v.innerHTML = `
    <div class="set-wrap">
      <h1 class="h-lg">Settings</h1>

      <section class="set-sec">
        <div class="set-sec-head"><h2>Playlists</h2><button class="btn" data-set="add">${icon('plus')}<span>Add playlist</span></button></div>
        <div class="pl-list">
          ${S.profiles
            .map(
              (x) => `<div class="pl-item ${x.id === p?.id ? 'is-on' : ''}">
                <span class="avatar">${esc(initials(x.name))}</span>
                <div class="pl-item-text"><b>${esc(x.name)}</b><small>${esc(x.username)} on ${esc(hostLabel(x.host))}</small></div>
                ${x.id === p?.id ? '<span class="pill pill-on">Watching</span>' : `<button class="btn btn-sm" data-set="use" data-id="${esc(x.id)}">Switch to this</button>`}
                <button class="icon-btn" data-set="edit" data-id="${esc(x.id)}" title="Edit">${icon('edit')}</button>
                <button class="icon-btn danger" data-set="del" data-id="${esc(x.id)}" title="Remove">${icon('trash')}</button>
              </div>`
            )
            .join('')}
        </div>
      </section>

      ${
        p
          ? `<section class="set-sec">
        <div class="set-sec-head"><h2>Account</h2><button class="btn btn-sm btn-ghost" data-set="recheck">${icon('refresh')}<span>Check again</span></button></div>
        <div class="acct">
          <div class="acct-row"><span>Status</span><b class="${/active/i.test(i.status) ? 'ok' : 'warn'}">${esc(i.status || 'Unknown')}${i.trial ? ' (trial)' : ''}</b></div>
          <div class="acct-row"><span>Expires</span><b>${esc(exp)}${days !== null ? ` <em class="${days < 8 ? 'warn' : ''}">${days > 0 ? `${days} day${days === 1 ? '' : 's'} left` : 'expired'}</em>` : ''}</b></div>
          <div class="acct-row"><span>Connections</span><b>${esc(i.active ?? '–')} in use of ${esc(i.max || '–')}</b></div>
          <div class="acct-row"><span>Server</span><b>${esc(p.host)}</b></div>
        </div>
        <div class="stats">${counts}</div>
        <div class="set-row">
          <div><b>Refresh channels, movies and series</b><small>DTV keeps a copy so it opens instantly, and updates it every 12 hours. Last update: ${esc(ts('live'))}</small></div>
          <button class="btn" data-set="refresh">${icon('refresh')}<span>Refresh now</span></button>
        </div>
      </section>`
          : ''
      }

      <section class="set-sec">
        <div class="set-sec-head"><h2>Playback</h2></div>
        <div class="set-row">
          <div><b>Live stream format</b><small>MPEG-TS starts fastest on most servers. Switch to HLS if channels stutter or won't open. DTV tries the other format automatically if the first one fails.</small></div>
          <div class="seg" data-seg="liveFormat">
            <button data-v="auto" class="${S.settings.liveFormat !== 'hls' ? 'is-on' : ''}">MPEG-TS</button>
            <button data-v="hls" class="${S.settings.liveFormat === 'hls' ? 'is-on' : ''}">HLS</button>
          </div>
        </div>
        <div class="set-row">
          <div><b>Play next episode automatically</b><small>When an episode finishes, the next one starts.</small></div>
          <button class="switch ${S.settings.autoNext ? 'is-on' : ''}" data-set="autonext" role="switch" aria-checked="${S.settings.autoNext}"><i></i></button>
        </div>
        <div class="set-row col" ${TV ? 'hidden' : ''}>
          <div><b>VLC location</b><small>Used for “Open in VLC”. Leave empty to find VLC automatically.</small></div>
          <input class="input" data-input="vlcPath" value="${esc(S.settings.vlcPath)}" placeholder="${N?.platform === 'win32' ? 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe' : '/Applications/VLC.app/Contents/MacOS/VLC'}" spellcheck="false">
        </div>
      </section>

      <section class="set-sec">
        <div class="set-sec-head"><h2>Advanced</h2></div>
        <div class="set-row col">
          <div><b>User agent</b><small>Some providers only allow certain apps. If yours gave you a user agent to use, paste it here. Leave empty for the default.</small></div>
          <input class="input" data-input="userAgent" value="${esc(S.settings.userAgent)}" placeholder="Default (Chrome on Windows)" spellcheck="false">
        </div>
        <div class="set-row">
          <div><b>Clear saved lists</b><small>Removes the stored copy of every playlist. Favourites and progress are kept.</small></div>
          <button class="btn" data-set="clear">Clear</button>
        </div>
      </section>
      <p class="version" id="ver"></p>
    </div>`;
  N?.info().then((x) => ($('#ver') && ($('#ver').textContent = `DTV ${x.version}`)));
  if (!N) $('#ver').textContent = 'DTV';

  v.onclick = async (e) => {
    const b = e.target.closest('[data-set]');
    const seg = e.target.closest('[data-seg] [data-v]');
    if (seg) {
      const key = seg.parentNode.dataset.seg;
      S.settings[key] = seg.dataset.v;
      saveSettings(S.settings);
      $$('button', seg.parentNode).forEach((x) => x.classList.toggle('is-on', x === seg));
      toast('Saved');
      return;
    }
    if (!b) return;
    const id = b.dataset.id;
    const prof = S.profiles.find((x) => x.id === id);
    switch (b.dataset.set) {
      case 'add':
        return showLogin();
      case 'use':
        return prof && openProfile(prof);
      case 'edit':
        return prof && showLogin(prof);
      case 'del': {
        if (!prof) return;
        if (!confirm(`Remove “${prof.name}” from DTV? Its favourites and progress will be deleted too.`)) return;
        S.profiles = S.profiles.filter((x) => x.id !== id);
        await profiles.save(S.profiles);
        await cache.clear(id);
        toast(`Removed ${prof.name}`);
        if (prof.id === S.profile?.id) {
          S.profile = null;
          if (S.profiles[0]) openProfile(S.profiles[0]);
          else showLogin();
        } else renderSettings();
        return;
      }
      case 'recheck':
        b.classList.add('is-loading');
        await refreshAccount();
        renderSettings();
        return toast('Account checked');
      case 'refresh':
        b.classList.add('is-loading');
        b.disabled = true;
        epgCache.clear();
        await Promise.all(KINDS.map((k) => loadKind(k, true)));
        renderSettings();
        return toast('Channels, movies and series are up to date');
      case 'autonext':
        S.settings.autoNext = !S.settings.autoNext;
        saveSettings(S.settings);
        b.classList.toggle('is-on', S.settings.autoNext);
        return;
      case 'clear':
        await cache.clear();
        return toast('Saved lists cleared. They will reload next time you open a section.');
    }
  };
  v.onchange = async (e) => {
    const k = e.target.dataset.input;
    if (!k) return;
    S.settings[k] = e.target.value.trim();
    saveSettings(S.settings);
    if (k === 'userAgent' && N) await N.setUserAgent(S.settings.userAgent);
    toast('Saved');
  };
}

// ---------------------------------------------------------------- player wiring
let player;
function setupPlayer() {
  player = new Player($('#player'), {
    onModeChange(mode, prev) {
      document.body.classList.toggle('player-full', mode === 'full');
      if (mode === 'docked') {
        player.root.style.cssText = '';
        dockPlayer();
      }
      if (mode === 'full') player.root.style.cssText = '';
      if (mode === 'hidden') $('.stage-slot').classList.remove('has-player');
      if (prev === 'full' && mode === 'docked') {
        // return keyboard focus to the channel list
        $('#view-live .chan-list').focus({ preventScroll: true });
      }
    },
    onExternal: (url, title) => openExternal(url, title),
    onCopy: (url) => copyLink(url),
  });
  player.setVolume(S.settings.volume ?? 1);
  let vt;
  player.onVolume = (v) => {
    clearTimeout(vt);
    vt = setTimeout(() => {
      S.settings.volume = v;
      saveSettings(S.settings);
    }, 500);
  };
}

function stopPlayback() {
  if (!player) return;
  player.stop();
  player.setMode('hidden');
  S.playingLive = null;
  clearInterval(epgTick);
  $('.stage-info') && ($('.stage-info').hidden = true);
  liveGrid?.refresh();
}

async function openExternal(url, title) {
  if (!N) return copyLink(url);
  const r = await N.openExternal(url, title, S.settings.vlcPath);
  if (r.ok) {
    toast('Opening in VLC…');
    if (player.cur) player.v.pause();
  } else toast("VLC isn't installed. Get it free from videolan.org, or set its location in Settings.", 4200);
}
async function copyLink(url) {
  if (N) await N.copy(url);
  else await navigator.clipboard?.writeText(url).catch(() => {});
  toast('Stream link copied');
}

// ---------------------------------------------------------------- TV (Fire TV / Android)
function catNameOf(it) {
  return S.data.live?.cats.find((c) => c.id === it.c)?.n || '';
}

async function playLiveNative(it) {
  const items = S.list.live || [it];
  let index = items.indexOf(it);
  if (index < 0) index = 0;
  const res = await N.nativePlay({
    live: true,
    autoNext: false,
    ua: S.settings.userAgent || '',
    index,
    items: items.map((x) => ({
      key: 'l:' + x.i,
      title: x.n,
      sub: catNameOf(x),
      num: String(x.o),
      sources: liveSources(x),
    })),
  });
  const last = items[res && res.index >= 0 ? res.index : index] || it;
  S.user.pushRecentLive(last.i);
  if (S.cat.live === 'recent') refreshLive(true);
  renderCats('live');
  const i = S.list.live.indexOf(last);
  if (i >= 0) {
    S.liveSel = i;
    focusIndex($('#view-live .chan-list'), i);
  }
  liveGrid.refresh();
  renderStageInfo(last);
}

async function nativeVod(items, after, meta = {}) {
  const res = (await N.nativePlay({ live: false, autoNext: !!S.settings.autoNext, ua: S.settings.userAgent || '', index: 0, items })) || {};
  for (const p of res.progress || []) {
    if (p.ended) S.user.setProgress(p.key, 1, 1, meta);
    else if (p.dur > 0) S.user.setProgress(p.key, p.pos, p.dur, meta);
  }
  after && after(res);
}

function focusedItem() {
  const el = document.activeElement;
  if (!el || !el.classList.contains('vg-cell')) return null;
  const root = el.closest('.vg');
  const g = root && root._vg;
  if (!g) return null;
  const kind = root.classList.contains('chan-list') ? 'live' : root.closest('.view')?.dataset.kind;
  return { kind, it: g.items[+el.dataset.vi], el };
}

function setupTv() {
  document.body.classList.add('tv');
  installTvNav();
  $('.stage-empty p').textContent = 'Highlight a channel to see what’s on';
  $('.stage-empty small').textContent = 'Press OK to watch. Press Menu (☰) to add a favourite.';
  // Moving through channels shows that channel's guide on the right
  let infoT;
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el.classList || !el.classList.contains('ch') || !el.closest('#view-live')) return;
    const i = +el.dataset.vi;
    const it = S.list.live && S.list.live[i];
    if (!it || !it.i || String(it.i).startsWith('sk')) return;
    S.liveSel = i;
    liveGrid.refresh();
    clearTimeout(infoT);
    infoT = setTimeout(() => renderStageInfo(it), 220);
  });
  // Remote Back button. Returns 'exit' when there's nothing left to go back from.
  window.__dtvBack = () => {
    const a = document.activeElement;
    if (!$('#sheet').hidden) {
      closeSheet();
      return 'handled';
    }
    if (!$('#login').hidden) {
      if (S.profile) {
        $('#login').hidden = true;
        $('#main').hidden = false;
        S.editing = null;
        focusDefault();
        return 'handled';
      }
      return 'exit';
    }
    if (a && /INPUT|SELECT/.test(a.tagName)) {
      a.blur();
      focusDefault();
      return 'handled';
    }
    if (!a || !a.closest('.rail')) {
      focusEl($('.rail-btn.is-on'));
      return 'handled';
    }
    if (S.view !== 'live') {
      go('live');
      focusEl($('.rail-btn.is-on'));
      return 'handled';
    }
    return 'exit';
  };
  // Remote Menu button (three lines) toggles a favourite on the focused item
  window.__dtvMenu = () => {
    const f = focusedItem();
    if (!f || !f.it || !f.it.i) {
      toast('Highlight a channel, film or series, then press Menu to favourite it');
      return;
    }
    const on = S.user.toggleFav(f.kind, f.it.i);
    toast(on ? `Added ${f.it.n} to favourites` : `Removed ${f.it.n} from favourites`);
    if (f.kind === 'live') {
      liveGrid.refresh();
      if (S.infoLive && S.infoLive.i === f.it.i) renderStageInfo(f.it);
    } else libGrids[f.kind].refresh();
    renderCats(f.kind);
  };
}

// ---------------------------------------------------------------- keyboard
let numBuf = '';
let numT;
function setupKeys() {
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (player.mode === 'full' && !typing) {
      if (player.handleKey(e)) return e.preventDefault();
    }
    if (e.key === 'Escape') {
      if (!$('#sheet').hidden) return closeSheet();
      if (typing) return document.activeElement.blur();
    }
    if ((e.key === 'f' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
      const inp = $(`#view-${S.view} [data-search]`);
      if (inp) {
        e.preventDefault();
        inp.focus();
        inp.select();
      }
      return;
    }
    if (typing) {
      // arrow down from the search box drops into the results
      if (e.key === 'ArrowDown' && S.view === 'live' && document.activeElement.dataset.search === 'live') {
        e.preventDefault();
        document.activeElement.blur();
        selectLive(Math.max(0, S.liveSel), false);
      }
      if (e.key === 'Enter' && S.view === 'live' && document.activeElement.dataset.search === 'live' && S.list.live?.length) {
        document.activeElement.blur();
        selectLive(0, true);
      }
      return;
    }
    if (S.view === 'live' && $('#sheet').hidden && S.list.live) {
      const items = S.list.live;
      if (e.key === 'ArrowDown') return e.preventDefault(), selectLive(Math.min(items.length - 1, S.liveSel + 1));
      if (e.key === 'ArrowUp') return e.preventDefault(), selectLive(Math.max(0, S.liveSel - 1));
      if (e.key === 'PageDown') return e.preventDefault(), selectLive(Math.min(items.length - 1, S.liveSel + 10));
      if (e.key === 'PageUp') return e.preventDefault(), selectLive(Math.max(0, S.liveSel - 10));
      if (e.key === 'Enter' && S.liveSel >= 0) {
        if (!player.cur) selectLive(S.liveSel, true);
        return player.setMode('full');
      }
      if (e.key === ' ' && player.cur) return e.preventDefault(), player.toggle();
      if (e.key === 'f' && player.cur) return player.setMode('full');
      if (/^\d$/.test(e.key)) {
        numBuf += e.key;
        clearTimeout(numT);
        toast(`Channel ${numBuf}`, 1200);
        numT = setTimeout(() => {
          const n = +numBuf;
          numBuf = '';
          const all = S.data.live.items;
          const it = all.find((x) => +x.o === n);
          if (!it) return toast(`No channel ${n}`);
          S.cat.live = 'all';
          S.query.live = '';
          $('[data-search="live"]').value = '';
          renderCats('live');
          refreshLive();
          selectLive(S.list.live.indexOf(it), true);
        }, 1100);
      }
    }
  });
}
