// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/core/grid.js');
const E = require('../src/core/economy.js');
const N = require('../src/core/night.js');
const M = require('../src/core/merchant.js');

const MAP = ['..........', ...Array(6).fill('.gggggggg.'), '..........'];
function island() {
  const s = E.newGame(MAP, []);
  s.wallet.bronze = new E.Decimal(100000);
  N.ensure(s);
  return s;
}
const atShip = (s) => { s.cycle.t = M.ensure(s).arriveAt + 1; };

test('the ship visits once a day for SHIP_STAY seconds with 3 offers', () => {
  const s = island();
  const m = M.ensure(s);
  assert.ok(m.arriveAt >= 15 && m.arriveAt < 45);
  assert.equal(m.offers.length, 3);
  assert.ok(['silver', 'gold'].includes(m.offers[2]));
  assert.equal(M.here(s), false);
  atShip(s);
  assert.equal(M.here(s), true);
  s.cycle.t = m.leaveAt;
  assert.equal(M.here(s), false);
  s.cycle.day = 2;
  assert.notEqual(M.ensure(s).day, 1);                     // a new day plans a new visit
});

test('buying pays the price, gives the goods, and each offer sells once', () => {
  const s = island();
  atShip(s);
  s.merchant.offers = ['bucket', 'cannon', 'silver'];
  const b0 = s.wallet.bronze.toNumber();
  assert.ok(M.buy(s, 0));
  assert.equal(s.items.bucket, 1);
  assert.equal(s.wallet.bronze.toNumber(), b0 - 30);
  assert.equal(M.buy(s, 0), null);                          // sold out
  M.buy(s, 2);
  assert.equal(s.wallet.silver.toNumber(), 5);
  s.cycle.t = s.merchant.leaveAt;
  assert.equal(M.buy(s, 1), null);                          // ship has left
});

test('a bucket saves the next building that would catch fire', () => {
  const s = island();
  const h = G.place(s, 'hut', 4, 3);
  s.items = { bucket: 1, net: 0, cannon: 0 };
  N.skip(s); N.skip(s);
  s.cycle.raiders = s.cycle.raiders.slice(0, 1);
  let ev = [];
  while (s.cycle.phase === 'night') ev = ev.concat(N.step(s, 1));
  const land = ev.find((e) => e.type === 'land');
  assert.equal(land.fire, null);
  assert.equal(land.saved, h.id);
  assert.equal(h.burn, undefined);
  assert.equal(s.items.bucket, 0);
});

test('a net slows the night by 30%; a cannonball knocks one coin off', () => {
  const s = island();
  G.place(s, 'hut', 4, 3);
  s.items = { bucket: 0, net: 1, cannon: 2 };
  N.skip(s);
  const speeds = s.cycle.raiders.map((r) => r.speed);
  const ev = N.skip(s);
  assert.ok(ev.some((e) => e.type === 'net'));
  s.cycle.raiders.forEach((r, i) => assert.ok(Math.abs(r.speed - speeds[i] * 0.7) < 1e-12));
  assert.equal(s.items.net, 0);
  s.cycle.raiders[1].progress = 0.5;
  const hit = N.cannon(s);
  assert.equal(hit.raider, s.cycle.raiders[1].id);
  assert.equal(s.cycle.raiders[1].hit, 1);
  assert.equal(s.items.cannon, 1);
});

test('upgraded towers reload faster', () => {
  const s = island();
  const t = G.place(s, 'tower', 1, 1);
  assert.equal(N.towerCooldown(t), 3);
  t.level = 5;
  assert.equal(N.towerCooldown(t), 1);
});

test('restore keeps valid items and visits, drops junk', () => {
  const s = island();
  M.restore(s, { bucket: 3, net: 'lots', cannon: 99 }, { day: 1, arriveAt: 20, offers: ['bucket', 'net', 'gold'], sold: [0, 7] });
  assert.deepEqual(s.items, { bucket: 3, net: 0, cannon: M.MAX_ITEM });
  assert.deepEqual(s.merchant.sold, [0]);
  M.restore(s, null, { day: 1, arriveAt: 20, offers: ['treasure', 'net', 'gold'], sold: [] });
  assert.equal(s.merchant, undefined);
});
