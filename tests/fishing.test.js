// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/core/grid.js');
const E = require('../src/core/economy.js');
const N = require('../src/core/night.js');
const F = require('../src/core/fishing.js');

const MAP = ['..........', '..........', ...Array(4).fill('..gggggg..'), '..........', '..........'];
function island() {
  const s = E.newGame(MAP, []);
  N.ensure(s);
  F.ensure(s);
  s.hut = G.place(s, 'hut', 2, 2);          // bronze
  s.work = G.place(s, 'workshop', 4, 3, 0); // silver
  return s;
}
function hooked(s, fish, set) {
  s.fishing.spot = { c: 1, r: 2, until: 999 };
  F.cast(s);
  Object.assign(s.fishing.cast, { fish, set, pos: 0, window: 0 });
  return s.fishing.cast;
}
const tapFor = (s, cur) => F.tap(s, cur === 'bronze' ? s.hut : s.work);

test('ripples appear on water next to land during the day, then vanish', () => {
  const s = island();
  const tiles = F.spotTiles(s);
  assert.ok(tiles.length > 0);
  assert.ok(tiles.every(([c, r]) => G.terrainAt(s, c, r) === '.'));
  let ev = F.step(s, 0);
  s.cycle.t = 10; ev = F.step(s, 0);
  assert.equal(ev[0].type, 'spot');
  s.cycle.t = 10 + F.SPOT_LIFE; ev = F.step(s, 0);
  assert.equal(ev[0].type, 'spotGone');
  N.skip(s);                                    // dusk: no fishing
  s.fishing.nextSpotAt = 0;
  assert.deepEqual(F.step(s, 1), []);
});

test('tapping the right currencies in order builds the gauge; sets roll over', () => {
  const s = island();
  const c = hooked(s, 'snapper', ['bronze', 'silver', 'bronze']);
  assert.ok(tapFor(s, 'bronze').ok);
  assert.ok(tapFor(s, 'silver').ok);
  const done = tapFor(s, 'bronze');
  assert.ok(done.setDone);
  assert.equal(c.sets, 1);
  assert.ok(Math.abs(c.gauge - (F.START_GAUGE + 3 * F.TAP_GAIN + F.SET_GAIN)) < 1e-9);
  assert.equal(c.set.length, 3);                // a fresh set
});

test('a wrong tap, or waiting past the 2s window, restarts the set', () => {
  const s = island();
  const c = hooked(s, 'snapper', ['bronze', 'silver', 'bronze']);
  tapFor(s, 'bronze');
  assert.deepEqual(tapFor(s, 'bronze'), { ok: false, reset: true });
  assert.equal(c.pos, 0);
  tapFor(s, 'bronze');
  const ev = F.step(s, F.WINDOW + 0.01);
  assert.ok(ev.some((e) => e.type === 'reset'));
  assert.equal(c.pos, 0);
});

test('an empty gauge loses the fish; a full one lands it after at least 2 sets', () => {
  const s = island();
  hooked(s, 'sardine', ['bronze', 'bronze']);
  assert.ok(F.step(s, 100).some((e) => e.type === 'escaped'));
  assert.equal(s.fishing.cast, null);
  const c = hooked(s, 'sardine', ['bronze', 'bronze']);
  c.gauge = 0.95;
  tapFor(s, 'bronze'); tapFor(s, 'bronze');     // set 1 done, gauge would pass 1 -> held just under
  assert.ok(s.fishing.cast);
  c.set = ['bronze', 'bronze'];
  tapFor(s, 'bronze');
  const res = tapFor(s, 'bronze');
  assert.equal(res.caught, 'sardine');
  assert.equal(res.first, true);
  assert.equal(s.fish.sardine, 1);
  assert.equal(s.fishBook.sardine, 1);
});

test('fish can ask for currencies the island cannot make', () => {
  const s = island();
  hooked(s, 'pearlfish', ['gold', 'diamond', 'gold', 'diamond']);
  assert.deepEqual(tapFor(s, 'bronze'), { ok: false, reset: false });
});

test('selling pays per fish; the book gives +5% income per species forever', () => {
  const s = island();
  s.fish = { sardine: 3, snapper: 1 }; s.fishBook = { sardine: 3, snapper: 1 };
  const w = s.wallet.bronze.toNumber();
  assert.equal(F.sell(s, 'sardine').got.bronze.toNumber(), 75);
  assert.equal(s.wallet.bronze.toNumber(), w + 75);
  assert.equal(s.fish.sardine, 0);
  assert.equal(F.sell(s, 'sardine'), null);
  assert.equal(F.bookBonus(s), 1.1);
  E.tick(s, 3); E.tick(s, 5);
  assert.equal(E.collect(s, s.hut.id, 1).amount.toNumber(), 3 * 1.1);   // bonus reaches income
});

test('restore keeps valid counts and drops junk; casts are not restored', () => {
  const s = island();
  F.restore(s, { fish: { sardine: 2, whale: 9, tuna: -1 }, fishBook: { tuna: 1 } });
  assert.deepEqual(s.fish, { sardine: 2 });
  assert.deepEqual(s.fishBook, { tuna: 1 });
  assert.equal(s.fishing.cast, null);
});
