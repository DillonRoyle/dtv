// DTV player: MPEG-TS (mpegts.js), HLS (hls.js) and direct files, with
// automatic fallback between formats and auto-reconnect for live TV.
import { icon } from './icons.js';

const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
};
export { fmtTime };

export class Player {
  constructor(root, { onModeChange, onExternal, onCopy } = {}) {
    this.root = root;
    this.cb = { onModeChange, onExternal, onCopy };
    this.mode = 'hidden';
    this.engine = null;
    this.token = 0;
    root.className = 'player is-hidden';
    root.innerHTML = `
      <video class="pl-video" playsinline preload="auto"></video>
      <div class="pl-shade"></div>
      <div class="pl-top">
        <button class="pl-btn pl-back" data-act="back" title="Back (Esc)">${icon('back')}</button>
        <div class="pl-titles"><div class="pl-title"></div><div class="pl-sub"></div></div>
        <span class="pl-live"><i></i>Live</span>
      </div>
      <div class="pl-center">
        <div class="pl-spinner"><span></span></div>
        <div class="pl-error" hidden>
          <p class="pl-error-msg"></p>
          <div class="pl-error-actions">
            <button class="btn btn-primary" data-act="retry">Try again</button>
            <button class="btn" data-act="external">Open in VLC</button>
            <button class="btn" data-act="copy">Copy stream link</button>
          </div>
        </div>
      </div>
      <div class="pl-osd" hidden></div>
      <div class="pl-bottom">
        <div class="pl-seek" hidden>
          <span class="pl-time pl-cur">0:00</span>
          <div class="pl-track"><div class="pl-buf"></div><div class="pl-prog"></div><div class="pl-knob"></div><div class="pl-hover"></div></div>
          <span class="pl-time pl-dur">0:00</span>
        </div>
        <div class="pl-row">
          <button class="pl-btn" data-act="toggle" title="Play / pause (Space)">${icon('pause')}</button>
          <button class="pl-btn pl-vod-only" data-act="rw" title="Back 10 seconds (←)">${icon('rewind')}</button>
          <button class="pl-btn pl-vod-only" data-act="ff" title="Forward 10 seconds (→)">${icon('forward')}</button>
          <div class="pl-vol">
            <button class="pl-btn" data-act="mute" title="Mute (M)">${icon('volume')}</button>
            <input type="range" min="0" max="1" step="0.02" value="1" aria-label="Volume">
          </div>
          <div class="pl-fill"></div>
          <span class="pl-tech"></span>
          <button class="pl-btn pl-live-only" data-act="zapUp" title="Previous channel (↑)">${icon('chevUp')}</button>
          <button class="pl-btn pl-live-only" data-act="zapDown" title="Next channel (↓)">${icon('chevDown')}</button>
          <button class="pl-btn" data-act="external" title="Open in VLC">${icon('external')}</button>
          <button class="pl-btn" data-act="pip" title="Picture in picture (P)">${icon('pip')}</button>
          <button class="pl-btn" data-act="full" title="Fullscreen (F)">${icon('expand')}</button>
        </div>
      </div>`;
    this.v = root.querySelector('video');
    this.$ = (s) => root.querySelector(s);
    this.v.volume = 1;

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) {
        e.stopPropagation();
        this.action(b.dataset.act);
        return;
      }
      if (e.target === this.v || e.target.classList.contains('pl-shade') || e.target.classList.contains('pl-center')) {
        if (this.mode === 'docked') this.setMode('full');
        else this.toggle();
      }
    });
    root.addEventListener('dblclick', (e) => {
      if (e.target.closest('.pl-bottom,.pl-top')) return;
      if (this.mode === 'docked') return;
      this.toggleFullscreen();
    });
    root.addEventListener('mousemove', () => this.poke());
    root.addEventListener('mouseleave', () => this.mode === 'full' && this.hideSoon(600));

    const vol = this.$('.pl-vol input');
    vol.addEventListener('input', () => {
      this.v.volume = +vol.value;
      this.v.muted = +vol.value === 0;
      this.syncVol();
      this.onVolume?.(this.v.volume);
    });

    // seek bar dragging
    const track = this.$('.pl-track');
    const posFrom = (e) => {
      const r = track.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    track.addEventListener('pointerdown', (e) => {
      if (!this.v.duration) return;
      track.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.drawProgress(posFrom(e) * this.v.duration);
    });
    track.addEventListener('pointermove', (e) => {
      const f = posFrom(e);
      const hv = this.$('.pl-hover');
      hv.style.left = f * 100 + '%';
      hv.textContent = fmtTime(f * (this.v.duration || 0));
      if (this.dragging) this.drawProgress(f * this.v.duration);
    });
    track.addEventListener('pointerup', (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.v.currentTime = posFrom(e) * this.v.duration;
    });

    const v = this.v;
    v.addEventListener('playing', () => this.setBusy(false));
    v.addEventListener('canplay', () => this.setBusy(false));
    v.addEventListener('waiting', () => this.setBusy(true));
    v.addEventListener('play', () => this.syncPlay());
    v.addEventListener('pause', () => this.syncPlay());
    v.addEventListener('volumechange', () => this.syncVol());
    v.addEventListener('timeupdate', () => this.onTime());
    v.addEventListener('progress', () => this.drawBuffer());
    v.addEventListener('loadedmetadata', () => {
      if (this.opts?.startAt && this.v.duration > this.opts.startAt) this.v.currentTime = this.opts.startAt;
      this.syncTech();
    });
    v.addEventListener('ended', () => this.opts?.onEnded?.());
    v.addEventListener('error', () => {
      // only for direct-file playback; engines report their own errors
      if (!this.engine && this.cur) this.fail('media');
    });
    document.addEventListener('fullscreenchange', () => this.syncFull());
    if (window.dtv) window.dtv.onFullscreen(() => this.syncFull());
  }

  // ---------- public ----------
  play(opts) {
    this.opts = opts;
    this.sources = opts.sources.filter((s) => s && s.url);
    this.srcIndex = 0;
    this.retries = 0;
    this.root.classList.toggle('is-live', !!opts.live);
    this.$('.pl-title').textContent = opts.title || '';
    this.$('.pl-sub').textContent = opts.subtitle || '';
    this.$('.pl-seek').hidden = !!opts.live;
    this.lastSave = 0;
    if (this.mode === 'hidden') this.setMode(opts.mode || 'full');
    this.start();
  }

  stop() {
    this.token++;
    this.destroyEngine();
    this.v.removeAttribute('src');
    this.v.load();
    this.cur = null;
    clearTimeout(this.stallT);
    this.setBusy(false);
    this.showError(null);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    this.root.classList.toggle('is-hidden', mode === 'hidden');
    this.root.classList.toggle('is-docked', mode === 'docked');
    this.root.classList.toggle('is-full', mode === 'full');
    if (mode !== 'full' && this.isFullscreen()) this.exitFullscreen();
    if (mode === 'full') this.poke();
    this.cb.onModeChange?.(mode, prev);
  }

  osd(html, ms = 3200) {
    const o = this.$('.pl-osd');
    o.innerHTML = html;
    o.hidden = false;
    o.classList.remove('show');
    void o.offsetWidth;
    o.classList.add('show');
    clearTimeout(this.osdT);
    this.osdT = setTimeout(() => {
      o.classList.remove('show');
      setTimeout(() => (o.hidden = true), 250);
    }, ms);
  }

  setTitle(title, sub) {
    this.$('.pl-title').textContent = title || '';
    this.$('.pl-sub').textContent = sub || '';
  }

  handleKey(e) {
    const k = e.key;
    const live = this.opts?.live;
    if (k === ' ' || k === 'k') return this.toggle(), true;
    if (k === 'f' || k === 'F') return this.toggleFullscreen(), true;
    if (k === 'm' || k === 'M') return (this.v.muted = !this.v.muted), true;
    if (k === 'p' || k === 'P') return this.action('pip'), true;
    if (k === 'Escape') {
      if (this.isFullscreen()) this.exitFullscreen();
      else this.action('back');
      return true;
    }
    if (!live && k === 'ArrowLeft') return this.seekBy(e.shiftKey ? -60 : -10), true;
    if (!live && k === 'ArrowRight') return this.seekBy(e.shiftKey ? 60 : 10), true;
    if (live && (k === 'ArrowUp' || k === 'PageUp' || k === 'ChannelUp')) return this.opts.onZap?.(-1), true;
    if (live && (k === 'ArrowDown' || k === 'PageDown' || k === 'ChannelDown')) return this.opts.onZap?.(1), true;
    if (!live && k === 'ArrowUp') return this.nudgeVol(0.05), true;
    if (!live && k === 'ArrowDown') return this.nudgeVol(-0.05), true;
    return false;
  }

  setVolume(v) {
    this.v.volume = Math.min(1, Math.max(0, v));
    this.syncVol();
  }

  // ---------- internals ----------
  action(a) {
    switch (a) {
      case 'toggle':
        return this.toggle();
      case 'rw':
        return this.seekBy(-10);
      case 'ff':
        return this.seekBy(10);
      case 'mute':
        this.v.muted = !this.v.muted;
        if (!this.v.muted && this.v.volume === 0) this.v.volume = 0.5;
        return;
      case 'full':
        return this.mode === 'docked' ? this.setMode('full') : this.toggleFullscreen();
      case 'pip':
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
        else this.v.requestPictureInPicture?.().catch(() => {});
        return;
      case 'back':
        if (this.isFullscreen()) this.exitFullscreen();
        this.opts?.onBack ? this.opts.onBack() : this.setMode('hidden');
        return;
      case 'retry':
        this.srcIndex = 0;
        this.retries = 0;
        return this.start();
      case 'external':
        return this.cb.onExternal?.(this.cur?.url || this.sources?.[0]?.url, this.opts?.title);
      case 'copy':
        return this.cb.onCopy?.(this.cur?.url || this.sources?.[0]?.url);
      case 'zapUp':
        return this.opts?.onZap?.(-1);
      case 'zapDown':
        return this.opts?.onZap?.(1);
    }
  }

  toggle() {
    if (!this.cur) return;
    if (this.v.paused) this.v.play().catch(() => {});
    else this.v.pause();
    this.poke();
  }
  seekBy(s) {
    if (!this.v.duration) return;
    this.v.currentTime = Math.min(this.v.duration - 1, Math.max(0, this.v.currentTime + s));
    this.poke();
  }
  nudgeVol(d) {
    this.v.muted = false;
    this.setVolume(this.v.volume + d);
    this.onVolume?.(this.v.volume);
  }

  isFullscreen() {
    return !!document.fullscreenElement;
  }
  toggleFullscreen() {
    if (this.isFullscreen()) this.exitFullscreen();
    else this.root.requestFullscreen?.().catch(() => {});
  }
  exitFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  syncFull() {
    const on = this.isFullscreen();
    this.root.classList.toggle('is-fs', on);
    this.$('[data-act="full"]').innerHTML = icon(on ? 'shrink' : 'expand');
  }

  poke() {
    this.root.classList.add('ui-on');
    this.hideSoon(2800);
  }
  hideSoon(ms) {
    clearTimeout(this.uiT);
    this.uiT = setTimeout(() => {
      if (this.v.paused || this.root.querySelector('.pl-bottom:hover') || !this.$('.pl-error').hidden) return;
      this.root.classList.remove('ui-on');
    }, ms);
  }

  setBusy(on) {
    this.root.classList.toggle('is-busy', !!on);
    clearTimeout(this.stallT);
    if (on && this.opts?.live && this.cur) {
      const tok = this.token;
      this.stallT = setTimeout(() => tok === this.token && this.recover('stall'), 12000);
    }
  }

  syncPlay() {
    this.$('[data-act="toggle"]').innerHTML = icon(this.v.paused ? 'play' : 'pause');
    this.root.classList.toggle('is-paused', this.v.paused);
    if (this.v.paused) this.root.classList.add('ui-on');
    else this.hideSoon(2000);
  }
  syncVol() {
    const muted = this.v.muted || this.v.volume === 0;
    this.$('[data-act="mute"]').innerHTML = icon(muted ? 'mute' : 'volume');
    const r = this.$('.pl-vol input');
    r.value = muted ? 0 : this.v.volume;
    r.style.setProperty('--p', (muted ? 0 : this.v.volume) * 100 + '%');
  }
  syncTech() {
    const h = this.v.videoHeight;
    const label = h ? (h >= 2000 ? '4K' : h >= 1000 ? 'FHD' : h >= 700 ? 'HD' : 'SD') : '';
    this.$('.pl-tech').textContent = label ? `${label} · ${this.cur?.type?.toUpperCase() || ''}` : '';
  }

  onTime() {
    if (this.opts?.live) return;
    if (!this.dragging) this.drawProgress(this.v.currentTime);
    const now = performance.now();
    if (this.opts?.onTime && now - this.lastSave > 5000) {
      this.lastSave = now;
      this.opts.onTime(this.v.currentTime, this.v.duration);
    }
  }
  drawProgress(t) {
    const d = this.v.duration || 0;
    const f = d ? t / d : 0;
    this.$('.pl-prog').style.transform = `scaleX(${f})`;
    this.$('.pl-knob').style.left = f * 100 + '%';
    this.$('.pl-cur').textContent = fmtTime(t);
    this.$('.pl-dur').textContent = fmtTime(d);
  }
  drawBuffer() {
    const v = this.v;
    if (!v.duration || !v.buffered.length) return;
    let end = 0;
    for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1) end = v.buffered.end(i);
    this.$('.pl-buf').style.transform = `scaleX(${end / v.duration})`;
  }

  showError(msg) {
    const box = this.$('.pl-error');
    box.hidden = !msg;
    this.root.classList.toggle('has-error', !!msg);
    if (msg) {
      this.$('.pl-error-msg').textContent = msg;
      this.root.classList.add('ui-on');
    }
  }

  destroyEngine() {
    const e = this.engine;
    this.engine = null;
    if (!e) return;
    try {
      if (e.kind === 'hls') e.inst.destroy();
      if (e.kind === 'ts') {
        e.inst.pause();
        e.inst.unload();
        e.inst.detachMediaElement();
        e.inst.destroy();
      }
    } catch {}
  }

  start() {
    const tok = ++this.token;
    this.destroyEngine();
    this.showError(null);
    const src = this.sources[this.srcIndex];
    if (!src) return this.fail('none');
    this.cur = src;
    this.setBusy(true);
    this.$('.pl-tech').textContent = '';
    const v = this.v;
    v.removeAttribute('src');

    const go = () => v.play().catch(() => {});
    if (src.type === 'hls' && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startFragPrefetch: true,
        maxBufferLength: this.opts.live ? 20 : 40,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
        startLevel: -1,
        capLevelToPlayerSize: false,
      });
      this.engine = { kind: 'hls', inst: hls };
      let mediaRecovered = false;
      hls.on(window.Hls.Events.ERROR, (_e, data) => {
        if (tok !== this.token || !data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
          mediaRecovered = true;
          hls.recoverMediaError();
        } else this.recover('hls:' + data.details);
      });
      hls.on(window.Hls.Events.MANIFEST_PARSED, go);
      hls.loadSource(src.url);
      hls.attachMedia(v);
    } else if (src.type === 'ts' && window.mpegts && window.mpegts.getFeatureList().mseLivePlayback) {
      const p = window.mpegts.createPlayer(
        { type: 'mpegts', isLive: !!this.opts.live, url: src.url },
        {
          enableWorker: true,
          enableStashBuffer: false,
          stashInitialSize: 128 * 1024,
          lazyLoad: false,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 6,
          liveBufferLatencyMinRemain: 1.5,
          autoCleanupSourceBuffer: true,
        }
      );
      this.engine = { kind: 'ts', inst: p };
      p.on(window.mpegts.Events.ERROR, () => tok === this.token && this.recover('ts'));
      p.on(window.mpegts.Events.LOADING_COMPLETE, () => {
        // a live TS stream that "completes" has dropped – reconnect
        if (tok === this.token && this.opts.live) this.recover('ended');
      });
      p.attachMediaElement(v);
      p.load();
      go();
    } else if (src.type === 'file' || (src.type === 'hls' && v.canPlayType('application/vnd.apple.mpegurl'))) {
      v.src = src.url;
      go();
    } else {
      // engine not available for this format, move on
      return this.next();
    }
  }

  recover(reason) {
    // retry the same source once for live hiccups, then fall through to the next format
    if (this.opts?.live && this.retries < 2 && reason !== 'media') {
      this.retries++;
      const tok = this.token;
      setTimeout(() => tok === this.token && this.start(), 600 * this.retries);
      return;
    }
    this.next();
  }
  next() {
    this.retries = 0;
    if (this.srcIndex < this.sources.length - 1) {
      this.srcIndex++;
      this.start();
    } else this.fail('all');
  }
  fail(why) {
    this.destroyEngine();
    this.setBusy(false);
    clearTimeout(this.stallT);
    const live = this.opts?.live;
    this.showError(
      live
        ? "This channel isn't playing right now. It may be offline, or your account may already be watching on another device."
        : why === 'media'
        ? "This video's format can't be played inside DTV. VLC can play almost anything."
        : "This video couldn't be loaded. It may have been removed from the server."
    );
  }
}
