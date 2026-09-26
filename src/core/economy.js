// core/economy.js — money on top of the placement rules (still no Phaser).
// All currency amounts are break_eternity Decimals so late-game numbers can grow
// past 1e308 (and on to e1e10, 10^^5 ...) without ever becoming Infinity.
(function (root) {
  'use strict';
  const Decimal = root.Decimal || require('../../lib/break_eternity.min.js');
  const G = root.Core || require('./grid.js');
  const B = G.BUILDINGS;

  // Tuning knobs (placeholders).
  const CURRENCIES = ['bronze', 'silver', 'gold', 'diamond'];
  const START = { bronze: 50 };
  const PRICE_GROWTH = 1.15;  // each copy of a building costs 15% more
  const REFUND = 0.5;         // removing gives back half of what the last copy cost
  const COMBO_WINDOW = 2.6;   // seconds between taps to keep a streak
  const COMBO_STEP = 0.1;     // +10% per streak step
  const COMBO_MAX = 3;        // capped at x3
  const RIPE_WINDOW = 1.5;    // tap within this many seconds of filling up...
  const RIPE_BONUS = 1.5;     // ...for a PERFECT collect worth x1.5
  const SAVE_VERSION = 1;

  const D = (x) => new Decimal(x);

  function newWallet() {
    const w = {};
    for (const c of CURRENCIES) w[c] = D(START[c] || 0);
    return w;
  }

  function newGame(map, layout) {
    const state = G.createState(map);
    for (const b of layout) G.place(state, b.id, b.c, b.r, b.rot || 0);
    state.wallet = newWallet();
    return state;
  }

  const countOf = (state, type) => state.buildings.filter((b) => b.type === type).length;
  const priceAt = (type, n) => D(B[type].cost[1]).mul(Decimal.pow(PRICE_GROWTH, n)).ceil();

  function costOf(state, type) { return { cur: B[type].cost[0], amount: priceAt(type, countOf(state, type)) }; }
  function canAfford(state, type) { const c = costOf(state, type); return state.wallet[c.cur].gte(c.amount); }

  // Place and pay, or return null (blocked or too expensive).
  function buy(state, type, c, r, rot) {
    const cost = costOf(state, type);
    if (!state.wallet[cost.cur].gte(cost.amount)) return null;
    const b = G.place(state, type, c, r, rot);
    if (b) state.wallet[cost.cur] = state.wallet[cost.cur].sub(cost.amount);
    return b;
  }

  function refundOf(state, type) {
    return { cur: B[type].cost[0], amount: priceAt(type, Math.max(0, countOf(state, type) - 1)).mul(REFUND).floor() };
  }
  function sell(state, id) {
    const b = state.buildings.find((x) => x.id === id);
    if (!b) return null;
    const ref = refundOf(state, b.type);
    G.remove(state, id);
    state.wallet[ref.cur] = state.wallet[ref.cur].add(ref.amount);
    return ref;
  }

  const comboMult = (n) => Math.min(COMBO_MAX, 1 + COMBO_STEP * Math.max(0, n - 1));
  const isReady = (b) => (b.fill || 0) >= 1;
  // One full cycle's worth of this building's current output.
  function batch(state, b, ev) {
    const def = B[b.type];
    return D(ev.get(b.id).output).mul(def.cycle);
  }

  // Advance time. Buildings fill up and then simply wait, full, until tapped:
  // there is no auto-collect and no offline income, so the island only earns
  // while you play. Burning buildings don't fill at all.
  function tick(state, dt, ev = G.evaluate(state)) {
    for (const b of state.buildings) {
      const def = B[b.type];
      if (!def.cur || b.burn > 0 || !(ev.get(b.id).output > 0)) continue;
      if (!isReady(b)) { b.fill = Math.min(1, (b.fill || 0) + dt / def.cycle); b.wait = 0; }
      else b.wait = (b.wait || 0) + dt;   // how long it has been sitting full
    }
  }
  const isRipe = (b) => isReady(b) && (b.wait || 0) <= RIPE_WINDOW && !(b.burn > 0);

  // Tap a full building: collect one batch times the streak multiplier.
  function collect(state, id, combo, ev = G.evaluate(state)) {
    const b = state.buildings.find((x) => x.id === id);
    if (!b || !isReady(b) || b.burn > 0) return null;
    const perfect = isRipe(b);
    const def = B[b.type], amount = batch(state, b, ev).mul(comboMult(combo)).mul(perfect ? RIPE_BONUS : 1);
    state.wallet[def.cur] = state.wallet[def.cur].add(amount);
    b.fill = 0; b.wait = 0;
    return { id, type: b.type, cur: def.cur, amount, perfect };
  }

  // ---- saves: plain JSON (Decimals as strings), validated on the way back in
  function serialize(state) {
    return JSON.stringify({ v: SAVE_VERSION, t: Date.now(), state });
  }
  function deserialize(json, map) {
    const data = JSON.parse(json);
    if (!data || data.v !== SAVE_VERSION || !data.state) throw new Error('unknown save format');
    const s = G.createState(map), src = data.state;
    for (const b of src.buildings || []) {
      if (!B[b.type] || !Number.isInteger(b.c) || !Number.isInteger(b.r)) continue;
      const nb = G.place(s, b.type, b.c, b.r, (b.rot | 0) % 4, Number.isInteger(b.id) && b.id > 0 ? b.id : undefined);
      if (nb) {
        nb.fill = Math.min(1, Math.max(0, +b.fill || 0));
        const burn = Math.floor(+b.burn || 0);
        if (burn > 0) nb.burn = Math.min(20, burn);
      }
    }
    s.nextId = Math.max(s.nextId, ...s.buildings.map((b) => b.id + 1));
    s.wallet = newWallet();
    for (const c of CURRENCIES) {
      const v = src.wallet && src.wallet[c];
      if (v == null) continue;
      const d = D(v);
      if (!d.isNan() && d.gte(0)) s.wallet[c] = d;
    }
    return { state: s, savedAt: data.t, raw: src };
  }

  // Human-readable big numbers: 999 · 12.3K · 4.56T · 7.89e123 · ee12.34
  function fmt(x) {
    const d = D(x);
    if (d.lt(1000)) {
      const n = d.toNumber();
      return n >= 100 ? String(Math.floor(n)) : String(Math.floor(n * 10) / 10);
    }
    if (d.lt(1e15)) {
      const e = Math.floor(d.log10().toNumber() / 3), m = d.div(Decimal.pow(1000, e)).toNumber();
      return (m < 10 ? m.toFixed(2) : m < 100 ? m.toFixed(1) : Math.floor(m)) + ['', 'K', 'M', 'B', 'T'][e];
    }
    if (d.lt('1e1000000')) {
      const e = Math.floor(d.log10().toNumber());
      return d.div(Decimal.pow(10, e)).toNumber().toFixed(2) + 'e' + e;
    }
    return 'ee' + d.log10().log10().toNumber().toFixed(2);
  }

  const api = {
    Decimal, CURRENCIES, START, PRICE_GROWTH, REFUND, COMBO_WINDOW, COMBO_MAX, RIPE_WINDOW, RIPE_BONUS, isRipe,
    newWallet, newGame, costOf, canAfford, buy, refundOf, sell, comboMult, isReady, batch, tick, collect,
    serialize, deserialize, fmt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Economy = api;
})(typeof window !== 'undefined' ? window : globalThis);
