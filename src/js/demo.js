// Built-in demo playlist. Log in with server "demo", username "demo", password "demo".
// Everything plays free, openly licensed test videos (Blender open movies and the
// public sample streams from Google, Apple, Mux and Akamai), so nothing else is needed.

const G = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/';
const img = (n) => `${G}images/${n}.jpg`;

const STREAMS = {
  mux: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  apple: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8',
  appleAdv: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8',
  akamai: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
  tears: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
};

const LIVE_CATS = [
  { id: '1', n: 'Demo | Films 24/7' },
  { id: '2', n: 'Demo | Test channels' },
  { id: '3', n: 'Demo | Motoring' },
];
const LIVE = [
  { i: 101, n: 'Big Buck Bunny 24/7', c: '1', l: img('BigBuckBunny'), url: STREAMS.mux },
  { i: 102, n: 'Tears of Steel 24/7', c: '1', l: img('TearsOfSteel'), url: STREAMS.tears },
  { i: 103, n: 'Sintel 24/7', c: '1', l: img('Sintel'), url: G + 'Sintel.mp4' },
  { i: 104, n: 'Elephants Dream 24/7', c: '1', l: img('ElephantsDream'), url: G + 'ElephantsDream.mp4' },
  { i: 201, n: 'Live Test HD', c: '2', l: '', url: STREAMS.akamai },
  { i: 202, n: 'Test Pattern', c: '2', l: '', url: STREAMS.apple },
  { i: 203, n: 'Test Pattern Advanced', c: '2', l: '', url: STREAMS.appleAdv },
  { i: 301, n: 'Car Reviews', c: '3', l: img('VolkswagenGTIReview'), url: G + 'VolkswagenGTIReview.mp4' },
  { i: 302, n: 'Off Road', c: '3', l: img('SubaruOutbackOnStreetAndDirt'), url: G + 'SubaruOutbackOnStreetAndDirt.mp4' },
  { i: 303, n: 'Bullrun', c: '3', l: img('WeAreGoingOnBullrun'), url: G + 'WeAreGoingOnBullrun.mp4' },
];

const MOVIE_CATS = [
  { id: '1', n: 'Open Movies' },
  { id: '2', n: 'Shorts' },
  { id: '3', n: 'Motoring' },
];
const MOVIES = [
  { i: 1001, n: 'Big Buck Bunny (2008)', c: '1', f: 'BigBuckBunny', r: 7.6, y: '2008', d: '00:09:56', g: 'Animation, Comedy',
    p: 'A giant, gentle rabbit is pushed too far by three bullying rodents and decides to get his own back. An open movie from the Blender Foundation.' },
  { i: 1002, n: 'Elephants Dream (2006)', c: '1', f: 'ElephantsDream', r: 6.5, y: '2006', d: '00:10:53', g: 'Animation, Sci-Fi',
    p: 'Two men explore a strange, ever-changing machine world, each seeing it very differently. The first Blender open movie.' },
  { i: 1003, n: 'Sintel (2010)', c: '1', f: 'Sintel', r: 7.4, y: '2010', d: '00:14:48', g: 'Animation, Fantasy',
    p: 'A lonely young woman searches the wild for the baby dragon she once rescued and lost. An open movie from the Blender Foundation.' },
  { i: 1004, n: 'Tears of Steel (2012)', c: '1', f: 'TearsOfSteel', r: 6.2, y: '2012', d: '00:12:14', g: 'Sci-Fi, Action',
    p: 'In a future Amsterdam, a group of scientists try to save the world by revisiting a painful breakup. A Blender open movie.' },
  { i: 2001, n: 'For Bigger Blazes', c: '2', f: 'ForBiggerBlazes', r: 5.8, y: '2013', d: '00:00:15', g: 'Short', p: 'A short sample clip.' },
  { i: 2002, n: 'For Bigger Escapes', c: '2', f: 'ForBiggerEscapes', r: 5.9, y: '2013', d: '00:00:15', g: 'Short', p: 'A short sample clip.' },
  { i: 2003, n: 'For Bigger Fun', c: '2', f: 'ForBiggerFun', r: 6.0, y: '2013', d: '00:01:00', g: 'Short', p: 'A short sample clip.' },
  { i: 2004, n: 'For Bigger Joyrides', c: '2', f: 'ForBiggerJoyrides', r: 5.7, y: '2013', d: '00:00:15', g: 'Short', p: 'A short sample clip.' },
  { i: 2005, n: 'For Bigger Meltdowns', c: '2', f: 'ForBiggerMeltdowns', r: 5.6, y: '2013', d: '00:00:15', g: 'Short', p: 'A short sample clip.' },
  { i: 3001, n: 'Subaru Outback On Street And Dirt', c: '3', f: 'SubaruOutbackOnStreetAndDirt', r: 6.1, y: '2015', d: '00:09:54', g: 'Motoring',
    p: 'A test drive on tarmac and gravel.' },
  { i: 3002, n: 'Volkswagen GTI Review', c: '3', f: 'VolkswagenGTIReview', r: 6.3, y: '2015', d: '00:09:54', g: 'Motoring', p: 'A road review.' },
  { i: 3003, n: 'We Are Going On Bullrun', c: '3', f: 'WeAreGoingOnBullrun', r: 6.0, y: '2015', d: '00:00:47', g: 'Motoring', p: 'A road-rally teaser.' },
  { i: 3004, n: 'What Car Can You Get For A Grand?', c: '3', f: 'WhatCarCanYouGetForAGrand', r: 6.4, y: '2015', d: '00:09:54', g: 'Motoring',
    p: 'How far does a thousand dollars go on a used car?' },
];

const SERIES_CATS = [{ id: '1', n: 'Demo Series' }];
const SERIES = [
  {
    i: 501, n: 'The Blender Open Movies', c: '1', l: img('Sintel'), r: 7.2, y: '2006',
    plot: 'The Blender Foundation’s short films, made openly and free for anyone to watch and share.',
    seasons: { 1: [1002, 1001, 1003, 1004] },
  },
  {
    i: 502, n: 'For Bigger Things', c: '1', l: img('ForBiggerJoyrides'), r: 5.9, y: '2013',
    plot: 'A collection of short sample clips.',
    seasons: { 1: [2001, 2002, 2003], 2: [2004, 2005] },
  },
  {
    i: 503, n: 'Car Talk', c: '1', l: img('VolkswagenGTIReview'), r: 6.2, y: '2015',
    plot: 'Reviews and road tests.',
    seasons: { 1: [3002, 3001, 3004, 3003] },
  },
];

const movieById = (id) => MOVIES.find((m) => m.i === +id);
const liveById = (id) => LIVE.find((c) => c.i === +id);
const SHOWS = ['Morning Matinee', 'Afternoon Feature', 'Evening Premiere', 'Late Show', 'Night Screening', 'Encore'];

export function isDemoHost(host) {
  return /^https?:\/\/demo\/?$/i.test(String(host || '').trim()) || /^demo$/i.test(String(host || '').trim());
}

/** Same methods as the Xtream client, answered from the built-in playlist. */
export const demoApi = {
  async auth() {
    return {
      user_info: { auth: 1, status: 'Active', exp_date: null, is_trial: '0', active_cons: '0', max_connections: '1', created_at: '1735689600' },
      server_info: { timezone: 'Europe/London' },
    };
  },
  async live() {
    return { cats: LIVE_CATS, items: LIVE.map((c, k) => ({ i: c.i, n: c.n, c: c.c, l: c.l, e: '', a: 0, o: k + 1 })) };
  },
  async movies() {
    return {
      cats: MOVIE_CATS,
      items: MOVIES.map((m, k) => ({ i: m.i, n: m.n, c: m.c, l: img(m.f), r: m.r, x: 'mp4', t: 1735689600 - k * 86400, o: k })),
    };
  },
  async series() {
    return { cats: SERIES_CATS, items: SERIES.map((s, k) => ({ i: s.i, n: s.n, c: s.c, l: s.l, r: s.r, t: 1735689600 - k * 86400, y: s.y, o: k })) };
  },
  async vodInfo(id) {
    const m = movieById(id) || MOVIES[0];
    return {
      info: { plot: m.p, genre: m.g, duration: m.d, releasedate: m.y + '-01-01', director: m.c === '1' ? 'Blender Foundation' : '', backdrop_path: [img(m.f)] },
      movie_data: { stream_id: m.i, container_extension: 'mp4' },
    };
  },
  async seriesInfo(id) {
    const s = SERIES.find((x) => x.i === +id) || SERIES[0];
    const episodes = {};
    for (const [season, ids] of Object.entries(s.seasons)) {
      episodes[season] = ids.map((mid, k) => {
        const m = movieById(mid);
        return {
          id: String(mid),
          episode_num: k + 1,
          title: m.n.replace(/\s*\(\d{4}\)$/, ''),
          container_extension: 'mp4',
          info: { duration: m.d, plot: m.p, movie_image: img(m.f) },
        };
      });
    }
    return { info: { name: s.n, plot: s.plot, genre: 'Demo', releaseDate: s.y + '-01-01', backdrop_path: [s.l] }, episodes };
  },
  async shortEpg(id, limit = 4) {
    const hour = 3600 * 1000;
    const base = Math.floor(Date.now() / hour) * hour;
    const ch = liveById(id);
    return Array.from({ length: limit }, (_, k) => ({
      title: `${SHOWS[(+id + k) % SHOWS.length]}${ch ? '' : ''}`,
      desc: k === 0 ? 'Demo programme guide. Real playlists show their own listings here.' : '',
      start: base + k * hour,
      end: base + (k + 1) * hour,
    }));
  },
  liveUrl(id) {
    const c = liveById(id);
    return c ? c.url : STREAMS.mux;
  },
  movieUrl(id) {
    const m = movieById(id);
    return G + (m ? m.f : 'BigBuckBunny') + '.mp4';
  },
  episodeUrl(id) {
    return this.movieUrl(id);
  },
};
