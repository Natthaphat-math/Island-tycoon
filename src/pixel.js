// pixel.js — a tiny pixel-art toolkit.
// All art in this prototype is drawn in code, pixel by pixel, into Phaser canvas
// textures. No image files, so the whole thing stays a no-build static site.
(function () {
  'use strict';

  const rgbCache = {};
  function rgb(hex) {
    let c = rgbCache[hex];
    if (!c) {
      const n = parseInt(hex.slice(1), 16);
      c = rgbCache[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return c;
  }

  // Deterministic hash noise in [0,1) — same island every load.
  function hash(x, y, s = 0) {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  class Painter {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.d = new Uint8ClampedArray(w * h * 4);
    }
    inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    set(x, y, c, a = 255) {
      if (c == null) return;
      x = Math.floor(x); y = Math.floor(y);
      if (!this.inb(x, y)) return;
      const k = rgb(c), i = (y * this.w + x) * 4;
      this.d[i] = k[0]; this.d[i + 1] = k[1]; this.d[i + 2] = k[2]; this.d[i + 3] = a;
    }
    erase(x, y) { if (this.inb(x, y)) this.d[(y * this.w + x) * 4 + 3] = 0; }
    a(x, y) { return this.inb(x, y) ? this.d[(y * this.w + x) * 4 + 3] : 0; }
    rect(x, y, w, h, c, a) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, a);
    }
    hline(x0, x1, y, c, a) { for (let x = x0; x <= x1; x++) this.set(x, y, c, a); }
    vline(x, y0, y1, c, a) { for (let y = y0; y <= y1; y++) this.set(x, y, c, a); }
    line(x0, y0, x1, y1, c, a) {
      x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        this.set(x0, y0, c, a);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    ellipse(cx, cy, rx, ry, c, a) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) this.set(x, y, c, a);
        }
      }
    }
    // Scanline polygon fill sampling pixel centres: clean 2:1 stair-steps for iso.
    poly(pts, c, a) {
      let minY = Infinity, maxY = -Infinity;
      for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      for (let y = Math.floor(minY); y < Math.ceil(maxY); y++) {
        const yc = y + 0.5, xs = [];
        for (let i = 0; i < pts.length; i++) {
          const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
          if ((y0 <= yc && yc < y1) || (y1 <= yc && yc < y0)) {
            xs.push(x0 + (yc - y0) / (y1 - y0) * (x1 - x0));
          }
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let x = Math.ceil(xs[k] - 0.5); x < Math.ceil(xs[k + 1] - 0.5); x++) this.set(x, y, c, a);
        }
      }
    }
    // Char-map sprite: rows of strings, map of char -> colour.
    sprite(x, y, rows, map) {
      rows.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          const c = map[row[i]];
          if (c) this.set(x + i, y + j, c);
        }
      });
    }
    shadow(cx, cy, rx, ry, c = '#000000', a = 64) { this.ellipse(cx, cy, rx, ry, c, a); }
    // Selective outline: paints c on every non-solid pixel touching a solid one.
    outline(c) {
      const out = [];
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (this.a(x, y) === 255) continue;
        if (this.a(x - 1, y) === 255 || this.a(x + 1, y) === 255 ||
            this.a(x, y - 1) === 255 || this.a(x, y + 1) === 255) out.push([x, y]);
      }
      for (const [x, y] of out) this.set(x, y, c);
      return out;
    }
    clone() { const p = new Painter(this.w, this.h); p.d.set(this.d); return p; }
    blit(src, ox, oy) {
      for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        if (!src.d[i + 3]) continue;
        const tx = ox + x, ty = oy + y;
        if (!this.inb(tx, ty)) continue;
        const j = (ty * this.w + tx) * 4;
        this.d[j] = src.d[i]; this.d[j + 1] = src.d[i + 1]; this.d[j + 2] = src.d[i + 2]; this.d[j + 3] = src.d[i + 3];
      }
    }
    scaled(k) {
      if (k === 1) return this;
      const p = new Painter(this.w * k, this.h * k);
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
        const i = (((y / k) | 0) * this.w + ((x / k) | 0)) * 4, j = (y * p.w + x) * 4;
        p.d[j] = this.d[i]; p.d[j + 1] = this.d[i + 1]; p.d[j + 2] = this.d[i + 2]; p.d[j + 3] = this.d[i + 3];
      }
      return p;
    }
  }

  function put(scene, key, p) {
    const t = scene.textures.createCanvas(key, p.w, p.h);
    t.getContext().putImageData(new ImageData(p.d, p.w, p.h), 0, 0);
    t.refresh();
    return t;
  }

  // Build a texture once (textures outlive scene restarts). opts.outline adds a
  // selective outline; opts.hl also makes `${key}-hl` with the outline recoloured
  // (used as the hover highlight).
  function tex(scene, key, w, h, draw, opts = {}) {
    if (scene.textures.exists(key)) return;
    const p = new Painter(w, h);
    draw(p);
    if (opts.outline) {
      const ol = p.outline(opts.outline);
      if (opts.hl) {
        const q = p.clone();
        for (const [x, y] of ol) q.set(x, y, opts.hl);
        put(scene, key + '-hl', q);
      }
    }
    put(scene, key, p);
  }

  // Horizontal strip of n frames, named 0..n-1.
  function sheet(scene, key, fw, fh, n, draw) {
    if (scene.textures.exists(key)) return;
    const big = new Painter(fw * n, fh);
    for (let i = 0; i < n; i++) { const p = new Painter(fw, fh); draw(p, i); big.blit(p, i * fw, 0); }
    const t = put(scene, key, big);
    for (let i = 0; i < n; i++) t.add(i, 0, i * fw, 0, fw, fh);
  }

  // ---------------------------------------------------------------- pixel font
  // 5px-tall variable-width font. Lowercase e/x are kept for numbers ("1.2e45", "x3").
  const F = {
    '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'],
    '2': ['##.', '..#', '.#.', '#..', '###'], '3': ['##.', '..#', '.#.', '..#', '##.'],
    '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '##.', '..#', '##.'],
    '6': ['.##', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '.#.', '.#.'],
    '8': ['###', '#.#', '###', '#.#', '###'], '9': ['###', '#.#', '###', '..#', '##.'],
    'A': ['.#.', '#.#', '###', '#.#', '#.#'], 'B': ['##.', '#.#', '##.', '#.#', '##.'],
    'C': ['.##', '#..', '#..', '#..', '.##'], 'D': ['##.', '#.#', '#.#', '#.#', '##.'],
    'E': ['###', '#..', '##.', '#..', '###'], 'F': ['###', '#..', '##.', '#..', '#..'],
    'G': ['.##', '#..', '#.#', '#.#', '.##'], 'H': ['#.#', '#.#', '###', '#.#', '#.#'],
    'I': ['###', '.#.', '.#.', '.#.', '###'], 'J': ['..#', '..#', '..#', '#.#', '.#.'],
    'K': ['#.#', '#.#', '##.', '#.#', '#.#'], 'L': ['#..', '#..', '#..', '#..', '###'],
    'M': ['#...#', '##.##', '#.#.#', '#...#', '#...#'], 'N': ['#..#', '##.#', '#.##', '#..#', '#..#'],
    'O': ['.#.', '#.#', '#.#', '#.#', '.#.'], 'P': ['##.', '#.#', '##.', '#..', '#..'],
    'Q': ['.#.', '#.#', '#.#', '##.', '.##'], 'R': ['##.', '#.#', '##.', '#.#', '#.#'],
    'S': ['.##', '#..', '.#.', '..#', '##.'], 'T': ['###', '.#.', '.#.', '.#.', '.#.'],
    'U': ['#.#', '#.#', '#.#', '#.#', '###'], 'V': ['#.#', '#.#', '#.#', '#.#', '.#.'],
    'W': ['#...#', '#...#', '#.#.#', '##.##', '#...#'], 'X': ['#.#', '#.#', '.#.', '#.#', '#.#'],
    'Y': ['#.#', '#.#', '.#.', '.#.', '.#.'], 'Z': ['###', '..#', '.#.', '#..', '###'],
    'e': ['...', '.#.', '###', '#..', '.##'], 'x': ['...', '#.#', '.#.', '#.#', '...'],
    '.': ['.', '.', '.', '.', '#'], ',': ['.', '.', '.', '#', '#'], ':': ['.', '#', '.', '#', '.'],
    '!': ['#', '#', '#', '.', '#'], '+': ['...', '.#.', '###', '.#.', '...'],
    '-': ['..', '..', '##', '..', '..'], '/': ['..#', '..#', '.#.', '#..', '#..'],
    '(': ['.#', '#.', '#.', '#.', '.#'], ')': ['#.', '.#', '.#', '.#', '#.'],
    "'": ['#', '#', '.', '.', '.'], '%': ['#.#', '..#', '.#.', '#..', '#.#'],
    '?': ['##.', '..#', '.#.', '...', '.#.'], '=': ['...', '###', '...', '###', '...'],
    '<': ['..#', '.#.', '#..', '.#.', '..#'], '>': ['#..', '.#.', '..#', '.#.', '#..'], '^': ['.#.', '#.#', '...', '...', '...'],
    ' ': ['..', '..', '..', '..', '..'],
  };
  const glyph = (ch) => F[ch] || F[ch.toUpperCase()] || F['?'];
  function measure(str) {
    let w = 0;
    for (const ch of str) w += glyph(ch)[0].length + 1;
    return Math.max(0, w - 1);
  }
  function drawText(p, x, y, str, c) {
    for (const ch of str) {
      const g = glyph(ch);
      g.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') p.set(x + i, y + j, c); });
      x += g[0].length + 1;
    }
  }

  function textPainter(str, opt) {
    const { color, outline, shadow, scale } = opt;
    const pad = outline ? 1 : 0, sh = shadow ? 1 : 0;
    const p = new Painter(Math.max(1, measure(str) + pad * 2 + sh), 5 + pad * 2 + sh);
    if (shadow) drawText(p, pad + 1, pad + 1, str, shadow);
    drawText(p, pad, pad, str, color);
    if (outline) p.outline(outline);
    return p.scaled(scale || 1);
  }

  // Cached, never-deleted texture for short-lived text (floating "+3" etc).
  // Deleting textures while Phaser batches draws makes other sprites vanish,
  // so nothing here ever removes a texture.
  function textTex(scene, str, opt) {
    const key = 'stxt|' + str + '|' + [opt.color, opt.outline, opt.shadow, opt.scale].join(',');
    if (!scene.textures.exists(key)) put(scene, key, textPainter(str, opt));
    return key;
  }

  let txtSeq = 0;
  // Image whose own canvas texture is redrawn in place on setText. Keys are
  // recycled across scene restarts (resetSlots) instead of being deleted.
  class PixelText extends Phaser.GameObjects.Image {
    static resetSlots() { txtSeq = 0; }
    constructor(scene, x, y, str, opt = {}) {
      super(scene, x, y, '__DEFAULT');
      this.opt = Object.assign({ color: '#ffffff', outline: null, shadow: null, scale: 1 }, opt);
      this.key = 'ptxt' + (txtSeq++);
      scene.add.existing(this);
      this.setText(str);
    }
    setText(str) {
      str = String(str);
      if (str === this.str) return this;
      this.str = str;
      const p = textPainter(str, this.opt), tm = this.scene.textures;
      let ct = tm.get(this.key);
      if (!tm.exists(this.key)) ct = tm.createCanvas(this.key, p.w, p.h);
      else if (ct.width !== p.w || ct.height !== p.h) ct.setSize(p.w, p.h);
      const ctx = ct.getContext();
      ctx.clearRect(0, 0, p.w, p.h);
      ctx.putImageData(new ImageData(p.d, p.w, p.h), 0, 0);
      ct.refresh();
      if (this.texture !== ct) this.setTexture(this.key);
      else { this.setSizeToFrame(); this.updateDisplayOrigin(); }
      return this;
    }
  }

  window.PX = { Painter, tex, sheet, put, hash, rgb, measure, drawText, PixelText, textTex };
})();
