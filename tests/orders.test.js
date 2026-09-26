// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/core/grid.js');
const E = require('../src/core/economy.js');
const N = require('../src/core/night.js');
const O = require('../src/core/orders.js');

const MAP = Array(8).fill('gggggggg');
function game() {
  const s = E.newGame(MAP, [{ id: 'hut', c: 0, r: 0 }, { id: 'hut', c: 3, r: 0 }, { id: 'farm', c: 0, r: 3 }]);
  s.wallet.bronze = new E.Decimal(100);
  N.ensure(s);
  return s;
}
const force = (s, a) => { O.ensure(s).active = { progress: a.kind === 'earn' ? '0' : 0, reward: '50', text: 'TEST', ...a }; };

test('next() draws a sensible order and is deterministic for a day', () => {
  const a = O.next(game()), b = O.next(game());
  assert.deepEqual(a, b);
  assert.ok(O.KINDS.includes(a.kind));
  assert.ok(a.text.length > 0 && a.text.length < 26);
  const s = game();
  const kinds = new Set();
  for (let i = 0; i < 40; i++) kinds.add(O.next(s).kind);
  assert.deepEqual([...kinds].sort(), [...O.KINDS].sort()); // every kind shows up
});

test('collect orders count taps on the named building type', () => {
  const s = game();
  force(s, { kind: 'collect', type: 'hut', n: 2 });
  assert.equal(O.record(s, { kind: 'collect', type: 'farm' }), null);
  assert.equal(O.record(s, { kind: 'collect', type: 'hut' }), null);
  const done = O.record(s, { kind: 'collect', type: 'hut' });
  assert.equal(done.reward.toNumber(), 50);
  assert.equal(s.wallet.bronze.toNumber(), 150);
  assert.equal(s.orders.active, null);
});

test('streak, perfect, earn and build orders', () => {
  const s = game();
  force(s, { kind: 'streak', n: 4 });
  O.record(s, { kind: 'collect', combo: 3 });
  assert.ok(O.record(s, { kind: 'collect', combo: 4 }));
  force(s, { kind: 'perfect', n: 2 });
  O.record(s, { kind: 'collect', perfect: false });
  O.record(s, { kind: 'collect', perfect: true });
  assert.ok(O.record(s, { kind: 'collect', perfect: true }));
  force(s, { kind: 'earn', n: '10' });
  O.record(s, { kind: 'collect', cur: 'silver', amount: new E.Decimal(50) });
  assert.equal(O.progressText(s.orders.active), '0/10');
  assert.ok(O.record(s, { kind: 'collect', cur: 'bronze', amount: new E.Decimal(12) }));
  force(s, { kind: 'build', type: 'farm', n: 1 });
  assert.ok(O.record(s, { kind: 'build', type: 'farm' }));
});

test('orders only progress during the day', () => {
  const s = game();
  force(s, { kind: 'collect', type: 'hut', n: 1 });
  N.skip(s); // dusk
  assert.equal(O.record(s, { kind: 'collect', type: 'hut' }), null);
  assert.equal(s.orders.active.progress, 0);
});

test('restore keeps a valid order and drops junk', () => {
  const s = game();
  const a = O.next(s);
  O.restore(s, JSON.parse(JSON.stringify(s.orders)));
  assert.equal(s.orders.active.text, a.text);
  O.restore(s, { active: { kind: 'steal-the-moon', n: 1, progress: 0, reward: '5', text: 'x' } });
  assert.equal(s.orders.active, null);
  O.restore(s, { active: { kind: 'collect', type: 'castle', n: 1, progress: 0, reward: '5', text: 'x' } });
  assert.equal(s.orders.active, null);
});
