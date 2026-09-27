// Style A — "Sunlit 3/4": top-down grid with 3/4-view sprites, 16px tiles,
// Endesga-32 palette, dark selective outlines. (Recommended direction.)
(function () {
  'use strict';
  const { tex } = PX;
  const E = {
    red1: '#be4a2f', orange1: '#d77643', sand1: '#ead4aa', sand2: '#e4a672', brown1: '#b86f50', brown2: '#733e39', dark1: '#3e2731',
    red2: '#a22633', red3: '#e43b44', orange2: '#f77622', yellow1: '#feae34', yellow2: '#fee761',
    green1: '#63c74d', green2: '#3e8948', green3: '#265c42', green4: '#193c3e',
    blue1: '#124e89', blue2: '#0099db', cyan: '#2ce8f5', white: '#ffffff',
    grey1: '#c0cbdc', grey2: '#8b9bb4', grey3: '#5a6988', grey4: '#3a4466', navy: '#262b44', black: '#181425',
    pink1: '#ff0044', purple1: '#68386c', purple2: '#b55088', pink2: '#f6757a', skin1: '#e8b796', skin2: '#c28569',
  };
  const HL = E.yellow2; // hover outline colour

  function thatch(p, y0, y1, h0, h1, cx, cols) {
    // trapezoid roof; rows of thatch, lit from the top-left
    for (let y = y0; y <= y1; y++) {
      const half = Math.round(h0 + (y - y0) * (h1 - h0) / (y1 - y0));
      for (let x = cx - half; x < cx + half; x++) {
        const shade = x >= cx + Math.floor(half * 0.35);
        let c = shade ? cols.mid : cols.light;
        if ((y - y0) % 3 === 2 && PX.hash(x, y, 20) > 0.2) c = shade ? cols.dark : cols.mid;
        if (y === y0) c = cols.top;
        p.set(x, y, c);
      }
    }
    const half = h1;
    for (let x = cx - half; x < cx + half; x++) if (x & 1) p.set(x, y1 + 1, cols.dark);
  }

  // ---------------------------------------------------------------------------
  // Generic 3/4-view building for ANY footprint (polyomino): a hip roof over the
  // cells plus walls on the south-facing edges. Every rotation of every shape
  // gets a sprite from the same code, so new shapes cost no hand-drawn art.
  // Returns window positions (relative to the sprite's bottom-centre) for night lights.
  function compound(p, cells, o) {
    const [bw, bh] = Core.bbox(cells), H = o.H, top = o.top;
    const has = (c, r) => cells.some(([x, y]) => x === c && y === r);
    const W = bw * 16, RH = bh * 16;
    // roof mask (roof = footprint shifted up by H), inset 1px on open east/west sides
    const mask = new Uint8Array(W * RH);
    for (const [c, r] of cells) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (x === 0 && !has(c - 1, r)) continue;
      if (x === 15 && !has(c + 1, r)) continue;
      mask[(r * 16 + y) * W + c * 16 + x] = 1;
    }
    const m = (x, y) => x >= 0 && y >= 0 && x < W && y < RH && mask[y * W + x];
    const dist = (x, y, dx, dy) => { let n = 0; while (m(x + dx * (n + 1), y + dy * (n + 1))) n++; return n; };
    // face = direction of the nearest roof edge (lit from the top-left)
    const face = new Int8Array(W * RH).fill(-1);
    for (let y = 0; y < RH; y++) for (let x = 0; x < W; x++) {
      if (!m(x, y)) continue;
      const d = [dist(x, y, 0, -1) * 1.6, dist(x, y, -1, 0), dist(x, y, 1, 0), dist(x, y, 0, 1) * 0.8]; // N W E S (N squashed by the 3/4 view)
      let f = 0; for (let i = 1; i < 4; i++) if (d[i] < d[f]) f = i;
      face[y * W + x] = f;
    }
    const R = o.roof;
    for (let y = 0; y < RH; y++) for (let x = 0; x < W; x++) {
      const f = face[y * W + x];
      if (f < 0) continue;
      let c = [R.n, R.w, R.e, R.s][f];
      // thatch layers run horizontally on every face; slate/tile adds staggered seams
      const stripe = y % 3 === 0 || (R.seams && (x + (Math.floor(y / 3) & 1) * 2) % 4 === 0);
      if (stripe && PX.hash(x, y, 50) > 0.25) c = [R.w, R.s, R.dark, R.e][f];
      const nb = [[1, 0], [0, 1], [-1, 0], [0, -1]].some(([dx, dy]) => { const g = face[(y + dy) * W + x + dx]; return m(x + dx, y + dy) && g !== f; });
      if (nb && f !== 3) c = R.ridge;
      if (!m(x, y + 1)) c = R.dark; // eave
      p.set(x, top + y, c);
    }
    // south walls + openings
    const wallsAt = cells.filter(([c, r]) => !has(c, r + 1)).sort((a, b) => a[0] - b[0]);
    const Wl = o.wall, lights = [];
    wallsAt.forEach(([c, r], i) => {
      const x0 = c * 16 + (has(c - 1, r) && !has(c - 1, r + 1) ? 0 : 1);
      const x1 = c * 16 + (has(c + 1, r) && !has(c + 1, r + 1) ? 15 : 14);
      const y0 = top + r * 16 + 16, y1 = y0 + H - 1;
      p.rect(x0, y0, x1 - x0 + 1, H, Wl.mid);
      for (let x = x0; x <= x1; x++) if ((x - c * 16) % 5 === 2) p.vline(x, y0 + 1, y1, Wl.dark);
      p.hline(x0, x1, y0, Wl.dark); p.hline(x0, x1, y1, Wl.dark);
      if (!has(c - 1, r) || has(c - 1, r + 1)) p.vline(x0, y0, y1, Wl.light);
      const cx = c * 16 + 7;
      if (i === Math.floor((wallsAt.length - 1) / 2)) { p.rect(cx, y1 - 4, 3, 5, o.door); p.set(cx + 2, y1 - 2, E.yellow1); }
      else { p.rect(cx, y0 + 2, 2, 2, E.navy); lights.push({ x: cx + 1 - W / 2, y: y0 + 3 - (top + RH + H) }); }
    });
    return lights;
  }

  // flat crop field over any footprint (bank on the outer edges)
  function field(p, cells, crop) {
    const has = (c, r) => cells.some(([x, y]) => x === c && y === r);
    for (const [c, r] of cells) {
      const x = c * 16, y = r * 16;
      p.rect(x, y, 16, 16, E.brown1);
      for (let j = 0; j < 3; j++) {
        const fy = y + 2 + j * 5;
        p.hline(x + 1, x + 14, fy + 3, E.brown2);
        for (let i = 0; i < 3; i++) crop(p, x + 3 + i * 5 + (j & 1) * 2, fy);
      }
    }
    for (const [c, r] of cells) {
      const x = c * 16, y = r * 16;
      if (!has(c, r - 1)) p.hline(x, x + 15, y, E.sand2);
      if (!has(c - 1, r)) p.vline(x, y, y + 15, E.sand2);
      if (!has(c, r + 1)) p.hline(x, x + 15, y + 15, E.dark1);
      if (!has(c + 1, r)) p.vline(x + 15, y, y + 15, E.dark1);
    }
  }
  const sapling = (p, x, y) => {
    p.set(x, y + 2, E.brown2); p.set(x, y + 1, E.brown1);
    p.set(x - 1, y, E.green1); p.set(x + 1, y, E.green1); p.set(x - 2, y + 1, E.green2); p.set(x + 2, y + 1, E.green2); p.set(x, y - 1, E.green1);
  };

  // sprite for every distinct rotation of a shaped building; records lights per rotation
  const LIGHTS = {};
  function shaped(s, type, H, top, draw) {
    LIGHTS[type] = {};
    for (const rot of Core.rotations(type)) {
      const cells = Core.rotateShape(Core.BUILDINGS[type].shape, rot);
      const [bw, bh] = Core.bbox(cells), key = `sunlit-${type}-r${rot}`;
      if (s.textures.exists(key)) continue;
      let lights = [];
      tex(s, key, bw * 16, bh * 16 + H + top, (p) => { lights = draw(p, cells) || []; }, H ? { outline: E.dark1, hl: HL } : {});
      LIGHTS[type][rot] = lights;
    }
  }

  function textures(s) {
    const straw = { top: E.yellow2, light: E.yellow1, mid: E.orange2, dark: E.brown1 };

    tex(s, 'sunlit-hut', 16, 24, (p) => {
      p.shadow(8, 22, 7, 2.2, E.black, 70);
      p.rect(3, 14, 10, 8, E.brown1);
      p.vline(3, 14, 21, E.sand2);
      p.vline(6, 15, 21, E.brown2);
      p.vline(12, 14, 21, E.brown2);
      p.hline(3, 12, 21, E.brown2);
      p.rect(7, 17, 3, 5, E.dark1); p.set(9, 19, E.yellow1);
      p.rect(10, 17, 2, 2, E.navy);
      thatch(p, 3, 14, 2, 7, 8, straw);
      p.hline(7, 8, 2, E.yellow2);
    }, { outline: E.dark1, hl: HL });

    tex(s, 'sunlit-tower', 16, 36, (p) => {
      p.shadow(8, 34, 6, 2, E.black, 70);
      p.vline(4, 18, 33, E.brown2); p.vline(11, 18, 33, E.brown2);
      p.line(5, 20, 10, 26, E.brown1); p.line(10, 20, 5, 26, E.brown1);
      p.line(5, 27, 10, 32, E.brown1); p.line(10, 27, 5, 32, E.brown1);
      p.rect(2, 16, 12, 3, E.brown1); p.hline(2, 13, 16, E.sand2); p.hline(2, 13, 18, E.brown2);
      p.rect(4, 10, 8, 6, E.brown1); p.vline(4, 10, 15, E.sand2); p.vline(11, 10, 15, E.brown2);
      p.rect(7, 12, 2, 2, E.dark1);
      thatch(p, 4, 9, 1, 7, 8, { top: E.orange1, light: E.red3, mid: E.red1, dark: E.red2 });
      p.vline(8, 0, 3, E.brown2); p.set(9, 0, E.blue2); p.set(10, 0, E.blue2); p.set(11, 0, E.cyan); p.set(9, 1, E.blue2); p.set(10, 1, E.blue1);
      p.vline(13, 13, 16, E.brown2); p.set(13, 12, E.orange2); p.set(13, 11, E.yellow1);
    }, { outline: E.dark1, hl: HL });

    tex(s, 'sunlit-market', 32, 40, (p) => {
      p.shadow(16, 37, 15, 3, E.black, 70);
      p.rect(3, 22, 26, 15, E.sand1);
      p.hline(4, 27, 35, E.sand2); p.hline(4, 27, 36, E.sand2);
      p.vline(3, 22, 36, E.brown2); p.vline(28, 22, 36, E.brown2);
      p.rect(4, 26, 24, 4, E.brown2);
      // goods on the counter
      p.rect(6, 28, 4, 2, E.yellow1); p.set(7, 28, E.yellow2);
      p.rect(11, 28, 4, 2, E.green1); p.set(14, 29, E.green2);
      p.rect(17, 28, 4, 2, E.red3); p.set(17, 28, E.pink2);
      p.rect(22, 28, 4, 2, E.orange2); p.set(22, 28, E.yellow1);
      p.rect(4, 30, 24, 5, E.brown1); p.hline(4, 27, 30, E.sand2); p.hline(4, 27, 34, E.brown2);
      p.vline(9, 31, 33, E.brown2); p.vline(16, 31, 33, E.brown2); p.vline(22, 31, 33, E.brown2);
      // striped awning
      for (let y = 22; y <= 26; y++) for (let x = 2; x <= 29; x++) {
        const stripe = ((x - 2) >> 2) & 1;
        if (y === 26 && ((x - 2) % 4 === 0 || (x - 2) % 4 === 3)) continue;
        p.set(x, y, stripe ? (y === 22 ? E.grey1 : E.white) : (y === 22 ? E.red1 : E.red3));
      }
      // tiled roof
      for (let y = 4; y <= 21; y++) {
        const half = Math.round(9 + (y - 4) * 6 / 17);
        for (let x = 16 - half; x < 16 + half; x++) {
          let c = x < 16 - half * 0.35 ? E.red3 : E.red1;
          if ((y - 4) % 3 === 0) c = E.red2;
          else if ((x + ((Math.floor((y - 4) / 3) & 1) * 2)) % 4 === 0) c = E.red2;
          if (y === 21) c = E.red2;
          p.set(x, y, c);
        }
      }
      p.hline(8, 23, 3, E.orange1);
      p.ellipse(16, 11, 3.5, 3.5, E.yellow1);
      p.set(15, 9, E.yellow2); p.set(14, 10, E.yellow2); p.set(18, 13, E.orange2); p.set(19, 12, E.orange2);
      p.vline(16, 10, 12, E.orange2);
      p.rect(25, 32, 6, 5, E.brown1); p.hline(25, 30, 32, E.sand2); p.line(25, 33, 29, 36, E.brown2);
    }, { outline: E.dark1, hl: HL });

    // one farm texture per rotation of the L (cells come from the core shape)
    for (let rot = 0; rot < 4; rot++) {
      tex(s, 'sunlit-farm-r' + rot, 32, 32, (p) => {
        const cells = Core.rotateShape(Core.BUILDINGS.farm.shape, rot);
        const tiles = cells.map(([c, r], i) => [c, r, i === cells.length - 1 ? 'sprout' : 'taro']);
        const has = (c, r) => tiles.some((t) => t[0] === c && t[1] === r);
        for (const [c, r, crop] of tiles) {
          const x = c * 16, y = r * 16;
          p.rect(x, y, 16, 16, E.brown1);
          for (let j = 0; j < 4; j++) {
            const fy = y + 1 + j * 4;
            p.hline(x + 1, x + 14, fy + 3, E.brown2);
            for (let i = 0; i < 4; i++) {
              const fx = x + 2 + i * 4 + (j & 1);
              if (crop === 'taro') {
                p.set(fx, fy, E.green1); p.set(fx + 1, fy, E.green1); p.set(fx - 1, fy + 1, E.green1);
                p.set(fx, fy + 1, E.green2); p.set(fx + 1, fy + 1, E.green2); p.set(fx, fy + 2, E.green3);
              } else {
                p.set(fx, fy + 2, E.green2); p.set(fx - 1, fy + 1, E.green1); p.set(fx + 1, fy + 1, E.green1);
              }
            }
          }
        }
        // raised bank around the field edge
        for (const [c, r] of tiles) {
          const x = c * 16, y = r * 16;
          if (!has(c, r - 1)) p.hline(x, x + 15, y, E.sand2);
          if (!has(c - 1, r)) p.vline(x, y, y + 15, E.sand2);
          if (!has(c, r + 1)) p.hline(x, x + 15, y + 15, E.dark1);
          if (!has(c + 1, r)) p.vline(x + 15, y, y + 15, E.dark1);
        }
        // scarecrow stands on the first taro tile
        const ox = tiles[0][0] * 16, oy = tiles[0][1] * 16;
        p.vline(ox + 7, oy + 4, oy + 13, E.brown2); p.hline(ox + 4, ox + 10, oy + 7, E.brown2);
        p.rect(ox + 6, oy + 3, 3, 3, E.sand1); p.hline(ox + 5, ox + 9, oy + 2, E.yellow1); p.hline(ox + 6, ox + 8, oy + 1, E.yellow1);
        p.rect(ox + 6, oy + 6, 3, 4, E.blue2); p.set(ox + 4, oy + 7, E.sand1); p.set(ox + 10, oy + 7, E.sand1);
      });
    }

    // shaped buildings drawn by the generic compound/field painters
    const thatchRoof = { n: E.yellow2, w: E.yellow1, s: E.yellow1, e: E.orange2, dark: E.brown1, ridge: E.yellow2 };
    const slateRoof = { n: E.grey1, w: E.grey2, s: E.grey2, e: E.grey3, dark: E.grey4, ridge: E.grey1, seams: true };
    const plankWall = { light: E.sand2, mid: E.brown1, dark: E.brown2 };
    shaped(s, 'longhouse', 8, 2, (p, cells) => compound(p, cells, { H: 8, top: 2, roof: thatchRoof, wall: plankWall, door: E.dark1 }));
    shaped(s, 'workshop', 8, 6, (p, cells) => {
      // chimney on the first cell, drawn behind the roof
      const [c, r] = cells[0];
      p.rect(c * 16 + 10, 0, 3, 8, E.grey3); p.vline(c * 16 + 10, 0, 7, E.grey2); p.hline(c * 16 + 9, c * 16 + 13, 0, E.grey4);
      return compound(p, cells, { H: 8, top: 6, roof: slateRoof, wall: { light: E.sand1, mid: E.sand2, dark: E.brown1 }, door: E.brown2 });
    });
    shaped(s, 'plantation', 0, 0, (p, cells) => { field(p, cells, sapling); });

    // merchant ship (docks by the pier during the day)
    tex(s, 'sunlit-ship', 34, 32, (p) => {
      p.shadow(17, 29, 15, 2.5, E.black, 60);
      p.poly([[2, 21], [32, 21], [28, 28], [6, 28]], E.brown1);
      p.hline(3, 31, 21, E.sand2); p.hline(6, 28, 27, E.brown2); p.hline(5, 29, 24, E.brown2);
      for (const x of [9, 16, 23]) p.rect(x, 22, 2, 2, E.dark1);
      p.vline(17, 3, 20, E.brown2); p.vline(10, 8, 20, E.brown2);
      p.poly([[18, 4], [29, 18], [18, 18]], E.white); p.poly([[18, 4], [23, 11], [18, 11]], E.grey1);
      p.poly([[11, 8], [16, 18], [11, 18]], E.sand1);
      p.hline(18, 28, 13, E.red3);
      p.rect(17, 1, 5, 3, E.yellow1); p.set(17, 0, E.brown2);
    }, { outline: E.dark1, hl: HL });
    // night tool icons (9x9) and the upgrade level pip
    const it9 = (key, rows, map) => tex(s, key, 11, 11, (p) => p.sprite(1, 1, rows, map), { outline: E.dark1 });
    it9('sunlit-item-bucket', ['.#######.', '.#bbbbb#.', '.#bcbbb#.', '.#bbbbb#.', '..#bbb#..', '..#####..', '.........', '.........', '.........'].slice(0, 7), { '#': E.grey2, b: E.blue2, c: E.cyan });
    it9('sunlit-item-net', ['#.#.#.#', '.#.#.#.', '#.#.#.#', '.#.#.#.', '#.#.#.#', '.#.#.#.', '#.#.#.#'], { '#': E.sand2 });
    it9('sunlit-item-cannon', ['..###..', '.#####.', '##w####', '#######', '#######', '.#####.', '..###..'], { '#': E.grey4, w: E.grey1 });
    tex(s, 'sunlit-level', 5, 5, (p) => { p.set(2, 1, E.yellow2); p.hline(1, 3, 2, E.yellow1); p.set(2, 3, E.orange2); }, { outline: E.dark1 });

    // fish (for the fish book and catches)
    const fish = (id, body, belly, fin, eye) => tex(s, 'sunlit-fish-' + id, 16, 10, (p) => {
      p.ellipse(7, 5, 5.5, 3, body); p.hline(3, 11, 6, belly); p.hline(4, 10, 7, belly);
      p.poly([[11, 5], [15, 1], [15, 9]], fin); p.set(8, 2, fin); p.set(7, 2, fin);
      p.set(4, 4, eye); p.set(3, 4, E.white);
    }, { outline: E.dark1 });
    fish('sardine', E.grey2, E.grey1, E.grey3, E.dark1);
    fish('snapper', E.red3, E.pink2, E.red1, E.dark1);
    fish('tuna', E.blue1, E.blue2, E.navy, E.white);
    fish('pearlfish', E.cyan, E.white, E.purple2, E.purple1);
    tex(s, 'sunlit-bobber', 7, 9, (p) => { p.rect(2, 1, 3, 3, E.red3); p.rect(2, 4, 3, 2, E.white); p.set(3, 0, E.dark1); p.hline(1, 5, 6, E.blue2, 150); }, { outline: E.dark1 });
    // menu rail icons (13x13)
    const ic = (key, rows, map) => tex(s, key, rows[0].length + 2, rows.length + 2, (p) => p.sprite(1, 1, rows, map), { outline: E.dark1 });
    ic('sunlit-ico-build', ['.####.....', '######....', '.####.....', '...##.....', '...##.....', '...##.....', '...##.....', '...##.....', '...##.....', '...##.....'], { '#': E.sand1 });
    ic('sunlit-ico-book', ['#########.', '#ssss#sss#', '#s..s#s.s#', '#ssss#sss#', '#s..s#s.s#', '#ssss#sss#', '#ssss#sss#', '#########.'], { '#': E.brown2, s: E.sand1, '.': E.sand2 });
    ic('sunlit-ico-gear', ['...##...', '.######.', '.##..##.', '##....##', '##....##', '.##..##.', '.######.', '...##...'], { '#': E.grey1 });
    ic('sunlit-cat-land', ['gggggg', 'gggggg', 'ssssss', 'ssssss', 'bbbbbb'], { g: E.green1, s: E.sand1, b: E.blue2 });

    // toolbar tool icons (12x12)
    const icon = (key, rows) => tex(s, key, 14, 14, (p) => p.sprite(1, 1, rows, { '#': E.sand1, 'o': E.yellow1, 'r': E.red3 }), { outline: E.dark1 });
    icon('sunlit-tool-rotate', [
      '....####....', '..##....##..', '.#........#.', '.#.........#', '#..........#', '#..........#',
      '#..........#', '.#.......#..', '.#......###.', '..##...#####', '....##......', '............',
    ]);
    icon('sunlit-tool-move', [
      '.....oo.....', '....oooo....', '.....oo.....', '.o...oo...o.', 'oo..oooo..oo', 'oooooooooooo',
      'oooooooooooo', 'oo..oooo..oo', '.o...oo...o.', '.....oo.....', '....oooo....', '.....oo.....',
    ]);
    icon('sunlit-tool-sell', [
      '.####.......', '######......', '######......', '.####.#.....', '.....#.#....', '......#.#...',
      '.......#.#..', '........#.#.', '.........#.#', '..........##', '............', '............',
    ]);

    tex(s, 'sunlit-idol', 16, 24, (p) => {
      p.shadow(8, 22, 6, 2, E.black, 70);
      p.rect(3, 19, 10, 3, E.grey3); p.hline(3, 12, 19, E.grey2);
      p.rect(4, 5, 8, 14, E.grey2); p.vline(4, 5, 18, E.grey1); p.vline(11, 5, 18, E.grey3);
      p.hline(5, 10, 4, E.grey2);
      p.set(5, 3, E.green2); p.set(7, 2, E.green2); p.set(8, 2, E.green1); p.set(10, 3, E.green2); p.set(6, 3, E.green1); p.set(9, 3, E.green1);
      p.hline(5, 10, 8, E.grey4);
      p.set(6, 9, E.pink1); p.set(9, 9, E.pink1); p.set(6, 10, E.purple2); p.set(9, 10, E.purple2);
      p.vline(7, 10, 13, E.grey1); p.vline(8, 10, 13, E.grey3);
      p.rect(5, 14, 6, 3, E.grey4); p.set(6, 14, E.white); p.set(9, 14, E.white); p.set(7, 16, E.red3); p.set(8, 16, E.red3);
      p.set(10, 6, E.grey4); p.set(11, 7, E.grey4); p.set(4, 17, E.green2); p.set(5, 18, E.green2);
      p.set(9, 11, E.purple1); p.set(9, 12, E.purple1);
    }, { outline: E.dark1, hl: HL });

    // decor
    tex(s, 'sunlit-palm', 24, 32, (p) => {
      p.shadow(12, 30, 6, 1.8, E.black, 60);
      let cx = 12;
      for (let y = 30; y >= 10; y--) {
        const x = 12 + Math.round(Math.sin((30 - y) / 20 * 1.6) * 3);
        p.set(x, y, (y % 3 === 0) ? E.brown2 : E.brown1); p.set(x + 1, y, E.brown2);
        cx = x;
      }
      const leaves = [[-10, 4, 5], [-8, -5, 3], [1, -8, 1], [9, -5, 3], [11, 4, 5]];
      for (const [dx, dy, droop] of leaves) {
        for (let i = 0; i <= 24; i++) {
          const t = i / 24, x = cx + 1 + dx * t, y = 9 + dy * t + droop * t * t;
          p.set(x, y, t > 0.9 ? E.green3 : E.green1);
          if (t < 0.85) p.set(x, y + 1, E.green2);
        }
      }
      p.set(cx, 10, E.brown2); p.set(cx + 2, 11, E.brown2); p.set(cx + 1, 10, E.dark1);
    }, { outline: E.green4 });

    tex(s, 'sunlit-rock', 16, 16, (p) => {
      p.shadow(8, 13, 6, 2, E.black, 60);
      p.ellipse(8, 11, 5, 3.5, E.grey2); p.ellipse(7, 10, 3, 2, E.grey1); p.hline(5, 11, 13, E.grey3);
      p.set(10, 9, E.green2); p.set(11, 10, E.green2);
    }, { outline: E.navy });

    tex(s, 'sunlit-bush', 16, 16, (p) => {
      p.shadow(8, 14, 6, 1.5, E.black, 60);
      p.ellipse(6, 11, 3.5, 3, E.green2); p.ellipse(10, 11, 3.5, 3, E.green2); p.ellipse(8, 9, 3.5, 3, E.green2);
      p.set(6, 8, E.green1); p.set(7, 8, E.green1); p.set(10, 10, E.green1); p.set(5, 10, E.green1);
      p.set(9, 11, E.red3); p.set(6, 12, E.red3);
    }, { outline: E.green4 });

    tex(s, 'sunlit-dock', 16, 16, (p) => {
      for (let x = 0; x < 16; x++) for (let y = 4; y <= 11; y++) p.set(x, y, x % 4 === 3 ? E.brown2 : (y === 4 ? E.sand2 : E.brown1));
      p.hline(0, 15, 12, E.dark1, 180);
      p.rect(1, 12, 2, 3, E.dark1); p.rect(13, 12, 2, 3, E.dark1);
    });

    tex(s, 'sunlit-boat', 18, 10, (p) => {
      p.ellipse(9, 5, 7.5, 3.5, E.brown1); p.hline(3, 14, 7, E.brown2); p.hline(4, 13, 8, E.brown2);
      p.ellipse(9, 4.5, 5, 2, E.sand2); p.vline(9, 3, 6, E.brown2);
    }, { outline: E.dark1 });
  }

  const map = [
    '....................',
    '......ssssss........',
    '...sssggggggsss.....',
    '..ssgggggggggggss...',
    '.ssggggggggggggggs..',
    '.sgggggggggggggggs.s',
    '.sggggggggggggggss..',
    '.ssgggggggggggggs...',
    '..ssgggggggggggss...',
    '...sssgggggggsss....',
    '.....sssssssss......',
    '....................',
  ];

  const S = {
    id: 'sunlit',
    swatches: Object.values(E),
    grid: { kind: 'square', T: 16, ox: 0, oy: -4 },
    map,
    P: {
      tile: 16,
      panel: { kind: 'wood', outline: E.dark1, fill: E.brown1, light: E.sand2, dark: E.brown2, grain: E.brown2 },
      card: { fill: E.brown2, fillLight: E.brown2, border: E.dark1, sel: E.yellow2 },
      text: E.sand1, textOutline: E.dark1, dim: E.sand1, accent: E.yellow2, worldOutline: E.dark1,
      coin: { bronze: [E.sand2, E.orange1, E.brown2], silver: [E.white, E.grey1, E.grey2], gold: [E.yellow2, E.yellow1, E.orange2], diamond: [E.cyan, E.blue2, E.blue1] },
      iconOutline: E.dark1, sun: [E.yellow1, E.yellow2], moon: [E.grey1, E.white],
      bubble: { fill: E.white, shade: E.grey1, outline: E.dark1 },
      up: E.green1, down: E.red3,
      light: { torch: E.orange2, window: E.yellow1, purple: E.purple2 },
      raider: { hull: E.brown2, dark: E.dark1, trim: E.red1, body: E.dark1, spear: E.grey2, outline: E.black },
      aura: { income: 0xfee761, boost: 0xffffff, defense: 0x2ce8f5, trap: 0xe43b44 },
      nightTint: 0x46558c,
    },
    art: {
      hut: { tex: 'sunlit-hut', lights: [{ x: 3, y: -6, key: 'window' }] },
      market: { tex: 'sunlit-market', lights: [{ x: -6, y: -11, key: 'window' }, { x: 6, y: -11, key: 'window' }] },
      farm: { tex: 'sunlit-farm-r0', rotTex: (rot) => 'sunlit-farm-r' + rot, cardCrop: 0 },
      tower: { tex: 'sunlit-tower', lights: [{ x: 5, y: -25, key: 'torch' }, { x: 0, y: -23, key: 'window' }], cardCrop: 0 },
      idol: { tex: 'sunlit-idol', lights: [{ x: 0, y: -15, key: 'purple' }] },
      longhouse: { tex: 'sunlit-longhouse-r0', rotTex: (rot) => 'sunlit-longhouse-r' + rot, lightsFor: (rot) => (LIGHTS.longhouse[rot] || []).map((l) => ({ ...l, key: 'window' })) },
      workshop: { tex: 'sunlit-workshop-r0', rotTex: (rot) => 'sunlit-workshop-r' + rot, lightsFor: (rot) => (LIGHTS.workshop[rot] || []).map((l) => ({ ...l, key: 'window' })), cardCrop: 4 },
      plantation: { tex: 'sunlit-plantation-r0', rotTex: (rot) => 'sunlit-plantation-r' + rot, cardCrop: 26 },
    },
    buildings: [
      { id: 'market', c: 8, r: 4 },
      { id: 'hut', c: 10, r: 3 }, { id: 'hut', c: 7, r: 6 }, { id: 'hut', c: 5, r: 5 }, { id: 'hut', c: 11, r: 7 },
      { id: 'farm', c: 12, r: 5 },
      { id: 'tower', c: 4, r: 7 }, { id: 'tower', c: 14, r: 8 },
      { id: 'idol', c: 10, r: 8 },
    ],
    decor: [
      { tex: 'sunlit-palm', c: 4, r: 2, sway: true }, { tex: 'sunlit-palm', c: 15, r: 3, dx: 2, sway: true },
      { tex: 'sunlit-palm', c: 1, r: 6, sway: true }, { tex: 'sunlit-palm', c: 15, r: 9, sway: true },
      { tex: 'sunlit-palm', c: 8, r: 1, sway: true },
      { tex: 'sunlit-rock', c: 19, r: 5 }, { tex: 'sunlit-rock', c: 4, r: 9 },
      { tex: 'sunlit-bush', c: 2, r: 4 }, { tex: 'sunlit-bush', c: 16, r: 8 }, { tex: 'sunlit-bush', c: 12, r: 2 },
      { tex: 'sunlit-dock', c: 17, r: 7, flat: true }, { tex: 'sunlit-dock', c: 18, r: 7, flat: true },
      { tex: 'sunlit-boat', c: 19, r: 7, dy: -2, flat: true },
    ],
    // the whole world the camera can see (the 20x12 map sits in the middle of open sea)
    world: { x0: -160, y0: -110, w: 640, h: 400 },
    // raider lanes: dusk staging point far out at sea (s) -> landing spot just off the beach (t)
    lanes: [
      { sx: -96, sy: -40, tx: 44, ty: 32 }, { sx: 416, sy: -40, tx: 268, ty: 32 },
      { sx: -96, sy: 222, tx: 52, ty: 162 }, { sx: 416, sy: 222, tx: 266, ty: 160 },
    ],
    textures,
    // map = the island's current tiles (land can be bought), key = texture name for this layout
    terrain(scene, map, key) {
      return SquareTerrain.addTerrain(scene, key || 'sunlit-terrain', { ...S, map: map || S.map }, {
        deep: E.blue1, glint: E.blue2, shallow: E.blue2, ring: E.cyan, foam: E.white,
        sand: E.sand1, sandSpeck: E.sand2, wet: E.sand2, cliff: E.brown1, cliffShadow: E.sand2,
        grass: E.green1, grassDark: E.green2, lip: E.green2, flowers: [E.yellow2, E.white, E.pink2],
      }, { bounds: S.world });
    },
    gridOverlay: (scene, map, key) => SquareTerrain.gridOverlay(scene, key || 'sunlit-grid', { ...S, map: map || S.map }, E.green2, 150),
  };
  (window.STYLES = window.STYLES || {}).sunlit = S;
})();
