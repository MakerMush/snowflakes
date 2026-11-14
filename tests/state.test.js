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

test('alignTo center: x becomes 0, rotation becomes 0, height is kept', () => {
  const st = ST.createStore(ST.defaultDoc());
  const o = st.addShape('heart');
  st.patch(o.id, { x: 7, y: -40, rot: 123 });
  st.alignTo(o.id, 'center');
  assert.equal(st.get(o.id).x, 0);
  assert.equal(st.get(o.id).rot, 0);
  assert.equal(st.get(o.id).y, -40);
  st.undo();
  assert.equal(st.get(o.id).x, 7);
  assert.equal(st.get(o.id).rot, 123);
});

for (const arms of [4, 6]) {
  const H = G.halfAngle(arms);
  const perpDist = (edgeSign, p) => {                       // signed distance of p from an edge line, positive = inside the wedge
    const n = edgeSign < 0 ? [Math.cos(H), -Math.sin(H)] : [-Math.cos(H), -Math.sin(H)];
    return p[0] * n[0] + p[1] * n[1];
  };
  for (const mode of ['left', 'right']) {
    const sg = mode === 'left' ? -1 : 1;
    test(`alignTo ${mode} edge, ${arms} arms: rotation is the edge angle and the shape sits on the fold`, () => {
      const st = ST.createStore(Object.assign(ST.defaultDoc(), { arms }));
      const o = st.addShape('heart');
      st.patch(o.id, { x: 3, y: -50, rot: 77 });
      st.alignTo(o.id, mode);
      const a = st.get(o.id);
      assert.ok(Math.abs(((a.rot + 180) % 360) - 180 - sg * H * 180 / Math.PI) < 1e-9, 'rot = ' + a.rot);
      assert.ok(Math.abs(perpDist(sg, [a.x, a.y])) < 1e-9, 'centre lies on the fold line');
      // the shape's own vertical axis runs along the fold: its top-centre is also on the line
      const m = G.objectMatrix(a);
      assert.ok(Math.abs(perpDist(sg, G.apply(m, [0, -0.5]))) < 1e-9, 'top of the shape is on the fold');
      assert.ok(Math.abs(perpDist(sg, G.apply(m, [0, 0.5]))) < 1e-9, 'bottom of the shape is on the fold');
      // distance from the tip is kept (projection of the old position onto the edge)
      const u = [sg * Math.sin(H), -Math.cos(H)];
      assert.ok(Math.abs((a.x * u[0] + a.y * u[1]) - (3 * u[0] + -50 * u[1])) < 1e-9);
    });

    test(`alignTo ${mode} edge inside, ${arms} arms: side of the shape touches the fold from within`, () => {
      const st = ST.createStore(Object.assign(ST.defaultDoc(), { arms }));
      const o = st.addShape('square');
      st.patch(o.id, { x: 0, y: -45, rot: 10, sx: 9, sy: 14 });
      st.alignTo(o.id, mode, { flush: true });
      const a = st.get(o.id), m = G.objectMatrix(a);
      const outerSide = sg < 0 ? -0.5 : 0.5;               // the local x side that should lie on the fold
      [-0.5, 0, 0.5].forEach(ly => assert.ok(Math.abs(perpDist(sg, G.apply(m, [outerSide, ly]))) < 1e-9, 'side point on the fold'));
      [-0.5, 0, 0.5].forEach(ly => assert.ok(perpDist(sg, G.apply(m, [-outerSide, ly])) > 8.9, 'far side is a full width inside'));
    });
  }
}

test('alignTo ignores unknown modes and ids', () => {
  const st = ST.createStore(ST.defaultDoc());
  const o = st.addShape('circle');
  const before = JSON.stringify(st.doc);
  st.alignTo(o.id, 'sideways');
  st.alignTo('nope', 'center');
  assert.equal(JSON.stringify(st.doc), before);
});

test('addObjects adds drafts as one undo step and keeps the selection', () => {
  const st = ST.createStore(ST.defaultDoc());
  const a = st.addShape('circle');
  const added = st.addObjects([
    { shapeId: 'square', x: 1, y: -30, sx: 10, sy: 3, rot: 20, role: 'keep', label: 'Bridge', bridge: true },
    { shapeId: 'square', x: 2, y: -31, sx: 10, sy: 3, rot: 40, role: 'keep', label: 'Bridge', bridge: true }
  ]);
  assert.equal(added.length, 2);
  assert.equal(st.selectedId, a.id);
  assert.ok(added.every(o => o.bridge && o.label === 'Bridge' && o.role === 'keep'));
  assert.equal(new Set(st.doc.objects.map(o => o.id)).size, 3, 'unique ids');
  assert.equal(st.removeBridges(), 2);
  assert.equal(st.doc.objects.length, 1);
  st.undo();
  assert.equal(st.doc.objects.length, 3);
  st.undo();
  assert.equal(st.doc.objects.length, 1, 'adding both was a single step');
});

test('object cap is enforced', () => {
  const st = ST.createStore(ST.defaultDoc());
  for (let i = 0; i < ST.MAX_OBJECTS + 5; i++) st.addShape('circle');
  assert.equal(st.doc.objects.length, ST.MAX_OBJECTS);
});
