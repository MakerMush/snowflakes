'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../js/state');
const G = require('../js/geometry');
const S = require('../js/shapes');

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test('addShape adds, selects, and can be undone and redone', () => {
  const st = ST.createStore(ST.defaultDoc());
  const o = st.addShape('circle');
  assert.equal(st.doc.objects.length, 1);
  assert.equal(st.selectedId, o.id);
  assert.ok(st.canUndo());
  st.undo();
  assert.equal(st.doc.objects.length, 0);
  assert.equal(st.selectedId, null, 'selection cleared when the object disappears');
  assert.ok(st.canRedo());
  st.redo();
  assert.equal(st.doc.objects.length, 1);
});

test('new shapes keep their proportions and do not stack on each other', () => {
  const st = ST.createStore(ST.defaultDoc());
  const a = st.addShape('capsule'), b = st.addShape('capsule');
  assert.ok(Math.abs(a.sx / a.sy - S.get('capsule').aspect) < 1e-6);
  assert.ok(a.x !== b.x || a.y !== b.y);
});

test('unknown shapes are ignored', () => {
  const st = ST.createStore(ST.defaultDoc());
  assert.equal(st.addShape('nope'), null);
  assert.equal(st.doc.objects.length, 0);
});

test('patch clamps size and position, drag gesture is one undo step', () => {
  const st = ST.createStore(ST.defaultDoc());
  const o = st.addShape('square');
  st.begin();
  st.patch(o.id, { x: 5 }); st.patch(o.id, { x: 6 }); st.patch(o.id, { x: 7, sx: 0.001, sy: 9999 });
  assert.equal(st.get(o.id).x, 7);
  assert.equal(st.get(o.id).sx, 1);
  assert.equal(st.get(o.id).sy, 200);
  st.undo();
  assert.notEqual(st.get(o.id).x, 7);
  assert.equal(st.doc.objects.length, 1, 'only the drag was undone');
});

test('begin with a key coalesces rapid repeats (arrow-key nudges)', () => {
  const st = ST.createStore(ST.defaultDoc());
  const o = st.addShape('square');
  const x0 = o.x;
  for (let i = 0; i < 5; i++) { st.begin('nudge'); st.patch(o.id, { x: st.get(o.id).x + 0.5 }); }
  st.undo();
  assert.equal(st.get(o.id).x, x0, 'five nudges undone in one step');
});

test('remove, duplicate, role, flip, reorder', () => {
  const st = ST.createStore(ST.defaultDoc());
  const a = st.addShape('circle'), b = st.addShape('square'), c = st.addShape('heart');
  st.reorder(a.id, 'front');
  assert.deepEqual(st.doc.objects.map(o => o.id), [b.id, c.id, a.id]);
  st.reorder(a.id, 'back');
  assert.equal(st.doc.objects[0].id, a.id);
  st.reorder(a.id, 'up');
  assert.equal(st.doc.objects[1].id, a.id);
  st.reorder(a.id, 'down');
  assert.equal(st.doc.objects[0].id, a.id);
  st.setRole(a.id, 'keep');
  assert.equal(st.get(a.id).role, 'keep');
  st.setRole(a.id, 'bogus');
  assert.equal(st.get(a.id).role, 'keep');
  st.toggleFlip(a.id);
  assert.equal(st.get(a.id).flip, true);
  const d = st.duplicate(a.id);
  assert.notEqual(d.id, a.id);
  assert.equal(d.role, 'keep');
  assert.equal(st.selectedId, d.id);
  st.remove(d.id);
  assert.equal(st.selectedId, null);
  assert.equal(st.doc.objects.length, 3);
});

test('setArms only accepts 4 or 6; hub settings clamp; clear empties and is undoable', () => {
  const st = ST.createStore(ST.starterDoc());
  st.setArms(8);
  assert.equal(st.doc.arms, 6);
  st.setArms(4);
  assert.equal(st.doc.arms, 4);
  st.setHubR(500);
  assert.equal(st.doc.hubR, 20);
  st.setHub(false);
  assert.equal(st.doc.hub, false);
  const n = st.doc.objects.length;
  st.clear();
  assert.equal(st.doc.objects.length, 0);
  st.undo();
  assert.equal(st.doc.objects.length, n);
});

test('subscribers hear about changes and can unsubscribe', () => {
  const st = ST.createStore(ST.defaultDoc());
  const seen = [];
  const off = st.subscribe(k => seen.push(k));
  st.addShape('circle');
  st.select(null);
  off();
  st.addShape('square');
  assert.deepEqual(seen, ['change', 'select']);
});

test('sanitize repairs bad input', () => {
  const d = ST.sanitize({
    arms: 8, hubR: 'x',
    objects: [
      { id: 'o1', shapeId: 'circle', x: 'a', y: 1e9, sx: -5, sy: 3, rot: -90, role: 'weird' },
      { id: 'o1', shapeId: 'square' },                       // duplicate id
      { id: 'o3', shapeId: 'does-not-exist' },               // dropped
      { id: 'o4', polys: [[[0, 0], [1, 0]]] },               // too few points, dropped
      { id: 'o5', polys: [[[0, 0], [1, 0], [1, 1]]], aspect: 2, name: 'Traced' },
      null
    ]
  });
  assert.equal(d.arms, 6);
  assert.equal(d.hubR, 7);
  assert.equal(d.objects.length, 3);
  const [a, b, c] = d.objects;
  assert.equal(a.x, 0); assert.equal(a.y, 200); assert.equal(a.sx, 1); assert.equal(a.rot, 270); assert.equal(a.role, 'cut');
  assert.notEqual(a.id, b.id);
  assert.equal(c.aspect, 2);
  assert.equal(new Set(d.objects.map(o => o.id)).size, 3, 'ids are unique');
  assert.ok(d.nextId > 3);
  assert.deepEqual(ST.sanitize(null).objects, []);
});

test('serialize then load round-trips the starter design', () => {
  const st = ST.createStore(ST.starterDoc());
  const again = ST.createStore(JSON.parse(st.serialize()));
  assert.deepEqual(again.doc, st.doc);
});

test('starter and random docs are valid for both fold types', () => {
  assert.equal(ST.starterDoc().objects.length, 4);
  const rand = seeded(5);
  for (const arms of [4, 6]) {
    for (let i = 0; i < 40; i++) {
      const d = ST.randomDoc(arms, rand);
      assert.equal(d.arms, arms);
      assert.ok(d.objects.length >= 4 && d.objects.length <= 7);
      assert.deepEqual(ST.sanitize(d).objects.length, d.objects.length, 'random doc survives sanitize');
      d.objects.forEach(o => assert.ok(G.inWedge(arms, [o.x, o.y], G.R * 1.1) || o.y < 0));
    }
  }
});

test('object cap is enforced', () => {
  const st = ST.createStore(ST.defaultDoc());
  for (let i = 0; i < ST.MAX_OBJECTS + 5; i++) st.addShape('circle');
  assert.equal(st.doc.objects.length, ST.MAX_OBJECTS);
});
