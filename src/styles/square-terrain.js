// square-terrain.js — renders a tile map as one smooth, hand-shaded pixel
// image (plus water animation frames), used by the two square-grid styles.
// Land/grass edges follow tile boundaries exactly (so the build grid stays
// honest) but corners are rounded per pixel so the coast looks organic.
(function () {
  'use strict';
  const { Painter, put, hash } = PX;

  function field(map, T, ox, oy, test) {
    const rows = map.length, cols = map[0].length;
    const v = (c, r) => (r < 0 || c < 0 || r >= rows || c >= cols) ? 0 : (test(map[r][c]) ? 1 : 0);
    return (x, y) => {
      const u = (x + 0.5 - ox) / T - 0.5, w = (y + 0.5 - oy) / T - 0.5;
      const c = Math.floor(u), r = Math.floor(w), fu = u - c, fw = w - r;
      return (v(c, r) * (1 - fu) + v(c + 1, r) * fu) * (1 - fw) + (v(c, r + 1) * (1 - fu) + v(c + 1, r + 1) * fu) * fw;
    };
  }

  // C = colours, o = options { frames, foam:[..per frame], shallowAt, tuftDensity }
  function render(scene, key, S, C, o = {}) {
    // o.bounds: world rectangle to cover (defaults to the 320x180 screen); the map's
    // tiles keep their world positions, everything outside the map is open sea
    const bd = o.bounds || { x0: 0, y0: 0, w: 320, h: 180 };
    const W = bd.w, H = bd.h, T = S.grid.T, ox = S.grid.ox - bd.x0, oy = S.grid.oy - bd.y0, frames = o.frames || 4;
    const land = field(S.map, T, ox, oy, (ch) => ch === 's' || ch === 'g');
    const grass = field(S.map, T, ox, oy, (ch) => ch === 'g');
    const WATER = 0, SAND = 1, GRASS = 2;
    const cls = new Uint8Array(W * H), Lv = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const n = (hash(x >> 1, y >> 1, 1) - 0.5) * (o.wobble ?? 0.14);
      const L = land(x, y) + n, i = y * W + x;
      Lv[i] = L;
      cls[i] = L < 0.5 ? WATER : (grass(x, y) + n >= 0.5 ? GRASS : SAND);
    }
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? WATER : cls[y * W + x];

    // static land layer
    const base = new Painter(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = at(x, y);
      if (k === GRASS) {
        let c = C.grass;
        if (hash(x, y, 2) < 0.04) c = C.grassDark;
        if (at(x, y + 1) !== GRASS) c = C.lip;
        base.set(x, y, c);
      } else if (k === SAND) {
        let c = hash(x, y, 3) < 0.06 ? C.sandSpeck : C.sand;
        if (at(x, y - 1) === GRASS) c = C.cliff;
        else if (at(x, y - 2) === GRASS && C.cliffShadow) c = C.cliffShadow;
        if (at(x, y + 1) === WATER || at(x + 1, y) === WATER || at(x - 1, y) === WATER) c = C.wet;
        base.set(x, y, c);
      }
    }
    // tufts & flowers stamped on grass
    const cell = o.tuftCell || 6;
    for (let cy = 0; cy < H; cy += cell) for (let cx = 0; cx < W; cx += cell) {
      const x = cx + Math.floor(hash(cx, cy, 4) * (cell - 3)), y = cy + Math.floor(hash(cx, cy, 5) * (cell - 2));
      if (at(x, y) !== GRASS || at(x + 2, y + 2) !== GRASS || at(x, y + 2) !== GRASS) continue;
      const r = hash(cx, cy, 6);
      if (r < 0.5) { base.set(x, y, C.grassDark); base.set(x + 2, y, C.grassDark); base.set(x + 1, y + 1, C.grassDark); }
      else if (r < 0.62 && C.flowers) { base.set(x + 1, y, C.flowers[Math.floor(hash(cx, cy, 8) * C.flowers.length)]); base.set(x + 1, y + 1, C.grassDark); }
      else if (r < 0.8 && C.grassLight) { base.set(x, y, C.grassLight); base.set(x + 1, y + 1, C.grassLight); }
    }

    // animated water frames under the land
    const foam = o.foam || [0.05, 0.08, 0.11, 0.08];
    const sheet = new Painter(W * frames, H);
    for (let f = 0; f < frames; f++) {
      const p = new Painter(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (cls[i] !== WATER) continue;
        const L = Lv[i];
        let c;
        if (L >= 0.5 - foam[f]) c = C.foam;
        else if (L >= (o.shallowAt ?? 0.26)) {
          c = C.shallow;
          const ring = (o.ringAt ?? 0.34) + 0.025 * Math.sin(f * Math.PI / 2);
          if (C.ring && Math.abs(L - ring) < 0.014 && ((x + y) & 1)) c = C.ring;
          if (hash(x, y, 10 + f) > 0.996) c = C.foam;
        } else {
          c = C.deep;
          const gx = x + f * 2 + (y >> 2) * 5;
          if ((y & 3) === 0 && gx % 22 < 3 && hash(Math.floor(gx / 22), y >> 2, 11) > 0.62) c = C.glint;
        }
        p.set(x, y, c);
      }
      p.blit(base, 0, 0);
      sheet.blit(p, f * W, 0);
    }
    const t = put(scene, key, sheet);
    for (let f = 0; f < frames; f++) t.add(f, 0, f * W, 0, W, H);
  }

  function addTerrain(scene, key, S, C, o) {
    if (!scene.textures.exists(key)) render(scene, key, S, C, o);
    if (!scene.anims.exists(key)) {
      scene.anims.create({ key, frames: [0, 1, 2, 3, 2, 1].map((f) => ({ key, frame: f })), frameRate: 3, repeat: -1 });
    }
    const bd = (o && o.bounds) || { x0: 0, y0: 0 };
    return scene.add.sprite(bd.x0, bd.y0, key, 0).setOrigin(0).setDepth(0).play(key);
  }

  // Dotted tile grid over buildable (grass) tiles, with a small cross at corners.
  function gridOverlay(scene, key, S, color, alpha, dotsOnly) {
    if (!scene.textures.exists(key)) {
      const { T, ox, oy } = S.grid, map = S.map;
      const g = (c, r) => (map[r] || '')[c] === 'g';
      const p = new Painter(320, 180);
      for (let r = 0; r < map.length; r++) for (let c = 0; c < map[0].length; c++) {
        const x0 = ox + c * T, y0 = oy + r * T;
        const corner = g(c, r) && g(c - 1, r) && g(c, r - 1) && g(c - 1, r - 1);
        if (dotsOnly) { if (corner) p.set(x0, y0, color, alpha); continue; }
        if (g(c, r) && g(c, r - 1)) for (let i = 1; i < T; i += 2) p.set(x0 + i, y0, color, alpha);
        if (g(c, r) && g(c - 1, r)) for (let i = 1; i < T; i += 2) p.set(x0, y0 + i, color, alpha);
        if (corner) {
          p.set(x0, y0, color); p.set(x0 - 1, y0, color); p.set(x0 + 1, y0, color); p.set(x0, y0 - 1, color); p.set(x0, y0 + 1, color);
        }
      }
      put(scene, key, p);
    }
    return scene.add.image(0, 0, key).setOrigin(0);
  }

  window.SquareTerrain = { addTerrain, gridOverlay };
})();
