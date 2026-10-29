// D-pad (remote control) navigation for the TV build.
// Arrow keys move focus to the nearest control in that direction; inside the
// virtual channel list and poster grids they move by row/column instead, so
// long lists scroll as you go.

const FOCUSABLE = 'button:not([disabled]), input:not([type=hidden]), select, [data-focus]';

function visible(el) {
  if (!el || el.disabled) return false;
  if (el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && +st.opacity !== 0;
}

/** The part of the screen that currently owns the remote. */
function layer() {
  const sheet = document.getElementById('sheet');
  if (sheet && !sheet.hidden) return sheet;
  const login = document.getElementById('login');
  if (login && !login.hidden) return login;
  return document.getElementById('main');
}

function candidates() {
  const root = layer();
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (!visible(el)) return false;
    // controls inside cells are reached with the Menu key instead
    if (el.closest('.vg-cell') && !el.classList.contains('vg-cell')) return false;
    // ignore anything inside a hidden view
    const view = el.closest('.view');
    return !view || !view.hidden;
  });
}

function centre(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function geometric(from, dir) {
  const fr = from.getBoundingClientRect();
  const fc = centre(fr);
  let best = null;
  let bestScore = Infinity;
  for (const el of candidates()) {
    if (el === from) continue;
    const r = el.getBoundingClientRect();
    const c = centre(r);
    let main;
    let cross;
    const hGap = Math.max(0, r.left - fr.right, fr.left - r.right); // 0 when columns overlap
    const vGap = Math.max(0, r.top - fr.bottom, fr.top - r.bottom); // 0 when rows overlap
    if (dir === 'left') {
      if (r.right > fr.left + 2) continue;
      main = fr.left - r.right;
      cross = vGap * 3 + Math.abs(c.y - fc.y) * 0.3;
    } else if (dir === 'right') {
      if (r.left < fr.right - 2) continue;
      main = r.left - fr.right;
      cross = vGap * 3 + Math.abs(c.y - fc.y) * 0.3;
    } else if (dir === 'up') {
      if (r.bottom > fr.top + 2) continue;
      main = fr.top - r.bottom;
      cross = hGap * 3 + Math.abs(c.x - fc.x) * 0.15;
    } else {
      if (r.top < fr.bottom - 2) continue;
      main = r.top - fr.bottom;
      cross = hGap * 3 + Math.abs(c.x - fc.x) * 0.15;
    }
    const score = main + cross;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

export function focusEl(el, opts = {}) {
  if (!el) return false;
  const vgRoot = el.classList.contains('vg-cell') ? el.closest('.vg') : null;
  if (vgRoot && vgRoot._vg) {
    vgRoot._vgLast = +el.dataset.vi;
    el.focus({ preventScroll: true });
  } else {
    el.focus({ preventScroll: !!opts.noScroll });
    if (!opts.noScroll && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  return true;
}

/** Focus a cell of a virtual grid by index, scrolling it into view first. */
export function focusIndex(vgRoot, i) {
  const g = vgRoot && vgRoot._vg;
  if (!g || !g.items.length) return false;
  i = Math.max(0, Math.min(g.items.length - 1, i));
  g.scrollToIndex(i);
  const el = g.elementFor(i);
  return el ? focusEl(el) : false;
}

/** Where focus should land when entering a container from outside it. */
function preferred(target, from) {
  const catList = target.closest('.cat-list');
  if (catList && !from?.closest('.cat-list')) {
    const on = catList.querySelector('.cat.is-on');
    if (on && visible(on)) return on;
  }
  const vgRoot = target.classList.contains('vg-cell') ? target.closest('.vg') : null;
  if (vgRoot && from?.closest('.vg') !== vgRoot) {
    const g = vgRoot._vg;
    const want = vgRoot._vgLast;
    if (g && want != null && want < g.items.length) {
      g.scrollToIndex(want);
      const el = g.elementFor(want);
      if (el) return el;
    }
  }
  const rail = target.closest('.rail');
  if (rail && !from?.closest('.rail')) {
    const on = rail.querySelector('.rail-btn.is-on');
    if (on) return on;
  }
  return target;
}

function moveInGrid(el, dir) {
  const vgRoot = el.closest('.vg');
  const g = vgRoot && vgRoot._vg;
  if (!g) return null;
  const i = +el.dataset.vi;
  const cols = g.cols;
  const n = g.items.length;
  let j = null;
  if (dir === 'up' && i - cols >= 0) j = i - cols;
  if (dir === 'down') {
    if (i + cols < n) j = i + cols;
    else if (Math.floor(i / cols) < Math.floor((n - 1) / cols)) j = n - 1; // short last row
    else return 'stay';
  }
  if (cols > 1 && dir === 'left' && i % cols > 0) j = i - 1;
  if (cols > 1 && dir === 'right' && i % cols < cols - 1 && i + 1 < n) j = i + 1;
  if (j === null) return null;
  focusIndex(vgRoot, j);
  return 'moved';
}

export function move(dir) {
  const cur = document.activeElement;
  const inLayer = cur && cur !== document.body && layer().contains(cur) && visible(cur);
  if (!inLayer) {
    return focusDefault();
  }
  if (cur.classList.contains('vg-cell')) {
    const r = moveInGrid(cur, dir);
    if (r) return true;
  }
  const t = geometric(cur, dir);
  if (!t) return false;
  return focusEl(preferred(t, cur));
}

/** Put focus somewhere sensible, e.g. after a view change. */
export function focusDefault() {
  const root = layer();
  const pick =
    root.querySelector('.sheet-panel [data-actions] button') ||
    root.querySelector('#savedList .saved-item') ||
    (root.id === 'login' ? root.querySelector('input[name=host]') : null) ||
    [...root.querySelectorAll('.view:not([hidden]) .vg-cell[data-focus]')].find(visible) ||
    [...root.querySelectorAll('.view:not([hidden]) .cat.is-on')].find(visible) ||
    root.querySelector('.rail-btn.is-on') ||
    candidates()[0];
  return pick ? focusEl(preferred(pick, null)) : false;
}

export function installTvNav() {
  document.addEventListener(
    'keydown',
    (e) => {
      const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const dir = map[e.key];
      const a = document.activeElement;
      const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
      if (dir) {
        if (typing && (dir === 'left' || dir === 'right')) {
          // let the caret move inside text until it reaches the edge
          const atStart = a.selectionStart === 0 && a.selectionEnd === 0;
          const atEnd = a.selectionStart === a.value.length;
          if ((dir === 'left' && !atStart) || (dir === 'right' && !atEnd)) return;
        }
        if (a && a.tagName === 'SELECT' && (dir === 'up' || dir === 'down')) {
          // move off a dropdown instead of changing it; OK opens it
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        move(dir);
        return;
      }
      if (e.key === 'Enter' && a && a.matches('[data-focus]') && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        a.click();
      }
    },
    true
  );
}
