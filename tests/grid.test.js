// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/core/grid.js');

const MAP = [
  '........',
  '.ssssss.',
  '.sggggs.',
  '.sggggs.',
  '.sggggs.',
  '.ssssss.',
  '........',
];
const fresh = () => G.createState(MAP);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('rotateShape turns the L clockwise and normalises to 0,0', () => {
  const L = G.BUILDINGS.farm.shape; // (0,0) (1,0) (0,1)
  assert.deepEqual(G.rotateShape(L, 0), [[0, 0], [1, 0], [0, 1]]);
  assert.deepEqual(G.rotateShape(L, 1), [[0, 0], [1, 0], [1, 1]]);
  assert.deepEqual(G.rotateShape(L, 2), [[1, 0], [0, 1], [1, 1]]);
  assert.deepEqual(G.rotateShape(L, 3), [[0, 0], [0, 1], [1, 1]]);
  assert.deepEqual(G.rotateShape(L, 4), G.rotateShape(L, 0));
});

test('rotations lists only distinct orientations', () => {
  assert.deepEqual(G.rotations('farm'), [0, 1, 2, 3]);
  assert.deepEqual(G.rotations('market'), [0]);
  assert.deepEqual(G.rotations('hut'), [0]);
  assert.deepEqual(G.rotations('longhouse'), [0, 1]);
  assert.deepEqual(G.rotations('workshop'), [0, 1, 2, 3]);
  assert.deepEqual(G.rotations('plantation'), [0, 1, 2, 3]);
});

test('rotated footprints keep their cell count and fit their bounding box', () => {
  for (const type of Object.keys(G.BUILDINGS)) {
    for (const rot of G.rotations(type)) {
      const cells = G.rotateShape(G.BUILDINGS[type].shape, rot);
      assert.equal(new Set(cells.map(String)).size, G.BUILDINGS[type].shape.length, type + rot);
      const [w, h] = G.bbox(cells);
      assert.ok(cells.every(([x, y]) => x >= 0 && y >= 0 && x < w && y < h));
    }
  }
  assert.deepEqual(G.bbox(G.rotateShape(G.BUILDINGS.longhouse.shape, 1)), [1, 3]);
  assert.deepEqual(G.rotateShape(G.BUILDINGS.workshop.shape, 2), [[1, 0], [0, 1], [1, 1], [2, 1]]); // T upside down
});

test('canPlace needs grass, rejects water, sand and overlaps', () => {
  const s = fresh();
  assert.equal(G.canPlace(s, 'hut', 2, 2, 0).ok, true);
  assert.equal(G.canPlace(s, 'hut', 1, 1, 0).reason, 'NEEDS GRASS');
  assert.equal(G.canPlace(s, 'hut', 0, 0, 0).reason, 'NOT ON WATER');
  assert.equal(G.canPlace(s, 'market', 5, 2, 0).reason, 'NEEDS GRASS'); // hangs onto sand
  G.place(s, 'market', 2, 2);
  assert.equal(G.canPlace(s, 'hut', 3, 3, 0).reason, 'TILE TAKEN');
  assert.equal(G.canPlace(s, 'hut', 4, 2, 0).ok, true);
});

test('moving a building may overlap its own old tiles', () => {
  const s = fresh();
  const m = G.place(s, 'market', 2, 2);
  assert.equal(G.canPlace(s, 'market', 3, 2, 0).ok, false);
  assert.equal(G.canPlace(s, 'market', 3, 2, 0, m.id).ok, true); // shifts onto its own old tiles
  assert.equal(G.canPlace(s, 'market', 5, 2, 0, m.id).ok, false); // (6,2) is sand
});

test('a 1x1 aura is the 8 surrounding tiles; a 2x2 aura is its 12-tile ring', () => {
  const s = fresh();
  assert.equal(G.auraCells(s, { type: 'hut', c: 3, r: 3, rot: 0 }).size, 8);
  assert.equal(G.auraCells(s, { type: 'market', c: 2, r: 2, rot: 0 }).size, 12);
  assert.equal(G.auraCells(s, { type: 'tower', c: 3, r: 3, rot: 0 }).size, 24);
});

test('aura rings grow with the shape: line-3 has 12 tiles, T has 14, big L has 16', () => {
  const s = G.createState(Array(9).fill('ggggggggg'));
  assert.equal(G.auraCells(s, { type: 'longhouse', c: 3, r: 4, rot: 0 }).size, 12);
  assert.equal(G.auraCells(s, { type: 'workshop', c: 3, r: 3, rot: 0 }).size, 14);
  assert.equal(G.auraCells(s, { type: 'plantation', c: 3, r: 3, rot: 0 }).size, 16);
  // the inner corner tile two steps from every cell stays outside the ring
  assert.equal(G.auraCells(s, { type: 'plantation', c: 3, r: 3, rot: 0 }).has('5,3'), false);
});

test('plantation feeds a workshop, which then weighs on nearby huts', () => {
  const s = G.createState(Array(9).fill('ggggggggg'));
  const w = G.place(s, 'workshop', 3, 3, 0);    // (3,3) (4,3) (5,3) (4,4)
  const h = G.place(s, 'hut', 3, 4);
  assert.ok(G.place(s, 'plantation', 1, 3, 0)); // (1,3) (1,4) (1,5) (2,5) (3,5): foot touches (4,4)
  const e = G.evaluate(s);
  near(e.get(w.id).mult, 1.3);
  near(e.get(h.id).mult, 0.8);
  near(e.get(w.id).output, 0.65); // 0.5 silver x1.3
});

test('economy auras skip water, defense auras do not', () => {
  const s = fresh();
  // hut on the corner grass tile: its ring touches sand only; tower at the same spot reaches water
  assert.equal(G.auraCells(s, { type: 'hut', c: 2, r: 2, rot: 0 }).size, 8);
  const t = G.auraCells(s, { type: 'tower', c: 2, r: 2, rot: 0 });
  assert.ok(t.has('0,0'));
  assert.equal(t.size, 24);
});

test('evaluate applies market x1.5, hut +10%, farm +25%, idol x0.5', () => {
  const s = fresh();
  const m = G.place(s, 'market', 2, 2);
  const h1 = G.place(s, 'hut', 4, 2);
  const h2 = G.place(s, 'hut', 4, 3);
  let e = G.evaluate(s);
  near(e.get(h1.id).mult, 1.1 * 1.5); // neighbour hut + market
  near(e.get(m.id).output, 0);
  G.place(s, 'idol', 4, 4);
  e = G.evaluate(s);
  near(e.get(h2.id).mult, 1.1 * 1.5 * 0.5); // idol touches h2 only
  near(e.get(h1.id).mult, 1.1 * 1.5);
});

test('a source counts once per target even when several aura tiles hit it', () => {
  const s = fresh();
  const m = G.place(s, 'market', 2, 2);
  const f = G.place(s, 'farm', 4, 2, 3); // vertical part of the L sits beside the market
  void m;
  near(G.evaluate(s).get(f.id).mult, 1.5);
});

test('preview reports the newcomer and the neighbours it changes', () => {
  const s = fresh();
  const h = G.place(s, 'hut', 2, 2);
  const p = G.preview(s, 'idol', 3, 2, 0);
  near(p.self.output, 0.05);
  near(p.total.gold, 0.05);
  near(p.total.bronze, -0.5);
  assert.deepEqual(p.changes.map((c) => c.id), [h.id]);
  near(p.changes[0].delta, -0.5);
  assert.equal(G.preview(s, 'idol', 2, 2, 0), null); // blocked
  assert.equal(s.buildings.length, 1); // preview never mutates
});

test('state survives a JSON round trip', () => {
  const s = fresh();
  G.place(s, 'farm', 2, 2, 1);
  G.place(s, 'hut', 2, 4);
  const back = JSON.parse(JSON.stringify(s));
  assert.deepEqual([...G.evaluate(back).values()].map((e) => e.mult), [...G.evaluate(s).values()].map((e) => e.mult));
  assert.equal(G.remove(back, 1).type, 'farm');
  assert.equal(back.buildings.length, 1);
});

test('rates sum outputs per currency', () => {
  const s = fresh();
  G.place(s, 'hut', 2, 2); G.place(s, 'hut', 5, 4);   // too far apart to buff each other
  G.place(s, 'workshop', 2, 3, 0);                      // (2,3) (3,3) (4,3) (3,4): its noise reaches both huts
  const r = G.rates(s);
  near(r.bronze, 0.8 + 0.8);
  near(r.silver, 0.5);
  assert.equal(r.gold, undefined);
});
