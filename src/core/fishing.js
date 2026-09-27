// core/fishing.js — fishing (pure; no Phaser).
//
// During the day a ripple appears on the water near the shore. Tap it to cast.
// A fishing gauge starts part-full and drains all the time; if it empties, the
// fish gets away. The fish shows a SET of currencies (e.g. silver gold silver).
// Tap buildings that make those currencies, in order. After each correct tap you
// have WINDOW seconds for the next one, or the set restarts from its first coin.
// Every correct tap nudges the gauge up and finishing a set gives a big boost;
// then the next set appears. Fill the gauge to land the fish (always 2+ sets).
//
// Fish can ask for currencies your island can't make yet; that's a reason to build.
// Caught fish go to your hold (sell them) and the fish book (each species you have
// ever caught gives +BOOK_BONUS to all income, for good).
(function (root) {
  'use strict';
  const Decimal = root.Decimal || require('../../lib/break_eternity.min.js');
  const G = root.Core || require('./grid.js');
  const B = G.BUILDINGS;

  const WINDOW = 2;              // seconds allowed between taps inside a set
  const START_GAUGE = 0.3;
  const TAP_GAIN = 0.07;         // per correct tap
  const SET_GAIN = 0.22;         // bonus for finishing a set
  const BOOK_BONUS = 0.05;       // +5% income per species discovered
  const SPOT_LIFE = 10;          // a ripple lasts this long
  const SPOT_GAP = [10, 22];     // seconds between ripples

  // A small starting cast of fish. set: pattern of currency slots drawn from `pool`.
  const FISH = {
    sardine: { name: 'SARDINE', rarity: 'COMMON', weight: 55, pool: ['bronze'], setLen: 2, drain: 0.06, price: { bronze: 25 } },
    snapper: { name: 'SNAPPER', rarity: 'UNCOMMON', weight: 30, pool: ['bronze', 'silver'], setLen: 3, drain: 0.07, price: { silver: 3 } },
    tuna: { name: 'TUNA', rarity: 'RARE', weight: 12, pool: ['silver', 'gold'], setLen: 3, drain: 0.08, price: { gold: 1 } },
    pearlfish: { name: 'PEARLFISH', rarity: 'LEGENDARY', weight: 3, pool: ['gold', 'diamond'], setLen: 4, drain: 0.09, price: { diamond: 1 } },
  };
  const IDS = Object.keys(FISH);

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ensure(state) {
    if (!state.fishing) state.fishing = { spot: null, nextSpotAt: 8, cast: null, seed: 1 };
    if (!state.fish) state.fish = {};         // hold: id -> count
    if (!state.fishBook) state.fishBook = {}; // ever caught: id -> count
    return state.fishing;
  }

  // Global income multiplier from the fish book.
  function bookBonus(state) {
    const book = state.fishBook || {};
    return 1 + BOOK_BONUS * IDS.filter((id) => book[id] > 0).length;
  }

  // Water tiles that touch land (4-neighbour) — where ripples can appear.
  function spotTiles(state) {
    const out = [];
    for (let r = 1; r < state.rows - 1; r++) for (let c = 1; c < state.cols - 1; c++) {
      if (G.terrainAt(state, c, r) !== '.') continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => G.terrainAt(state, c + dx, r + dy) !== '.')) out.push([c, r]);
    }
    return out;
  }

  function makeSet(fish, rand) {
    const set = [];
    for (let i = 0; i < fish.setLen; i++) set.push(fish.pool[Math.floor(rand() * fish.pool.length)]);
    // make sure a mixed-pool fish really mixes its currencies
    if (fish.pool.length > 1 && set.every((c) => c === set[0])) set[set.length - 1] = fish.pool.find((c) => c !== set[0]);
    return set;
  }

  // Advance: ripples come and go during the day; the gauge drains while casting.
  // Returns events: { type: 'spot' } | { type: 'spotGone' } | { type: 'escaped', fish }.
  function step(state, dt) {
    const f = ensure(state), cy = state.cycle, ev = [];
    const day = cy && cy.phase === 'day';
    if (f.cast) {
      if (!day) { ev.push({ type: 'escaped', fish: f.cast.fish }); f.cast = null; return ev; }
      const c = f.cast;
      c.gauge -= FISH[c.fish].drain * dt;
      if (c.pos > 0) { c.window -= dt; if (c.window <= 0) { c.pos = 0; c.window = 0; ev.push({ type: 'reset' }); } }
      if (c.gauge <= 0) { ev.push({ type: 'escaped', fish: c.fish }); f.cast = null; }
      return ev;
    }
    if (!day) { if (f.spot) { f.spot = null; ev.push({ type: 'spotGone' }); } return ev; }
    const t = cy.t;
    if (f.spot && t >= f.spot.until) { f.spot = null; ev.push({ type: 'spotGone' }); f.nextSpotAt = t + SPOT_GAP[0]; }
    if (!f.spot && t >= f.nextSpotAt) {
      const rand = rng((cy.day * 977 + (f.seed++)) * 131);
      const tiles = spotTiles(state);
      if (tiles.length) {
        const [c, r] = tiles[Math.floor(rand() * tiles.length)];
        f.spot = { c, r, until: t + SPOT_LIFE };
        f.nextSpotAt = t + SPOT_LIFE + SPOT_GAP[0] + rand() * (SPOT_GAP[1] - SPOT_GAP[0]);
        ev.push({ type: 'spot', c, r });
      }
    }
    return ev;
  }

  // Tap the ripple: a fish bites (picked by rarity weight).
  function cast(state) {
    const f = ensure(state);
    if (!f.spot || f.cast) return null;
    const rand = rng(((state.cycle ? state.cycle.day : 1) * 389 + f.seed++) * 7);
    let roll = rand() * IDS.reduce((a, id) => a + FISH[id].weight, 0), fish = IDS[0];
    for (const id of IDS) { roll -= FISH[id].weight; if (roll < 0) { fish = id; break; } }
    f.cast = { fish, set: makeSet(FISH[fish], rand), pos: 0, window: 0, gauge: START_GAUGE, sets: 0, seed: Math.floor(rand() * 1e9) };
    f.spot = null;
    return f.cast;
  }

  // Tap a building while fishing. Returns { ok, reset?, setDone?, caught? } or null if not fishing.
  function tap(state, b) {
    const f = ensure(state), c = f.cast;
    if (!c) return null;
    const def = B[b.type];
    if (!def.cur || b.burn > 0) return { ok: false };
    if (def.cur !== c.set[c.pos]) {                 // wrong currency: this set starts over
      const had = c.pos > 0;
      c.pos = 0; c.window = 0;
      return { ok: false, reset: had };
    }
    c.pos++; c.window = WINDOW; c.gauge = Math.min(1, c.gauge + TAP_GAIN);
    const res = { ok: true };
    if (c.pos >= c.set.length) {
      c.sets++; res.setDone = true;
      c.gauge = Math.min(1, c.gauge + SET_GAIN);
      c.pos = 0; c.window = 0;
      c.set = makeSet(FISH[c.fish], rng(c.seed + c.sets * 101));
    }
    // never land a fish on the first set
    if (c.gauge >= 1 && c.sets >= 2) {
      state.fish[c.fish] = (state.fish[c.fish] || 0) + 1;
      state.fishBook[c.fish] = (state.fishBook[c.fish] || 0) + 1;
      res.caught = c.fish; res.first = state.fishBook[c.fish] === 1;
      f.cast = null;
    } else if (c.gauge >= 1) c.gauge = 0.99;
    return res;
  }

  function giveUp(state) { const f = ensure(state); const had = !!f.cast; f.cast = null; return had; }

  // Sell every fish of one kind from the hold.
  function sell(state, id) {
    ensure(state);
    const n = state.fish[id] || 0;
    if (!n || !FISH[id]) return null;
    const got = {};
    for (const [cur, v] of Object.entries(FISH[id].price)) {
      got[cur] = new Decimal(v).mul(n);
      state.wallet[cur] = state.wallet[cur].add(got[cur]);
    }
    state.fish[id] = 0;
    return { n, got };
  }

  // Rebuild from untrusted save data. A cast in progress is not restored.
  function restore(state, raw) {
    const clean = (o) => {
      const out = {};
      for (const id of IDS) { const v = o && o[id]; if (Number.isInteger(v) && v > 0) out[id] = Math.min(1e6, v); }
      return out;
    };
    state.fish = clean(raw && raw.fish);
    state.fishBook = clean(raw && raw.fishBook);
    state.fishing = { spot: null, nextSpotAt: 8, cast: null, seed: 1 };
    return state;
  }

  const api = { WINDOW, START_GAUGE, TAP_GAIN, SET_GAIN, BOOK_BONUS, SPOT_LIFE, FISH, IDS, ensure, bookBonus, spotTiles, step, cast, tap, giveUp, sell, restore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Fishing = api;
})(typeof window !== 'undefined' ? window : globalThis);
