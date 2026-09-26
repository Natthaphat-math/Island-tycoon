// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/core/grid.js');
const E = require('../src/core/economy.js');

const MAP = Array(8).fill('gggggggg');
const game = (bronze) => { const s = E.newGame(MAP, []); if (bronze != null) s.wallet.bronze = new E.Decimal(bronze); return s; };

test('prices grow 15% per copy and are paid on build', () => {
  const s = game(1000);
  assert.equal(E.costOf(s, 'hut').amount.toNumber(), 10);
  assert.ok(E.buy(s, 'hut', 0, 0, 0));
  assert.equal(s.wallet.bronze.toNumber(), 990);
  assert.equal(E.costOf(s, 'hut').amount.toNumber(), Math.ceil(10 * 1.15));
});

test('buy refuses when too poor or blocked, and charges nothing', () => {
  const s = game(5);
  assert.equal(E.buy(s, 'hut', 0, 0, 0), null);
  s.wallet.bronze = new E.Decimal(100);
  E.buy(s, 'hut', 0, 0, 0);
  assert.equal(E.buy(s, 'hut', 0, 0, 0), null); // tile taken
  assert.equal(s.wallet.bronze.toNumber(), 90);
});

test('selling refunds half of what the last copy cost', () => {
  const s = game(1000);
  const b = E.buy(s, 'farm', 0, 0, 0);
  const ref = E.sell(s, b.id);
  assert.equal(ref.amount.toNumber(), 20);
  assert.equal(s.wallet.bronze.toNumber(), 1000 - 40 + 20);
  assert.equal(s.buildings.length, 0);
});

test('buildings fill over their cycle, then a tap pays one batch x combo', () => {
  const s = game(100);
  const b = E.buy(s, 'hut', 0, 0, 0);
  const before = s.wallet.bronze.toNumber();
  E.tick(s, 1.5);
  assert.equal(E.collect(s, b.id, 1), null);      // half full: nothing to take
  E.tick(s, 1.5);
  assert.ok(E.isReady(b));
  E.tick(s, 5);                                    // past the PERFECT window
  const got = E.collect(s, b.id, 6);               // 3s x 1/s x (1 + 5 x 10%)
  assert.equal(got.amount.toNumber(), 4.5);
  assert.equal(s.wallet.bronze.toNumber(), before + 4.5);
  assert.equal(b.fill, 0);
});

test('combo multiplier is capped at x3', () => {
  assert.equal(E.comboMult(1), 1);
  assert.equal(E.comboMult(11), 2);
  assert.equal(E.comboMult(500), 3);
});

test('a full building just waits: no auto-collect, no idle income', () => {
  const s = game(100);
  const h = E.buy(s, 'hut', 0, 0, 0);
  const w = s.wallet.bronze.toNumber();
  E.tick(s, 3);
  E.tick(s, 600);
  assert.equal(s.wallet.bronze.toNumber(), w);
  assert.equal(h.fill, 1);
  assert.equal(E.collect(s, h.id, 1).amount.toNumber(), 3); // still exactly one batch
});

test('burning buildings neither fill nor pay out', () => {
  const s = game(100);
  const h = E.buy(s, 'hut', 0, 0, 0);
  h.burn = 2;
  E.tick(s, 5);
  assert.equal(h.fill || 0, 0);
  h.fill = 1;
  assert.equal(E.collect(s, h.id, 1), null);
});

test('aura multipliers flow into the batch', () => {
  const s = game(10000);
  E.buy(s, 'market', 0, 0, 0);
  const h = E.buy(s, 'hut', 2, 0, 0);
  E.tick(s, 3); E.tick(s, 5);
  assert.equal(E.collect(s, h.id, 1).amount.toNumber(), 4.5); // 3s x 1.5/s
});

test('wallet goes far past float range without becoming Infinity', () => {
  const s = game();
  s.wallet.bronze = new E.Decimal('1e308').mul('1e308');
  assert.equal(E.fmt(s.wallet.bronze), '1.00e616');
  s.wallet.bronze = new E.Decimal('1e1e12');
  assert.equal(E.fmt(s.wallet.bronze), 'ee12.00');
});

test('fmt covers every range', () => {
  assert.equal(E.fmt(0), '0');
  assert.equal(E.fmt(4.56), '4.5');
  assert.equal(E.fmt(999), '999');
  assert.equal(E.fmt(12345), '12.3K');
  assert.equal(E.fmt(4.56e12), '4.56T');
  assert.equal(E.fmt('7.89e123'), '7.89e123');
});

test('save round trip keeps layout, fill and big wallets', () => {
  const s = game(1000);
  const f = E.buy(s, 'farm', 1, 1, 2);
  E.tick(s, 3);
  s.wallet.gold = new E.Decimal('3.5e400');
  const { state } = E.deserialize(E.serialize(s), MAP);
  assert.deepEqual(state.buildings.map((b) => [b.id, b.type, b.c, b.r, b.rot]), [[f.id, 'farm', 1, 1, 2]]);
  assert.equal(state.buildings[0].fill, 0.5);
  assert.equal(E.fmt(state.wallet.gold), '3.50e400');
  assert.equal(state.wallet.bronze.toNumber(), s.wallet.bronze.toNumber());
  assert.ok(state.nextId > f.id);
});

test('deserialize drops junk instead of trusting it', () => {
  const bad = JSON.stringify({ v: 1, state: {
    buildings: [{ id: 1, type: 'castle', c: 0, r: 0 }, { id: 2, type: 'hut', c: 99, r: 0 }, { id: 3, type: 'hut', c: 1, r: 1, fill: 'lots' }],
    wallet: { bronze: 'NaN', silver: '-5', gold: '12' },
  } });
  const { state } = E.deserialize(bad, MAP);
  assert.deepEqual(state.buildings.map((b) => b.type), ['hut']);
  assert.equal(state.buildings[0].fill, 0);
  assert.equal(state.wallet.bronze.toNumber(), 50);
  assert.equal(state.wallet.silver.toNumber(), 0);
  assert.equal(state.wallet.gold.toNumber(), 12);
  assert.throws(() => E.deserialize('{"v":99}', MAP));
});

test('tapping right as a building fills is PERFECT: x1.5', () => {
  const s = game(100);
  const h = E.buy(s, 'hut', 0, 0, 0);
  E.tick(s, 3);                               // just filled
  assert.ok(E.isRipe(h));
  const p = E.collect(s, h.id, 1);
  assert.equal(p.perfect, true);
  assert.equal(p.amount.toNumber(), 4.5);
  E.tick(s, 3); E.tick(s, E.RIPE_WINDOW + 0.1); // waited too long
  assert.equal(E.isRipe(h), false);
  const q = E.collect(s, h.id, 1);
  assert.equal(q.perfect, false);
  assert.equal(q.amount.toNumber(), 3);
});
