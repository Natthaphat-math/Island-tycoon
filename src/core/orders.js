// core/orders.js — villager orders: one small daytime goal at a time
// ("TAP HUT x4", "STREAK OF 6", "3 PERFECT TAPS", "EARN 120 BRONZE", "BUILD A FARM").
// Finishing one pays bronze and the next arrives shortly after. Orders only
// progress during the day; a new day brings a fresh one. No penalty for failing.
(function (root) {
  'use strict';
  const Decimal = root.Decimal || require('../../lib/break_eternity.min.js');
  const G = root.Core || require('./grid.js');
  const E = root.Economy || require('./economy.js');
  const B = G.BUILDINGS;
  const KINDS = ['collect', 'streak', 'perfect', 'earn', 'build'];

  const reward = (day, n) => new Decimal(20).mul(Decimal.pow(1.35, day)).mul(1 + n * 0.25).floor();

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
    if (!state.orders) state.orders = { day: 0, n: 0, active: null };
    return state.orders;
  }

  // Draw the next order for today (deterministic per day + order number).
  function next(state) {
    const o = ensure(state), day = state.cycle ? state.cycle.day : 1;
    if (o.day !== day) { o.day = day; o.n = 0; }
    const rand = rng(day * 1009 + o.n * 7919 + 3);
    const producers = [...new Set(state.buildings.filter((b) => B[b.type].cur && B[b.type].base > 0).map((b) => b.type))];
    const buildable = Object.keys(B).filter((t) => B[t].cost[0] === 'bronze' && E.costOf(state, t).amount.lte(Decimal.max(60, state.wallet.bronze.mul(2))));
    const kinds = KINDS.filter((k) => (k === 'collect' || k === 'streak' || k === 'perfect' ? producers.length : k === 'build' ? buildable.length : true));
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const pickFrom = (arr) => arr[Math.floor(rand() * arr.length)];
    let a;
    if (kind === 'collect') { const type = pickFrom(producers), n = 3 + Math.floor(rand() * 4); a = { kind, type, n, text: 'TAP ' + B[type].name + ' x' + n }; }
    else if (kind === 'streak') { const n = 4 + Math.floor(rand() * 4); a = { kind, n, text: 'STREAK OF ' + n }; }
    else if (kind === 'perfect') { const n = 2 + Math.floor(rand() * 3); a = { kind, n, text: n + ' PERFECT TAPS' }; }
    else if (kind === 'earn') { const n = reward(day, 0).mul(2); a = { kind, n: n.toString(), text: 'EARN ' + E.fmt(n) + ' BRONZE' }; }
    else { const type = pickFrom(buildable); a = { kind, type, n: 1, text: 'BUILD A ' + B[type].name }; }
    a.progress = kind === 'earn' ? '0' : 0;
    a.reward = reward(day, o.n).toString();
    o.active = a; o.n++;
    return a;
  }

  // Feed a player action in. evt: { kind: 'collect', type, cur, amount, perfect, combo } | { kind: 'build', type }
  // Returns { done, order, reward } when an order completes, else null.
  function record(state, evt) {
    const o = ensure(state), a = o.active;
    if (!a || !state.cycle || state.cycle.phase !== 'day') return null;
    if (a.kind === 'collect' && evt.kind === 'collect' && evt.type === a.type) a.progress++;
    else if (a.kind === 'streak' && evt.kind === 'collect') a.progress = Math.max(a.progress, evt.combo || 0);
    else if (a.kind === 'perfect' && evt.kind === 'collect' && evt.perfect) a.progress++;
    else if (a.kind === 'earn' && evt.kind === 'collect' && evt.cur === 'bronze') a.progress = new Decimal(a.progress).add(evt.amount).toString();
    else if (a.kind === 'build' && evt.kind === 'build' && evt.type === a.type) a.progress++;
    else return null;
    if (!isDone(a)) return null;
    const pay = new Decimal(a.reward);
    state.wallet.bronze = state.wallet.bronze.add(pay);
    o.active = null;
    return { done: true, order: a, reward: pay };
  }

  const isDone = (a) => (a.kind === 'earn' ? new Decimal(a.progress).gte(a.n) : a.progress >= a.n);
  const progressText = (a) => (a.kind === 'earn'
    ? E.fmt(Decimal.min(a.progress, a.n)) + '/' + E.fmt(a.n)
    : Math.min(a.progress, a.n) + '/' + a.n);

  // Rebuild from untrusted save data (drop anything odd; a fresh order comes next day).
  function restore(state, raw) {
    const o = { day: 0, n: 0, active: null };
    if (raw && typeof raw === 'object') {
      if (Number.isInteger(raw.day)) o.day = raw.day;
      if (Number.isInteger(raw.n) && raw.n >= 0) o.n = raw.n;
      const a = raw.active;
      const numOk = (x) => (typeof x === 'number' && x >= 0) || (typeof x === 'string' && !new Decimal(x).isNan());
      if (a && KINDS.includes(a.kind) && numOk(a.n) && numOk(a.progress) && numOk(a.reward) && typeof a.text === 'string' && a.text.length < 40
          && (a.type == null || B[a.type])) {
        o.active = { kind: a.kind, type: a.type, n: a.n, progress: a.progress, reward: String(a.reward), text: a.text };
      }
    }
    state.orders = o;
    return o;
  }

  const api = { KINDS, reward, ensure, next, record, isDone, progressText, restore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Orders = api;
})(typeof window !== 'undefined' ? window : globalThis);
