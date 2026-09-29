// scene.js — renders the core state (src/core/*) in the Sunlit 3/4 style and turns
// mouse, keyboard and touch input into core calls. Rules, money, the day/night
// loop, orders, the merchant and fishing live in Core / Economy / Night / Orders /
// Merchant / Fishing; this file only draws and routes input.
//
// The canvas is the whole screen at device resolution (one game pixel = one
// device pixel). Two cameras: the world camera pans (drag) and zooms smoothly
// (pinch / wheel), then settles on a whole-number zoom so pixels stay crisp; the
// UI camera draws every scrollFactor-0 object at a whole-number scale US, in a
// layout of UW x UH UI pixels (at least 320x180, wider or taller to fit the
// screen). Rotating the device or resizing the window rebuilds the UI to fit.
//
// Modes:
//   PLAY  taps collect (PERFECT if right as it fills), reel in fish, fire at
//         raiders at night, or put out fires. Hold a building to start editing.
//   EDIT  (menu rail, E, holding a building, or right-click one) drag buildings
//         to move them; the selected one can be rotated, upgraded or sold from
//         the dock. Tap empty space to finish.
// All info and actions live in one docked panel in the bottom corner opposite
// the menu, so nothing pops up on top of the buildings you're looking at.
(function () {
  'use strict';
  const { PixelText } = PX;
  const B = Core.BUILDINGS, E = Economy, N = Night, O = Orders, M = Merchant, F = Fishing;
  const ITEMS = ['bucket', 'net', 'cannon'];
  const ORDER = ['hut', 'farm', 'longhouse', 'workshop', 'plantation', 'market', 'tower', 'idol'];
  const CATS = [
    { id: 'income', icon: 'ico-bronze', name: 'INCOME', types: ['hut', 'farm', 'longhouse', 'workshop', 'plantation'] },
    { id: 'boost', icon: 'cat-boost', name: 'BOOST', types: ['market'] },
    { id: 'defense', icon: 'cat-defense', name: 'DEFENSE', types: ['tower'] },
    { id: 'trap', icon: 'cat-trap', name: 'TRAPS', types: ['idol'] },
    { id: 'land', icon: 'cat-land', name: 'LAND', types: [] },
  ];
  const SAVE_KEY = 'itc-save-v1';
  const TOP = 14, RAIL = 20, DW = 26;          // top bar height, menu rail width, build drawer width
  // set by layout() from the screen size: UI layout size and scale, world zoom range
  let UW = 320, UH = 180, US = 2, ZMIN = 1, ZMAX = 3, ZSTART = 2;
  const HOLD_MS = 450, DRAG_PX = 10;           // long-press time; movement (game px) that starts a drag
  const LETTER = { bronze: 'B', silver: 'S', gold: 'G', diamond: 'D' };
  const RARITY = { COMMON: '#c0cbdc', UNCOMMON: '#63c74d', RARE: '#2ce8f5', LEGENDARY: '#feae34' };
  const fmtMult = (m) => 'x' + (Math.round(m * 100) / 100);
  const fmtRate = (n) => (n < 10 ? String(Math.round(n * 100) / 100) : E.fmt(n));
  const clock = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const bag = (o) => Object.entries(o || {}).map(([c, v]) => E.fmt(v) + LETTER[c]).join(' ');
  const hex = (c) => Phaser.Display.Color.HexStringToColor(c).color;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isUI = (o) => o.scrollFactorX === 0;
  const U = (o) => o.setScrollFactor(0);       // UI objects are exactly the scrollFactor-0 ones

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
      M.restore(this.state, loaded && loaded.raw.items, loaded && loaded.raw.merchant);
      M.ensure(this.state);
      F.restore(this.state, loaded && loaded.raw);

      this.views = new Map(); this.raiders = new Map();
      this.auraObjs = []; this.ants = null; this.focus = null; this.press = null; this.pinch = null;
      this.ghost = null; this.edit = false; this.combo = 0; this.comboLeft = 0; this.modal = null;
      this.touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
      this.side = this.registry.get('drawerSide') === 'right' ? 'right' : 'left';
      this.drawerOpen = false; this.cat = 'income';

      this.setupCameras();
      this.music = window.Soundtrack ? Soundtrack.get() : null;
      this.antsG = this.add.graphics().setDepth(4);
      this.landG = this.add.graphics().setDepth(4);
      this.rippleG = this.add.graphics().setDepth(6);
      this.decorImgs = S.decor.map((d) => ({ d, img: this.addDecor(d) }));
      this.buildTerrain();

      this.buildNight();
      this.refreshEval();
      for (const b of this.state.buildings) this.addView(b);
      this.buildShip();
      this.buildUI();
      const ph = this.state.cycle.phase;
      this.setNight(ph === 'dusk' || ph === 'night', true);
      if (ph === 'dusk' || ph === 'night') this.spawnRaiders();
      if (ph === 'day' && !this.state.orders.active) O.next(this.state);

      this.input.addPointer(1);                     // second finger for pinch zoom
      this.input.mouse && this.input.mouse.disableContextMenu();
      this.input.on('pointermove', (p) => this.onPointerMove(p));
      this.input.on('pointerdown', (p, over) => this.onPointerDown(p, over));
      this.input.on('pointerup', (p) => this.onPointerUp(p));
      this.input.on('pointerupoutside', (p) => this.onPointerUp(p));
      this.input.on('wheel', (p, over, dx, dy) => {
        if (!dy || this.modal) return;
        if (this.ghost) this.rotate(); else this.zoomBy(dy < 0 ? 1 : -1, p.x, p.y);
      });
      const kb = this.input.keyboard;
      const k = (name, fn) => kb.on('keydown-' + name, (e) => { if (!this.modal) fn(e); });
      k('N', () => this.skipPhase());
      k('G', () => window.IslandGame.toggleGrid());
      k('E', () => this.setEdit(!this.edit));
      k('B', () => this.openBook());
      kb.on('keydown-ESC', () => {
        if (this.modal) this.closeModal();
        else if (this.ghost) this.cancel();
        else if (this.edit) this.setEdit(false);
        else if (this.drawerOpen) this.setDrawer(false);
        else this.clearFocus();
      });
      k('R', () => { if (this.ghost) this.rotate(); else if (this.edit && this.focus) this.rotateSel(this.focus); });
      k('X', () => { if (this.edit && this.focus && !this.ghost) this.sellSel(this.focus); });
      k('TAB', (e) => { e.preventDefault && e.preventDefault(); this.setDrawer(!this.drawerOpen); });
      kb.on('keydown', (e) => {
        if (this.music) this.music.unlock();
        if (this.modal) return;
        if (e.key === '+' || e.key === '=') this.zoomBy(1);
        else if (e.key === '-' || e.key === '_') this.zoomBy(-1);
      });
      ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'].forEach((key, i) => k(key, () => this.selectCard(ORDER[i])));
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

    // ------------------------------------------------------------ cameras
    // UI scale: the biggest whole number that still leaves a 320x180 layout.
    // World zoom: US shows about as much as the UI covers; zooming out stops once
    // the whole sea fits; zooming in goes to 1.5x that.
    layout() {
      const W = this.scale.width, H = this.scale.height, wb = this.S.world;
      US = Math.max(1, Math.floor(Math.min(W / 320, H / 180)));
      UW = Math.floor(W / US); UH = Math.floor(H / US);
      ZSTART = US;
      ZMAX = Math.max(ZSTART + 1, Math.round(US * 1.5));
      ZMIN = Math.min(ZSTART, Math.max(1, Math.ceil(Math.max(W / wb.w, H / wb.h))));
    }
    setupCameras() {
      const cam = this.cameras.main, wb = this.S.world;
      this.layout();
      cam.setBackgroundColor('#124e89');
      cam.setBounds(wb.x0, wb.y0, wb.w, wb.h);
      cam.setZoom(ZSTART);
      cam.centerOn(160, 90);
      this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height).setOrigin(0, 0).setZoom(US);
      this.scale.on('resize', this.onResize, this);
      this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
      // each object is drawn by exactly one camera: UI (scrollFactor 0) or world
      const split = () => {
        const wm = cam.id, um = this.uiCam.id;
        for (const o of this.children.list) o.cameraFilter = isUI(o) ? wm : um;
      };
      this.events.on('prerender', split);
      this.events.once('shutdown', () => this.events.off('prerender', split));
    }
    // pointer (game pixels) -> UI layout / world coordinates
    uiPt(p) { return { x: p.x / US, y: p.y / US }; }
    worldPt(sx, sy) {
      const cam = this.cameras.main, z = cam.zoom, hw = cam.width / 2, hh = cam.height / 2;
      return { x: cam.scrollX + hw - hw / z + sx / z, y: cam.scrollY + hh - hh / z + sy / z };
    }
    // world -> UI layout coordinates (for the dock and the edge markers)
    toUI(wx, wy) {
      const cam = this.cameras.main, z = cam.zoom, hw = cam.width / 2, hh = cam.height / 2;
      const sx = (wx - (cam.scrollX + hw - hw / z)) * z, sy = (wy - (cam.scrollY + hh - hh / z)) * z;
      return { x: sx / US, y: sy / US };
    }
    // the screen changed size (rotation, window resize, browser bars): keep the view
    // centred on the same spot at the same relative zoom, and rebuild the UI if its layout changed
    onResize() {
      const cam = this.cameras.main, W = this.scale.width, H = this.scale.height;
      // the centre remembered from the last frame (the camera may already have been resized)
      const c = this.viewCenter || { x: 160, y: 90 }, rel = cam.zoom / US, before = [UW, UH, US].join();
      if (this.zoomTween) { this.zoomTween.stop(); this.zoomTween = null; }
      this.layout();
      cam.setSize(W, H); this.uiCam.setSize(W, H).setZoom(US);
      cam.setZoom(clamp(Math.round(rel * US), ZMIN, ZMAX)).centerOn(c.x, c.y);
      if ([UW, UH, US].join() !== before) this.rebuildUI();
    }
    rebuildUI() {
      this.closeModal(); this.hideReport(); this.hideCatch();
      for (const o of [...this.children.list]) if (isUI(o)) o.destroy();
      this.bannerObj = null;
      this.buildUI();
    }

    // zoom to z, keeping world point (wx, wy) under screen point (sx, sy)
    setView(z, sx, sy, wx, wy) {
      const cam = this.cameras.main, hw = cam.width / 2, hh = cam.height / 2;
      cam.setZoom(z);
      cam.setScroll(wx - hw + hw / z - sx / z, wy - hh + hh / z - sy / z);
    }
    zoomTo(z, sx, sy) {
      const cam = this.cameras.main;
      if (sx == null) { sx = cam.width / 2; sy = cam.height / 2; }
      const w = this.worldPt(sx, sy);
      z = clamp(z, ZMIN, ZMAX);
      if (this.zoomTween) this.zoomTween.stop();
      const o = { z: cam.zoom };
      this.zoomTarget = z;
      this.zoomTween = this.tweens.add({ targets: o, z, duration: 220, ease: 'Sine.easeOut', onUpdate: () => this.setView(o.z, sx, sy, w.x, w.y), onComplete: () => { this.zoomTween = null; } });
    }
    zoomBy(step, sx, sy) {
      const base = this.zoomTween ? this.zoomTarget : this.cameras.main.zoom;
      this.zoomTo(Math.round(base) + step, sx, sy);
    }
    resetView() {
      if (this.zoomTween) this.zoomTween.stop();
      this.cameras.main.setZoom(ZSTART).centerOn(160, 90);
    }
    startPinch() {
      const a = this.input.pointer1, b = this.input.pointer2;
      if (this.press && this.press.hold) this.press.hold.remove();
      this.press = null;
      if (this.ghost && this.ghost.drag) this.finishDrag(true);
      if (this.zoomTween) { this.zoomTween.stop(); this.zoomTween = null; }
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.pinch = { d0: Math.max(10, Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)), z0: this.cameras.main.zoom, w: this.worldPt(mx, my) };
    }
    updatePinch() {
      const a = this.input.pointer1, b = this.input.pointer2, pc = this.pinch;
      const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      const z = clamp(pc.z0 * d / pc.d0, ZMIN * 0.9, ZMAX * 1.1);
      this.setView(z, (a.x + b.x) / 2, (a.y + b.y) / 2, pc.w.x, pc.w.y);
    }
    endPinch() {
      this.pinch = null;
      this.zoomTo(Math.round(clamp(this.cameras.main.zoom, ZMIN, ZMAX)));   // settle on a crisp whole-number zoom
    }

    // ------------------------------------------------------------ extra UI art
    uiTextures() {
      const P = this.S.P, k = this.key, C = P.card, tex = PX.tex;
      const box = (name, w, h, sel) => tex(this, k(name), w, h, (p) => {
        p.rect(1, 1, w - 2, h - 2, C.fill);
        const b = sel ? C.sel : C.border;
        p.hline(1, w - 2, 0, b); p.hline(1, w - 2, h - 1, b); p.vline(0, 1, h - 2, b); p.vline(w - 1, 1, h - 2, b);
        if (sel) { p.hline(1, w - 2, 1, b); p.hline(1, w - 2, h - 2, b); p.vline(1, 1, h - 2, b); p.vline(w - 2, 1, h - 2, b); }
      });
      for (const sel of [false, true]) {
        const s = sel ? '-sel' : '';
        box('tab' + s, 12, 12, sel); box('card22' + s, 24, 22, sel); box('railbtn' + s, 18, 18, sel);
      }
      const ico = (name, rows, map) => tex(this, k(name), rows[0].length + 2, rows.length + 2, (p) => p.sprite(1, 1, rows, map), { outline: P.iconOutline });
      ico('cat-boost', ['..#..', '.###.', '#####', '..#..', '..#..', '..#..'], { '#': P.up });
      ico('cat-defense', ['#######', '#.....#', '#.###.#', '#.....#', '.#...#.', '..#.#..', '...#...'], { '#': '#2ce8f5', '.': '#0099db' });
      ico('cat-trap', ['.###.', '#####', '#.#.#', '#####', '.#.#.'], { '#': '#b55088', '.': '#ff0044' });
      ico('ico-ok', ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'], { '#': P.up });
      ico('ico-no', ['#...#', '##.##', '.###.', '##.##', '#...#'], { '#': P.down });
      ico('ico-rot', ['.###.', '#...#', '#....', '#..#.', '.###.', '...#.'], { '#': P.text });
      // corner brackets that frame a coin bubble when that building can fire (or reel)
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
    railX() { return this.side === 'left' ? 0 : UW - RAIL; }
    drawerX() { return this.side === 'left' ? RAIL : UW - RAIL - DW; }
    menuW() { return RAIL + (this.drawerOpen ? DW : 0); }
    overMenu(u) { return this.side === 'left' ? u.x < this.menuW() : u.x >= UW - this.menuW(); }
    // only a dock with buttons swallows taps; plain info never blocks the map
    overDock(u) { const t = this.dock; return t && t.visible && t.hasBtns && u.x >= t.x && u.x < t.x + t.w && u.y >= t.y && u.y < t.y + t.h; }
    inMap(u) { return u.y >= TOP && !this.overMenu(u) && !this.overDock(u); }

    // terrain + grid textures follow the island's current tiles (land can be bought)
    buildTerrain() {
      const map = this.state.terrain;
      let h = 0;
      for (const ch of map.join('|')) h = (h * 31 + ch.charCodeAt(0)) | 0;
      const id = (h >>> 0).toString(36), tk = 'sunlit-terrain-' + id, gk = 'sunlit-grid-' + id;
      const oldT = this.terrainKey, oldG = this.gridKey;
      const vis = this.gridObj ? this.gridObj.visible : this.registry.get('grid') !== false;
      if (this.terrainSprite) this.terrainSprite.destroy();
      if (this.gridObj) this.gridObj.destroy();
      this.terrainSprite = this.S.terrain(this, map, tk);
      this.gridObj = this.S.gridOverlay(this, map, gk).setDepth(1).setVisible(vis);
      this.terrainKey = tk; this.gridKey = gk;
      for (const k of [oldT, oldG]) {
        if (!k || k === tk || k === gk) continue;
        if (this.anims.exists(k)) this.anims.remove(k);
        if (this.textures.exists(k)) this.textures.remove(k);
      }
      // palms, rocks and the dock vanish once their tile has been turned into something else
      for (const { d, img } of this.decorImgs) img.setVisible(Core.terrainAt(this.state, d.c, d.r) === this.S.map[d.r][d.c]);
    }

    addDecor(d) {
      const a = { x: this.ox + (d.c + 0.5) * this.T, y: this.oy + (d.r + 1) * this.T };
      const img = this.add.image(a.x + (d.dx || 0), a.y + (d.dy || 0), d.tex).setOrigin(0.5, 1);
      img.setDepth(d.flat ? 5 : 10 + img.y + img.x * 0.001);
      if (d.sway) this.tweens.add({ targets: img, x: img.x + 1, duration: 1400 + Math.random() * 600, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [1], delay: Math.random() * 1000 });
      return img;
    }

    // ------------------------------------------------------------ building views
    addView(b) {
      const art = this.S.art[b.type], a = this.anchor(b.type, b.c, b.r, b.rot), def = B[b.type];
      const tex = this.texFor(b.type, b.rot);
      const sprite = this.add.image(a.x, a.y + (art.dy || 0), tex).setOrigin(0.5, 1).setDepth(10 + a.y + a.x * 0.001);
      const v = { b, sprite, tex, x: a.x, y: a.y, lights: [], pips: [] };
      for (let i = 1; i < Core.levelOf(b); i++) {
        v.pips.push(this.add.image(a.x - Math.floor(sprite.width / 2) + 3 + (i - 1) * 4, a.y - 2, this.key('level')).setDepth(sprite.depth + 0.2));
      }
      sprite.setInteractive({ pixelPerfect: true, alphaTolerance: 1, cursor: 'pointer' });
      sprite.on('pointerover', (p) => { if (!p.wasTouch && !this.ghost && !this.edit) this.setFocus(v, false); });
      sprite.on('pointerout', (p) => { if (!p.wasTouch && this.focus === v && !this.focusSticky && !this.edit) this.clearFocus(); });

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
      for (const o of [v.sprite, v.bubble, v.aim, v.flame, v.flameLight, ...v.lights, ...v.pips]) if (o) { this.tweens.killTweensOf(o); o.destroy(); }
      this.views.delete(id);
    }
    // redraw one building (level pips, rotation, tower coverage) and keep it selected
    redrawView(id) {
      const v = this.views.get(id), sel = this.focus === v;
      if (!v) return null;
      this.removeView(id);
      this.refreshEval();
      if (B[v.b.type].kind === 'defense') this.rebuildDefenseLights(); else this.addView(v.b);
      const nv = this.views.get(id);
      if (sel && nv) this.setFocus(nv, true);
      return nv;
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

    // ------------------------------------------------------------ focus / selection
    // PLAY: focus = hovered (mouse) or tapped-but-not-ready (touch) building: highlight,
    // aura and its numbers in the dock; sticky focus (from a tap) fades after a while.
    // EDIT: focus is the selected building, with rotate / upgrade / sell in the dock.
    setFocus(v, sticky) {
      if (this.ghost || !v) return;
      if (this.focus && this.focus !== v) this.clearFocus();
      this.focus = v; this.focusSticky = !!sticky;
      if (this.sellArmed !== v.b.id) this.sellArmed = null;
      if (!(v.b.burn > 0)) {
        if (this.textures.exists(v.tex + '-hl')) v.sprite.setTexture(v.tex + '-hl');
        else v.sprite.setTint(0xfff4c0);
      }
      this.showAura(v.b, this.effectsFrom(v.b.id));
      this.dockForBuilding(v);
      if (this.focusTimer) this.focusTimer.remove();
      if (sticky && !this.edit) this.focusTimer = this.time.delayedCall(4000, () => { if (this.focus === v && !this.edit) this.clearFocus(); });
    }
    clearFocus() {
      const v = this.focus;
      this.focus = null; this.focusSticky = false; this.sellArmed = null;
      if (v && v.sprite.active) { v.sprite.setTexture(v.tex); if (!(v.b.burn > 0)) v.sprite.clearTint(); }
      this.clearAura();
      if (!this.ghost) this.dockIdle();
    }

    dockForBuilding(v) {
      const b = v.b, d = B[b.type], e = this.eval.get(b.id), name = d.name + (Core.levelOf(b) > 1 ? ' LV' + Core.levelOf(b) : '');
      let l3 = d.cur ? fmtMult(e.mult) + ' = ' + fmtRate(e.output) + '/S' : d.kind === 'defense' ? 'GUARDS AT NIGHT' : 'NO INCOME ITSELF';
      let icon = d.cur || null;
      if (b.burn > 0) { l3 = 'FIRE! TAP x' + b.burn; icon = null; }
      else if (d.cur && N.isCovered(this.state, b, this.cov)) l3 += ' GUARDED';
      if (!this.edit) { this.showDock({ lines: [name, d.desc, l3], icon, near: v }); return; }
      const btns = [];
      if (Core.rotations(b.type).length > 1) btns.push({ icon: 'ico-rot', fn: () => this.rotateSel(this.focus) });
      const up = E.upgradeCost(b);
      if (up) btns.push({ label: 'UP ' + E.fmt(up.amount) + 'S', fn: () => this.upSel(this.focus), tone: this.state.wallet.silver.gte(up.amount) ? 'ok' : 'off' });
      const ref = E.refundFor(this.state, b);
      btns.push({ label: this.sellArmed === b.id ? '+' + ref.map((p) => E.fmt(p.amount) + LETTER[p.cur]).join(' ') + '?' : 'SELL', fn: () => this.sellSel(this.focus), tone: 'danger' });
      btns.push({ icon: 'ico-ok', fn: () => this.clearFocus(), tone: 'ok' });
      this.showDock({ lines: [name, l3, (this.touch ? 'DRAG' : 'DRAG / RIGHT-CLICK') + ' TO MOVE'], btns, near: v });
    }

    // selected building (edit mode): rotate in place, upgrade, sell
    rotateSel(v) {
      if (!v) return;
      const b = v.b, rots = Core.rotations(b.type);
      if (rots.length < 2) return;
      for (let i = 1; i < rots.length; i++) {
        const rot = rots[(rots.indexOf(b.rot) + i) % rots.length];
        for (const [dc, dr] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1]]) {
          if (!Core.canPlace(this.state, b.type, b.c + dc, b.r + dr, rot, b.id).ok) continue;
          b.rot = rot; b.c += dc; b.r += dr;
          const nv = this.redrawView(b.id);
          if (nv) this.dust(nv);
          this.save();
          return;
        }
      }
      this.floatText(v.x, v.sprite.y - v.sprite.height, 'NO ROOM TO TURN', '#e43b44');
    }
    upSel(v) {
      if (!v) return;
      const paid = E.upgrade(this.state, v.b);
      if (!paid) { this.floatText(v.x, v.sprite.y - v.sprite.height, 'NEED SILVER', '#e43b44'); return; }
      const nv = this.redrawView(v.b.id) || v;
      this.floatText(nv.x, nv.sprite.y - nv.sprite.height, 'LEVEL ' + v.b.level + '!', '#fee761');
      this.burst(nv.x, nv.sprite.y - nv.sprite.height + 6, ['#fee761', '#ffffff']);
      this.save();
    }
    sellSel(v) {
      if (!v) return;
      if (this.sellArmed !== v.b.id) { this.sellArmed = v.b.id; this.dockForBuilding(v); return; }
      this.sellArmed = null;
      this.sell(v);
    }

    // ------------------------------------------------------------ the dock
    buildDock() {
      const P = this.S.P;
      const t = this.dock = { visible: false, x: 0, y: 0, w: 0, h: 0 };
      t.g = U(this.add.graphics().setDepth(3500));
      t.lines = [0, 1, 2, 3].map((i) => U(new PixelText(this, 0, 0, '', { color: [P.accent, P.text, P.dim, P.text][i], outline: P.textOutline }).setOrigin(0).setDepth(3501)));
      t.icon = U(this.add.image(0, 0, this.key('ico-bronze')).setOrigin(0).setDepth(3501));
      t.btns = [0, 1, 2, 3, 4].map(() => {
        const zone = U(this.add.zone(0, 0, 10, 10).setOrigin(0).setDepth(3502));
        const label = U(new PixelText(this, 0, 0, '', { color: P.text, outline: P.textOutline }).setOrigin(0).setDepth(3503));
        const icon = U(this.add.image(0, 0, this.key('ico-ok')).setDepth(3503));
        const bt = { zone, label, icon, fn: null };
        zone.on('pointerdown', () => { if (bt.fn) bt.fn(); });
        return bt;
      });
      this.hideDock();
    }

    // o: { lines, icon, btns: [{ label | icon, fn, tone: 'ok'|'danger'|'off'|null }], near: {x,y} in world (dock hops away from it) }
    showDock(o) {
      const t = this.dock, P = this.S.P;
      if (!t) return;
      const lines = o.lines.filter((x) => x != null).slice(0, t.lines.length);
      t.lines.forEach((pt, i) => pt.setText(lines[i] || '').setVisible(i < lines.length));
      const iconW = o.icon ? 10 : 0;
      const btns = (o.btns || []).slice(0, t.btns.length);
      const bw = btns.map((b, i) => (b.icon ? 16 : t.btns[i].label.setText(b.label).width + 8));
      let w = Math.max(40, ...t.lines.map((pt, i) => (i < lines.length ? pt.width + (i === lines.length - 1 ? iconW : 0) : 0))) + 6;
      w = Math.max(w, bw.reduce((a, x) => a + x + 2, 0) + 4);
      const h = lines.length * 8 + 4 + (btns.length ? 15 : 0);
      // bottom corner opposite the menu; hop to the other corner if it would cover `near`
      const left = this.side === 'left', mw = this.menuW();
      const leftX = (left ? mw : 0) + 2, rightX = (left ? UW : UW - mw) - 2 - w;
      let x = left ? rightX : leftX;
      const y = UH - 2 - h;
      if (o.near) {
        const n = this.toUI(o.near.x, o.near.y);
        if (n.x > x - 8 && n.x < x + w + 8 && n.y > y - 4) x = x === rightX ? leftX : rightX;
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
        this.drawBtn(t.g, bx, by, bw[i], b.tone);
        if (b.icon) bt.icon.setTexture(this.key(b.icon)).setPosition(bx + 8, by + 6).setAlpha(b.tone === 'off' ? 0.4 : 1);
        else bt.label.setPosition(bx + 4, by + 3);
        bt.zone.setPosition(bx - 1, by - 3).setSize(bw[i] + 2, 16);
        bx += bw[i] + 2;
      });
    }
    drawBtn(g, x, y, w, tone) {
      const fill = tone === 'danger' ? 0xa22633 : tone === 'ok' ? 0x3e8948 : tone === 'off' ? 0x3a4466 : 0x733e39;
      g.fillStyle(fill, 1).fillRect(x, y, w, 12);
      g.fillStyle(hex(this.S.P.panel.light), 0.6).fillRect(x, y, w, 1);
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
      if (this.shopOpen) return this.dockShop(true);
      if (this.edit) {
        this.showDock({ lines: ['EDIT MODE', 'DRAG A BUILDING TO MOVE IT', (this.touch ? 'TAP' : 'CLICK') + ' EMPTY SPACE TO FINISH'], btns: [{ label: 'DONE', fn: () => this.setEdit(false), tone: 'ok' }] });
      } else if (this.landMode()) {
        const cost = E.landCost(this.state);
        this.showDock({ lines: ['BUY LAND', 'TAP A DOTTED TILE NEXT TO THE ISLAND', 'NEXT TILE ' + E.fmt(cost.amount)], icon: 'bronze' });
      } else this.hideDock();
    }

    // ------------------------------------------------------------ edit mode
    setEdit(on) {
      if (this.ghost) this.cancel();
      this.clearFocus();
      if (on && this.drawerOpen) this.setDrawer(false);
      this.edit = on;
      this.gridObj.setVisible(on || this.registry.get('grid') !== false);
      this.refreshRail();
      if (on) this.banner('EDIT MODE', '#fee761');
      this.landSel = null;
      this.drawLand();
      this.dockIdle();
    }

    // ------------------------------------------------------------ land (build menu, LAND tab)
    landMode() { return this.drawerOpen && this.cat === 'land' && !this.edit; }
    drawLand() {
      const g = this.landG;
      g.clear();
      if (!this.landMode() || this.ghost) return;
      const st = this.state;
      for (let r = 0; r < st.rows; r++) for (let c = 0; c < st.cols; c++) {
        const opt = E.landOption(st, c, r);
        if (!opt) continue;
        const set = new Map([[c + ',' + r, [c, r]]]);
        const sel = this.landSel && this.landSel.c === c && this.landSel.r === r;
        this.dotPerimeter(g, set, sel ? 0xfee761 : (opt.to === 'g' ? 0x63c74d : 0xead4aa), sel ? 1 : 0);
        if (sel) { const t = this.tileXY(c, r); g.fillStyle(0xfee761, 0.25).fillRect(t.x, t.y, this.T, this.T); }
      }
    }
    selectLand(c, r) {
      const opt = E.landOption(this.state, c, r);
      if (!opt) return;
      this.landSel = { c, r };
      this.drawLand();
      const cost = E.landCost(this.state), ok = this.state.wallet.bronze.gte(cost.amount);
      this.showDock({
        lines: ['BUY LAND', opt.to === 'g' ? 'SAND -> GRASS (BUILDABLE)' : 'SEA -> SAND', E.fmt(cost.amount)], icon: 'bronze',
        btns: [{ label: 'BUY', fn: () => this.buyLand(c, r), tone: ok ? 'ok' : 'off' }, { icon: 'ico-no', fn: () => { this.landSel = null; this.drawLand(); this.dockIdle(); } }],
        near: { x: this.ox + c * this.T + 8, y: this.oy + r * this.T + 16 },
      });
    }
    buyLand(c, r) {
      const res = E.buyLand(this.state, c, r);
      if (!res) { this.floatText(this.ox + c * this.T + 8, this.oy + r * this.T, 'TOO POOR', '#e43b44'); return; }
      this.buildTerrain();
      this.refreshEval();
      this.dust({ x: this.ox + c * this.T + 8, y: this.oy + r * this.T + 14 }, res.to === 'g' ? 0x63c74d : 0xead4aa);
      this.floatText(this.ox + c * this.T + 8, this.oy + r * this.T, res.to === 'g' ? 'NEW GRASS!' : 'NEW SAND!', '#fee761');
      this.save();
      this.refreshCards();
      // keep the selection going if the same tile can be upgraded again (sand -> grass)
      if (E.landOption(this.state, c, r)) this.selectLand(c, r); else { this.landSel = null; this.drawLand(); this.dockIdle(); }
    }

    // ------------------------------------------------------------ placement
    selectCard(type) {
      if (this.ghost && this.ghost.type === type && !this.ghost.moving) { this.cancel(); return; }
      if (this.ghost) this.cancel();
      if (this.edit) this.setEdit(false);
      const cat = CATS.find((c) => c.types.includes(type));
      if (!this.drawerOpen) this.setDrawer(true);
      if (cat && cat.id !== this.cat) { this.cat = cat.id; this.buildCards(); }
      this.makeGhost(type, Core.rotations(type)[0], null);
    }

    makeGhost(type, rot, moving) {
      this.clearFocus();
      const img = this.add.image(-100, -100, this.texFor(type, rot)).setOrigin(0.5, 1).setAlpha(0.8).setDepth(2300).setVisible(false);
      this.ghost = { type, rot, moving, img, cells: [], tileKey: null };
      this.landSel = null;
      this.landG.clear();
      this.refreshButtons();
      const p = this.input.activePointer;
      if (moving) this.positionGhost(moving.c, moving.r, true, true);
      else if (!this.touch && this.inMap(this.uiPt(p))) this.onPointerMove(p);
      else this.dockGhost();
      return this.ghost;
    }

    dropGhost() {
      if (!this.ghost) return;
      this.ghost.img.destroy();
      for (const o of this.ghost.cells) o.destroy();
      this.ghost = null;
      this.clearAura();
      this.refreshButtons();
      this.drawLand();
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

    // cancel placement; a picked-up building goes back where it was (and is returned)
    cancel() {
      const g = this.ghost;
      const b = g && g.moving ? this.restoreHeld() : null;
      this.dropGhost();
      return b;
    }
    restoreHeld() {
      const m = this.ghost.moving;
      const b = Core.place(this.state, m.type, m.c, m.r, m.rot, m.id, m.level);
      if (b) { b.fill = m.fill; b.wait = m.wait; if (m.burn) b.burn = m.burn; this.addView(b); }
      this.refreshEval();
      if (B[m.type].kind === 'defense') this.rebuildDefenseLights();
      return b;
    }

    positionGhost(c, r, force, exact) {
      const g = this.ghost, k = c + ',' + r;
      if (!force && !exact && g.tileKey === k) return;
      if (!force && exact && g.origin && g.origin.c === c && g.origin.r === r) return;
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
      g.preview = chk.ok ? Core.preview(this.state, g.type, o.c, o.r, g.rot, g.moving && g.moving.level) : null;
      this.showAura({ type: g.type, c: o.c, r: o.r, rot: g.rot }, g.preview ? g.preview.changes.map((ch) => [ch.id, ch.delta > 0]) : []);
      this.dockGhost();
    }

    // dock contents while holding a building: verdict + rotate / build / cancel
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
        const lv = g.moving && Core.levelOf(g.moving) > 1 ? ' LV' + Core.levelOf(g.moving) : '';
        lines = [d.name + lv, own + 'NET ' + net + '/S', g.moving ? (g.drag ? 'LET GO TO DROP' : 'MOVE: FREE') : E.fmt(cost.amount)];
        if (!g.moving) icon = cost.cur;
      }
      if (g.drag) { this.showDock({ lines, icon, near: g.a }); return; }   // hands are busy: info only
      const btns = [];
      if (Core.rotations(g.type).length > 1) btns.push({ icon: 'ico-rot', fn: () => this.rotate() });
      btns.push({ icon: 'ico-ok', fn: () => this.tryPlace(), tone: g.ok ? 'ok' : 'off' });
      btns.push({ icon: 'ico-no', fn: () => this.cancelAndSelect() });
      this.showDock({ lines, icon, btns, near: g.a ? { x: g.a.x, y: g.a.y } : null });
    }
    cancelAndSelect() {
      const b = this.cancel();
      if (b && this.edit) this.setFocus(this.views.get(b.id), true);
    }

    // pick a building up to move it. With a pointer it follows that finger / button
    // (drag & drop); without, the ghost follows the mouse until clicked (desktop).
    pickUp(v, p) {
      const b = { ...v.b };
      this.clearFocus();
      this.removeView(b.id);
      Core.remove(this.state, b.id);
      this.refreshEval();
      if (B[b.type].kind === 'defense') this.rebuildDefenseLights();
      const g = this.makeGhost(b.type, b.rot, b);
      if (p) {
        const w = this.worldPt(p.x, p.y), t = this.pick(w.x, w.y);
        g.drag = true; g.pointerId = p.id; g.grab = { c: t.c - b.c, r: t.r - b.r };
        this.dockGhost();
      }
    }
    moveDrag(p) {
      const g = this.ghost, w = this.worldPt(p.x, p.y), t = this.pick(w.x, w.y);
      this.positionGhost(t.c - g.grab.c, t.r - g.grab.r, false, true);
    }
    // let go: drop it if the spot is fine, otherwise it snaps back. Either way it stays selected.
    finishDrag(abort) {
      const g = this.ghost;
      if (!g) return;
      if (!abort && g.ok && g.origin) { this.tryPlace(); return; }
      if (!abort && g.at && g.reason) this.floatText(g.img.x, g.img.y - g.img.height, g.reason, '#e43b44');
      this.cancelAndSelect();
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
      const b = g.moving ? Core.place(this.state, g.type, c, r, g.rot, g.moving.id, g.moving.level) : E.buy(this.state, g.type, c, r, g.rot);
      if (!b) return;
      if (g.moving) { b.fill = g.moving.fill; b.wait = g.moving.wait; if (g.moving.burn) b.burn = g.moving.burn; }
      this.refreshEval();
      this.addView(b);
      this.rebuildDefenseLights();
      const v = this.views.get(b.id);
      this.dust(v);
      const out = this.eval.get(b.id).output;
      if (out > 0 && !g.moving) this.floatText(v.x, v.sprite.y - v.sprite.height, '+' + fmtRate(out) + '/S', this.S.P.coin[B[b.type].cur][0]);
      if (!g.moving) this.orderEvent({ kind: 'build', type: b.type });
      this.save();
      if (g.moving) {
        this.dropGhost();
        if (this.edit) this.setFocus(this.views.get(b.id), true);   // stays selected for rotate / upgrade / sell
        return;
      }
      this.positionGhost(g.at.c, g.at.r, true); // stay in build mode
      this.refreshCards();
    }

    // towers' night coverage belongs to their views; rebuild when towers change
    rebuildDefenseLights() {
      const selId = this.focus && this.focus.b.id;
      for (const v of [...this.views.values()]) if (B[v.b.type].kind === 'defense') { this.removeView(v.b.id); this.addView(v.b); }
      if (selId && !this.focus && this.views.get(selId) && this.edit && !this.ghost) this.setFocus(this.views.get(selId), true);
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
      if (ref) this.floatText(x, y - 16, 'SOLD +' + ref.map((p) => E.fmt(p.amount) + LETTER[p.cur]).join(' '), '#fee761');
      this.save();
    }

    // ------------------------------------------------------------ pointer input
    onPointerMove(p) {
      if (!p.wasTouch) this.touch = false;
      if (this.pinch) { if (this.input.pointer1.isDown && this.input.pointer2.isDown) this.updatePinch(); return; }
      const g = this.ghost, pr = this.press;
      if (g && g.drag) { if (p.id === g.pointerId) this.moveDrag(p); return; }
      if (pr && p.id === pr.id && p.isDown) {
        if (!pr.moved && Phaser.Math.Distance.Between(p.x, p.y, pr.sx, pr.sy) > DRAG_PX) {
          pr.moved = true;
          if (pr.hold) pr.hold.remove();
          if (pr.v && this.edit && !g && this.views.get(pr.v.b.id) === pr.v) { this.press = null; this.pickUp(pr.v, p); this.moveDrag(p); return; }
        }
        if (pr.moved && !g && !pr.noPan) {
          const cam = this.cameras.main;
          cam.setScroll(pr.scrollX - (p.x - pr.sx) / cam.zoom, pr.scrollY - (p.y - pr.sy) / cam.zoom);
          return;
        }
      }
      if (!g) return;
      if (p.wasTouch && !p.isDown) return;           // touch: ghost follows a dragging finger only
      if (!this.inMap(this.uiPt(p))) return;
      const w = this.worldPt(p.x, p.y), { c, r } = this.pick(w.x, w.y);
      this.positionGhost(c, r);
    }

    onPointerDown(p, over) {
      if (p.wasTouch) this.touch = true;
      if (this.music) this.music.unlock();          // browsers allow sound only after a tap
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) { this.startPinch(); return; }
      if (this.modal) return;                        // the modal's backdrop handles it
      const u = this.uiPt(p), w = this.worldPt(p.x, p.y), cam = this.cameras.main;
      if (p.rightButtonDown()) return this.onRightClick(over, w, u);
      if (over.some(isUI) || !this.inMap(u)) return;
      if (this.reportShown) this.hideReport();
      const { c, r } = this.pick(w.x, w.y);
      const pr = this.press = { id: p.id, sx: p.x, sy: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY, moved: false };
      if (this.ghost) {
        pr.noPan = true;
        if (this.ghost.drag) return;
        // touch: tap (or drag) previews the spot; tapping it again (or ✓) places
        if (p.wasTouch && this.ghost.tileKey !== c + ',' + r) { this.positionGhost(c, r); return; }
        this.positionGhost(c, r);
        this.tryPlace();
        return;
      }
      if (this.ship && over.includes(this.ship)) { this.openShop(); return; }
      if (this.shopOpen) this.closeShop();
      if (!this.edit && this.spotHit(w)) { this.startCast(); return; }
      const v = this.viewAt(over, c, r, p.wasTouch || this.edit);
      if (this.edit) {
        if (v) { pr.v = v; this.setFocus(v, true); } else pr.emptyEdit = true;
        return;
      }
      if (this.landMode() && E.landOption(this.state, c, r)) { this.selectLand(c, r); return; }
      if (this.landSel) { this.landSel = null; this.drawLand(); this.dockIdle(); }
      if (!v) { pr.empty = true; return; }
      // hold a building to start editing (the tap itself still collects / fires)
      pr.v = v;
      pr.hold = this.time.delayedCall(HOLD_MS, () => this.holdToEdit(pr));
      this.tapBuilding(v, p.wasTouch);
    }

    onPointerUp(p) {
      if (this.pinch) { if (!(this.input.pointer1.isDown && this.input.pointer2.isDown)) this.endPinch(); return; }
      const g = this.ghost;
      if (g && g.drag && p.id === g.pointerId) { this.press = null; this.finishDrag(); return; }
      const pr = this.press;
      if (!pr || pr.id !== p.id) return;
      this.press = null;
      if (pr.hold) pr.hold.remove();
      if (pr.moved) return;
      if (pr.emptyEdit) this.setEdit(false);          // tap empty space: done editing
      else if (pr.empty) this.clearFocus();
    }

    // desktop: right-click a building to pick it up (it follows the mouse; left-click drops)
    onRightClick(over, w, u) {
      if (this.ghost) { this.cancelAndSelect(); return; }
      const { c, r } = this.pick(w.x, w.y);
      const v = this.viewAt(over, c, r, true);
      if (v && this.inMap(u)) {
        if (!this.edit) this.setEdit(true);
        this.pickUp(this.views.get(v.b.id));
      } else if (this.edit) this.setEdit(false);
      else this.clearFocus();
    }

    holdToEdit(pr) {
      if (this.press !== pr || pr.moved || this.ghost || this.modal) return;
      const id = pr.v.b.id;
      this.setEdit(true);
      const v = this.views.get(id);
      if (!v) return;
      pr.v = v;
      this.setFocus(v, true);
      const y0 = v.sprite.y;
      this.tweens.add({ targets: v.sprite, y: y0 - 3, duration: 80, yoyo: true, onComplete: () => v.sprite.active && v.sprite.setY(y0) });
      try { navigator.vibrate && navigator.vibrate(15); } catch (e) { /* not allowed */ }
    }

    // PLAY tap, in priority order: douse fire > reel a fish > fire at raider > collect > show info
    tapBuilding(v, touch) {
      const b = v.b;
      if (b.burn > 0) return this.douse(v);
      const cast = this.state.fishing.cast;          // while waiting for a bite you can keep playing
      if (cast && cast.phase === 'reel') return this.fishTap(v);
      if (cast && cast.phase === 'rest') return this.floatText(v.x, v.sprite.y - v.sprite.height, 'GET READY...', '#2ce8f5');
      const shot = N.fire(this.state, b.id, this.cov);
      if (shot) return this.shoot(v, shot);
      if (B[b.type].kind === 'defense' && b.cool > 0) return this.floatText(v.x, v.sprite.y - v.sprite.height, 'RELOADING', '#8b9bb4');
      if (E.isReady(b)) return this.collect(v);
      if (this.focus === v && this.focusSticky) return this.clearFocus();
      if (touch) this.setFocus(v, true);
      else this.tweens.add({ targets: v.sprite, x: v.x + 1, duration: 40, yoyo: true, repeat: 1, onComplete: () => v.sprite.setX(v.x) });
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
      const y = TOP + (this.state.fishing.cast ? 40 : 26);
      const t = this.bannerObj = U(this.add.image(UW / 2, y, PX.textTex(this, str, { color: color || this.S.P.accent, outline: this.S.P.worldOutline })).setOrigin(0.5, 0).setDepth(3300));
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
      if (this.music) this.music.coin(got.cur, this.combo, got.perfect);
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

    // ------------------------------------------------------------ fishing
    spotXY(s) { return { x: this.ox + (s.c + 0.5) * this.T, y: this.oy + (s.r + 0.5) * this.T }; }
    spotHit(w) {
      const s = this.state.fishing.spot;
      if (!s || this.state.fishing.cast) return false;
      const c = this.spotXY(s);
      return Phaser.Math.Distance.Between(w.x, w.y, c.x, c.y) <= 13;
    }
    startCast() {
      const s = this.state.fishing.spot, at = this.spotXY(s);
      const c = F.cast(this.state);
      if (!c) return;
      this.clearFocus();
      this.castAt = at;
      this.bobber = this.add.image(at.x, at.y + 3, this.key('bobber')).setOrigin(0.5, 1).setDepth(7);
      this.tweens.add({ targets: this.bobber, y: at.y + 4, duration: 300, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [1] });
      this.splash(at.x, at.y);
      this.fishPanel.fishId = null;
      this.reel = 0;
      this.banner('LINE IS OUT... WAIT FOR A BITE', '#2ce8f5');
    }
    splash(x, y) {
      for (let i = 0; i < 8; i++) {
        const p = this.add.image(x, y, this.key('px')).setTint(i & 1 ? 0xffffff : 0x2ce8f5).setDepth(2550);
        const vx = (Math.random() - 0.5) * 20, h = 4 + Math.random() * 8;
        this.tweens.add({ targets: p, x: x + vx, duration: 400 });
        this.tweens.add({ targets: p, y: y - h, duration: 180, ease: 'Quad.easeOut', yoyo: true, onComplete: () => p.destroy() });
      }
    }
    fishTap(v) {
      const res = F.tap(this.state, v.b), top = v.sprite.y - v.sprite.height;
      if (!res) return;
      const cur = B[v.b.type].cur;
      if (!res.ok) {
        this.reel = 0;
        this.floatText(v.x, top, !cur ? 'NO COINS HERE' : res.reset ? 'WRONG! SET RESTARTS' : 'WRONG COIN', '#e43b44');
        this.tweens.add({ targets: v.sprite, x: v.x + 1, duration: 40, yoyo: true, repeat: 1, onComplete: () => v.sprite.setX(v.x) });
        this.fishPanel.shake = 6;
        return;
      }
      this.burst(v.x, top + 4, this.S.P.coin[cur]);
      if (this.castAt) this.splash(this.castAt.x, this.castAt.y);
      this.reel = (this.reel || 0) + 1;              // each good tap climbs the scale
      if (this.music) this.music.coin(cur, this.reel, !!res.caught || !!res.setDone);
      if (res.caught) this.reel = 0;
      if (res.caught) return this.endCast(res.caught, res.first);
      if (res.setDone) { this.floatText(this.castAt.x, this.castAt.y - 10, 'SET!', '#fee761'); this.fishPanel.pop = 8; }
    }
    endCast(caught, first) {
      const at = this.castAt;
      if (this.bobber) { this.tweens.killTweensOf(this.bobber); this.bobber.destroy(); this.bobber = null; }
      this.castAt = null;
      if (!caught) { this.banner('IT GOT AWAY...', '#8b9bb4'); return; }
      const img = this.add.image(at.x, at.y, this.key('fish-' + caught)).setDepth(2600);
      this.tweens.add({ targets: img, y: at.y - 24, duration: 500, ease: 'Quad.easeOut' });
      this.tweens.add({ targets: img, alpha: 0, delay: 900, duration: 300, onComplete: () => img.destroy() });
      this.burst(at.x, at.y - 6, ['#fee761', '#ffffff']);
      this.showCatch(caught, first);                  // the reveal: only now do you learn what it was
      this.save();
    }
    onFishing(ev) {
      if (ev.type === 'spot') this.banner('RIPPLES! TAP THEM TO FISH', '#2ce8f5');
      else if (ev.type === 'bite') this.onBite();
      else if (ev.type === 'nextSet' && this.castAt) { this.splash(this.castAt.x, this.castAt.y); this.fishPanel.pop = 8; }
      else if (ev.type === 'reset' && this.castAt && !(this.reel = 0)) this.floatText(this.castAt.x, this.castAt.y - 10, 'TOO SLOW', '#e43b44');
      else if (ev.type === 'escaped') this.endCast(null);
    }
    buildFishPanel() {
      const P = this.S.P, w = 124, h = 36, x = (UW - w) / 2, y = TOP + 2;
      const fp = this.fishPanel = { x, y, w, h, shake: 0 };
      fp.bg = U(this.add.rectangle(x, y, w, h, 0x181425, 0.92).setOrigin(0).setDepth(3000).setInteractive());
      fp.g = U(this.add.graphics().setDepth(3001));
      fp.fish = U(this.add.image(x + 3, y + 3, this.key('fish-sardine')).setOrigin(0).setDepth(3002));
      fp.name = U(new PixelText(this, x + 22, y + 2, '', { color: P.text, outline: P.textOutline }).setOrigin(0).setDepth(3002));
      fp.rar = U(new PixelText(this, x + 22, y + 9, '', { color: P.dim, outline: P.textOutline }).setOrigin(0).setDepth(3002));
      fp.sets = U(new PixelText(this, x + 52, y + 19, '', { color: P.dim, outline: P.textOutline }).setOrigin(0).setDepth(3002));
      fp.msg = U(new PixelText(this, x + 3, y + 19, '', { color: '#2ce8f5', outline: P.textOutline }).setOrigin(0).setDepth(3002));
      fp.icons = [0, 1, 2, 3].map((i) => U(this.add.image(x + 3 + i * 11, y + 17, this.key('ico-bronze')).setOrigin(0).setDepth(3002)));
      fp.quit = U(this.add.image(x + w - 8, y + 7, this.key('ico-no')).setDepth(3002));
      fp.quitZone = U(this.add.zone(x + w - 16, y, 16, 15).setOrigin(0).setDepth(3003).setInteractive({ cursor: 'pointer' }));
      fp.quitZone.on('pointerdown', () => { if (F.giveUp(this.state)) this.endCast(null); });
      fp.objs = [fp.bg, fp.g, fp.fish, fp.name, fp.rar, fp.sets, fp.msg, ...fp.icons, fp.quit, fp.quitZone];
    }
    // the panel shows the hooked fish as a mystery: '???' and a dark silhouette.
    // wait: line out, no coins yet. reel: the coin set + gauge. rest: a breather between sets.
    refreshFishPanel(time) {
      const fp = this.fishPanel, c = this.state.fishing.cast, show = !!c;
      if (fp.shown !== show) {
        fp.shown = show;
        for (const o of fp.objs) o.setVisible(show);
        if (show) fp.bg.setInteractive(); else fp.bg.disableInteractive();
        if (show) fp.quitZone.setInteractive({ cursor: 'pointer' }); else fp.quitZone.disableInteractive();
      }
      if (!show) return;
      const P = this.S.P, dots = '.'.repeat(1 + (Math.floor(time / 400) % 3));
      const dx = fp.shake > 0 ? ((fp.shake-- & 2) ? 1 : -1) : 0, dy = fp.pop > 0 ? -(fp.pop-- > 4 ? 1 : 0) : 0;
      const x = fp.x + dx, y = fp.y + dy;
      if (fp.fishId !== c.fish) { fp.fishId = c.fish; fp.fish.setTexture(this.key('fish-' + c.fish)).setTintFill(0x3a4466); }
      const wait = c.phase === 'wait', rest = c.phase === 'rest';
      fp.name.setText(wait ? 'LINE OUT' + dots : '???');
      fp.rar.setText(wait ? 'WAIT FOR A BITE' : rest ? 'NICE! GET READY' : 'REEL IT IN!');
      fp.fish.setAlpha(wait ? 0.35 : 1);
      fp.bg.setPosition(x, y); fp.fish.setPosition(x + 3, y + 3 + (wait ? Math.floor(time / 300) % 2 : 0));
      fp.name.setPosition(x + 22, y + 2); fp.rar.setPosition(x + 22, y + 9); fp.sets.setPosition(x + 52, y + 19); fp.msg.setPosition(x + 3, y + 19);
      fp.quit.setPosition(x + fp.w - 8, y + 7);
      const blink = Math.floor(time / 200) & 1, coins = c.phase === 'reel';
      fp.icons.forEach((im, i) => {
        const on = coins && i < c.set.length;
        im.setVisible(on).setPosition(x + 3 + i * 11, y + 17);
        if (!on) return;
        im.setTexture(this.key('ico-' + c.set[i]));
        im.setAlpha(i < c.pos ? 0.3 : i === c.pos ? (blink ? 1 : 0.6) : 1);
      });
      fp.msg.setVisible(!coins).setText(wait ? 'SOMETHING IS NEAR' + dots : 'NEXT SET' + dots);
      fp.sets.setVisible(coins).setText(c.sets < 2 ? 'SETS ' + c.sets + '/2' : 'REEL IN!');
      const g = fp.g.clear();
      g.fillStyle(hex(P.panel.light), 1).fillRect(x, y, fp.w, 1).fillRect(x, y + fp.h - 1, fp.w, 1).fillRect(x, y, 1, fp.h).fillRect(x + fp.w - 1, y, 1, fp.h);
      if (wait) return;
      // time left for the next tap in this set
      if (coins && c.pos > 0) g.fillStyle(0xfee761, 1).fillRect(x + 3, y + 28, Math.ceil(c.set.length * 11 * c.window / F.WINDOW), 1);
      // the gauge: fill it to land the fish; it drains while reeling and holds between sets
      const gw = fp.w - 6;
      g.fillStyle(0x000000, 0.7).fillRect(x + 3, y + 30, gw, 4);
      g.fillStyle(c.gauge < 0.25 ? 0xe43b44 : rest ? 0x2ce8f5 : 0x63c74d, 1).fillRect(x + 3, y + 31, Math.max(0, Math.round(gw * c.gauge)), 2);
    }
    // the fish bites: the bobber is pulled under, then the coins appear
    onBite() {
      const at = this.castAt;
      if (!at) return;
      this.splash(at.x, at.y); this.splash(at.x, at.y + 2);
      if (this.bobber) {
        this.tweens.killTweensOf(this.bobber);
        this.bobber.setY(at.y + 6);
        this.tweens.add({ targets: this.bobber, y: at.y + 4, duration: 180, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [1] });
      }
      this.floatText(at.x, at.y - 8, '!', '#fee761');
      this.cameras.main.shake(120, 0.002);
      this.fishPanel.pop = 8;
      this.banner('A BITE! TAP BUILDINGS WITH THESE COINS', '#fee761');
      if (this.music) this.music.coin('gold', 6, true);
      try { navigator.vibrate && navigator.vibrate(30); } catch (e) { /* not allowed */ }
    }
    // the reveal card after a catch: what it was, how rare, new to the book?
    showCatch(id, first) {
      this.hideCatch();
      const P = this.S.P, fish = F.FISH[id], objs = [];
      const w = 150, h = first ? 74 : 64, x = Math.round((UW - w) / 2), y = Math.round((UH - h) / 2) - 6;
      const add = (o) => { U(o); objs.push(o); return o; };
      const card = add(this.add.rectangle(x, y, w, h, 0x181425, 0.95).setOrigin(0).setDepth(3650).setInteractive());
      card.on('pointerdown', () => this.hideCatch());
      const g = add(this.add.graphics().setDepth(3651)), col = hex(RARITY[fish.rarity]);
      g.fillStyle(col, 1).fillRect(x, y, w, 2).fillRect(x, y + h - 2, w, 2).fillRect(x, y, 2, h).fillRect(x + w - 2, y, 2, h);
      g.fillStyle(col, 0.15).fillRect(x + 2, y + 2, w - 4, 38);
      const text = (ty, s, c, sc) => add(this.add.image(UW / 2, ty, PX.textTex(this, s, { color: c, outline: P.textOutline, scale: sc || 1 })).setOrigin(0.5, 0).setDepth(3652));
      text(y + 5, 'YOU CAUGHT', P.dim);
      const img = add(this.add.image(UW / 2, y + 26, this.key('fish-' + id)).setDepth(3652).setScale(2));
      text(y + 41, fish.name, RARITY[fish.rarity], 2);
      const price = Object.entries(fish.price).map(([c, v]) => E.fmt(v) + LETTER[c]).join(' ');
      text(y + 55, fish.rarity + '  -  SELLS FOR ' + price, RARITY[fish.rarity]);
      if (first) text(y + 64, 'NEW IN YOUR BOOK! +' + Math.round(F.BOOK_BONUS * 100) + '% INCOME', '#fee761');
      // pop in, bob, then go away by itself
      for (const o of objs) o.setAlpha(0);
      this.tweens.add({ targets: objs, alpha: 1, duration: 160 });
      this.tweens.add({ targets: img, y: y + 24, duration: 400, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [2] });
      this.catchObjs = objs;
      this.catchTimer = this.time.delayedCall(first ? 4200 : 3200, () => this.hideCatch());
    }
    hideCatch() {
      if (this.catchTimer) { this.catchTimer.remove(); this.catchTimer = null; }
      for (const o of this.catchObjs || []) { this.tweens.killTweensOf(o); o.destroy(); }
      this.catchObjs = null;
    }
    // ripples on the water where a fish is biting, the bobber while one is hooked
    drawRipple(time) {
      const g = this.rippleG.clear(), s = this.state.fishing.spot;
      if (!s) return;
      const { x, y } = this.spotXY(s), t = time / 1000;
      for (let k = 0; k < 3; k++) {
        const ph = (t * 0.8 + k / 3) % 1, rad = 2 + ph * 9;
        g.lineStyle(1, 0xffffff, 0.9 * (1 - ph)).strokeEllipse(x, y, rad * 2, rad * 1.2);
      }
      if (Math.floor(t * 3) % 4 === 0) g.fillStyle(0x2ce8f5, 1).fillRect(Math.round(x + Math.sin(t * 5) * 3), y - 1, 2, 1);
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
        g: U(this.add.graphics().setDepth(3000)),
        l1: U(new PixelText(this, 0, 0, '', { color: P.accent, outline: P.textOutline }).setOrigin(0).setDepth(3001)),
        l2: U(new PixelText(this, 0, 0, '', { color: P.text, outline: P.textOutline }).setOrigin(0).setDepth(3001)),
        icon: U(this.add.image(0, 0, this.key('ico-bronze')).setOrigin(0).setDepth(3001)),
      };
    }
    // top corner opposite the menu
    cornerX(w) { return this.side === 'left' ? UW - 2 - w : 2; }
    refreshOrderCard() {
      const oc = this.orderCard, a = this.state.orders.active;
      const show = !!a && this.state.cycle.phase === 'day' && !this.state.fishing.cast;
      oc.g.setVisible(show); oc.l1.setVisible(show); oc.l2.setVisible(show); oc.icon.setVisible(show);
      if (!show) return;
      oc.l1.setText('ORDER: ' + a.text);
      oc.l2.setText(O.progressText(a) + '   +' + E.fmt(a.reward));
      const w = Math.max(oc.l1.width, oc.l2.width + 10) + 6, h = 20;
      const x = this.cornerX(w), y = TOP + 2;
      if (oc.w !== w || oc.x !== x) {
        oc.w = w; oc.x = x;
        oc.g.clear().fillStyle(0x181425, 0.85).fillRect(x, y, w, h).fillStyle(0x63c74d, 1).fillRect(x, y, 1, h);
      }
      oc.l1.setPosition(x + 3, y + 2); oc.l2.setPosition(x + 3, y + 11);
      oc.icon.setPosition(x + 3 + oc.l2.width + 1, y + 10);
    }

    // ------------------------------------------------------------ merchant ship
    buildShip() {
      this.ship = this.add.image(500, 140, this.key('ship')).setOrigin(0.5, 1).setDepth(7).setVisible(false).setInteractive({ pixelPerfect: true, alphaTolerance: 1, cursor: 'pointer' });
      this.shipShown = false;
      this.shipBob = this.tweens.add({ targets: this.ship, y: 139, duration: 600, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [1] });
    }
    refreshShip() {
      const here = M.here(this.state), ship = this.ship;
      if (here && !this.shipShown) {
        this.shipShown = true;
        ship.setVisible(true).setX(500).setTexture(this.key('ship'));
        this.tweens.add({ targets: ship, x: 290, duration: 5000, ease: 'Sine.easeOut' });
        this.banner('MERCHANT SHIP ARRIVED - TAP IT', '#fee761');
      } else if (!here && this.shipShown) {
        this.shipShown = false;
        if (this.shopOpen) this.closeShop();
        this.tweens.add({ targets: ship, x: 520, duration: 5000, ease: 'Sine.easeIn', onComplete: () => ship.setVisible(false) });
      }
      if (this.shopOpen && here) this.dockShop();
    }
    openShop() {
      if (!M.here(this.state)) return;
      if (this.ghost) this.cancel();
      this.clearFocus();
      this.shopOpen = true;
      this.ship.setTexture(this.key('ship-hl'));
      this.dockShop(true);
    }
    closeShop() {
      this.shopOpen = false;
      this.ship.setTexture(this.key('ship'));
      this.dockIdle();
    }
    dockShop(force) {
      const m = M.ensure(this.state), left = Math.ceil(m.leaveAt - this.state.cycle.t);
      const key = m.sold.join() + '|' + left + '|' + E.fmt(this.state.wallet.bronze) + E.fmt(this.state.wallet.silver);
      if (!force && key === this.shopKey) return;
      this.shopKey = key;
      const it = M.items(this.state);
      const offers = M.offers(this.state);
      const lines = offers.map((o) => o.name + (o.item ? ' (' + it[o.item] + ')' : '') + ': ' + o.desc);
      const btns = offers.map((o) => {
        const full = o.item && it[o.item] >= M.MAX_ITEM, can = this.state.wallet[o.cost.cur].gte(o.cost.amount);
        const label = o.sold ? 'SOLD' : full ? 'FULL' : E.fmt(o.cost.amount) + LETTER[o.cost.cur];
        return { label, tone: o.sold || full || !can ? 'off' : 'ok', fn: () => this.buyOffer(o.i) };
      });
      btns.push({ icon: 'ico-no', fn: () => this.closeShop() });
      lines.unshift('MERCHANT - LEAVES IN ' + left + 'S');
      this.showDock({ lines, btns });
    }
    buyOffer(i) {
      const o = M.buy(this.state, i);
      if (!o) { this.floatText(this.ship.x, this.ship.y - 30, 'CAN\'T BUY', '#e43b44'); return; }
      this.floatText(this.ship.x, this.ship.y - 30, 'BOUGHT ' + o.name, '#fee761');
      this.burst(this.ship.x, this.ship.y - 20, ['#fee761', '#ffffff']);
      this.save();
      this.dockShop(true);
      this.refreshCards();
    }

    // ------------------------------------------------------------ night toolbar
    // dusk & night: shows your merchant tools; the cannon is fired from here
    buildItemBar() {
      const P = this.S.P;
      const bar = this.itemBar = { g: U(this.add.graphics().setDepth(3000)), parts: [] };
      for (const k of ITEMS) {
        const icon = U(this.add.image(0, 0, this.key('item-' + k)).setOrigin(0).setDepth(3001));
        const txt = U(new PixelText(this, 0, 0, '0', { color: P.text, outline: P.textOutline }).setOrigin(0).setDepth(3001));
        bar.parts.push({ k, icon, txt });
      }
      bar.zone = U(this.add.zone(0, 0, 10, 10).setOrigin(0).setDepth(3002).setInteractive({ cursor: 'pointer' }));
      bar.zone.on('pointerdown', () => this.fireCannon());
    }
    refreshItemBar() {
      const bar = this.itemBar, ph = this.state.cycle.phase, show = ph === 'dusk' || ph === 'night';
      bar.g.setVisible(show); bar.zone.setVisible(show);
      for (const p of bar.parts) { p.icon.setVisible(show); p.txt.setVisible(show); }
      if (!show) { bar.zone.disableInteractive(); return; }
      const it = M.items(this.state), w = 66, h = 13;
      const x = this.cornerX(w), y = TOP + 2;
      const armed = ph === 'night' && it.cannon > 0;
      if (bar.key !== x + '|' + armed) {
        bar.key = x + '|' + armed;
        bar.g.clear().fillStyle(0x181425, 0.85).fillRect(x, y, w, h);
        bar.g.fillStyle(armed ? 0xa22633 : 0x3a4466, 1).fillRect(x + 44, y + 1, 21, h - 2);
      }
      bar.parts.forEach((p, i) => { p.icon.setPosition(x + 2 + i * 22, y + 1); p.txt.setText(String(it[p.k])).setPosition(x + 13 + i * 22, y + 4); });
      bar.zone.setPosition(x + 42, y - 2).setSize(24, h + 4).setInteractive({ cursor: 'pointer' });
    }
    fireCannon() {
      const res = N.cannon(this.state);
      const cam = this.cameras.main;
      if (!res) { const w = this.worldPt(cam.width / 2, cam.height * 0.3); this.floatText(w.x, w.y, this.state.cycle.phase !== 'night' ? 'WAIT FOR NIGHT' : 'NO CANNONBALLS', '#8b9bb4'); return; }
      const rv = this.raiders.get(res.raider);
      if (rv) {
        const from = this.worldPt(cam.width / 2, cam.height * 0.85);
        const ball = this.add.image(from.x, from.y, this.key('item-cannon')).setDepth(2200);
        this.tweens.add({ targets: ball, x: rv.img.x, y: rv.img.y, duration: 450, ease: 'Quad.easeIn', onComplete: () => {
          ball.destroy();
          cam.shake(120, 0.003);
          this.burst(rv.img.x, rv.img.y, ['#ffffff', '#f77622']);
          if (res.sunk) this.sinkRaider(rv, res.loot);
        } });
      }
      this.save();
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
        const rv = { r, img, pips, eyes, sc, pipsAbove: L.sy > L.ty };
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
    // raiders outside the view get a blinking marker on the screen edge, pointing at them
    drawEdgeMarkers(time) {
      const g = this.edgeG.clear();
      if (!this.raiders.size) return;
      const left = this.side === 'left', x0 = (left ? RAIL : 0) + 4, x1 = (left ? UW : UW - RAIL) - 5, y0 = TOP + 4, y1 = UH - 5;
      const blink = Math.floor(time / 300) & 1;
      for (const rv of this.raiders.values()) {
        const u = this.toUI(rv.img.x, rv.img.y);
        if (u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) continue;
        const x = Math.round(clamp(u.x, x0, x1)), y = Math.round(clamp(u.y, y0, y1)), s = rv.r.boss ? 3 : 2;
        g.fillStyle(0x181425, 1).fillRect(x - s - 1, y - s - 1, s * 2 + 3, s * 2 + 3);
        g.fillStyle(blink ? 0xe43b44 : 0xf77622, 1).fillRect(x - s, y - s, s * 2 + 1, s * 2 + 1);
        // a little tick pointing towards the raider
        const dx = Math.sign(Math.round(u.x - x)), dy = Math.sign(Math.round(u.y - y));
        g.fillStyle(0xffffff, 1).fillRect(x + dx * (s + 1), y + dy * (s + 1), 1, 1);
      }
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
        targets: bolt, x: tgt.x, y: tgt.y, duration: 160 + Math.min(600, Phaser.Math.Distance.Between(sx, sy, tgt.x, tgt.y) * 2),
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
      if (this.music) this.music.coin(isTower ? 'silver' : B[v.b.type].cur, this.combo, false);
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
      if (ev.saved) {
        const v = this.views.get(ev.saved);
        if (v) this.floatText(v.x, v.sprite.y - v.sprite.height, 'BUCKET SAVED IT!', '#2ce8f5');
      }
      if (ev.fire) {
        const v = this.views.get(ev.fire);
        if (v) { this.syncFlame(v); this.floatText(v.x, v.sprite.y - v.sprite.height, 'FIRE! TAP x' + N.BURN_TAPS, '#f77622'); }
      }
      this.cameras.main.shake(180, 0.004);
    }

    // ------------------------------------------------------------ day / night
    buildNight() {
      const P = this.S.P, wb = this.S.world;
      this.nightOverlay = this.add.rectangle(wb.x0, wb.y0, wb.w, wb.h, P.nightTint).setOrigin(0).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(2000);
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
      if (ev.type === 'saved') {
        const v = this.views.get(ev.id);
        if (v) this.floatText(v.x, v.sprite.y - v.sprite.height, 'BUCKET SAVED IT!', '#2ce8f5');
        return;
      }
      if (ev.type === 'net') { this.banner('NET CAST: RAIDERS SLOWED', '#2ce8f5'); return; }
      if (ev.type === 'spread') {
        const v = this.views.get(ev.id);
        if (v) { this.syncFlame(v); this.floatText(v.x, v.sprite.y - v.sprite.height - 6, 'FIRE SPREAD!', '#f77622'); }
        return;
      }
      if (ev.type !== 'land' && !this.ghost && !this.edit) this.clearFocus();
      if (ev.type === 'dusk') {
        this.setDrawer(false);
        this.setNight(true);
        this.spawnRaiders();
        const boss = this.state.cycle.raiders.some((r) => r.boss);
        this.banner(boss ? 'WAR CANOE SPOTTED! GUARD YOUR COAST' : 'RAIDERS SPOTTED! ' + (this.touch ? 'PINCH' : 'SCROLL') + ' OUT TO SEE THEM', '#f77622');
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
      const g = U(this.add.graphics().setDepth(3600));
      const w = 150, h = 48, x = (UW - w) / 2, y = 60;
      g.fillStyle(0x181425, 0.94).fillRect(x, y, w, h).fillStyle(hex(P.panel.light), 1)
        .fillRect(x, y, w, 1).fillRect(x, y + h - 1, w, 1).fillRect(x, y, 1, h).fillRect(x + w - 1, y, 1, h);
      objs.push(g);
      lines.forEach(([s, c], i) => objs.push(U(this.add.image(UW / 2, y + 5 + i * 10, PX.textTex(this, s, { color: c, outline: P.textOutline })).setOrigin(0.5, 0).setDepth(3601))));
      this.reportObjs = objs; this.reportShown = true;
    }
    hideReport() {
      for (const o of this.reportObjs || []) o.destroy();
      this.reportObjs = []; this.reportShown = false;
    }

    // ------------------------------------------------------------ menu rail + build drawer
    buildRail() {
      const k = this.key, x0 = this.railX();
      U(this.add.image(x0, TOP, k('rail-' + UH)).setOrigin(0).setDepth(3000).setInteractive());
      const items = [
        { id: 'build', icon: 'ico-build', tip: ['BUILD', 'BUILDINGS AND LAND (TAB)'], fn: () => this.setDrawer(!this.drawerOpen) },
        { id: 'edit', icon: 'tool-move', tip: ['EDIT', 'MOVE, UPGRADE, SELL (E)', 'OR HOLD A BUILDING'], fn: () => this.setEdit(!this.edit) },
        { id: 'book', icon: 'ico-book', tip: ['FISH BOOK', 'YOUR CATCH (B)'], fn: () => this.openBook() },
        { id: 'gear', icon: 'ico-gear', tip: ['SETTINGS'], fn: () => this.openSettings() },
      ];
      this.rail = {};
      items.forEach((it, i) => {
        const y = TOP + 3 + i * 21;
        const bg = U(this.add.image(x0 + 1, y, k('railbtn')).setOrigin(0).setDepth(3001).setInteractive({ cursor: 'pointer' }));
        U(this.add.image(x0 + 10, y + 9, k(it.icon)).setDepth(3002));
        bg.on('pointerdown', () => { if (this.ghost && it.id !== 'build') this.cancel(); it.fn(); });
        bg.on('pointerover', (p) => { if (!p.wasTouch && !this.ghost && !this.focus) this.showDock({ lines: it.tip }); });
        bg.on('pointerout', (p) => { if (!p.wasTouch && !this.ghost && !this.focus) this.dockIdle(); });
        this.rail[it.id] = bg;
      });
      // how many fish are waiting in the hold, on the book button
      this.holdBadge = U(this.add.image(x0 + 16, TOP + 3 + 2 * 21 + 15, PX.textTex(this, '0', { color: '#fee761', outline: this.S.P.textOutline })).setDepth(3003).setVisible(false));
    }
    refreshRail() {
      if (!this.rail) return;
      this.rail.build.setTexture(this.key(this.drawerOpen ? 'railbtn-sel' : 'railbtn'));
      this.rail.edit.setTexture(this.key(this.edit ? 'railbtn-sel' : 'railbtn'));
      this.rail.book.setTexture(this.key(this.modal && this.modal.kind === 'book' ? 'railbtn-sel' : 'railbtn'));
      this.rail.gear.setTexture(this.key(this.modal && this.modal.kind === 'settings' ? 'railbtn-sel' : 'railbtn'));
    }

    buildDrawer() {
      const k = this.key, P = this.S.P;
      this.drawer = { objs: [], cards: [] };
      const d = this.drawer, x0 = this.drawerX();
      const ui = (o) => { U(o); d.objs.push(o); return o; };
      ui(this.add.image(x0, TOP, k('drawer-' + UH)).setOrigin(0).setDepth(3000).setInteractive());
      d.tabs = CATS.map((cat, i) => {
        const tx = x0 + 1 + (i % 2) * 12, ty = TOP + 2 + Math.floor(i / 2) * 12;
        const bg = ui(this.add.image(tx, ty, k('tab')).setOrigin(0).setDepth(3001).setInteractive({ cursor: 'pointer' }));
        ui(this.add.image(tx + 6, ty + 6, k(cat.icon)).setDepth(3002));
        bg.on('pointerdown', () => { if (this.ghost) this.cancel(); this.cat = cat.id; this.landSel = null; this.buildCards(); this.drawLand(); this.dockIdle(); });
        bg.on('pointerover', (p) => { if (!p.wasTouch && !this.ghost) this.showDock({ lines: [cat.name] }); });
        bg.on('pointerout', (p) => { if (!p.wasTouch && !this.ghost) this.dockIdle(); });
        return { cat: cat.id, bg };
      });
      // the LAND tab's single card: next tile's price
      d.landPrice = ui(new PixelText(this, 0, 0, '', { color: P.text, outline: P.textOutline }).setOrigin(0.5, 0).setDepth(3002));
      this.buildCards();
    }

    buildCards() {
      const d = this.drawer, k = this.key, S = this.S, x0 = this.drawerX();
      for (const c of d.cards) for (const o of c.objs) o.destroy();
      d.cards = [];
      for (const t of d.tabs) t.bg.setTexture(k(t.cat === this.cat ? 'tab-sel' : 'tab'));
      const cat = CATS.find((c) => c.id === this.cat);
      const ui = (objs, o) => { U(o); objs.push(o); return o; };
      if (cat.id === 'land') {
        const objs = [], x = x0 + 1, y = TOP + 40;
        const bg = ui(objs, this.add.image(x, y, k('card22')).setOrigin(0).setDepth(3001).setInteractive({ cursor: 'pointer' }));
        ui(objs, this.add.image(x + 12, y + 7, k('cat-land')).setDepth(3002));
        bg.on('pointerdown', () => this.dockIdle());
        d.landPrice.setPosition(x + 12, y + 13);
        d.cards.push({ type: 'land', bg, objs });
      }
      cat.types.forEach((type, j) => {
        const x = x0 + 1, y = TOP + 40 + j * 23, objs = [];
        const bg = ui(objs, this.add.image(x, y, k('card22')).setOrigin(0).setDepth(3001).setInteractive({ cursor: 'pointer' }));
        const tex = this.texFor(type, 0), f = this.textures.getFrame(tex);
        const w = Math.min(f.width, 20), h = Math.min(f.height, 12);
        const cx = Math.floor((f.width - w) / 2), cy = S.art[type].cardCrop != null ? S.art[type].cardCrop : Math.max(0, f.height - h - 2);
        const im = ui(objs, this.add.image(0, 0, tex).setOrigin(0).setDepth(3002).setCrop(cx, cy, w, h));
        im.setPosition(x + 12 - Math.floor(w / 2) - cx, y + 2 - cy);
        const glyph = ui(objs, this.add.image(x + 12, y + 17, this.shapeGlyph(type)).setDepth(3002));
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

    setDrawer(open) {
      const was = this.drawerOpen;
      this.drawerOpen = open;
      const d = this.drawer;
      if (!d) return;
      if (open && this.edit) this.setEdit(false);
      if (!open && this.ghost && !this.ghost.moving) this.cancel();
      const all = [...d.objs, ...d.cards.flatMap((c) => c.objs)];
      for (const o of all) o.setVisible(open);
      d.landPrice.setVisible(open && this.cat === 'land');
      if (was !== open) this.landSel = null;
      this.refreshRail();
      this.drawLand();
      this.orderCard && (this.orderCard.w = -1);
      if (this.itemBar) this.itemBar.key = null;
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
        if (c.type === 'land') continue;
        const a = E.canAfford(this.state, c.type) ? 1 : 0.4;
        c.im.setAlpha(a); c.glyph.setAlpha(a);
      }
      const cost = E.landCost(this.state);
      this.drawer.landPrice.setText(E.fmt(cost.amount)).setAlpha(this.state.wallet.bronze.gte(cost.amount) ? 1 : 0.5);
      // fish waiting to be sold
      const n = F.IDS.reduce((a, id) => a + (this.state.fish[id] || 0), 0);
      if (this.holdBadge && this.holdBadgeN !== n) {
        this.holdBadgeN = n;
        this.holdBadge.setTexture(PX.textTex(this, String(Math.min(n, 99)), { color: '#fee761', outline: this.S.P.textOutline })).setVisible(n > 0);
      }
    }

    // ------------------------------------------------------------ modals (fish book, settings)
    // modal = centred panel over a dimmed backdrop; tapping the backdrop closes it
    openModal(kind, title, w, rows, tabs) {
      this.closeModal();
      if (this.ghost) this.cancel();
      this.clearFocus();
      const P = this.S.P, objs = [], RH = 16, h = 22 + rows.length * RH + 4;
      const x = Math.round((UW - w) / 2), y = Math.max(TOP + 2, Math.round((UH - h) / 2));
      const add = (o) => { U(o); objs.push(o); return o; };
      const back = add(this.add.rectangle(0, 0, UW, UH, 0x000000, 0.45).setOrigin(0).setDepth(3700).setInteractive());
      back.on('pointerdown', () => this.closeModal());
      add(this.add.rectangle(x, y, w, h, 0x181425, 0.97).setOrigin(0).setDepth(3701).setInteractive());
      const g = add(this.add.graphics().setDepth(3702));
      g.fillStyle(hex(P.panel.light), 1).fillRect(x, y, w, 1).fillRect(x, y + h - 1, w, 1).fillRect(x, y, 1, h).fillRect(x + w - 1, y, 1, h);
      const text = (tx, ty, s, color, ox = 0) => add(this.add.image(tx, ty, PX.textTex(this, s, { color: color || P.text, outline: P.textOutline })).setOrigin(ox, 0).setDepth(3703));
      const button = (bx, by, label, tone, fn, icon) => {
        const bw = icon ? 16 : PX.measure(label) + 10;
        this.drawBtn(g, bx - bw, by, bw, tone);
        if (icon) add(this.add.image(bx - bw / 2, by + 6, this.key(icon)).setDepth(3703));
        else text(bx - bw + 5, by + 3, label, P.text);
        const z = add(this.add.zone(bx - bw - 1, by - 2, bw + 2, 16).setOrigin(0).setDepth(3704).setInteractive({ cursor: 'pointer' }));
        z.on('pointerdown', fn);
      };
      text(x + 5, y + 5, title[0], P.accent);
      if (title[1]) text(x + 5 + PX.measure(title[0]) + 6, y + 5, title[1], P.dim);
      let tx = x + 5 + PX.measure(title[0]) + 10;
      for (const t of tabs || []) {
        const tw = PX.measure(t.label) + 10;
        this.drawBtn(g, tx, y + 3, tw, t.on ? 'ok' : 'off');
        text(tx + 5, y + 6, t.label, t.on ? P.text : P.dim);
        const z = add(this.add.zone(tx - 1, y + 1, tw + 2, 16).setOrigin(0).setDepth(3704).setInteractive({ cursor: 'pointer' }));
        z.on('pointerdown', t.fn);
        tx += tw + 3;
      }
      button(x + w - 4, y + 3, '', null, () => this.closeModal(), 'ico-no');
      rows.forEach((row, i) => {
        const ry = y + 22 + i * RH;
        let tx = x + 6;
        if (row.img) {
          const im = add(this.add.image(tx, ry + 1, this.key(row.img)).setOrigin(0).setDepth(3703));
          if (row.dark) im.setTintFill(0x3a4466);
          tx += im.width + 4;
        }
        text(tx, ry, row.text, row.color);
        if (row.sub) text(tx, ry + 7, row.sub, row.subColor || P.dim);
        if (row.btn) button(x + w - 5, ry + 1, row.btn.label, row.btn.tone, row.btn.fn);
      });
      this.modal = { kind, objs };
      this.refreshRail();
    }
    closeModal() {
      if (!this.modal) return;
      for (const o of this.modal.objs) o.destroy();
      this.modal = null;
      this.refreshRail();
    }

    openBook() {
      if (this.modal && this.modal.kind === 'book') { this.closeModal(); return; }
      const st = this.state, bonus = Math.round((F.bookBonus(st) - 1) * 100);
      const rows = F.IDS.map((id) => {
        const f = F.FISH[id], seen = (st.fishBook[id] || 0) > 0, hold = st.fish[id] || 0;
        const price = Object.entries(f.price).map(([c, v]) => E.fmt(v) + LETTER[c]).join(' ');
        return {
          img: 'fish-' + id, dark: !seen,
          text: seen ? f.name + '  ' + f.rarity : '??? ' + f.rarity, color: seen ? RARITY[f.rarity] : this.S.P.dim,
          sub: seen ? 'CAUGHT ' + st.fishBook[id] + '  HOLD ' + hold + '  ' + price + ' EACH' : 'NOT CAUGHT YET',
          btn: hold ? { label: 'SELL ' + hold, tone: 'ok', fn: () => this.sellFish(id) } : null,
        };
      });
      rows.push({ text: 'TAP RIPPLES ON THE WATER BY DAY TO FISH', color: this.S.P.dim });
      this.openModal('book', ['FISH BOOK', 'EACH NEW KIND: +' + Math.round(F.BOOK_BONUS * 100) + '% INCOME (NOW +' + bonus + '%)'], 250, rows);
    }
    sellFish(id) {
      const res = F.sell(this.state, id);
      if (!res) return;
      this.banner('SOLD ' + res.n + ' ' + F.FISH[id].name + ' +' + bag(res.got), '#fee761');
      this.save();
      this.closeModal();
      this.openBook();
    }

    // two tabs: SOUND and GAME. `again` re-opens in place after a change (instead of toggling closed)
    openSettings(again, tab, armed) {
      if (this.modal && this.modal.kind === 'settings' && !again) { this.closeModal(); return; }
      tab = tab || this.settingsTab || 'sound';
      this.settingsTab = tab;
      const api = window.IslandGame, gridOn = this.registry.get('grid') !== false, mu = this.music, rows = [];
      const re = (t, a) => () => this.openSettings(true, t || tab, a);
      if (tab === 'sound') {
        if (mu && mu.ok) rows.push(
          { text: 'DAY MUSIC', sub: mu.track === 'off' ? 'SILENT (COIN SOUNDS STAY ON)' : IslandSongs.SONGS[mu.track].tag, btn: { label: mu.trackName(), tone: mu.track === 'off' ? 'off' : 'ok', fn: () => { mu.unlock(); mu.nextTrack(); re()(); } } },
          { text: 'VOLUME', sub: 'MUSIC AND COIN SOUNDS', btn: { label: mu.volName(), fn: () => { mu.nextVol(); re()(); } } },
          { text: 'COINS ON THE BEAT', sub: 'TAPS LAND ON THE MUSIC\'S BEAT', btn: { label: mu.snap ? 'ON' : 'OFF', tone: mu.snap ? 'ok' : 'off', fn: () => { mu.toggleSnap(); re()(); } } },
        );
        else rows.push({ text: 'NO SOUND IN THIS BROWSER', color: this.S.P.dim });
      } else {
        rows.push(
          { text: 'HOW TO PLAY', sub: 'ALL THE RULES', btn: { label: 'OPEN', fn: () => { this.closeModal(); api.showHelp(); } } },
          { text: 'MENU SIDE', sub: 'WHICH EDGE THE MENU SITS ON', btn: { label: this.side === 'left' ? 'LEFT' : 'RIGHT', fn: () => { this.closeModal(); api.setSide(this.side === 'left' ? 'right' : 'left'); } } },
          { text: 'TILE GRID', sub: 'DOTS ON BUILDABLE GRASS', btn: { label: gridOn ? 'ON' : 'OFF', tone: gridOn ? 'ok' : 'off', fn: () => { api.toggleGrid(); re()(); } } },
          { text: 'VIEW', sub: 'PINCH OR WHEEL TO ZOOM, DRAG TO PAN', btn: { label: 'RESET', fn: () => { this.resetView(); this.closeModal(); } } },
        );
        if (api.canFullscreen) rows.push({ text: 'FULLSCREEN', sub: 'HIDE THE BROWSER BARS', btn: { label: api.isFullscreen ? 'EXIT' : 'GO', fn: () => { api.toggleFullscreen(); this.closeModal(); } } });
        rows.push(
          { text: 'SKIP PHASE', sub: 'FOR TESTING (N)', btn: { label: 'SKIP', fn: () => { this.closeModal(); this.skipPhase(); } } },
          { text: 'NEW ISLAND', sub: armed ? 'TAP AGAIN TO WIPE YOUR SAVE' : 'START OVER FROM SCRATCH', subColor: armed ? '#e43b44' : null,
            btn: { label: armed ? 'SURE?' : 'WIPE', tone: 'danger', fn: () => { if (armed) api.newIsland(); else re(tab, true)(); } } },
        );
      }
      this.openModal('settings', ['SETTINGS'], 240, rows, [
        { label: 'SOUND', on: tab === 'sound', fn: re('sound') },
        { label: 'GAME', on: tab === 'game', fn: re('game') },
      ]);
    }

    // ------------------------------------------------------------ top bar
    buildUI() {
      const S = this.S, P = S.P, k = this.key;
      const txt = (x, y, s, color) => U(new PixelText(this, x, y, s, { color: color || P.text, outline: P.textOutline }).setOrigin(0, 0).setDepth(3001));
      // panels sized to the current layout
      PX.tex(this, k('topbar-' + UW), UW, TOP, (p) => ART.drawPanel(p, 0, -2, UW, TOP + 2, P.panel));
      PX.tex(this, k('drawer-' + UH), DW, UH - TOP, (p) => ART.drawPanel(p, 0, 0, DW, UH - TOP, P.panel));
      PX.tex(this, k('rail-' + UH), RAIL, UH - TOP, (p) => ART.drawPanel(p, 0, 0, RAIL, UH - TOP, P.panel));
      U(this.add.image(0, 0, k('topbar-' + UW)).setOrigin(0).setDepth(3000).setInteractive());
      this.curText = {};
      for (const [c, x] of [['bronze', 3], ['silver', 100], ['gold', 142], ['diamond', 184]]) {
        U(this.add.image(x, 2, k('ico-' + c)).setOrigin(0).setDepth(3001));
        this.curText[c] = txt(x + 11, 3, '0');
      }
      this.rateText = txt(60, 3, '', P.accent);
      this.phaseIcon = U(this.add.image(UW - 96, 2, k('ico-sun')).setOrigin(0).setDepth(3001));
      this.phaseText = txt(UW - 85, 3, '', P.accent);
      this.phaseBar = U(this.add.graphics().setDepth(3002));

      this.comboText = U(new PixelText(this, UW / 2, TOP + 4, 'COMBO x2', { color: P.accent, outline: P.worldOutline, scale: 2 }).setOrigin(0.5, 0).setDepth(3001).setVisible(false));
      this.comboBar = U(this.add.graphics().setDepth(3001));
      this.edgeG = U(this.add.graphics().setDepth(2990));
      this.buildOrderCard();
      this.buildItemBar();
      this.buildFishPanel();
      this.buildDock();
      this.buildRail();
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
      this.phaseBar.clear().fillStyle(col, 1).fillRect(0, TOP - 1, Math.round(UW * Math.max(0, frac)), 1);
    }

    update(time, dt) {
      const sec = Math.min(dt, 250) / 1000;
      E.tick(this.state, sec, this.eval);
      for (const ev of N.step(this.state, sec, this.S.lanes.length)) this.onCycle(ev);
      for (const ev of F.step(this.state, sec)) this.onFishing(ev);
      const cam = this.cameras.main;
      this.viewCenter = { x: cam.midPoint.x, y: cam.midPoint.y };
      if (this.music) {
        const cy = this.state.cycle, f = cy.t / N.DAY_LEN;
        this.music.follow(cy.phase, f < 0.34 ? 'morning' : f < 0.72 ? 'midday' : 'afternoon');
      }

      const night = this.state.cycle.phase === 'night', cast = this.state.fishing.cast;
      const want = cast && cast.phase === 'reel' ? cast.set[cast.pos] : null;
      const blink = Math.floor(time / 90) & 1;
      for (const v of this.views.values()) {
        if (!v.bubble) { if (v.aim) v.aim.setVisible(night && !!N.targetFor(this.state, v.b, this.cov)); continue; }
        const ready = E.isReady(v.b) && !(v.b.burn > 0);
        v.bubble.setVisible(ready);
        // PERFECT window: the bubble flashes gold right after it fills
        if (ready && E.isRipe(v.b)) v.bubble.setTint(blink ? 0xfee761 : 0xffffff); else v.bubble.clearTint();
        // brackets: can fire at a raider now, or makes the coin the hooked fish wants next
        const reel = !!want && B[v.b.type].cur === want && !(v.b.burn > 0);
        v.aim.setVisible(reel || (ready && night && !!N.targetFor(this.state, v.b, this.cov)));
      }
      for (const rv of this.raiders.values()) this.syncRaider(rv);
      const w = this.state.wallet;
      for (const c of E.CURRENCIES) this.curText[c].setText(E.fmt(w[c]));
      this.rateText.setX(this.curText.bronze.x + this.curText.bronze.width + 3).setText('+' + fmtRate((this.rates.bronze || 0) * F.bookBonus(this.state)) + '/S');
      this.refreshPhase();
      this.refreshOrderCard();
      this.refreshShip();
      this.refreshItemBar();
      this.refreshFishPanel(time);
      this.drawRipple(time);
      this.drawEdgeMarkers(time);

      this.antsG.clear();
      if (this.ants) this.dotPerimeter(this.antsG, this.ants.set, this.ants.col, Math.floor(time / 120));

      if (this.comboLeft > 0) {
        this.comboLeft -= dt;
        if (this.comboLeft <= 0) { this.combo = 0; this.comboText.setVisible(false); if (this.music) this.music.endStreak(); }
      }
      this.comboBar.clear();
      if (this.combo >= 2 && !cast) {
        const bw = Math.ceil(40 * this.comboLeft / (E.COMBO_WINDOW * 1000));
        this.comboBar.fillStyle(0x000000, 0.6).fillRect(UW / 2 - 21, TOP + 19, 42, 3);
        this.comboBar.fillStyle(hex(this.S.P.accent), 1).fillRect(UW / 2 - 20, TOP + 20, bw, 1);
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
