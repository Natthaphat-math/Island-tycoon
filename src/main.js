// main.js — boots Phaser at a fixed 320x180 internal resolution and scales it
// up by whole numbers only (nearest-neighbour), plus the page controls.
(function () {
  'use strict';
  const W = 320, H = 180;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('itc-' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('itc-' + k, v); } catch (e) { /* private mode */ } },
  };
  const state = { zoom: store.get('zoom', 'auto'), grid: true, side: store.get('side', 'left') === 'right' ? 'right' : 'left' };

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: W, height: H,
    pixelArt: true,        // nearest-neighbour sampling, no smoothing
    roundPixels: true,
    antialias: false,
    backgroundColor: '#10141f',
    scale: { mode: Phaser.Scale.NONE, zoom: 2 },
    banner: false,
  });
  game.registry.set('drawerSide', state.side);
  game.registry.set('grid', state.grid);
  game.scene.add('game', window.GameScene, true);
  const scene = () => game.scene.getScene('game');

  function fit() {
    if (!game.isBooted) return;
    const st = document.getElementById('stage');
    // Auto picks the largest whole multiple in *device* pixels, so every game
    // pixel is an exact NxN block of screen pixels even on 2.625x phones.
    const dpr = window.devicePixelRatio || 1;
    const auto = Math.max(1, Math.floor(Math.min(st.clientWidth * dpr / W, st.clientHeight * dpr / H)));
    const z = state.zoom === 'auto' ? auto / dpr : parseInt(state.zoom, 10);
    if (game.scale.zoom !== z) game.scale.setZoom(z);
    document.querySelector('#zoomBtns [data-z="auto"]').textContent = `Auto (${auto}×)`;
  }

  const api = window.IslandGame = {
    skipPhase() { scene().skipPhase(); },
    setSide(side) {
      state.side = side; store.set('side', side);
      game.registry.set('drawerSide', side);
      document.getElementById('sideBtn').textContent = 'Menu: ' + side;
      const sc = scene(); sc.save(); sc.scene.restart();
    },
    toggleGrid() {
      state.grid = !state.grid;
      game.registry.set('grid', state.grid);
      scene().gridObj.setVisible(state.grid);
      document.getElementById('gridBtn').setAttribute('aria-pressed', state.grid);
    },
    setZoom(z) {
      state.zoom = z; store.set('zoom', z); fit();
      document.querySelectorAll('#zoomBtns button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.z === z));
    },
    game,
    get state() { return scene().state; },
  };

  const zb = document.getElementById('zoomBtns');
  for (const z of ['auto', '1', '2', '3', '4', '5']) {
    const b = document.createElement('button');
    b.textContent = z === 'auto' ? 'Auto' : z + '×'; b.dataset.z = z;
    b.setAttribute('aria-pressed', z === state.zoom);
    b.onclick = () => { api.setZoom(z); b.blur(); };
    zb.appendChild(b);
  }
  // autosave: every few seconds and whenever the tab is hidden or closed
  const save = () => { const sc = scene(); if (sc && sc.state) sc.save(); };
  setInterval(save, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);

  // "New island" asks for a second tap instead of a confirm() dialog
  const reset = document.getElementById('resetBtn');
  let armed = null;
  reset.onclick = () => {
    if (!armed) {
      reset.dataset.armed = ''; reset.textContent = 'Tap again to wipe';
      armed = setTimeout(() => { delete reset.dataset.armed; reset.textContent = 'New island'; armed = null; }, 3000);
      return;
    }
    clearTimeout(armed); armed = null; delete reset.dataset.armed; reset.textContent = 'New island';
    try { localStorage.removeItem('itc-save-v1'); } catch (e) { /* ignore */ }
    game.registry.set('fresh', true);
    scene().scene.restart();
    document.body.classList.remove('menu-open');
  };

  const full = document.getElementById('fullBtn');
  const root = document.documentElement;
  if (root.requestFullscreen || root.webkitRequestFullscreen) {
    full.hidden = false;
    full.onclick = async () => {
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else {
          await (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        }
      } catch (e) { /* not allowed here */ }
      document.body.classList.remove('menu-open');
    };
  }
  document.getElementById('menuBtn').onclick = () => document.body.classList.toggle('menu-open');

  document.getElementById('skipBtn').onclick = (e) => { api.skipPhase(); e.target.blur(); };
  const sideBtn = document.getElementById('sideBtn');
  sideBtn.textContent = 'Menu: ' + state.side;
  sideBtn.onclick = (e) => { api.setSide(state.side === 'left' ? 'right' : 'left'); e.target.blur(); document.body.classList.remove('menu-open'); };
  document.getElementById('gridBtn').onclick = (e) => { api.toggleGrid(); e.target.blur(); };

  // rules table in the sidebar, generated from the core data so it never drifts
  const B = Core.BUILDINGS, name = (t) => B[t].name.toLowerCase();
  const rows = Core.RULES.map((ru) => {
    const targets = Object.keys(B).filter(ru.to).map(name).join(', ');
    return `<li>${name(ru.from)} → ${targets}: <b>${ru.mul ? '×' + ru.mul : '+' + Math.round(ru.add * 100) + '%'}</b></li>`;
  }).join('');
  document.getElementById('rules').innerHTML = rows;

  window.addEventListener('resize', fit);
  new ResizeObserver(fit).observe(document.getElementById('stage'));
  game.events.once('ready', fit);
})();
