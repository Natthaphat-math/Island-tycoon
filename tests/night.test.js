// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/core/grid.js');
const E = require('../src/core/economy.js');
const N = require('../src/core/night.js');

// 10x8 grass island in open water so tower coverage can reach the sea
const MAP = ['..........', ...Array(6).fill('.gggggggg.'), '..........'];
function island() {
  const s = E.newGame(MAP, []);
  s.wallet.bronze = new E.Decimal(10000);
  N.ensure(s);
  return s;
}
const toNight = (s) => { N.skip(s); N.skip(s); assert.equal(s.cycle.phase, 'night'); };

test('the clock runs day -> dusk -> night -> dawn -> next day', () => {
  const s = island();
  E.buy(s, 'hut', 1, 1, 0);
  const seen = [];
  const push = (evs) => evs.forEach((e) => { if (e.type !== 'burn') seen.push(e.type); });
  push(N.step(s, N.DAY_LEN - 1));
  assert.equal(s.cycle.phase, 'day');
  push(N.step(s, 1));
  assert.equal(s.cycle.phase, 'dusk');
  assert.equal(s.cycle.raiders.length, 3); // at least three raiders every night
  push(N.step(s, N.DUSK_LEN));
  while (s.cycle.phase === 'night') push(N.step(s, 1));
  push(N.step(s, N.DAWN_LEN));
  assert.deepEqual(seen, ['dusk', 'night', 'land', 'land', 'land', 'dawn', 'day']);
  assert.equal(s.cycle.day, 2);
});

test('raiders only ask for currencies the island can make, and grow with the days', () => {
  const s = island();
  E.buy(s, 'hut', 1, 1, 0);
  N.skip(s);
  assert.ok(s.cycle.raiders.every((r) => r.seq.every((c) => c === 'bronze')));
  assert.equal(s.cycle.raiders[0].seq.length, N.seqLength(1));
  assert.ok(N.seqLength(9) > N.seqLength(1));
  assert.equal(N.raiderCount(1), 3);
  assert.ok(N.raiderCount(9) > N.raiderCount(1));
  assert.equal(N.raiderCount(99), 8);
});

test('only full buildings inside tower coverage can fire', () => {
  const s = island();
  G.place(s, 'tower', 1, 1);                    // covers columns 0..3, rows 0..3
  const near = G.place(s, 'hut', 2, 2);
  const far = G.place(s, 'hut', 7, 5);
  toNight(s);
  assert.equal(N.targetFor(s, near), null);     // not full yet
  near.fill = 1; far.fill = 1;
  assert.ok(N.targetFor(s, near));
  assert.equal(N.targetFor(s, far), null);      // outside coverage
  assert.equal(N.fire(s, far.id), null);
});

test('firing matches pips in order, spends the batch, and sinking pays loot', () => {
  const s = island();
  G.place(s, 'tower', 1, 1);
  const h = G.place(s, 'hut', 2, 2);
  toNight(s);
  s.cycle.raiders = s.cycle.raiders.slice(0, 1);
  const r = s.cycle.raiders[0];
  const bronze0 = s.wallet.bronze;
  for (let i = 0; i < r.seq.length; i++) {
    h.fill = 1;
    const res = N.fire(s, h.id);
    assert.equal(res.raider, r.id);
    assert.equal(h.fill, 0);
  }
  assert.equal(r.status, 'sunk');
  assert.ok(s.wallet.bronze.gt(bronze0));
  assert.equal(s.cycle.report.sunk, 1);
  N.step(s, 0.1);
  assert.equal(s.cycle.phase, 'dawn');
});

test('a tap with no matching pip does nothing (no wasted batch)', () => {
  const s = island();
  G.place(s, 'tower', 1, 1);
  const h = G.place(s, 'hut', 2, 2);
  toNight(s);
  s.cycle.raiders = [{ ...s.cycle.raiders[0], seq: ['silver', 'bronze'] }];
  h.fill = 1;
  assert.equal(N.fire(s, h.id), null);
  assert.equal(h.fill, 1);
});

test('the raider closest to shore is hit first', () => {
  const s = island();
  G.place(s, 'tower', 1, 1);
  const h = G.place(s, 'hut', 2, 2);
  toNight(s);
  s.cycle.raiders = [
    { id: 1, lane: 0, seq: ['bronze'], hit: 0, progress: 0.2, status: 'coming', speed: 0.01 },
    { id: 2, lane: 1, seq: ['bronze'], hit: 0, progress: 0.7, status: 'coming', speed: 0.01 },
  ];
  h.fill = 1;
  assert.equal(N.fire(s, h.id).raider, 2);
});

test('a landing raider steals 10% and sets a building on fire', () => {
  const s = island();
  const h = G.place(s, 'hut', 5, 3);
  s.wallet.silver = new E.Decimal(50);
  toNight(s);
  s.cycle.raiders = s.cycle.raiders.slice(0, 1);
  let ev = [];
  while (s.cycle.phase === 'night') ev = ev.concat(N.step(s, 1));
  const land = ev.find((e) => e.type === 'land');
  assert.equal(land.stolen.bronze.toNumber(), 1000);
  assert.equal(land.stolen.silver.toNumber(), 5);
  assert.equal(land.fire, h.id);
  assert.equal(h.burn, N.BURN_TAPS);
  assert.equal(s.wallet.bronze.toNumber(), 9000);
  // tap to douse: BURN_TAPS taps
  assert.equal(N.BURN_TAPS, 10);
  assert.equal(N.douse(s, h.id), 9);
  for (let i = 0; i < 8; i++) N.douse(s, h.id);
  assert.equal(N.douse(s, h.id), 0);
  assert.equal(h.burn, undefined);
  assert.equal(N.douse(s, h.id), null);
});

test('burning buildings cannot fire', () => {
  const s = island();
  G.place(s, 'tower', 1, 1);
  const h = G.place(s, 'hut', 2, 2);
  toNight(s);
  h.fill = 1; h.burn = 2;
  assert.equal(N.targetFor(s, h), null);
});

test('restore keeps a saved night and rejects junk', () => {
  const s = island();
  G.place(s, 'hut', 2, 2);
  toNight(s);
  const raw = JSON.parse(JSON.stringify(s.cycle));
  const t = island();
  N.restore(t, raw);
  assert.equal(t.cycle.phase, 'night');
  assert.deepEqual(t.cycle.raiders.map((r) => r.seq), s.cycle.raiders.map((r) => r.seq));
  N.restore(t, { day: -3, phase: 'party', raiders: [{ seq: ['doubloons'] }] });
  assert.equal(t.cycle.day, 1);
  assert.equal(t.cycle.phase, 'day');
  assert.equal(t.cycle.raiders.length, 0);
  N.restore(t, { day: 4, phase: 'night', raiders: [] }); // night without raiders -> back to day
  assert.equal(t.cycle.phase, 'day');
  N.restore(t, { day: 4, phase: 'dawn', t: 2 });        // dawn -> next morning
  assert.deepEqual([t.cycle.day, t.cycle.phase], [5, 'day']);
});

test('each fire drains 1% of bronze per second (at least 1) until put out', () => {
  const s = island();                       // 10000 bronze
  const a = G.place(s, 'hut', 2, 2), b = G.place(s, 'hut', 5, 5);
  a.burn = 10; b.burn = 10;
  let ev = N.burn(s, 0.5);
  assert.equal(ev.length, 0);                // not a full second yet
  ev = N.burn(s, 0.5);
  assert.deepEqual(ev.map((e) => e.amount.toNumber()), [100, 99]);
  assert.equal(s.wallet.bronze.toNumber(), 9801);
  s.wallet.bronze = new E.Decimal(20);
  ev = N.burn(s, 1);
  assert.deepEqual(ev.map((e) => e.amount.toNumber()), [1, 1]); // minimum 1
  s.wallet.bronze = new E.Decimal(0);
  assert.deepEqual(N.burn(s, 1), []);        // never below zero
  while (N.douse(s, a.id)) { /* put a out */ }
  s.wallet.bronze = new E.Decimal(500);
  assert.equal(N.burn(s, 1).length, 1);
});

test('raiders beyond the lane count queue further out to sea', () => {
  const s = island();
  G.place(s, 'hut', 2, 2);
  s.cycle.day = 5;
  N.planNight(s, 2);                              // 5 raiders, only 2 lanes
  const waves = s.cycle.raiders.map((r) => r.progress);
  assert.deepEqual(waves, [0, 0, -0.6, -0.6, -1.2]);
});

test('shield pips are answered by tapping a watchtower, which then reloads', () => {
  const s = island();
  const t = G.place(s, 'tower', 1, 1);
  G.place(s, 'hut', 2, 2);
  toNight(s);
  s.cycle.raiders = [{ id: 1, lane: 0, seq: ['tower', 'tower'], hit: 0, progress: 0.3, status: 'coming', speed: 0.01 }];
  assert.equal(N.fire(s, t.id).raider, 1);
  assert.equal(N.fire(s, t.id), null);           // reloading
  N.step(s, N.TOWER_COOLDOWN);
  assert.ok(N.fire(s, t.id).sunk);
});

test('every 5th night brings a boss: longer row, slower, bigger loot with diamonds', () => {
  const s = island();
  G.place(s, 'hut', 2, 2);
  s.cycle.day = N.BOSS_EVERY;
  N.planNight(s, 4);
  const [boss, other] = s.cycle.raiders;
  assert.equal(boss.boss, true);
  assert.equal(boss.seq.length, other.seq.length + 3);
  assert.ok(boss.speed < other.speed);
  s.cycle.phase = 'night';
  s.cycle.raiders = [{ ...boss, seq: ['bronze'] }];
  const h = s.buildings[0];
  G.place(s, 'tower', 1, 1);
  h.fill = 1;
  const res = N.fire(s, h.id);
  assert.equal(res.loot.diamond.toNumber(), 2);
});

test('a fire left for 6 seconds spreads to a touching building', () => {
  const s = island();
  const a = G.place(s, 'hut', 2, 2), b = G.place(s, 'hut', 3, 3), far = G.place(s, 'hut', 7, 6);
  assert.deepEqual(N.neighbours(s, a).map((x) => x.id), [b.id]);
  a.burn = 10;
  let ev = N.burn(s, 5.9);
  assert.ok(!ev.some((e) => e.type === 'spread'));
  ev = N.burn(s, 0.2);
  assert.deepEqual(ev.filter((e) => e.type === 'spread').map((e) => [e.from, e.id]), [[a.id, b.id]]);
  assert.equal(b.burn, N.BURN_TAPS);
  assert.equal(far.burn, undefined);
  // putting it out in time stops the spread
  const s2 = island();
  const c = G.place(s2, 'hut', 2, 2), d = G.place(s2, 'hut', 3, 2);
  c.burn = 10;
  N.burn(s2, 3);
  while (N.douse(s2, c.id)) { /* out */ }
  N.burn(s2, 5);
  assert.equal(d.burn, undefined);
});
