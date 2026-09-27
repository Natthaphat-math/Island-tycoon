// core/night.js — the day/dusk/night/dawn loop and raiders (still no Phaser).
//
// DAY   (DAY_LEN s)  tap buildings, build.
// DUSK  (DUSK_LEN s) raiders appear offshore showing their currency sequence;
//                    time to move buildings into tower coverage.
// NIGHT (until every raider is sunk or has landed) raiders paddle in. Tapping a
//       FULL building that stands inside tower coverage fires its batch at the
//       raider whose next pip matches that building's currency (the one closest
//       to shore first). Finish a raider's sequence to sink it and take its loot.
//       A raider that lands steals STEAL of each currency and sets a building on
//       fire (tap it BURN_TAPS times to put it out; while it burns it produces
//       nothing and drains BURN_DRAIN of your bronze every second).
// DAWN  (DAWN_LEN s) night report, then the next day.
(function (root) {
  'use strict';
  const Decimal = root.Decimal || require('../../lib/break_eternity.min.js');
  const G = root.Core || require('./grid.js');
  const E = root.Economy || require('./economy.js');
  const B = G.BUILDINGS;

  // Tuning knobs (placeholders).
  const DAY_LEN = 90, DUSK_LEN = 12, DAWN_LEN = 6;
  const BURN_TAPS = 10, STEAL = 0.1, BURN_DRAIN = 0.01; // drain: 1% of bronze per second per fire (min 1)
  const SPREAD_AFTER = 6;      // a fire left alone this long jumps to a touching building (and again every 6s)
  const TOWER_COOLDOWN = 3;    // seconds before a watchtower can answer another shield pip
  const TOWER_PIP_FROM = 3, TOWER_PIP_CHANCE = 0.18, BOSS_EVERY = 5;
  const NET_SLOW = 0.3;        // a net makes that night's raiders 30% slower
  const towerCooldown = (b) => Math.max(1, TOWER_COOLDOWN - 0.5 * (G.levelOf(b) - 1)); // upgrades reload faster
  const PHASES = ['day', 'dusk', 'night', 'dawn'];
  // at least 3 raiders a night; more than there are lanes queue up further out to sea
  const raiderCount = (day) => Math.min(8, 3 + Math.floor((day - 1) / 2));
  const seqLength = (day) => Math.min(6, 2 + Math.floor((day - 1) / 2));
  const approachSecs = (day) => Math.max(25, 50 - day * 2);
  const lootBronze = (day) => new Decimal(15).mul(Decimal.pow(1.35, day)).floor();
  const diamondChance = (day) => Math.min(0.5, 0.15 + 0.02 * day);

  // small seeded RNG so a given day always brings the same raiders
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

  function newCycle() {
    return { day: 1, phase: 'day', t: 0, raiders: [], report: null };
  }
  function ensure(state) {
    if (!state.cycle) state.cycle = newCycle();
    return state.cycle;
  }

  // tiles guarded by any watchtower
  function coverage(state) {
    const set = new Set();
    for (const b of state.buildings) {
      if (B[b.type].kind !== 'defense') continue;
      for (const k of G.auraCells(state, b).keys()) set.add(k);
    }
    return set;
  }
  function isCovered(state, b, cov = coverage(state)) {
    return G.footprint(b).some(([c, r]) => cov.has(c + ',' + r));
  }

  // currencies the island can actually make, so every raider is beatable in principle
  function producible(state) {
    const have = new Set(state.buildings.map((b) => B[b.type]).filter((d) => d.cur && d.base > 0).map((d) => d.cur));
    const out = E.CURRENCIES.filter((c) => have.has(c));
    return out.length ? out : ['bronze'];
  }

  function planNight(state, lanes) {
    const cy = ensure(state), day = cy.day;
    const rand = rng(day * 7919 + 17);
    const curs = producible(state), n = raiderCount(day), len = seqLength(day);
    const hasTower = state.buildings.some((b) => B[b.type].kind === 'defense');
    const order = [...Array(lanes).keys()].sort(() => rand() - 0.5);
    const boss = day % BOSS_EVERY === 0;
    cy.raiders = [];
    for (let i = 0; i < n; i++) {
      const isBoss = boss && i === 0;
      const seq = [];
      for (let k = 0; k < len + (isBoss ? 3 : 0); k++) {
        // shield pips (tap a watchtower itself) show up from day TOWER_PIP_FROM
        if (hasTower && day >= TOWER_PIP_FROM && k > 0 && rand() < TOWER_PIP_CHANCE) { seq.push('tower'); continue; }
        // bronze is common, rarer currencies show up less often
        const roll = rand();
        seq.push(curs[Math.min(curs.length - 1, Math.floor(Math.pow(roll, 1.6) * curs.length))]);
      }
      const wave = Math.floor(i / lanes);
      cy.raiders.push({
        id: i + 1, lane: order[i % lanes], seq, hit: 0, boss: isBoss,
        progress: wave ? -0.6 * wave : 0,    // later waves wait further out to sea
        status: 'coming', speed: (isBoss ? 0.7 : 1) / (approachSecs(day) + (i % lanes) * 4),
      });
    }
    cy.report = { sunk: 0, landed: 0, loot: {}, stolen: {}, fires: 0 };
    return cy.raiders;
  }

  const addTo = (bag, cur, amount) => { bag[cur] = (bag[cur] ? new Decimal(bag[cur]) : new Decimal(0)).add(amount); };

  // a fire bucket from the merchant saves the building instead
  function ignite(state, b) {
    const it = state.items;
    if (it && it.bucket > 0) { it.bucket--; return false; }
    b.burn = BURN_TAPS; b.burnT = 0; b.spreadT = 0;
    return true;
  }

  function land(state, r, rand) {
    const cy = state.cycle, stolen = {};
    for (const c of ['bronze', 'silver', 'gold']) {
      const amt = state.wallet[c].mul(STEAL).floor();
      if (amt.gt(0)) { state.wallet[c] = state.wallet[c].sub(amt); stolen[c] = amt; addTo(cy.report.stolen, c, amt); }
    }
    const targets = state.buildings.filter((b) => B[b.type].cur && !(b.burn > 0));
    let fire = null, saved = null;
    if (targets.length) {
      const b = targets[Math.floor(rand() * targets.length)];
      if (ignite(state, b)) { fire = b.id; cy.report.fires++; } else saved = b.id;
    }
    r.status = 'landed'; cy.report.landed++;
    return { type: 'land', raider: r.id, stolen, fire, saved };
  }

  // Advance the clock. Returns events for the view: dusk, night, land, dawn, day.
  // Fires burn in every phase: each burning building takes BURN_DRAIN of your
  // bronze once per second (at least 1, never below zero).
  // buildings whose footprint touches b's (Chebyshev distance 1)
  function neighbours(state, b) {
    const mine = G.footprint(b);
    return state.buildings.filter((o) => o.id !== b.id && G.footprint(o).some(([c, r]) => mine.some(([x, y]) => Math.abs(x - c) <= 1 && Math.abs(y - r) <= 1)));
  }

  // Fires burn in every phase: each burning building takes BURN_DRAIN of your
  // bronze once per second (at least 1, never below zero), and one left alone for
  // SPREAD_AFTER seconds sets a touching building alight.
  function burn(state, dt) {
    const events = [];
    const report = state.cycle && state.cycle.phase !== 'day' ? state.cycle.report : null;
    for (const b of [...state.buildings]) {
      if (!(b.burn > 0)) continue;
      b.burnT = (b.burnT || 0) + dt;
      while (b.burnT >= 1) {
        b.burnT -= 1;
        const w = state.wallet.bronze;
        const amt = Decimal.min(w, Decimal.max(1, w.mul(BURN_DRAIN).floor()));
        if (amt.lte(0)) continue;
        state.wallet.bronze = w.sub(amt);
        if (report) addTo(report.stolen, 'bronze', amt);
        events.push({ type: 'burn', id: b.id, amount: amt });
      }
      b.spreadT = (b.spreadT || 0) + dt;
      if (b.spreadT >= SPREAD_AFTER) {
        b.spreadT = 0;
        const cands = neighbours(state, b).filter((o) => !(o.burn > 0));
        if (cands.length) {
          const t = cands[Math.floor(rng(b.id * 131 + state.buildings.length * 17 + Math.floor((state.cycle ? state.cycle.t : 0) * 10))() * cands.length)];
          if (ignite(state, t)) {
            if (report) report.fires++;
            events.push({ type: 'spread', from: b.id, id: t.id });
          } else events.push({ type: 'saved', id: t.id });
        }
      }
    }
    return events;
  }

  function step(state, dt, lanes = 4) {
    const cy = ensure(state), events = burn(state, dt);
    cy.t += dt;
    for (const b of state.buildings) if (b.cool > 0) b.cool = Math.max(0, b.cool - dt);
    if (cy.phase === 'day' && cy.t >= DAY_LEN) {
      cy.phase = 'dusk'; cy.t = 0; planNight(state, lanes);
      events.push({ type: 'dusk' });
    } else if (cy.phase === 'dusk' && cy.t >= DUSK_LEN) {
      cy.phase = 'night'; cy.t = 0;
      events.push({ type: 'night' });
      // a fishing net from the merchant slows the whole night's raiders
      if (state.items && state.items.net > 0) {
        state.items.net--;
        for (const r of cy.raiders) r.speed *= 1 - NET_SLOW;
        events.push({ type: 'net' });
      }
    } else if (cy.phase === 'night') {
      const rand = rng(cy.day * 104729 + Math.floor(cy.t * 10));
      for (const r of cy.raiders) {
        if (r.status !== 'coming') continue;
        r.progress = Math.min(1, r.progress + dt * r.speed);
        if (r.progress >= 1) events.push(land(state, r, rand));
      }
      if (cy.raiders.every((r) => r.status !== 'coming')) {
        cy.phase = 'dawn'; cy.t = 0;
        events.push({ type: 'dawn', report: cy.report });
      }
    } else if (cy.phase === 'dawn' && cy.t >= DAWN_LEN) {
      cy.day++; cy.phase = 'day'; cy.t = 0; cy.raiders = [];
      events.push({ type: 'day', day: cy.day });
    }
    return events;
  }

  // Skip straight to the next phase boundary (for testing / impatient players).
  function skip(state, lanes = 4) {
    const cy = ensure(state);
    const len = { day: DAY_LEN, dusk: DUSK_LEN, dawn: DAWN_LEN }[cy.phase];
    return len ? step(state, len - cy.t, lanes) : [];
  }

  // Which raider would a tap on this building hit right now? (null = none)
  function targetFor(state, b, cov = coverage(state)) {
    const cy = ensure(state), def = B[b.type];
    if (cy.phase !== 'night' || b.burn > 0) return null;
    let want;
    if (def.kind === 'defense') { if (b.cool > 0) return null; want = 'tower'; }     // towers answer shield pips
    else { if (!def.cur || !E.isReady(b) || !isCovered(state, b, cov)) return null; want = def.cur; }
    const cands = cy.raiders.filter((r) => r.status === 'coming' && r.seq[r.hit] === want);
    cands.sort((x, y) => y.progress - x.progress);
    return cands[0] || null;
  }

  // Knock the next coin off raider r; sinking it pays loot.
  function hitRaider(state, r) {
    const cy = state.cycle;
    r.hit++;
    const res = { raider: r.id, sunk: false, loot: null };
    if (r.hit >= r.seq.length) {
      r.status = 'sunk'; cy.report.sunk++;
      const loot = { bronze: lootBronze(cy.day).mul(r.boss ? 5 : 1) };
      if (r.boss || rng(cy.day * 31 + r.id * 131)() < diamondChance(cy.day)) loot.diamond = new Decimal(r.boss ? 2 : 1);
      for (const [c, v] of Object.entries(loot)) { state.wallet[c] = state.wallet[c].add(v); addTo(cy.report.loot, c, v); }
      res.sunk = true; res.loot = loot;
    }
    return res;
  }

  // Fire a full, covered building at the matching raider. Spends its batch.
  function fire(state, id, cov) {
    const b = state.buildings.find((x) => x.id === id);
    if (!b) return null;
    const r = targetFor(state, b, cov);
    if (!r) return null;
    if (B[b.type].kind === 'defense') b.cool = towerCooldown(b); else b.fill = 0;
    return { ...hitRaider(state, r), building: id };
  }

  // Fire a cannonball (merchant item) at the raider closest to shore.
  function cannon(state) {
    const cy = ensure(state), it = state.items;
    if (cy.phase !== 'night' || !it || !(it.cannon > 0)) return null;
    const r = cy.raiders.filter((x) => x.status === 'coming').sort((x, y) => y.progress - x.progress)[0];
    if (!r) return null;
    it.cannon--;
    return hitRaider(state, r);
  }

  // One tap of water on a burning building. Returns taps still needed, or null.
  function douse(state, id) {
    const b = state.buildings.find((x) => x.id === id);
    if (!b || !(b.burn > 0)) return null;
    b.burn--;
    if (b.burn <= 0) { delete b.burn; delete b.burnT; }
    return b.burn || 0;
  }

  // Rebuild the cycle from untrusted save data.
  function restore(state, raw) {
    const cy = newCycle();
    if (raw && typeof raw === 'object') {
      if (Number.isInteger(raw.day) && raw.day >= 1) cy.day = raw.day;
      if (PHASES.includes(raw.phase)) cy.phase = raw.phase;
      if (typeof raw.t === 'number' && raw.t >= 0) cy.t = raw.t;
      if (Array.isArray(raw.raiders)) {
        cy.raiders = raw.raiders.slice(0, 8).filter((r) => r && Array.isArray(r.seq) && r.seq.length && r.seq.every((c) => E.CURRENCIES.includes(c) || c === 'tower'))
          .map((r, i) => ({
            id: i + 1, lane: Number.isInteger(r.lane) ? r.lane : i,
            seq: r.seq.slice(0, 12), boss: !!r.boss,
            hit: Math.max(0, Math.min(r.seq.length, r.hit | 0)), progress: Math.max(-3, Math.min(1, +r.progress || 0)),
            status: ['coming', 'sunk', 'landed'].includes(r.status) ? r.status : 'coming',
            speed: Math.max(0.01, Math.min(1, +r.speed || 0.03)),
          }));
      }
      if (cy.phase === 'dusk' || cy.phase === 'night') {
        if (!cy.raiders.length) { cy.phase = 'day'; cy.t = 0; }
        cy.report = { sunk: 0, landed: 0, loot: {}, stolen: {}, fires: 0 };
      }
      // a save taken at dawn resumes on the next morning
      if (cy.phase === 'dawn') { cy.day++; cy.phase = 'day'; cy.t = 0; cy.raiders = []; }
    }
    state.cycle = cy;
    return cy;
  }

  const api = {
    DAY_LEN, DUSK_LEN, DAWN_LEN, BURN_TAPS, BURN_DRAIN, SPREAD_AFTER, TOWER_COOLDOWN, BOSS_EVERY, NET_SLOW, STEAL, burn, neighbours, towerCooldown, cannon, hitRaider, raiderCount, seqLength, approachSecs,
    newCycle, ensure, coverage, isCovered, producible, planNight, step, skip, targetFor, fire, douse, restore,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Night = api;
})(typeof window !== 'undefined' ? window : globalThis);
