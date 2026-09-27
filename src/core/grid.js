// core/grid.js — the placement puzzle as plain data + pure functions.
// No Phaser here: the scene renders this state, tests run it under Node, and
// the state object is plain JSON so saves / save codes can serialise it later.
(function (root) {
  'use strict';

  // Footprints are tile offsets from the top-left of the bounding box.
  // aura = Chebyshev radius around the footprint (1 = the ring of touching tiles).
  // Numbers are placeholders for the prototype; tune freely.
  // up = first upgrade price in silver (each level after costs x3), max = top level.
  // Levels: income buildings x2 output per level; market +0.25 to its boost per level;
  // watchtower +1 guard radius at level 3 and a faster reload.
  // base = output per second (in `cur`) before auras. cycle = seconds to fill up
  // before it's ready to tap. cost = [currency, first price]; each extra copy costs
  // x1.15 more. All numbers are placeholders for the prototype; tune freely.
  const BUILDINGS = {
    hut: {
      name: 'FISHER HUT', shape: [[0, 0]], kind: 'income', aura: 1, base: 1, cur: 'bronze', cycle: 3,
      cost: ['bronze', 10], desc: '+1/S. LIKES OTHER HUTS', up: 2, max: 5,
    },
    farm: {
      name: 'TARO FARM', shape: [[0, 0], [1, 0], [0, 1]], kind: 'income', aura: 1, base: 3, cur: 'bronze', cycle: 6,
      cost: ['bronze', 40], desc: '+3/S. FEEDS NEARBY HUTS', up: 4, max: 5,
    },
    longhouse: { // straight line of 3
      name: 'LONGHOUSE', shape: [[0, 0], [1, 0], [2, 0]], kind: 'income', aura: 1, base: 4, cur: 'bronze', cycle: 5,
      cost: ['bronze', 90], desc: '+4/S. HUTS +15%', up: 6, max: 5,
    },
    workshop: { // T of 4
      name: 'WORKSHOP', shape: [[0, 0], [1, 0], [2, 0], [1, 1]], kind: 'income', aura: 1, base: 0.5, cur: 'silver', cycle: 8,
      cost: ['bronze', 300], desc: '+0.5 SILVER/S. NOISY', up: 10, max: 5,
    },
    plantation: { // big L of 5
      name: 'PLANTATION', shape: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], kind: 'income', aura: 1, base: 8, cur: 'bronze', cycle: 10,
      cost: ['silver', 10], desc: '+8/S. WORKSHOPS +30%', up: 12, max: 5,
    },
    market: {
      name: 'MARKET', shape: [[0, 0], [1, 0], [0, 1], [1, 1]], kind: 'boost', aura: 1, base: 0,
      cost: ['bronze', 250], desc: 'x1.5 TO INCOME IN AURA', up: 15, max: 5,
    },
    tower: {
      name: 'WATCHTOWER', shape: [[0, 0]], kind: 'defense', aura: 2, base: 0,
      cost: ['silver', 15], desc: 'GUARDS 5x5 AT NIGHT', up: 8, max: 5,
    },
    idol: {
      name: 'CURSED IDOL', shape: [[0, 0]], kind: 'trap', aura: 1, base: 0.05, cur: 'gold', cycle: 12,
      cost: ['bronze', 500], desc: 'GOLD! NEIGHBOURS x0.5', up: 0, max: 1,
    },
  };

  // How a source's aura changes a target standing in it.
  // add: additive bonus (summed); mul: multiplier (multiplied together).
  const RULES = [
    { from: 'market', to: (t) => BUILDINGS[t].kind === 'income', mul: 1.5, mulPerLevel: 0.25 },
    { from: 'hut', to: (t) => t === 'hut', add: 0.1 },
    { from: 'farm', to: (t) => t === 'hut', add: 0.25 },
    { from: 'idol', to: (t) => t !== 'idol', mul: 0.5 },
    { from: 'longhouse', to: (t) => t === 'hut', add: 0.15 },
    { from: 'workshop', to: (t) => t === 'hut', mul: 0.8 },
    { from: 'plantation', to: (t) => t === 'workshop', add: 0.3 },
  ];

  const key = (c, r) => c + ',' + r;

  function createState(map) {
    return { cols: map[0].length, rows: map.length, terrain: map.slice(), buildings: [], nextId: 1 };
  }

  function terrainAt(state, c, r) {
    return (state.terrain[r] || '')[c] || '.';
  }

  // Rotate a shape 90° clockwise `rot` times, re-normalised to start at 0,0.
  function rotateShape(shape, rot) {
    let cells = shape.map(([x, y]) => [x, y]);
    for (let i = 0; i < ((rot % 4) + 4) % 4; i++) cells = cells.map(([x, y]) => [-y, x]);
    const mx = Math.min(...cells.map((p) => p[0])), my = Math.min(...cells.map((p) => p[1]));
    return cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }

  // Distinct rotations only (a 2x2 has 1, an L has 4).
  function rotations(type) {
    const seen = new Set(), out = [];
    for (let rot = 0; rot < 4; rot++) {
      const k = JSON.stringify(rotateShape(BUILDINGS[type].shape, rot));
      if (!seen.has(k)) { seen.add(k); out.push(rot); }
    }
    return out;
  }

  function bbox(cells) {
    let w = 0, h = 0;
    for (const [x, y] of cells) { w = Math.max(w, x + 1); h = Math.max(h, y + 1); }
    return [w, h];
  }

  function footprint(b) {
    return rotateShape(BUILDINGS[b.type].shape, b.rot || 0).map(([x, y]) => [b.c + x, b.r + y]);
  }

  function occupancy(state, ignoreId) {
    const occ = new Map();
    for (const b of state.buildings) {
      if (b.id === ignoreId) continue;
      for (const [c, r] of footprint(b)) occ.set(key(c, r), b);
    }
    return occ;
  }

  // Buildable = grass. Returns { ok, reason, cells }.
  function canPlace(state, type, c, r, rot, ignoreId) {
    const cells = footprint({ type, c, r, rot });
    const occ = occupancy(state, ignoreId);
    for (const [cc, rr] of cells) {
      const t = terrainAt(state, cc, rr);
      if (t === '.') return { ok: false, reason: 'NOT ON WATER', cells };
      if (t !== 'g') return { ok: false, reason: 'NEEDS GRASS', cells };
      if (occ.has(key(cc, rr))) return { ok: false, reason: 'TILE TAKEN', cells };
    }
    return { ok: true, reason: '', cells };
  }

  function place(state, type, c, r, rot = 0, id, level) {
    const chk = canPlace(state, type, c, r, rot, id);
    if (!chk.ok) return null;
    const b = { id: id || state.nextId++, type, c, r, rot };
    if (level > 1) b.level = Math.min(BUILDINGS[type].max, level | 0);
    state.buildings.push(b);
    return b;
  }

  function remove(state, id) {
    const i = state.buildings.findIndex((b) => b.id === id);
    return i < 0 ? null : state.buildings.splice(i, 1)[0];
  }

  // Tiles covered by a building's aura (clipped to the map, footprint excluded).
  // Economy auras only cover land; defense auras also reach out over the sea.
  const levelOf = (b) => Math.max(1, b.level | 0);
  const auraRadius = (b) => BUILDINGS[b.type].aura + (BUILDINGS[b.type].kind === 'defense' && levelOf(b) >= 3 ? 1 : 0);
  // output multiplier from the building's own level (income and trap buildings)
  const levelMult = (b) => (['income', 'trap'].includes(BUILDINGS[b.type].kind) ? Math.pow(2, levelOf(b) - 1) : 1);

  function auraCells(state, b) {
    const def = BUILDINGS[b.type], R = auraRadius(b), fp = footprint(b);
    const own = new Set(fp.map(([c, r]) => key(c, r))), out = new Map();
    for (const [c, r] of fp) {
      for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
        const cc = c + dc, rr = r + dr, k = key(cc, rr);
        if (own.has(k) || out.has(k) || cc < 0 || rr < 0 || cc >= state.cols || rr >= state.rows) continue;
        if (def.kind !== 'defense' && terrainAt(state, cc, rr) === '.') continue;
        out.set(k, [cc, rr]);
      }
    }
    return out;
  }

  // Every building's multiplier and output, from the aura rules.
  // Returns Map id -> { mult, output, sources: [{ id, type, add?, mul? }] }.
  function evaluate(state) {
    const occ = occupancy(state);
    const res = new Map(state.buildings.map((b) => [b.id, { add: 0, mul: 1, sources: [] }]));
    for (const src of state.buildings) {
      const rules = RULES.filter((ru) => ru.from === src.type);
      if (!rules.length) continue;
      const hit = new Set();
      for (const k of auraCells(state, src).keys()) {
        const tgt = occ.get(k);
        if (!tgt || tgt.id === src.id || hit.has(tgt.id)) continue;
        hit.add(tgt.id);
        for (const ru of rules) {
          if (!ru.to(tgt.type)) continue;
          const e = res.get(tgt.id);
          if (ru.add) e.add += ru.add;
          const mul = ru.mul ? ru.mul + (ru.mulPerLevel || 0) * (levelOf(src) - 1) : 0;
          if (mul) e.mul *= mul;
          e.sources.push({ id: src.id, type: src.type, add: ru.add, mul: mul || undefined });
        }
      }
    }
    for (const b of state.buildings) {
      const e = res.get(b.id);
      e.mult = (1 + e.add) * e.mul * levelMult(b);
      e.output = BUILDINGS[b.type].base * e.mult;
    }
    return res;
  }

  // Output per second summed by currency, e.g. { bronze: 12.5, silver: 0.5 }.
  function rates(state, ev = evaluate(state)) {
    const out = {};
    for (const b of state.buildings) {
      const d = BUILDINGS[b.type];
      if (d.cur) out[d.cur] = (out[d.cur] || 0) + ev.get(b.id).output;
    }
    return out;
  }

  // What would change if `type` were placed here: the newcomer's own result
  // plus every existing building whose multiplier goes up or down.
  function preview(state, type, c, r, rot, level) {
    const before = evaluate(state);
    const trial = JSON.parse(JSON.stringify(state));
    const b = place(trial, type, c, r, rot, undefined, level);
    if (!b) return null;
    const after = evaluate(trial), changes = [];
    for (const [id, e] of after) {
      if (id === b.id) continue;
      const d = e.mult - before.get(id).mult;
      if (Math.abs(d) > 1e-9) changes.push({ id, delta: d });
    }
    const r0 = rates(state, before), r1 = rates(trial, after), total = {};
    for (const c of new Set([...Object.keys(r0), ...Object.keys(r1)])) {
      const d = (r1[c] || 0) - (r0[c] || 0);
      if (Math.abs(d) > 1e-9) total[c] = d;
    }
    return { self: after.get(b.id), changes, total };
  }

  const api = {
    BUILDINGS, RULES, createState, terrainAt, rotateShape, rotations, bbox, footprint,
    occupancy, canPlace, place, remove, auraCells, evaluate, rates, preview, key, levelOf, auraRadius, levelMult,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
