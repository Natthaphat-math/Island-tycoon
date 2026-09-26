// scene.js — renders the core state (src/core/*) in the Sunlit 3/4 style and turns
// mouse, keyboard and touch input into core calls. Rules, money, the day/night
// loop and villager orders live in Core / Economy / Night / Orders; this file
// only draws and routes input.
//
// Two modes:
//   PLAY  taps collect (PERFECT if right as it fills), fire at raiders at night,
//         or put out fires. Tapping a building that isn't ready shows its info.
//   EDIT  (drawer button or E) taps pick buildings up to move / rotate / sell.
// All info and actions live in one docked panel in the bottom corner opposite
// the drawer, so nothing pops up on top of the buildings you're looking at.
(function () {
  'use strict';
  const { PixelText } = PX;
  const B = Core.BUILDINGS, E = Economy, N = Night, O = Orders;
  const ORDER = ['hut', 'farm', 'longhouse', 'workshop', 'plantation', 'market', 'tower', 'idol'];
  const CATS = [
    { id: 'income', icon: 'ico-bronze', name: 'INCOME', types: ['hut', 'farm', 'longhouse', 'workshop', 'plantation'] },
    { id: 'boost', icon: 'cat-boost', name: 'BOOST', types: ['market'] },
    { id: 'defense', icon: 'cat-defense', name: 'DEFENSE', types: ['tower'] },
    { id: 'trap', icon: 'cat-trap', name: 'TRAPS', types: ['idol'] },
  ];
  const SAVE_KEY = 'itc-save-v1';
  const TOP = 14, DW = 26;                     // top bar height, drawer width
  const LETTER = { bronze: 'B', silver: 'S', gold: 'G', diamond: 'D' };
  const fmtMult = (m) => 'x' + (Math.round(m * 100) / 100);
  const fmtRate = (n) => (n < 10 ? String(Math.round(n * 100) / 100) : E.fmt(n));
  const clock = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const bag = (o) => Object.entries(o || {}).map(([c, v]) => E.fmt(v) + LETTER[c]).join(' ');
  const hex = (c) => Phaser.Display.Color.HexStringToColor(c).color;

  class GameScene extends Phaser.Scene {
    constructor() { super('game'); }

    create() {
      const S = this.S = window.STYLES.sunlit;
      this.key = (s) => `${S.id}-${s}`;
      this.T = S.grid.T; this.ox = S.grid.ox; this.oy = S.grid.oy;
      PixelText.resetSlots();
      ART.build(this, S.id, S.P);
      S.textures(this);
      this.uiTextures();

      const loaded = this.loadGame();
      this.state = loaded ? loaded.state : E.newGame(S.map, S.buildings);
      N.restore(this.state, loaded && loaded.raw.cycle);
      O.restore(this.state, loaded && loaded.raw.orders);

      this.views = new Map(); this.raiders = new Map();
      this.auraObjs = []; this.ants = null; this.focus = null;
      this.ghost = null; this.edit = false; this.combo = 0; this.comboLeft = 0;
      this.touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
      this.side = this.registry.get('drawerSide') === 'right' ? 'right' : 'left';
      this.drawerOpen = true; this.cat = 'income';
      this.cameras.main.setBackgroundColor('#124e89');

      S.terrain(this);
      this.gridObj = S.gridOverlay(this).setDepth(1).setVisible(this.registry.get('grid') !== false);
      this.antsG = this.add.graphics().setDepth(4);
      for (const d of S.decor) this.addDecor(d);

      this.buildNight();
      this.refreshEval();
      for (const b of this.state.buildings) this.addView(b);
      this.buildUI();
      const ph = this.state.cycle.phase;
      this.setNight(ph === 'dusk' || ph === 'night', true);
      if (ph === 'dusk' || ph === 'night') { this.spawnRaiders(); this.setDrawer(false); }
      if (ph === 'day' && !this.state.orders.active) O.next(this.state);

      this.input.mouse && this.input.mouse.disableContextMenu();
      this.input.on('pointermove', (p) => this.onPointerMove(p));
      this.input.on('pointerdown', (p, over) => this.onPointerDown(p, over));
      this.input.on('wheel', (p, over, dx, dy) => { if (this.ghost && dy) this.rotate(); });
      const kb = this.input.keyboard;
      kb.on('keydown-N', () => this.skipPhase());
      kb.on('keydown-G', () => window.IslandGame.toggleGrid());
      kb.on('keydown-E', () => this.setEdit(!this.edit));
      kb.on('keydown-ESC', () => { if (this.ghost) this.cancel(); else if (this.edit) this.setEdit(false); else this.clearFocus(); });
      kb.on('keydown-R', () => this.rotate());
      kb.on('keydown-X', () => { if (this.ghost && this.ghost.moving) this.sellHeld(); });
      kb.on('keydown-TAB', (e) => { e.preventDefault && e.preventDefault(); this.setDrawer(!this.drawerOpen); });
      ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'].forEach((k, i) => kb.on('keydown-' + k, () => this.selectCard(ORDER[i])));
      this.time.addEvent({ delay: 250, loop: true, callback: () => this.refreshCards() });
    }

    // ------------------------------------------------------------ saves
    loadGame() {
      if (this.registry.get('fresh')) { this.registry.set('fresh', false); return null; }
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        return raw ? E.deserialize(raw, this.S.map) : null;
      } catch (e) { return null; }
    }
    save() {
      try { localStorage.setItem(SAVE_KEY, E.serialize(this.state)); return true; } catch (e) { return false; }
    }

    // ------------------------------------------------------------ extra UI art
    uiTextures() {
      const P = this.S.P, k = this.key, C = P.card, tex = PX.tex;
      tex(this, k('drawer'), DW, 180 - TOP, (p) => ART.drawPanel(p, 0, 0, DW, 180 - TOP, P.panel));
      const box = (name, w, h, sel) => tex(this, k(name), w, h, (p) => {
        p.rect(1, 1, w - 2, h - 2, C.fill);
        const b = sel ? C.sel : C.border;
        p.hline(1, w - 2, 0, b); p.hline(1, w - 2, h - 1, b); p.vline(0, 1, h - 2, b); p.vline(w - 1, 1, h - 2, b);
        if (sel) { p.hline(1, w - 2, 1, b); p.hline(1, w - 2, h - 2, b); p.vline(1, 1, h - 2, b); p.vline(w - 2, 1, h - 2, b); }
      });
      for (const sel of [false, true]) {
        const s = sel ? '-sel' : '';
        box('tab' + s, 12, 12, sel); box('card22' + s, 24, 22, sel); box('editbtn' + s, 24, 11, sel);
      }
      box('handle', 24, 10, false); box('pull', 10, 28, false);
      const ico = (name, rows, map) => tex(this, k(name), rows[0].length + 2, rows.length + 2, (p) => p.sprite(1, 1, rows, map), { outline: P.iconOutline });
      ico('cat-boost', ['..#..', '.###.', '#####', '..#..', '..#..', '..#..'], { '#': P.up });
      ico('cat-defense', ['#######', '#.....#', '#.###.#', '#.....#', '.#...#.', '..#.#..', '...#...'], { '#': '#2ce8f5', '.': '#0099db' });
      ico('cat-trap', ['.###.', '#####', '#.#.#', '#####', '.#.#.'], { '#': '#b55088', '.': '#ff0044' });
      ico('ico-ok', ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'], { '#': P.up });
      ico('ico-no', ['#...#', '##.##', '.###.', '##.##', '#...#'], { '#': P.down });
      ico('ico-rot', ['.###.', '#...#', '#....', '#..#.', '.###.', '...#.'], { '#': P.text });
      // corner brackets that frame a coin bubble when that building can fire
      tex(this, k('crosshair'), 17, 18, (p) => {
        const c = '#ff0044';
        for (const [x, y, dx, dy] of [[0, 0, 1, 1], [16, 0, -1, 1], [0, 17, 1, -1], [16, 17, -1, -1]]) {
          p.set(x, y, c); p.set(x + dx, y, c); p.set(x + 2 * dx, y, c); p.set(x, y + dy, c); p.set(x, y + 2 * dy, c);
        }
      });
      PX.sheet(this, k('flame'), 9, 12, 2, (p, f) => {
        const o = f ? 1 : 0;
        p.ellipse(4.5, 8, 3.5, 3.5, '#f77622'); p.ellipse(4.5 - o * 0.5, 6 - o, 2.4, 3.2, '#f77622');
        p.ellipse(4.5, 8.5, 2.2, 2.2, '#feae34'); p.set(4 + o, 3 + o, '#feae34'); p.set(5 - o, 1 + o, '#f77622');
        p.ellipse(4.5, 9, 1.2, 1.2, '#fee761');
        p.outline('#3e2731');
      });
      if (!this.anims.exists(k('flame'))) this.anims.create({ key: k('flame'), frames: [0, 1].map((f) => ({ key: k('flame'), frame: f })), frameRate: 6, repeat: -1 });
    }

    // ------------------------------------------------------------ geometry
    tileXY(c, r) { return { x: this.ox + c * this.T, y: this.oy + r * this.T }; }
    pick(x, y) { return { c: Math.floor((x - this.ox) / this.T), r: Math.floor((y - this.oy) / this.T) }; }
    anchor(type, c, r, rot) {
      const [bw, bh] = Core.bbox(Core.rotateShape(B[type].shape, rot));
      return { x: this.ox + (c + bw / 2) * this.T, y: this.oy + (r + bh) * this.T };
    }
    texFor(type, rot) { const a = this.S.art[type]; return a.rotTex ? a.rotTex(rot) : a.tex; }
    originFor(type, rot, c, r) {
      const [bw, bh] = Core.bbox(Core.rotateShape(B[type].shape, rot));
      return { c: c - Math.floor((bw - 1) / 2), r: r - Math.floor((bh - 1) / 2) };
    }
    drawerX() { return this.side === 'left' ? 0 : 320 - DW; }
    overDrawer(p) {
      if (!this.drawerOpen) return this.side === 'left' ? p.x < 10 && p.y > 76 && p.y < 104 : p.x >= 310 && p.y > 76 && p.y < 104;
      return this.side === 'left' ? p.x < DW : p.x >= 320 - DW;
    }
    // only a dock with buttons swallows taps; plain info never blocks the map
    overDock(p) { const t = this.dock; return t && t.visible && t.hasBtns && p.x >= t.x && p.x < t.x + t.w && p.y >= t.y && p.y < t.y + t.h; }
    inMap(p) { return p.y >= TOP && !this.overDrawer(p) && !this.overDock(p); }
    scrollX() { return this.cameras.main.scrollX; }

    addDecor(d) {
      const a = { x: this.ox + (d.c + 0.5) * this.T, y: this.oy + (d.r + 1) * this.T };
      const img = this.add.image(a.x + (d.dx || 0), a.y + (d.dy || 0), d.tex).setOrigin(0.5, 1);
      img.setDepth(d.flat ? 5 : 10 + img.y + img.x * 0.001);
      if (d.sway) this.tweens.add({ targets: img, x: img.x + 1, duration: 1400 + Math.random() * 600, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [1], delay: Math.random() * 1000 });
    }

    // ------------------------------------------------------------ building views
    addView(b) {
      const art = this.S.art[b.type], a = this.anchor(b.type, b.c, b.r, b.rot), def = B[b.type];
      const tex = this.texFor(b.type, b.rot);
      const sprite = this.add.image(a.x, a.y + (art.dy || 0), tex).setOrigin(0.5, 1).setDepth(10 + a.y + a.x * 0.001);
      const v = { b, sprite, tex, x: a.x, y: a.y, lights: [] };
      sprite.setInteractive({ pixelPerfect: true, alphaTolerance: 1, cursor: 'pointer' });
      sprite.on('pointerover', (p) => { if (!p.wasTouch && !this.ghost) this.setFocus(v, false); });
      sprite.on('pointerout', (p) => { if (!p.wasTouch && this.focus === v && !this.focusSticky) this.clearFocus(); });

      if (def.cur) {
        const by = sprite.y - sprite.height - 1;
        v.bubble = this.add.image(a.x, by, this.key('bubble-' + def.cur)).setOrigin(0.5, 1).setDepth(2400).setVisible(false);
        v.bubble.setInteractive(new Phaser.Geom.Rectangle(-5, -5, 23, 24), Phaser.Geom.Rectangle.Contains);
        v.aim = this.add.image(a.x, by + 2, this.key('crosshair')).setOrigin(0.5, 1).setDepth(2401).setVisible(false);
        this.tweens.add({ targets: [v.bubble, v.aim], y: '-=2', duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      const na = (o, alpha) => { o.nightAlpha = alpha; o.setAlpha(this.night ? alpha : 0); v.lights.push(o); return o; };
      for (const L of (art.lightsFor ? art.lightsFor(b.rot) : art.lights) || []) {
        const img = na(this.add.image(sprite.x + L.x, sprite.y + L.y, this.key('light-' + L.key)).setBlendMode(Phaser.BlendModes.ADD).setDepth(2100), 1);
        img.flicker = L.key === 'torch' || L.key === 'purple';
      }
      if (def.kind === 'defense') {
        v.aim = this.add.image(a.x, sprite.y - sprite.height + 14, this.key('crosshair')).setOrigin(0.5, 1).setDepth(2401).setVisible(false);
        this.tweens.add({ targets: v.aim, y: '-=2', duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        const set = Core.auraCells(this.state, b);
        for (const [c, r] of set.values()) {
          const t = this.tileXY(c, r);
          na(this.add.image(t.x, t.y, this.key('aura-fill')).setOrigin(0).setTint(this.S.P.aura.defense).setBlendMode(Phaser.BlendModes.ADD).setDepth(2050), 0.08);
        }
        const g = this.add.graphics().setDepth(2051).setBlendMode(Phaser.BlendModes.ADD);
        this.dotPerimeter(g, set, this.S.P.aura.defense, 0);
        na(g, 0.7);
      }
      this.views.set(b.id, v);
      this.syncFlame(v);
      return v;
    }

    removeView(id) {
      const v = this.views.get(id);
      if (!v) return;
      if (this.focus === v) this.clearFocus();
      for (const o of [v.sprite, v.bubble, v.aim, v.flame, v.flameLight, ...v.lights]) if (o) { this.tweens.killTweensOf(o); o.destroy(); }
      this.views.delete(id);
    }

    syncFlame(v) {
      const on = v.b.burn > 0;
      if (on && !v.flame) {
        const s = v.sprite, y = s.y - Math.min(s.height, 20) + 8;
        v.flame = this.add.sprite(s.x, y, this.key('flame')).setOrigin(0.5, 1).setDepth(s.depth + 0.5).play(this.key('flame'));
        v.flameLight = this.add.image(s.x, y - 4, this.key('light-torch')).setBlendMode(Phaser.BlendModes.ADD).setDepth(2100).setAlpha(0.8);
        v.sprite.setTint(0xb08070);
      } else if (!on && v.flame) {
        v.flame.destroy(); v.flameLight.destroy(); v.flame = v.flameLight = null;
        v.sprite.clearTint();
      }
    }

    viewAt(over, c, r, allowTile) {
      for (const o of over) for (const v of this.views.values()) if (v.sprite === o || v.bubble === o) return v;
      if (!allowTile) return null;
      const b = Core.occupancy(this.state).get(c + ',' + r);
      return b ? this.views.get(b.id) : null;
    }

    refreshEval() {
      this.eval = Core.evaluate(this.state);
      this.rates = Core.rates(this.state, this.eval);
      this.cov = N.coverage(this.state);
    }

    // ------------------------------------------------------------ auras
    showAura(b, badges) {
      this.clearAura();
      const def = B[b.type], set = Core.auraCells(this.state, b), col = this.S.P.aura[def.kind];
      for (const [c, r] of set.values()) {
        const t = this.tileXY(c, r);
        this.auraObjs.push(this.add.image(t.x, t.y, this.key('aura-fill')).setOrigin(0).setTint(col).setAlpha(0.35).setDepth(2));
      }
      this.ants = { set, col };
      for (const [id, up] of badges) this.addBadge(this.views.get(id), up);
    }
    addBadge(v, up) {
      if (!v) return;
      const s = v.sprite;
      const bdg = this.add.image(s.x + Math.floor(s.width / 4) + 1, s.y - s.height + 8, this.key(up ? 'badge-up' : 'badge-down')).setDepth(2500);
      this.tweens.add({ targets: bdg, y: bdg.y - 2, duration: 400, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [2] });
      this.auraObjs.push(bdg);
    }
    clearAura() {
      for (const o of this.auraObjs) o.destroy();
      this.auraObjs = []; this.ants = null; this.antsG.clear();
    }
    dotPerimeter(g, set, col, off) {
      const T = this.T;
      g.fillStyle(col, 1);
      const dot = (x, y) => { if (((x + y + off) >> 1) & 1) g.fillRect(x, y, 1, 1); };
      for (const [c, r] of set.values()) {
        const { x: x0, y: y0 } = this.tileXY(c, r);
        const has = (a, bb) => set.has(a + ',' + bb);
        for (let i = 0; i < T; i++) {
          if (!has(c, r - 1)) dot(x0 + i, y0);
          if (!has(c, r + 1)) dot(x0 + i, y0 + T - 1);
          if (!has(c - 1, r)) dot(x0, y0 + i);
          if (!has(c + 1, r)) dot(x0 + T - 1, y0 + i);
        }
      }
    }
    effectsFrom(id) {
      const out = [];
      for (const [tid, e] of this.eval) for (const s of e.sources) if (s.id === id) out.push([tid, (s.add || 0) > 0 || (s.mul || 1) > 1]);
      return out;
    }

    // ------------------------------------------------------------ focus (info only)
    // focus = hovered (mouse) or tapped-but-not-ready (touch) building: highlight,
    // aura and its numbers in the dock. Sticky focus (from a tap) fades after a while.
    setFocus(v, sticky) {
      if (this.ghost) return;
      if (this.focus && this.focus !== v) this.clearFocus();
      this.focus = v; this.focusSticky = !!sticky;
      if (!(v.b.burn > 0)) {
        if (this.textures.exists(v.tex + '-hl')) v.sprite.setTexture(v.tex + '-hl');
        else v.sprite.setTint(0xfff4c0);
      }
      this.showAura(v.b, this.effectsFrom(v.b.id));
      this.dockForBuilding(v);
      if (this.focusTimer) this.focusTimer.remove();
      if (sticky) this.focusTimer = this.time.delayedCall(4000, () => { if (this.focus === v) this.clearFocus(); });
    }
    clearFocus() {
      const v = this.focus;
      this.focus = null; this.focusSticky = false;
      if (v && v.sprite.active) { v.sprite.setTexture(v.tex); if (!(v.b.burn > 0)) v.sprite.clearTint(); }
      this.clearAura();
      if (!this.ghost) this.dockIdle();
    }

    dockForBuilding(v) {
      const b = v.b, d = B[b.type], e = this.eval.get(b.id);
      let l3 = d.cur ? fmtMult(e.mult) + ' = ' + fmtRate(e.output) + '/S' : d.kind === 'defense' ? 'GUARDS AT NIGHT' : 'NO INCOME ITSELF';
      let icon = d.cur || null;
      if (b.burn > 0) { l3 = 'FIRE! TAP x' + b.burn; icon = null; }
      else if (d.cur && N.isCovered(this.state, b, this.cov)) l3 += ' GUARDED';
      if (this.edit) { l3 = this.touch ? 'TAP TO MOVE / SELL' : 'CLICK TO MOVE / SELL'; icon = null; }
      this.showDock({ lines: [d.name, d.desc, l3], icon, near: v });
    }

    // ------------------------------------------------------------ the dock
    buildDock() {
      const P = this.S.P;
      const t = this.dock = { visible: false, x: 0, y: 0, w: 0, h: 0 };
      t.g = this.add.graphics().setScrollFactor(0).setDepth(3500);
      t.lines = [0, 1, 2].map((i) => new PixelText(this, 0, 0, '', { color: [P.accent, P.text, P.dim][i], outline: P.textOutline }).setOrigin(0).setScrollFactor(0).setDepth(3501));
      t.icon = this.add.image(0, 0, this.key('ico-bronze')).setOrigin(0).setScrollFactor(0).setDepth(3501);
      t.btns = [0, 1, 2, 3].map(() => {
        const zone = this.add.zone(0, 0, 10, 10).setOrigin(0).setScrollFactor(0).setDepth(3502);
        zone.isUI = true;
        const label = new PixelText(this, 0, 0, '', { color: P.text, outline: P.textOutline }).setOrigin(0).setScrollFactor(0).setDepth(3503);
        const icon = this.add.image(0, 0, this.key('ico-ok')).setScrollFactor(0).setDepth(3503);
        const bt = { zone, label, icon, fn: null };
        zone.on('pointerdown', () => { if (bt.fn) bt.fn(); });
        return bt;
      });
      this.hideDock();
    }

    // o: { lines, icon, btns: [{ label | icon, fn, tone: 'ok'|'danger'|null }], near: view (dock hops away from it) }
    showDock(o) {
      const t = this.dock, P = this.S.P;
      const lines = o.lines.filter((x) => x != null);
      t.lines.forEach((pt, i) => pt.setText(lines[i] || '').setVisible(i < lines.length));
      const iconW = o.icon ? 10 : 0;
      const btns = o.btns || [];
      const bw = btns.map((b, i) => (b.icon ? 16 : t.btns[i].label.setText(b.label).width + 8));
      let w = Math.max(40, ...t.lines.map((pt, i) => (i < lines.length ? pt.width + (i === lines.length - 1 ? iconW : 0) : 0))) + 6;
      w = Math.max(w, bw.reduce((a, x) => a + x + 2, 0) + 4);
      const h = lines.length * 8 + 4 + (btns.length ? 15 : 0);
      // bottom corner opposite the drawer; hop to the other corner if it would cover `near`
      const leftX = (this.drawerOpen && this.side === 'left' ? DW : 0) + 2;
      const rightX = (this.drawerOpen && this.side === 'right' ? 320 - DW : 320) - 2 - w;
      let x = this.side === 'left' ? rightX : leftX;
      const y = 178 - h;
      if (o.near) {
        const nx = o.near.x - this.scrollX(), ny = o.near.y;
        if (nx > x - 8 && nx < x + w + 8 && ny > y - 4) x = x === rightX ? leftX : rightX;
      }
      Object.assign(t, { visible: true, x, y, w, h, hasBtns: btns.length > 0 });
      t.g.clear().setVisible(true);
      t.g.fillStyle(0x181425, 0.92).fillRect(x, y, w, h);
      t.g.fillStyle(hex(P.panel.light), 1).fillRect(x, y, w, 1).fillRect(x, y + h - 1, w, 1).fillRect(x, y, 1, h).fillRect(x + w - 1, y, 1, h);
      lines.forEach((_, i) => t.lines[i].setPosition(x + 3 + (o.icon && i === lines.length - 1 ? iconW : 0), y + 2 + i * 8));
      t.icon.setVisible(!!o.icon);
      if (o.icon) t.icon.setTexture(this.key('ico-' + o.icon)).setPosition(x + 2, y + 1 + (lines.length - 1) * 8);
      let bx = x + 3;
      t.btns.forEach((bt, i) => {
        const on = i < btns.length, b = btns[i];
        bt.label.setVisible(on && !b.icon); bt.icon.setVisible(on && !!b.icon);
        if (!on) { bt.fn = null; bt.zone.disableInteractive(); return; }
        bt.fn = b.fn; bt.zone.setInteractive({ cursor: 'pointer' });
        const by = y + h - 14;
        const fill = b.tone === 'danger' ? 0xa22633 : b.tone === 'ok' ? 0x3e8948 : b.tone === 'off' ? 0x3a4466 : 0x733e39;
        t.g.fillStyle(fill, 1).fillRect(bx, by, bw[i], 12);
        t.g.fillStyle(hex(P.panel.light), 0.6).fillRect(bx, by, bw[i], 1);
        if (b.icon) bt.icon.setTexture(this.key(b.icon)).setPosition(bx + 8, by + 6).setAlpha(b.tone === 'off' ? 0.4 : 1);
        else bt.label.setPosition(bx + 4, by + 3);
        bt.zone.setPosition(bx - 1, by - 3).setSize(bw[i] + 2, 16);
        bx += bw[i] + 2;
      });
    }
    hideDock() {
      const t = this.dock;
      if (!t) return;
      t.visible = false; t.g.setVisible(false); t.icon.setVisible(false);
      t.lines.forEach((l) => l.setVisible(false));
      t.btns.forEach((b) => { b.label.setVisible(false); b.icon.setVisible(false); b.zone.disableInteractive(); b.fn = null; });
    }
    // what the dock shows when nothing is selected
    dockIdle() {
      if (this.edit) {
        this.showDock({ lines: ['EDIT MODE', this.touch ? 'TAP A BUILDING TO' : 'CLICK A BUILDING TO', 'MOVE, TURN OR SELL'], btns: [{ label: 'DONE', fn: () => this.setEdit(false), tone: 'ok' }] });
      } else this.hideDock();
    }

    // ------------------------------------------------------------ edit mode
    setEdit(on) {
      if (this.ghost) this.cancel();
      this.clearFocus();
      this.edit = on;
      this.gridObj.setVisible(on || this.registry.get('grid') !== false);
      if (this.drawer) this.drawer.editBtn.setTexture(this.key(on ? 'editbtn-sel' : 'editbtn'));
      if (on) this.banner('EDIT MODE', '#fee761');
      this.dockIdle();
    }

    // ------------------------------------------------------------ placement
    selectCard(type) {
      if (this.ghost && this.ghost.type === type && !this.ghost.moving) { this.cancel(); return; }
      if (this.ghost) this.cancel();
      if (this.edit) this.setEdit(false);
      const cat = CATS.find((c) => c.types.includes(type));
      if (cat && cat.id !== this.cat) { this.cat = cat.id; this.buildCards(); }
      this.makeGhost(type, Core.rotations(type)[0], null);
    }

    makeGhost(type, rot, moving) {
      this.clearFocus();
      const img = this.add.image(-100, -100, this.texFor(type, rot)).setOrigin(0.5, 1).setAlpha(0.8).setDepth(2300).setVisible(false);
      this.ghost = { type, rot, moving, img, cells: [], tileKey: null, sellArmed: false };
      this.refreshButtons();
      const p = this.input.activePointer;
      if (moving) this.positionGhost(moving.c, moving.r, true, true);
      else if (!this.touch && this.inMap(p)) this.onPointerMove(p);
      else this.dockGhost();
    }

    dropGhost() {
      if (!this.ghost) return;
      this.ghost.img.destroy();
      for (const o of this.ghost.cells) o.destroy();
      this.ghost = null;
      this.clearAura();
      this.refreshButtons();
      this.dockIdle();
    }

    rotate() {
      const g = this.ghost;
      if (!g) return;
      const rots = Core.rotations(g.type);
      if (rots.length < 2) return;
      g.rot = rots[(rots.indexOf(g.rot) + 1) % rots.length];
      g.img.setTexture(this.texFor(g.type, g.rot));
      if (g.at) this.positionGhost(g.at.c, g.at.r, true); else this.dockGhost();
    }

    cancel() {
      const g = this.ghost;
      if (g && g.moving) this.restoreHeld();
      this.dropGhost();
    }
    // put a picked-up building back where it was
    restoreHeld() {
      const m = this.ghost.moving;
      const b = Core.place(this.state, m.type, m.c, m.r, m.rot, m.id);
      if (b) { b.fill = m.fill; b.wait = m.wait; if (m.burn) b.burn = m.burn; this.addView(b); }
      this.refreshEval();
      if (B[m.type].kind === 'defense') this.rebuildDefenseLights();
      return b;
    }
    // sell the building currently held in edit mode (asks twice)
    sellHeld() {
      const g = this.ghost;
      if (!g || !g.moving) return;
      if (!g.sellArmed) { g.sellArmed = true; this.dockGhost(); return; }
      const b = this.restoreHeld();
      this.dropGhost();
      if (b) this.sell(this.views.get(b.id));
    }

    positionGhost(c, r, force, exact) {
      const g = this.ghost, k = c + ',' + r;
      if (!force && g.tileKey === k) return;
      const [bw, bh] = Core.bbox(Core.rotateShape(B[g.type].shape, g.rot));
      const o = exact ? { c, r } : this.originFor(g.type, g.rot, c, r);
      g.at = exact ? { c: c + Math.floor((bw - 1) / 2), r: r + Math.floor((bh - 1) / 2) } : { c, r };
      g.tileKey = g.at.c + ',' + g.at.r;
      g.origin = o;
      const chk = Core.canPlace(this.state, g.type, o.c, o.r, g.rot);
      const afford = g.moving || E.canAfford(this.state, g.type);
      g.ok = chk.ok && afford; g.reason = chk.ok ? 'TOO POOR' : chk.reason;
      const a = this.anchor(g.type, o.c, o.r, g.rot);
      g.a = a;
      g.img.setVisible(true).setPosition(a.x, a.y + (this.S.art[g.type].dy || 0)).setTint(g.ok ? 0xc8ffc0 : 0xff7070);
      for (const obj of g.cells) obj.destroy();
      g.cells = chk.cells.map(([cc, rr]) => {
        const t = this.tileXY(cc, rr);
        return this.add.image(t.x, t.y, this.key('aura-fill')).setOrigin(0).setTint(g.ok ? 0x63c74d : 0xe43b44).setAlpha(0.55).setDepth(3);
      });
      g.preview = chk.ok ? Core.preview(this.state, g.type, o.c, o.r, g.rot) : null;
      this.showAura({ type: g.type, c: o.c, r: o.r, rot: g.rot }, g.preview ? g.preview.changes.map((ch) => [ch.id, ch.delta > 0]) : []);
      this.dockGhost();
    }

    // dock contents while holding a building: verdict + rotate / (sell) / build / cancel
    dockGhost() {
      const g = this.ghost;
      if (!g) return;
      const d = B[g.type], cost = E.costOf(this.state, g.type);
      let lines, icon = null;
      if (!g.at) lines = [d.name, d.desc, this.touch ? 'TAP A TILE' : 'PICK A TILE'];
      else if (!g.ok) {
        lines = [d.name, g.reason, g.reason === 'TOO POOR' ? 'NEED ' + E.fmt(cost.amount) : null];
        if (g.reason === 'TOO POOR') icon = cost.cur;
      } else {
        const pv = g.preview, own = d.base ? fmtMult(pv.self.mult) + ' ' : '';
        const net = Object.entries(pv.total).map(([cc, n]) => (n >= 0 ? '+' : '-') + fmtRate(Math.abs(n)) + (cc === 'bronze' ? '' : LETTER[cc])).join(' ') || '+0';
        lines = [d.name, own + 'NET ' + net + '/S', g.moving ? 'MOVE: FREE' : E.fmt(cost.amount)];
        if (!g.moving) icon = cost.cur;
      }
      const btns = [];
      if (Core.rotations(g.type).length > 1) btns.push({ icon: 'ico-rot', fn: () => this.rotate() });
      if (g.moving) {
        const ref = E.refundOf(this.state, g.type);
        btns.push({ label: g.sellArmed ? 'SURE? +' + E.fmt(ref.amount) : 'SELL', fn: () => this.sellHeld(), tone: 'danger' });
      }
      btns.push({ icon: 'ico-ok', fn: () => this.tryPlace(), tone: g.ok ? 'ok' : 'off' });
      btns.push({ icon: 'ico-no', fn: () => this.cancel() });
      this.showDock({ lines, icon, btns, near: g.a ? { x: g.a.x, y: g.a.y } : null });
    }

    onPointerMove(p) {
      if (!p.wasTouch) this.touch = false;
      if (!this.ghost) return;
      if (p.wasTouch && !p.isDown) return;           // touch: ghost follows a dragging finger only
      if (!this.inMap(p)) return;
      const { c, r } = this.pick(p.worldX, p.worldY);
      this.positionGhost(c, r);
    }

    onPointerDown(p, over) {
      if (p.wasTouch) this.touch = true;
      if (p.rightButtonDown()) { if (this.ghost) this.cancel(); else if (this.edit) this.setEdit(false); else this.clearFocus(); return; }
      if (!this.inMap(p) || over.some((o) => o.isUI)) return;
      if (this.reportShown) this.hideReport();
      const { c, r } = this.pick(p.worldX, p.worldY);
      if (this.ghost) {
        // touch: tap (or drag) previews the spot; tapping it again (or ✓) places
        if (p.wasTouch && this.ghost.tileKey !== c + ',' + r) { this.positionGhost(c, r); return; }
        this.positionGhost(c, r);
        this.tryPlace();
        return;
      }
      const v = this.viewAt(over, c, r, p.wasTouch || this.edit);
      if (!v) { this.clearFocus(); return; }
      if (this.edit) { this.pickUp(v); return; }
      this.tapBuilding(v, p.wasTouch);
    }

    // PLAY tap, in priority order: douse fire > fire at raider > collect > show info
    tapBuilding(v, touch) {
      const b = v.b;
      if (b.burn > 0) return this.douse(v);
      const shot = N.fire(this.state, b.id, this.cov);
      if (shot) return this.shoot(v, shot);
      if (B[b.type].kind === 'defense' && b.cool > 0) return this.floatText(v.x, v.sprite.y - v.sprite.height, 'RELOADING', '#8b9bb4');
      if (E.isReady(b)) return this.collect(v);
      if (this.focus === v && this.focusSticky) return this.clearFocus();
      if (touch) this.setFocus(v, true);
      else this.tweens.add({ targets: v.sprite, x: v.x + 1, duration: 40, yoyo: true, repeat: 1, onComplete: () => v.sprite.setX(v.x) });
    }

    tryPlace() {
      const g = this.ghost;
      if (!g || !g.origin) return;
      if (!g.ok) {
        this.floatText(g.img.x, g.img.y - g.img.height, g.reason, '#e43b44');
        this.tweens.add({ targets: g.img, x: g.img.x + 2, duration: 40, yoyo: true, repeat: 2 });
        return;
      }
      const { c, r } = g.origin;
      const b = g.moving ? Core.place(this.state, g.type, c, r, g.rot, g.moving.id) : E.buy(this.state, g.type, c, r, g.rot);
      if (!b) return;
      if (g.moving) { b.fill = g.moving.fill; b.wait = g.moving.wait; if (g.moving.burn) b.burn = g.moving.burn; }
      this.refreshEval();
      const v = this.addView(b);
      this.rebuildDefenseLights();
      this.dust(v);
      const out = this.eval.get(b.id).output;
      if (out > 0) this.floatText(v.x, v.sprite.y - v.sprite.height, '+' + fmtRate(out) + '/S', this.S.P.coin[B[b.type].cur][0]);
      if (!g.moving) this.orderEvent({ kind: 'build', type: b.type });
      this.save();
      if (g.moving) { this.dropGhost(); return; }
      this.positionGhost(g.at.c, g.at.r, true); // stay in build mode
      this.refreshCards();
    }

    // towers' night coverage belongs to their views; rebuild when towers change
    rebuildDefenseLights() {
      for (const v of [...this.views.values()]) if (B[v.b.type].kind === 'defense') { this.removeView(v.b.id); this.addView(v.b); }
    }

    pickUp(v) {
      const b = { ...v.b };
      this.clearFocus();
      this.removeView(b.id);
      Core.remove(this.state, b.id);
      this.refreshEval();
      if (B[b.type].kind === 'defense') this.rebuildDefenseLights();
      this.makeGhost(b.type, b.rot, b);
    }

    sell(v) {
      if (!v) return;
      const { x, y } = v, wasTower = B[v.b.type].kind === 'defense';
      this.dust(v);
      this.clearFocus();
      this.removeView(v.b.id);
      const ref = E.sell(this.state, v.b.id);
      this.refreshEval();
      if (wasTower) this.rebuildDefenseLights();
      if (ref) this.floatText(x, y - 16, 'SOLD +' + E.fmt(ref.amount), this.S.P.coin[ref.cur][0]);
      this.save();
    }

    dust(v, col = 0xe4a672) {
      const { x, y } = v;
      for (let i = 0; i < 8; i++) {
        const p = this.add.image(x + (Math.random() - 0.5) * 16, y - 2, this.key('px')).setTint(col).setDepth(2550);
        this.tweens.add({ targets: p, x: p.x + (Math.random() - 0.5) * 12, y: y - 4 - Math.random() * 6, alpha: 0, duration: 450, onComplete: () => p.destroy() });
      }
    }

    floatText(x, y, str, color) {
      const t = this.add.image(Math.round(x), Math.round(y), PX.textTex(this, str, { color, outline: this.S.P.worldOutline })).setOrigin(0.5, 1).setDepth(2600);
      this.tweens.add({ targets: t, y: y - 12, duration: 700, ease: 'Cubic.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 500, duration: 300, onComplete: () => t.destroy() });
    }

    banner(str, color) {
      if (this.bannerObj && this.bannerObj.active) this.bannerObj.destroy();
      const t = this.bannerObj = this.add.image(160, TOP + 26, PX.textTex(this, str, { color: color || this.S.P.accent, outline: this.S.P.worldOutline })).setOrigin(0.5, 0).setScrollFactor(0).setDepth(3300);
      this.tweens.add({ targets: t, alpha: 0, delay: 2600, duration: 500, onComplete: () => t.destroy() });
    }

    // ------------------------------------------------------------ collecting
    collect(v) {
      this.combo = this.comboLeft > 0 ? this.combo + 1 : 1;
      const got = E.collect(this.state, v.b.id, this.combo, this.eval);
      if (!got) return;
      this.comboLeft = E.COMBO_WINDOW * 1000;
      const pct = Math.round((E.comboMult(this.combo) - 1) * 100);
      this.comboText.setVisible(this.combo >= 2).setText('COMBO x' + this.combo + (pct ? ' +' + pct + '%' : ''));
      const y0 = v.sprite.y;
      this.tweens.add({ targets: v.sprite, y: y0 - 2, duration: 60, yoyo: true, onComplete: () => v.sprite.setY(y0) });
      const top = v.sprite.y - v.sprite.height;
      this.burst(v.x, top + 4, this.S.P.coin[got.cur]);
      if (got.perfect) { this.burst(v.x, top + 2, ['#fee761', '#ffffff']); this.floatText(v.x, top - 8, 'PERFECT!', '#fee761'); }
      this.floatText(v.x, top, '+' + E.fmt(got.amount), got.perfect ? '#fee761' : this.S.P.coin[got.cur][0]);
      this.orderEvent({ kind: 'collect', type: got.type, cur: got.cur, amount: got.amount, perfect: got.perfect, combo: this.combo });
    }

    burst(x, y, cols) {
      for (let i = 0; i < 7; i++) {
        const p = this.add.image(x, y, this.key('px')).setTint(hex(cols[i % 2])).setDepth(2550);
        const vx = (Math.random() - 0.5) * 30, h = 8 + Math.random() * 10;
        this.tweens.add({ targets: p, x: x + vx, duration: 500 });
        this.tweens.add({ targets: p, y: y - h, duration: 220, ease: 'Quad.easeOut', yoyo: true, onComplete: () => p.destroy() });
      }
    }

    douse(v) {
      const left = N.douse(this.state, v.b.id);
      if (left == null) return;
      for (let i = 0; i < 6; i++) {
        const p = this.add.image(v.x + (Math.random() - 0.5) * 10, v.sprite.y - 10, this.key('px')).setTint(0x2ce8f5).setDepth(2550);
        this.tweens.add({ targets: p, y: p.y + 6 + Math.random() * 6, alpha: 0, duration: 400, onComplete: () => p.destroy() });
      }
      const y0 = v.sprite.y;
      this.tweens.add({ targets: v.sprite, y: y0 + 1, duration: 40, yoyo: true, onComplete: () => v.sprite.setY(y0) });
      this.floatText(v.x, v.sprite.y - v.sprite.height - 4, left ? String(left) : 'PUT OUT!', '#2ce8f5');
      this.syncFlame(v);
      if (!left) this.save();
    }

    // ------------------------------------------------------------ orders
    orderEvent(evt) {
      const res = O.record(this.state, evt);
      if (!res) return;
      this.banner('ORDER DONE! +' + E.fmt(res.reward) + ' BRONZE', '#63c74d');
      this.time.delayedCall(2500, () => { if (this.state.cycle.phase === 'day' && !this.state.orders.active) O.next(this.state); });
    }
    buildOrderCard() {
      const P = this.S.P;
      this.orderCard = {
        g: this.add.graphics().setScrollFactor(0).setDepth(3000),
        l1: new PixelText(this, 0, 0, '', { color: P.accent, outline: P.textOutline }).setOrigin(0).setScrollFactor(0).setDepth(3001),
        l2: new PixelText(this, 0, 0, '', { color: P.text, outline: P.textOutline }).setOrigin(0).setScrollFactor(0).setDepth(3001),
        icon: this.add.image(0, 0, this.key('ico-bronze')).setOrigin(0).setScrollFactor(0).setDepth(3001),
      };
    }
    refreshOrderCard() {
      const oc = this.orderCard, a = this.state.orders.active, show = !!a && this.state.cycle.phase === 'day';
      oc.g.setVisible(show); oc.l1.setVisible(show); oc.l2.setVisible(show); oc.icon.setVisible(show);
      if (!show) return;
      oc.l1.setText('ORDER: ' + a.text);
      oc.l2.setText(O.progressText(a) + '   +' + E.fmt(a.reward));
      const w = Math.max(oc.l1.width, oc.l2.width + 10) + 6, h = 20;
      const x = this.side === 'left' ? 318 - w : (this.drawerOpen ? DW + 2 : 2), y = TOP + 2;
      if (oc.w !== w || oc.x !== x) {
        oc.w = w; oc.x = x;
        oc.g.clear().fillStyle(0x181425, 0.85).fillRect(x, y, w, h).fillStyle(0x63c74d, 1).fillRect(x, y, 1, h);
      }
      oc.l1.setPosition(x + 3, y + 2); oc.l2.setPosition(x + 3, y + 11);
      oc.icon.setPosition(x + 3 + oc.l2.width + 1, y + 10);
    }

    // ------------------------------------------------------------ raiders
    laneOf(r) { const L = this.S.lanes; return L[r.lane % L.length]; }
    raiderPos(r) {
      const L = this.laneOf(r), t = r.progress;
      return { x: Math.round(L.sx + (L.tx - L.sx) * t), y: Math.round(L.sy + (L.ty - L.sy) * t) };
    }
    spawnRaiders() {
      this.clearRaiders();
      for (const r of this.state.cycle.raiders) {
        if (r.status !== 'coming') continue;
        const L = this.laneOf(r), pos = this.raiderPos(r);
        const sc = r.boss ? 2 : 1;             // war canoe: whole-number scale keeps pixels crisp
        const img = this.add.image(pos.x, pos.y, this.key('canoe')).setDepth(6).setFlipX(L.tx < L.sx).setScale(sc);
        const pips = r.seq.map((c) => this.add.image(0, 0, this.key(c === 'tower' ? 'cat-defense' : 'ico-' + c)).setDepth(2210));
        const eyes = [6, 11, 15].map(() => this.add.image(0, 0, this.key('light-eye')).setBlendMode(Phaser.BlendModes.ADD).setDepth(2150).setScale(sc));
        const rv = { r, img, pips, eyes, sc, pipsAbove: L.sy > 40 };
        img.setAlpha(0);
        this.tweens.add({ targets: img, alpha: 1, duration: 800 });
        this.raiders.set(r.id, rv);
        this.syncRaider(rv);
      }
    }
    clearRaiders() {
      for (const rv of this.raiders.values()) for (const o of [rv.img, ...rv.pips, ...rv.eyes]) { this.tweens.killTweensOf(o); o.destroy(); }
      this.raiders.clear();
    }
    syncRaider(rv) {
      const r = rv.r, pos = this.raiderPos(r);
      rv.img.setPosition(pos.x, pos.y + (Math.floor(this.time.now / 450 + r.id) & 1));
      const n = r.seq.length, py = rv.pipsAbove ? pos.y - 9 - 5 * rv.sc : pos.y + 6 + 5 * rv.sc;
      rv.pips.forEach((p, i) => {
        p.setPosition(Math.round(pos.x + (i - (n - 1) / 2) * 9), py);
        if (i < r.hit) p.setAlpha(0.25).setTint(0x3a4466);
        else if (i === r.hit) p.setAlpha(Math.floor(this.time.now / 250) & 1 ? 1 : 0.55).clearTint();
        else p.setAlpha(1).clearTint();
      });
      rv.eyes.forEach((e, i) => {
        const ex = ([6, 11, 15][i] + 1 - 11) * rv.sc;
        e.setPosition(Math.round(pos.x + (rv.img.flipX ? -ex : ex)), pos.y - 3 * rv.sc).setAlpha(this.night ? rv.img.alpha : 0);
      });
    }

    shoot(v, shot) {
      const rv = this.raiders.get(shot.raider);
      if (v.bubble) v.bubble.setVisible(false);
      if (v.aim) v.aim.setVisible(false);
      // the bolt leaves from the nearest watchtower (or the tapped tower itself)
      const isTower = B[v.b.type].kind === 'defense';
      let src = v, bd = isTower ? -1 : 1e9;
      if (!isTower) for (const t of this.views.values()) {
        if (B[t.b.type].kind !== 'defense') continue;
        const d = Phaser.Math.Distance.Between(v.x, v.y, t.x, t.y);
        if (d < bd) { bd = d; src = t; }
      }
      const sx = src.sprite.x, sy = src.sprite.y - src.sprite.height + 6;
      const tgt = rv ? rv.img : { x: v.x, y: v.y };
      const bolt = this.add.image(sx, sy, this.key('bolt')).setBlendMode(Phaser.BlendModes.ADD).setDepth(2200);
      this.burst(v.x, v.sprite.y - v.sprite.height + 4, isTower ? ['#2ce8f5', '#ffffff'] : this.S.P.coin[B[v.b.type].cur]);
      this.tweens.add({
        targets: bolt, x: tgt.x, y: tgt.y, duration: 160 + Phaser.Math.Distance.Between(sx, sy, tgt.x, tgt.y) * 2,
        onComplete: () => {
          bolt.destroy();
          if (!rv) return;
          rv.img.setTintFill(0xffffff);
          this.time.delayedCall(70, () => rv.img.active && rv.img.clearTint());
          this.burst(rv.img.x, rv.img.y, ['#ffffff', '#a0e8ff']);
          if (shot.sunk) this.sinkRaider(rv, shot.loot);
        },
      });
      this.combo = this.comboLeft > 0 ? this.combo + 1 : 1;
      this.comboLeft = E.COMBO_WINDOW * 1000;
      this.comboText.setVisible(this.combo >= 2).setText('VOLLEY x' + this.combo);
    }

    sinkRaider(rv, loot) {
      const { img } = rv;
      this.floatText(img.x, img.y - 6, 'SUNK! +' + bag(loot), '#fee761');
      for (const o of [img, ...rv.pips]) this.tweens.add({ targets: o, y: '+=5', alpha: 0, duration: 700, onComplete: () => o.destroy() });
      rv.eyes.forEach((e) => e.destroy());
      this.raiders.delete(rv.r.id);
    }

    landRaider(ev) {
      const rv = this.raiders.get(ev.raider);
      if (rv) {
        this.floatText(rv.img.x, rv.img.y - 8, 'RAIDED! -' + (bag(ev.stolen) || '0'), '#e43b44');
        for (const o of [rv.img, ...rv.pips]) this.tweens.add({ targets: o, alpha: 0, duration: 900, delay: 300, onComplete: () => o.destroy() });
        rv.eyes.forEach((e) => e.destroy());
        this.raiders.delete(ev.raider);
      }
      if (ev.fire) {
        const v = this.views.get(ev.fire);
        if (v) { this.syncFlame(v); this.floatText(v.x, v.sprite.y - v.sprite.height, 'FIRE! TAP x' + N.BURN_TAPS, '#f77622'); }
      }
      this.cameras.main.shake(180, 0.004);
    }

    // ------------------------------------------------------------ day / night
    buildNight() {
      const P = this.S.P;
      this.nightOverlay = this.add.rectangle(-20, 0, 360, 180, P.nightTint).setOrigin(0).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(2000);
      this.fireflies = [];
      for (let i = 0; i < 12; i++) {
        const f = this.add.image(60 + Math.random() * 200, 40 + Math.random() * 110, this.key('light-dot')).setBlendMode(Phaser.BlendModes.ADD).setDepth(2160);
        f.base = { x: f.x, y: f.y, ph: Math.random() * 6.28 };
        this.fireflies.push(f);
      }
    }

    setNight(on, instant) {
      this.night = on;
      const objs = [this.nightOverlay, ...this.fireflies];
      for (const v of this.views.values()) objs.push(...v.lights);
      this.tweens.killTweensOf(objs);
      for (const o of objs) {
        const target = on ? (o.nightAlpha ?? 1) : 0;
        if (instant) o.setAlpha(target); else this.tweens.add({ targets: o, alpha: target, duration: 1500 });
      }
    }

    onCycle(ev) {
      if (ev.type === 'burn') {
        const v = this.views.get(ev.id);
        if (v) this.floatText(v.x + 6, v.sprite.y - v.sprite.height + 4, '-' + E.fmt(ev.amount), '#e43b44');
        return;
      }
      if (ev.type === 'spread') {
        const v = this.views.get(ev.id);
        if (v) { this.syncFlame(v); this.floatText(v.x, v.sprite.y - v.sprite.height - 6, 'FIRE SPREAD!', '#f77622'); }
        return;
      }
      if (ev.type !== 'land' && !this.ghost) this.clearFocus();
      if (ev.type === 'dusk') {
        this.wasOpen = this.drawerOpen;
        this.setDrawer(false);
        this.setNight(true);
        this.spawnRaiders();
        const boss = this.state.cycle.raiders.some((r) => r.boss);
        this.banner(boss ? 'WAR CANOE SPOTTED! GUARD YOUR COAST' : 'RAIDERS SPOTTED! GUARD YOUR COAST', '#f77622');
      } else if (ev.type === 'night') {
        this.banner(this.touch ? 'TAP GUARDED BUILDINGS TO FIRE' : 'CLICK GUARDED BUILDINGS TO FIRE', '#2ce8f5');
      } else if (ev.type === 'land') {
        this.landRaider(ev);
      } else if (ev.type === 'dawn') {
        this.setNight(false);
        this.time.delayedCall(900, () => this.clearRaiders());
        this.showReport(ev.report);
      } else if (ev.type === 'day') {
        this.hideReport();
        if (this.wasOpen) this.setDrawer(true);
        this.banner('DAY ' + ev.day);
        O.next(this.state);
      }
      this.save();
    }

    skipPhase() {
      for (const ev of N.skip(this.state, this.S.lanes.length)) this.onCycle(ev);
    }

    showReport(rep) {
      if (!rep) return;
      const P = this.S.P, cy = this.state.cycle;
      this.hideReport();
      const lines = [
        ['DAWN - DAY ' + cy.day + ' SURVIVED', P.accent],
        ['SUNK ' + rep.sunk + '   LANDED ' + rep.landed, P.text],
        ['LOOT ' + (bag(rep.loot) || '-'), '#63c74d'],
        ['LOST ' + (bag(rep.stolen) || '-') + (rep.fires ? '  FIRES ' + rep.fires : ''), rep.landed ? '#e43b44' : P.dim],
      ];
      const objs = [];
      const g = this.add.graphics().setScrollFactor(0).setDepth(3600);
      const w = 150, h = 48, x = 85, y = 60;
      g.fillStyle(0x181425, 0.94).fillRect(x, y, w, h).fillStyle(hex(P.panel.light), 1)
        .fillRect(x, y, w, 1).fillRect(x, y + h - 1, w, 1).fillRect(x, y, 1, h).fillRect(x + w - 1, y, 1, h);
      objs.push(g);
      lines.forEach(([s, c], i) => objs.push(this.add.image(160, y + 5 + i * 10, PX.textTex(this, s, { color: c, outline: P.textOutline })).setOrigin(0.5, 0).setScrollFactor(0).setDepth(3601)));
      this.reportObjs = objs; this.reportShown = true;
    }
    hideReport() {
      for (const o of this.reportObjs || []) o.destroy();
      this.reportObjs = []; this.reportShown = false;
    }

    // ------------------------------------------------------------ drawer
    buildDrawer() {
      const k = this.key, P = this.S.P;
      this.drawer = { objs: [], cards: [] };
      const d = this.drawer, x0 = this.drawerX();
      const ui = (o) => { o.isUI = true; o.setScrollFactor(0); d.objs.push(o); return o; };
      ui(this.add.image(x0, TOP, k('drawer')).setOrigin(0).setDepth(3000).setInteractive());
      d.tabs = CATS.map((cat, i) => {
        const tx = x0 + 1 + (i % 2) * 12, ty = TOP + 2 + Math.floor(i / 2) * 12;
        const bg = ui(this.add.image(tx, ty, k('tab')).setOrigin(0).setDepth(3001).setInteractive({ cursor: 'pointer' }));
        ui(this.add.image(tx + 6, ty + 6, k(cat.icon)).setDepth(3002));
        bg.on('pointerdown', () => { this.cat = cat.id; this.buildCards(); });
        bg.on('pointerover', (p) => { if (!p.wasTouch && !this.ghost) this.showDock({ lines: [cat.name] }); });
        bg.on('pointerout', (p) => { if (!p.wasTouch && !this.ghost) this.dockIdle(); });
        return { cat: cat.id, bg };
      });
      // EDIT toggle
      d.editBtn = ui(this.add.image(x0 + 1, TOP + 27, k('editbtn')).setOrigin(0).setDepth(3001).setInteractive({ cursor: 'pointer' }));
      ui(new PixelText(this, x0 + 13, TOP + 30, 'EDIT', { color: P.text, outline: P.textOutline }).setOrigin(0.5, 0).setDepth(3002));
      d.editBtn.on('pointerdown', () => this.setEdit(!this.edit));
      const hb = ui(this.add.image(x0 + 1, 180 - 11, k('handle')).setOrigin(0).setDepth(3001).setInteractive({ cursor: 'pointer' }));
      ui(new PixelText(this, x0 + 13, 180 - 9, this.side === 'left' ? '<<' : '>>', { color: P.text, outline: P.textOutline }).setOrigin(0.5, 0).setDepth(3002));
      hb.on('pointerdown', () => this.setDrawer(false));
      const px = this.side === 'left' ? 0 : 310;
      d.pull = [
        ui(this.add.image(px, 76, k('pull')).setOrigin(0).setDepth(3001).setInteractive({ cursor: 'pointer' })),
        ui(new PixelText(this, px + 5, 87, this.side === 'left' ? '>' : '<', { color: P.text, outline: P.textOutline }).setOrigin(0.5, 0).setDepth(3002)),
      ];
      d.pull[0].on('pointerdown', () => this.setDrawer(true));
      this.buildCards();
    }

    buildCards() {
      const d = this.drawer, k = this.key, S = this.S, x0 = this.drawerX();
      for (const c of d.cards) for (const o of c.objs) o.destroy();
      d.cards = [];
      for (const t of d.tabs) t.bg.setTexture(k(t.cat === this.cat ? 'tab-sel' : 'tab'));
      const cat = CATS.find((c) => c.id === this.cat);
      cat.types.forEach((type, j) => {
        const x = x0 + 1, y = TOP + 40 + j * 23, objs = [];
        const ui = (o) => { o.isUI = true; o.setScrollFactor(0); objs.push(o); return o; };
        const bg = ui(this.add.image(x, y, k('card22')).setOrigin(0).setDepth(3001).setInteractive({ cursor: 'pointer' }));
        const tex = this.texFor(type, 0), f = this.textures.getFrame(tex);
        const w = Math.min(f.width, 20), h = Math.min(f.height, 12);
        const cx = Math.floor((f.width - w) / 2), cy = S.art[type].cardCrop != null ? S.art[type].cardCrop : Math.max(0, f.height - h - 2);
        const im = ui(this.add.image(0, 0, tex).setOrigin(0).setDepth(3002).setCrop(cx, cy, w, h));
        im.setPosition(x + 12 - Math.floor(w / 2) - cx, y + 2 - cy);
        const glyph = ui(this.add.image(x + 12, y + 17, this.shapeGlyph(type)).setDepth(3002));
        const info = () => this.showDock({
          lines: [B[type].name, B[type].desc, E.fmt(E.costOf(this.state, type).amount) + (Core.rotations(type).length > 1 ? '  ' + Core.rotations(type).length + ' WAYS' : '')],
          icon: B[type].cost[0],
        });
        bg.on('pointerdown', () => this.selectCard(type));
        bg.on('pointerover', (p) => { if (!p.wasTouch && !this.ghost) info(); });
        bg.on('pointerout', (p) => { if (!p.wasTouch && !this.ghost) this.dockIdle(); });
        d.cards.push({ type, bg, im, glyph, objs });
      });
      this.setDrawer(this.drawerOpen, true);
      this.refreshButtons();
      this.refreshCards();
    }

    setDrawer(open, instant) {
      this.drawerOpen = open;
      const d = this.drawer;
      if (!d) return;
      const all = [...d.objs, ...d.cards.flatMap((c) => c.objs)];
      for (const o of all) if (!d.pull.includes(o)) o.setVisible(open);
      for (const o of d.pull) o.setVisible(!open);
      // keep the island centred in whatever the drawer leaves free
      const target = open ? (this.side === 'left' ? -DW / 2 : DW / 2) : 0;
      const cam = this.cameras.main;
      this.tweens.killTweensOf(cam);
      if (instant) cam.setScroll(Math.round(target), 0);
      else this.tweens.add({ targets: cam, scrollX: target, duration: 180, ease: 'Sine.easeOut', onUpdate: () => cam.setScroll(Math.round(cam.scrollX), 0) });
      this.orderCard && (this.orderCard.w = -1);
      if (this.ghost) this.dockGhost(); else if (this.focus) this.dockForBuilding(this.focus); else this.dockIdle();
    }

    shapeGlyph(type) {
      const key = this.key('shape-' + type);
      const cells = B[type].shape, [bw, bh] = Core.bbox(cells);
      PX.tex(this, key, bw * 3 + 1, bh * 3 + 1, (p) => {
        for (const [c, r] of cells) p.rect(c * 3 + 1, r * 3 + 1, 2, 2, this.S.P.accent);
      }, { outline: this.S.P.textOutline });
      return key;
    }

    refreshButtons() {
      const g = this.ghost;
      if (!this.drawer) return;
      for (const c of this.drawer.cards) c.bg.setTexture(this.key(g && !g.moving && g.type === c.type ? 'card22-sel' : 'card22'));
    }
    refreshCards() {
      if (!this.drawer) return;
      for (const c of this.drawer.cards) {
        const a = E.canAfford(this.state, c.type) ? 1 : 0.4;
        c.im.setAlpha(a); c.glyph.setAlpha(a);
      }
    }

    // ------------------------------------------------------------ top bar
    buildUI() {
      const S = this.S, P = S.P, k = this.key;
      const txt = (x, y, s, color) => new PixelText(this, x, y, s, { color: color || P.text, outline: P.textOutline }).setOrigin(0, 0).setScrollFactor(0).setDepth(3001);
      const top = this.add.image(0, 0, k('panel-top')).setOrigin(0).setScrollFactor(0).setDepth(3000).setInteractive();
      top.isUI = true;
      this.curText = {};
      for (const [c, x] of [['bronze', 3], ['silver', 100], ['gold', 142], ['diamond', 184]]) {
        this.add.image(x, 2, k('ico-' + c)).setOrigin(0).setScrollFactor(0).setDepth(3001);
        this.curText[c] = txt(x + 11, 3, '0');
      }
      this.rateText = txt(60, 3, '', P.accent);
      this.phaseIcon = this.add.image(224, 2, k('ico-sun')).setOrigin(0).setScrollFactor(0).setDepth(3001);
      this.phaseText = txt(235, 3, '', P.accent);
      this.phaseBar = this.add.graphics().setScrollFactor(0).setDepth(3002);

      this.comboText = new PixelText(this, 160, TOP + 4, 'COMBO x2', { color: P.accent, outline: P.worldOutline, scale: 2 }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(3001).setVisible(false);
      this.comboBar = this.add.graphics().setScrollFactor(0).setDepth(3001);
      this.buildOrderCard();
      this.buildDock();
      this.buildDrawer();
    }

    refreshPhase() {
      const cy = this.state.cycle;
      const coming = cy.raiders.filter((r) => r.status === 'coming');
      let label, frac, col;
      if (cy.phase === 'day') { label = 'DAY ' + cy.day + ' ' + clock(N.DAY_LEN - cy.t); frac = 1 - cy.t / N.DAY_LEN; col = 0xfee761; }
      else if (cy.phase === 'dusk') { label = 'DUSK ' + clock(N.DUSK_LEN - cy.t); frac = 1 - cy.t / N.DUSK_LEN; col = 0xf77622; }
      else if (cy.phase === 'night') { label = 'NIGHT ' + cy.day + ' ' + coming.length + ' LEFT'; frac = 1 - Math.max(0, ...coming.map((r) => r.progress)); col = 0xe43b44; }
      else { label = 'DAWN'; frac = 1; col = 0xead4aa; }
      this.phaseText.setText(label);
      this.phaseIcon.setTexture(this.key(cy.phase === 'day' || cy.phase === 'dawn' ? 'ico-sun' : 'ico-moon'));
      this.phaseBar.clear().fillStyle(col, 1).fillRect(0, TOP - 1, Math.round(320 * Math.max(0, frac)), 1);
    }

    update(time, dt) {
      const sec = Math.min(dt, 250) / 1000;
      E.tick(this.state, sec, this.eval);
      for (const ev of N.step(this.state, sec, this.S.lanes.length)) this.onCycle(ev);

      const night = this.state.cycle.phase === 'night';
      const blink = Math.floor(time / 90) & 1;
      for (const v of this.views.values()) {
        if (!v.bubble) { if (v.aim) v.aim.setVisible(night && !!N.targetFor(this.state, v.b, this.cov)); continue; }
        const ready = E.isReady(v.b) && !(v.b.burn > 0);
        v.bubble.setVisible(ready);
        // PERFECT window: the bubble flashes gold right after it fills
        if (ready && E.isRipe(v.b)) v.bubble.setTint(blink ? 0xfee761 : 0xffffff); else v.bubble.clearTint();
        v.aim.setVisible(ready && night && !!N.targetFor(this.state, v.b, this.cov));
      }
      for (const rv of this.raiders.values()) this.syncRaider(rv);
      const w = this.state.wallet;
      for (const c of E.CURRENCIES) this.curText[c].setText(E.fmt(w[c]));
      this.rateText.setX(this.curText.bronze.x + this.curText.bronze.width + 3).setText('+' + fmtRate(this.rates.bronze || 0) + '/S');
      this.refreshPhase();
      this.refreshOrderCard();

      this.antsG.clear();
      if (this.ants) this.dotPerimeter(this.antsG, this.ants.set, this.ants.col, Math.floor(time / 120));

      if (this.comboLeft > 0) {
        this.comboLeft -= dt;
        if (this.comboLeft <= 0) { this.combo = 0; this.comboText.setVisible(false); }
      }
      this.comboBar.clear();
      if (this.combo >= 2) {
        const bw = Math.ceil(40 * this.comboLeft / (E.COMBO_WINDOW * 1000));
        this.comboBar.fillStyle(0x000000, 0.6).fillRect(139, TOP + 19, 42, 3);
        this.comboBar.fillStyle(hex(this.S.P.accent), 1).fillRect(140, TOP + 20, bw, 1);
      }

      if (this.night) {
        for (const v of this.views.values()) for (const l of v.lights) if (l.flicker) l.setAlpha(0.8 + Math.random() * 0.2);
        const s = time / 1000;
        for (const f of this.fireflies) {
          f.setPosition(Math.round(f.base.x + Math.sin(s * 0.7 + f.base.ph) * 10), Math.round(f.base.y + Math.cos(s * 0.9 + f.base.ph) * 6));
          f.setAlpha(Math.sin(s * 3 + f.base.ph) > 0 ? 1 : 0.2);
        }
      }
    }
  }

  window.GameScene = GameScene;
})();
