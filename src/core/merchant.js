// core/merchant.js — the merchant ship: a daytime visitor that sells night tools
// and swaps currencies. It is a money sink with a timer: it arrives once a day at a
// random moment, stays SHIP_STAY seconds, then sails off.
//
// Night tools (stored in state.items):
//   bucket  - the next building that catches fire is saved instantly (used up automatically)
//   net     - used automatically at nightfall: every raider that night paddles 30% slower
//   cannon  - fire it from the night toolbar: knocks the next coin off the raider closest to shore
(function (root) {
  'use strict';
  const Decimal = root.Decimal || require('../../lib/break_eternity.min.js');
  const E = root.Economy || require('./economy.js');
  const SHIP_STAY = 30, MAX_ITEM = 5;
  const D = (x) => new Decimal(x);
  const grow = (base, day, g) => D(base).mul(Decimal.pow(g, day - 1)).ceil();

  const CATALOG = {
    bucket: { name: 'FIRE BUCKET', desc: 'SAVES THE NEXT FIRE', price: (d) => ({ cur: 'bronze', amount: grow(30, d, 1.3) }), item: 'bucket' },
    net: { name: 'FISHING NET', desc: 'RAIDERS 30% SLOWER', price: (d) => ({ cur: 'bronze', amount: grow(60, d, 1.3) }), item: 'net' },
    cannon: { name: 'CANNONBALL', desc: 'KNOCKS OFF 1 COIN', price: (d) => ({ cur: 'bronze', amount: grow(80, d, 1.3) }), item: 'cannon' },
    silver: { name: 'SILVER x5', desc: 'SWAP BRONZE', price: (d) => ({ cur: 'bronze', amount: grow(100, d, 1.2) }), gives: { silver: 5 } },
    gold: { name: 'GOLD x1', desc: 'SWAP SILVER', price: (d) => ({ cur: 'silver', amount: grow(20, d, 1.2) }), gives: { gold: 1 } },
  };
  const KEYS = Object.keys(CATALOG);

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

  function items(state) {
    if (!state.items) state.items = { bucket: 0, net: 0, cannon: 0 };
    return state.items;
  }

  // Schedule today's visit: arrival time and three offers (always one exchange).
  function plan(state) {
    const day = state.cycle ? state.cycle.day : 1, rand = rng(day * 4513 + 7);
    const arriveAt = 15 + Math.floor(rand() * 30);
    const tools = ['bucket', 'net', 'cannon'].sort(() => rand() - 0.5).slice(0, 2);
    const swap = rand() < 0.6 ? 'silver' : 'gold';
    state.merchant = { day, arriveAt, leaveAt: arriveAt + SHIP_STAY, offers: [...tools, swap], sold: [] };
    return state.merchant;
  }
  function ensure(state) {
    const day = state.cycle ? state.cycle.day : 1;
    if (!state.merchant || state.merchant.day !== day) plan(state);
    items(state);
    return state.merchant;
  }
  function here(state) {
    const m = ensure(state), cy = state.cycle;
    return !!cy && cy.phase === 'day' && cy.t >= m.arriveAt && cy.t < m.leaveAt;
  }

  function offers(state) {
    const m = ensure(state), day = m.day;
    return m.offers.map((k, i) => ({ i, key: k, ...CATALOG[k], cost: CATALOG[k].price(day), sold: m.sold.includes(i) }));
  }

  // Buy offer i while the ship is here. Returns what was bought or null.
  function buy(state, i) {
    if (!here(state)) return null;
    const m = ensure(state), o = offers(state)[i];
    if (!o || o.sold) return null;
    const it = items(state);
    if (o.item && it[o.item] >= MAX_ITEM) return null;
    if (state.wallet[o.cost.cur].lt(o.cost.amount)) return null;
    state.wallet[o.cost.cur] = state.wallet[o.cost.cur].sub(o.cost.amount);
    if (o.item) it[o.item]++;
    for (const [c, v] of Object.entries(o.gives || {})) state.wallet[c] = state.wallet[c].add(v);
    m.sold.push(i);
    return o;
  }

  // Rebuild from untrusted save data.
  function restore(state, rawItems, rawMerchant) {
    const it = { bucket: 0, net: 0, cannon: 0 };
    for (const k of Object.keys(it)) {
      const v = rawItems && rawItems[k];
      if (Number.isInteger(v) && v > 0) it[k] = Math.min(MAX_ITEM, v);
    }
    state.items = it;
    const m = rawMerchant;
    if (m && Number.isInteger(m.day) && Array.isArray(m.offers) && m.offers.length === 3 && m.offers.every((k) => KEYS.includes(k))
        && typeof m.arriveAt === 'number' && Array.isArray(m.sold)) {
      state.merchant = { day: m.day, arriveAt: m.arriveAt, leaveAt: m.arriveAt + SHIP_STAY, offers: m.offers.slice(), sold: m.sold.filter((x) => Number.isInteger(x) && x >= 0 && x < 3) };
    } else delete state.merchant;
    return state.items;
  }

  const api = { SHIP_STAY, MAX_ITEM, CATALOG, items, plan, ensure, here, offers, buy, restore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Merchant = api;
})(typeof window !== 'undefined' ? window : globalThis);
