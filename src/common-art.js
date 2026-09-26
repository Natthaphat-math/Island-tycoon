// common-art.js — textures every style needs (UI panels, currency icons, coin
// bubbles, aura tiles, night lights, raiders). Same shapes, per-style palette.
(function () {
  'use strict';
  const { Painter, tex, put } = PX;

  function drawPanel(p, x, y, w, h, P) {
    const x1 = x + w - 1, y1 = y + h - 1;
    if (P.kind === 'pico') {
      p.rect(x, y, w, h, P.fill);
      p.hline(x + 1, x1 - 1, y + 1, P.border); p.hline(x + 1, x1 - 1, y1 - 1, P.border);
      p.vline(x + 1, y + 1, y1 - 1, P.border); p.vline(x1 - 1, y + 1, y1 - 1, P.border);
      return;
    }
    const r = P.kind === 'soft' ? 2 : 1;
    // body with clipped corners
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const cx = i < r ? r - i : i > w - 1 - r ? i - (w - 1 - r) : 0;
      const cy = j < r ? r - j : j > h - 1 - r ? j - (h - 1 - r) : 0;
      if (cx + cy > r) continue;
      const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1 || cx + cy === r;
      p.set(x + i, y + j, edge ? P.outline : P.fill);
    }
    p.hline(x + r, x1 - r, y + 1, P.light);
    p.hline(x + r, x1 - r, y1 - 1, P.dark);
    if (P.kind === 'soft') p.hline(x + r, x1 - r, y1 - 2, P.dark);
    if (P.grain) {
      for (let j = y + 4; j < y1 - 2; j += 4) {
        for (let i = x + 2; i < x1 - 1; i++) if (PX.hash(i >> 3, j, 7) > 0.35) p.set(i, j, P.grain);
      }
    }
  }

  function coin(p, x, y, [l, m, d]) {
    for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
      const dx = i - 3, dy = j - 3;
      if (dx * dx + dy * dy > 11) continue;
      const s = dx + dy;
      p.set(x + i, y + j, s < -3 ? l : s > 2 ? d : m);
    }
    p.vline(x + 3, y + 2, y + 4, d); p.set(x + 4, y + 2, l);
  }
  function gem(p, x, y, [l, m, d], w) {
    p.sprite(x, y, ['.llmm.', 'lwlmmd', 'mmmddd', '.mmdd.', '..md..'], { l, m, d, w });
  }
  function iconPainter(kind, P) {
    const p = new Painter(9, 9);
    if (kind === 'diamond') gem(p, 1, 2, P.coin.diamond, '#ffffff');
    else if (kind === 'sun') {
      p.ellipse(4.5, 4.5, 2.5, 2.5, P.sun[0]);
      p.set(4, 3, P.sun[1]); p.set(3, 4, P.sun[1]);
      for (const [a, b] of [[4, 0], [4, 8], [0, 4], [8, 4], [1, 1], [7, 1], [1, 7], [7, 7]]) p.set(a, b, P.sun[0]);
    } else if (kind === 'moon') {
      p.ellipse(4.5, 4.5, 3.5, 3.5, P.moon[0]);
      for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
        const dx = i + 0.5 - 6.2, dy = j + 0.5 - 3.3;
        if (dx * dx + dy * dy < 7.5) p.erase(i, j);
      }
      p.set(3, 6, P.moon[1]); p.set(2, 4, P.moon[1]);
    } else coin(p, 1, 1, P.coin[kind]);
    p.outline(P.iconOutline);
    return p;
  }

  function glow(scene, key, r, color, alphas) {
    tex(scene, key, r * 2, r * 2, (p) => {
      for (let y = 0; y < r * 2; y++) for (let x = 0; x < r * 2; x++) {
        const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
        if (d >= 1) continue;
        // stepped rings rather than a smooth gradient: reads as pixel art
        const a = d < 0.34 ? alphas[0] : d < 0.67 ? alphas[1] : alphas[2];
        p.set(x, y, color, a);
      }
    });
  }

  function build(scene, id, P) {
    const k = (s) => `${id}-${s}`;
    if (scene.textures.exists(k('panel-top'))) return;

    tex(scene, k('panel-top'), 320, 14, (p) => drawPanel(p, 0, -2, 320, 16, P.panel));
    tex(scene, k('panel-bot'), 320, 30, (p) => drawPanel(p, 0, 0, 320, 32, P.panel));
    tex(scene, k('panel-pop'), 64, 12, (p) => drawPanel(p, 0, 0, 64, 12, P.panel));
    // building cards (20x26) and tool buttons (16x26), plain + selected
    for (const [name, w] of [['card', 20], ['tool', 16]]) {
      for (const sel of [false, true]) {
        tex(scene, k(name + (sel ? '-sel' : '')), w, 26, (p) => {
          const C = P.card, x1 = w - 1;
          p.rect(1, 1, w - 2, 24, C.fill);
          p.hline(2, x1 - 2, 2, C.fillLight);
          const b = sel ? C.sel : C.border;
          p.hline(1, x1 - 1, 0, b); p.hline(1, x1 - 1, 25, b); p.vline(0, 1, 24, b); p.vline(x1, 1, 24, b);
          if (sel) { p.hline(1, x1 - 1, 1, b); p.hline(1, x1 - 1, 24, b); p.vline(1, 1, 24, b); p.vline(x1 - 1, 1, 24, b); }
        });
      }
    }
    for (const c of ['bronze', 'silver', 'gold', 'diamond', 'sun', 'moon']) put(scene, k('ico-' + c), iconPainter(c, P));

    for (const c of ['bronze', 'silver', 'gold']) {
      if (P.bubble.bare) { put(scene, k('bubble-' + c), iconPainter(c, P)); continue; }
      tex(scene, k('bubble-' + c), 13, 14, (p) => {
        const B = P.bubble;
        p.rect(1, 0, 11, 11, B.fill); p.rect(0, 1, 13, 9, B.fill);
        p.hline(1, 11, 10, B.shade);
        p.set(5, 11, B.fill); p.set(6, 11, B.fill); p.set(7, 11, B.fill); p.set(6, 12, B.fill);
        p.blit(iconPainter(c, P), 2, 1);
      }, { outline: P.bubble.outline });
    }
    // buddy / penalty chips: coloured arrow on a light disc so they read on any ground
    const arrowUp = ['..#..', '.###.', '#####', '.###.', '.###.'];
    for (const [name, rows, col] of [['badge-up', arrowUp, P.up], ['badge-down', arrowUp.slice().reverse(), P.down]]) {
      if (P.badgeChip === false) tex(scene, k(name), 7, 7, (p) => p.sprite(1, 1, rows, { '#': col }), { outline: P.iconOutline });
      else tex(scene, k(name), 11, 11, (p) => {
        p.ellipse(5.5, 5.5, 4.6, 4.6, P.bubble.fill);
        p.sprite(3, 3, rows, { '#': col });
      }, { outline: P.iconOutline });
    }

    // aura / grid tiles
    if (P.tile === 'iso') {
      const dia = [[16, 0], [32, 8], [16, 16], [0, 8]];
      tex(scene, k('aura-fill'), 32, 16, (p) => p.poly(dia, '#ffffff'));
      tex(scene, k('aura-edge'), 32, 16, (p) => {
        const q = new Painter(32, 16); q.poly(dia, '#ffffff');
        for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
          if (q.a(x, y) && (!q.a(x - 1, y) || !q.a(x + 1, y) || !q.a(x, y - 1) || !q.a(x, y + 1))) p.set(x, y, '#ffffff');
        }
      });
    } else {
      tex(scene, k('aura-fill'), P.tile, P.tile, (p) => p.rect(0, 0, P.tile, P.tile, '#ffffff'));
    }

    // night lights (drawn with ADD blend)
    glow(scene, k('light-torch'), 16, P.light.torch, [150, 80, 36]);
    glow(scene, k('light-window'), 5, P.light.window, [170, 70, 30]);
    glow(scene, k('light-purple'), 13, P.light.purple, [150, 70, 30]);
    glow(scene, k('light-eye'), 2, '#ff2030', [255, 120, 60]);
    tex(scene, k('light-dot'), 1, 1, (p) => p.set(0, 0, P.light.window));
    tex(scene, k('bolt'), 3, 3, (p) => { p.set(1, 0, P.light.torch); p.set(0, 1, P.light.torch); p.set(2, 1, P.light.torch); p.set(1, 2, P.light.torch); p.set(1, 1, '#ffffff'); });
    tex(scene, k('px'), 1, 1, (p) => p.set(0, 0, '#ffffff'));

    // raider canoe (only visible at night)
    tex(scene, k('canoe'), 22, 10, (p) => {
      const R = P.raider;
      p.hline(2, 19, 6, R.hull); p.hline(3, 18, 7, R.hull); p.hline(5, 16, 8, R.dark);
      p.set(1, 5, R.hull); p.set(20, 5, R.hull); p.hline(2, 19, 5, R.trim);
      for (const x of [6, 11, 15]) { p.rect(x, 2, 2, 3, R.body); p.set(x, 1, R.body); p.set(x + 1, 1, R.body); }
      p.line(9, 0, 9, 8, R.spear); p.line(17, 1, 18, 8, R.spear);
    }, { outline: P.raider.outline });
  }

  window.ART = { build, drawPanel, iconPainter, coin, gem };
})();
