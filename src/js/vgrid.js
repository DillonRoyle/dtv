// Virtualised list / grid: only the rows on screen exist in the DOM, so
// 50,000 channels or films scroll as smoothly as 50.
export class VirtualGrid {
  /**
   * opts: {
   *   minItemWidth?: number  // grid mode when set, columns are fitted to width
   *   rowHeight: number | (cellWidth) => number
   *   gap?: number, pad?: number,
   *   create(): HTMLElement, render(el, item, index),
   *   onActivate?(item, index, event), onDouble?(item, index, event)
   * }
   */
  constructor(root, opts) {
    this.root = root;
    root._vg = this;
    this.o = { gap: 0, pad: 0, ...opts };
    this.items = [];
    this.live = new Map(); // index -> el
    this.free = [];
    root.classList.add('vg');
    this.inner = document.createElement('div');
    this.inner.className = 'vg-inner';
    root.append(this.inner);
    this.raf = 0;
    root.addEventListener('scroll', () => this.schedule(), { passive: true });
    this.ro = new ResizeObserver(() => {
      this.measure();
      this.layoutAll();
      this.schedule();
    });
    this.ro.observe(root);
    const pick = (e) => {
      const el = e.target.closest('[data-vi]');
      return el ? +el.dataset.vi : -1;
    };
    this.inner.addEventListener('click', (e) => {
      const i = pick(e);
      if (i >= 0) this.o.onActivate?.(this.items[i], i, e);
    });
    this.inner.addEventListener('dblclick', (e) => {
      const i = pick(e);
      if (i >= 0) this.o.onDouble?.(this.items[i], i, e);
    });
    this.measure();
  }

  setItems(items, keepScroll = false) {
    this.items = items;
    for (const el of this.live.values()) this.recycle(el);
    this.live.clear();
    if (!keepScroll) this.root.scrollTop = 0;
    this.measure();
    this.render();
  }

  measure() {
    const { gap, pad, minItemWidth, rowHeight } = this.o;
    const w = Math.max(0, this.root.clientWidth - pad * 2);
    if (minItemWidth) {
      this.cols = Math.max(1, Math.floor((w + gap) / (minItemWidth + gap)));
      this.cw = (w - gap * (this.cols - 1)) / this.cols;
    } else {
      this.cols = 1;
      this.cw = w;
    }
    this.ch = typeof rowHeight === 'function' ? rowHeight(this.cw) : rowHeight;
    this.rowH = this.ch + gap;
    const rows = Math.ceil(this.items.length / this.cols);
    this.inner.style.height = Math.max(0, rows * this.rowH - gap + pad * 2) + 'px';
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  place(el, i) {
    const r = Math.floor(i / this.cols);
    const c = i % this.cols;
    const x = this.o.pad + c * (this.cw + this.o.gap);
    const y = this.o.pad + r * this.rowH;
    el.style.transform = `translate3d(${x}px,${y}px,0)`;
    el.style.width = this.cw + 'px';
    el.style.height = this.ch + 'px';
  }
  layoutAll() {
    for (const [i, el] of this.live) this.place(el, i);
  }
  recycle(el) {
    el.style.display = 'none';
    this.free.push(el);
  }

  render() {
    const n = this.items.length;
    const top = this.root.scrollTop - this.o.pad;
    const h = this.root.clientHeight;
    const overscan = this.cols > 1 ? 2 : 6;
    const firstRow = Math.max(0, Math.floor(top / this.rowH) - overscan);
    const lastRow = Math.ceil((top + h) / this.rowH) + overscan;
    const start = firstRow * this.cols;
    const end = Math.min(n, (lastRow + 1) * this.cols);
    for (const [i, el] of this.live) {
      if (i < start || i >= end) {
        this.live.delete(i);
        this.recycle(el);
      }
    }
    for (let i = start; i < end; i++) {
      if (this.live.has(i)) continue;
      let el = this.free.pop();
      if (!el) {
        el = this.o.create();
        el.classList.add('vg-cell');
        this.inner.append(el);
      }
      el.style.display = '';
      el.dataset.vi = i;
      this.o.render(el, this.items[i], i);
      this.place(el, i);
      this.live.set(i, el);
    }
  }

  /** Re-render the visible cells in place (e.g. after selection or a favourite change). */
  refresh() {
    for (const [i, el] of this.live) this.o.render(el, this.items[i], i);
  }

  scrollToIndex(i, align = 'auto') {
    const r = Math.floor(i / this.cols);
    const y = this.o.pad + r * this.rowH;
    const st = this.root.scrollTop;
    const h = this.root.clientHeight;
    if (align === 'center') this.root.scrollTop = y - h / 2 + this.ch / 2;
    else if (y < st) this.root.scrollTop = y - this.o.pad;
    else if (y + this.ch > st + h) this.root.scrollTop = y + this.ch - h + this.o.pad;
    this.render();
  }

  elementFor(i) {
    return this.live.get(i);
  }
}
