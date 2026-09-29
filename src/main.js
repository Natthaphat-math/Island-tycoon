// main.js — boots Phaser to fill the whole screen at device resolution (one game
// pixel = one device pixel, so pixel art stays crisp at any size), keeps it sized
// to the screen, and wires the page's few controls.
// The scene picks whole-number UI and world scales from the size it gets.
(function () {
  'use strict';
  const store = {
    get(k, d) { try { const v = localStorage.getItem('itc-' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('itc-' + k, v); } catch (e) { /* private mode */ } },
  };
  const state = { grid: store.get('grid', '1') !== '0', side: store.get('side', 'left') === 'right' ? 'right' : 'left' };
  const host = document.getElementById('game');
  const dpr = () => window.devicePixelRatio || 1;
  const size = () => ({ w: Math.max(320, Math.round(host.clientWidth * dpr())), h: Math.max(180, Math.round(host.clientHeight * dpr())) });

  const s0 = size();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: s0.w, height: s0.h,
    pixelArt: true,        // nearest-neighbour sampling, no smoothing
    roundPixels: true,
    antialias: false,
    backgroundColor: '#124e89',
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr() },
    input: { activePointers: 2 },
    banner: false,
  });
  game.registry.set('drawerSide', state.side);
  game.registry.set('grid', state.grid);
  game.scene.add('game', window.GameScene, true);
  const scene = () => game.scene.getScene('game');

  // follow the screen: rotation, window resizes, browser bars coming and going
  let pending = null;
  function fit() {
    if (!game.isBooted) return;
    const s = size(), z = 1 / dpr();
    if (game.scale.width !== s.w || game.scale.height !== s.h) game.scale.resize(s.w, s.h);
    if (game.scale.zoom !== z) game.scale.setZoom(z);
  }
  const fitSoon = () => { clearTimeout(pending); pending = setTimeout(fit, 80); };

  const root = document.documentElement;
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const api = window.IslandGame = {
    skipPhase() { scene().skipPhase(); },
    newIsland() {
      try { localStorage.removeItem('itc-save-v1'); } catch (e) { /* ignore */ }
      game.registry.set('fresh', true);
      scene().scene.restart();
    },
    get side() { return state.side; },
    setSide(side) {
      state.side = side; store.set('side', side);
      game.registry.set('drawerSide', side);
      const sc = scene(); sc.save(); sc.scene.restart();
    },
    toggleGrid() {
      state.grid = !state.grid; store.set('grid', state.grid ? '1' : '0');
      game.registry.set('grid', state.grid);
      const sc = scene(); sc.gridObj.setVisible(state.grid || sc.edit);
    },
    showHelp() { document.getElementById('info').hidden = false; },
    // iPhone Safari has no fullscreen API (Add to Home Screen instead); iPad and desktops do
    canFullscreen: !!(root.requestFullscreen || root.webkitRequestFullscreen),
    get isFullscreen() { return !!fsEl(); },
    async toggleFullscreen() {
      try {
        if (fsEl()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else {
          await (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        }
      } catch (e) { /* not allowed here */ }
      fitSoon();
    },
    game,
    get state() { return scene().state; },
  };

  // autosave: every few seconds and whenever the tab is hidden or closed
  const save = () => { const sc = scene(); if (sc && sc.state) sc.save(); };
  setInterval(save, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);

  // how-to-play overlay
  const info = document.getElementById('info');
  document.getElementById('helpClose').onclick = () => { info.hidden = true; };
  const full = document.getElementById('fullBtn');
  if (api.canFullscreen) { full.hidden = false; full.onclick = () => api.toggleFullscreen(); }

  // rules table in the help, generated from the core data so it never drifts
  const B = Core.BUILDINGS, name = (t) => B[t].name.toLowerCase();
  const rows = Core.RULES.map((ru) => {
    const targets = Object.keys(B).filter(ru.to).map(name).join(', ');
    return `<li>${name(ru.from)} → ${targets}: <b>${ru.mul ? '×' + ru.mul : '+' + Math.round(ru.add * 100) + '%'}</b></li>`;
  }).join('');
  document.getElementById('rules').innerHTML = rows;

  window.addEventListener('resize', fitSoon);
  window.addEventListener('orientationchange', fitSoon);
  document.addEventListener('fullscreenchange', fitSoon);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitSoon);
  new ResizeObserver(fitSoon).observe(host);
  game.events.once('ready', fit);
})();
