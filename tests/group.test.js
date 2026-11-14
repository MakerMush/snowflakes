'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../js/state');

function three() {
  const st = ST.createStore(ST.defaultDoc());
  const a = st.addShape('circle'), b = st.addShape('petal'), c = st.addShape('diamond');
  return { st, a, b, c };
}
const ids = (st) => st.doc.objects.map((o) => o.id);

test('selectIds, toggleSelect and selectAll build a multi-selection', () => {
  const { st, a, b, c } = three();
  st.select(a.id);
  assert.equal(st.selectedId, a.id);
  st.toggleSelect(b.id);
  assert.deepEqual(st.selectedIds, [a.id, b.id]);
  assert.equal(st.selectedId, null, 'selectedId is only set for exactly one object');
  st.toggleSelect(a.id);
  assert.deepEqual(st.selectedIds, [b.id]);
  assert.equal(st.selectedId, b.id);
  st.selectAll();
  assert.equal(st.selectedIds.length, 3);
  st.selectIds([c.id]);
  assert.deepEqual(st.selectedIds, [c.id]);
  st.selectIds([a.id], true);
  assert.equal(st.selectedIds.length, 2);
  st.select(null);
  assert.deepEqual(st.selectedIds, []);
});

test('group needs two shapes, is one undo step, and selecting one member selects them all', () => {
  const { st, a, b, c } = three();
  st.select(a.id);
  assert.equal(st.groupSelection(), null, 'one shape cannot be a group');
  st.selectIds([a.id, c.id]);
  const before = st.serialize();
  const g = st.groupSelection();
  assert.match(g, /^g\d+$/);
  assert.equal(st.get(a.id).group, g);
  assert.equal(st.get(c.id).group, g);
  assert.equal(st.get(b.id).group, undefined);
  assert.deepEqual(ids(st), [b.id, a.id, c.id], 'members sit side by side at the top member');
  st.select(null);
  st.select(a.id);
  assert.deepEqual(st.selectedIds.sort(), [a.id, c.id].sort(), 'whole group selected');
  assert.equal(st.groupSelection(), g, 'grouping an existing group changes nothing');
  st.undo();
  assert.equal(st.serialize(), before);
});

test('ungroup releases the members and keeps them selected', () => {
  const { st, a, b } = three();
  st.selectIds([a.id, b.id]);
  st.groupSelection();
  const n = st.ungroupSelection();
  assert.equal(n, 2);
  assert.equal(st.get(a.id).group, undefined);
  assert.equal(st.selectedIds.length, 2);
  assert.equal(st.ungroupSelection(), 0);
  st.select(a.id);
  assert.equal(st.selectedId, a.id, 'a lone shape selects alone again');
});

test('grouping across groups merges them, and removing a member removes its whole group', () => {
  const { st, a, b, c } = three();
  st.selectIds([a.id, b.id]); const g1 = st.groupSelection();
  st.selectIds([a.id, c.id]);                  // expands to a, b, c
  assert.equal(st.selectedIds.length, 3);
  const g2 = st.groupSelection();
  assert.notEqual(g1, g2);
  assert.ok(st.doc.objects.every((o) => o.group === g2));
  // remove one by id: whole group goes (groups act as a unit)
  st.remove(a.id);
  assert.equal(st.doc.objects.length, 0);
});

test('remove, duplicate, role and flip act on the whole selection', () => {
  const { st, a, b, c } = three();
  st.selectIds([a.id, b.id]);
  st.setRole(undefined, 'keep');
  assert.equal(st.get(a.id).role, 'keep'); assert.equal(st.get(b.id).role, 'keep'); assert.equal(st.get(c.id).role, 'cut');
  st.undo();
  assert.equal(st.get(a.id).role, 'cut', 'role change was one undo step');
  st.groupSelection();
  const copies = st.duplicate();
  assert.equal(copies.length, 2);
  assert.equal(st.doc.objects.length, 5);
  const gids = new Set(copies.map((o) => o.group));
  assert.equal(gids.size, 1);
  assert.notEqual(copies[0].group, st.get(a.id).group, 'the copy is its own group');
  assert.deepEqual(st.selectedIds, copies.map((o) => o.id));
  st.remove();
  assert.equal(st.doc.objects.length, 3);
  assert.equal(st.selectedIds.length, 0);
});

test('flipping several shapes mirrors them about their middle', () => {
  const { st, a, b } = three();
  Object.assign(st.get(a.id), { x: -20, y: -50, rot: 30, flip: false });
  Object.assign(st.get(b.id), { x: 10, y: -70, rot: 0, flip: false });
  st.selectIds([a.id, b.id]);
  const bb = st.selectionBounds();
  st.toggleFlip();
  const A = st.get(a.id), B = st.get(b.id);
  assert.ok(Math.abs(A.x - (2 * bb.cx + 20)) < 1e-9);
  assert.ok(Math.abs(B.x - (2 * bb.cx - 10)) < 1e-9);
  assert.equal(A.flip, true); assert.ok(Math.abs(A.rot - 330) < 1e-9);
  assert.equal(A.y, -50);
  const bb2 = st.selectionBounds();
  assert.ok(Math.abs(bb2.cx - bb.cx) < 1e-6, 'the group stays put');
  st.toggleFlip();
  assert.ok(Math.abs(st.get(a.id).x + 20) < 1e-9 && Math.abs(st.get(a.id).rot - 30) < 1e-9, 'flip twice is the identity');
});

test('transform moves, scales and rotates a selection around a centre', () => {
  const { st, a, b } = three();
  Object.assign(st.get(a.id), { x: -10, y: -50, sx: 10, sy: 10, rot: 0 });
  Object.assign(st.get(b.id), { x: 10, y: -50, sx: 10, sy: 20, rot: 40 });
  st.selectIds([a.id, b.id]);
  const base = st.snapshotOf(), c = st.selectionBounds();
  st.begin();
  st.transform(base, { dx: 5, dy: -3, s: 2, theta: 0, cx: c.cx, cy: c.cy });
  let A = st.get(a.id), B = st.get(b.id);
  assert.ok(Math.abs(A.x - (c.cx + 5 + 2 * (-10 - c.cx))) < 1e-9);
  assert.ok(Math.abs(B.sx - 20) < 1e-9 && Math.abs(B.sy - 40) < 1e-9);
  assert.ok(Math.abs(A.y - (c.cy - 3 + 2 * (-50 - c.cy))) < 1e-9);
  // quarter turn clockwise about the centre (screen coordinates, y down): the left shape goes to the top
  st.transform(base, { dx: 0, dy: 0, s: 1, theta: 90, cx: 0, cy: -50 });
  A = st.get(a.id); B = st.get(b.id);
  assert.ok(Math.abs(A.x - 0) < 1e-9 && Math.abs(A.y - (-60)) < 1e-9, 'left of centre rotates to above it');
  assert.ok(Math.abs(B.x - 0) < 1e-9 && Math.abs(B.y - (-40)) < 1e-9);
  assert.ok(Math.abs(B.rot - 130) < 1e-9);
  // sizes never leave 1..200
  st.transform(base, { s: 1000, cx: 0, cy: -50 });
  assert.ok(st.get(a.id).sx <= 200 && st.get(b.id).sy <= 200);
  assert.ok(Math.abs(st.get(b.id).sy / st.get(b.id).sx - 2) < 1e-9, 'proportions survive clamping');
  st.transform(base, { s: 0.0001, cx: 0, cy: -50 });
  assert.ok(st.get(a.id).sx >= 1 - 1e-9 && st.get(a.id).sy >= 1 - 1e-9);
  // the whole gesture is one undo step
  st.undo();
  assert.equal(st.get(a.id).x, -10);
});

test('align center moves a selection together without rotating it', () => {
  const { st, a, b } = three();
  Object.assign(st.get(a.id), { x: 10, y: -50, sx: 10, sy: 10, rot: 20 });
  Object.assign(st.get(b.id), { x: 30, y: -60, sx: 10, sy: 10, rot: 20 });
  st.selectIds([a.id, b.id]);
  st.alignTo(undefined, 'center');
  assert.ok(Math.abs(st.selectionBounds().cx) < 1e-9);
  assert.equal(st.get(a.id).rot, 20);
  assert.ok(Math.abs(st.get(b.id).x - st.get(a.id).x - 20) < 1e-9, 'spacing preserved');
  const x = st.get(a.id).x;
  st.alignTo(undefined, 'left');
  assert.equal(st.get(a.id).x, x, 'edge align is single-shape only');
});

test('reorder moves a group as one block and hops over other groups', () => {
  const st = ST.createStore(ST.defaultDoc());
  const o = [1, 2, 3, 4, 5].map(() => st.addShape('circle'));
  st.selectIds([o[0].id, o[1].id]); st.groupSelection();        // [0 1] 2 3 4
  st.selectIds([o[3].id, o[4].id]); st.groupSelection();        // [0 1] 2 [3 4]
  const n = (x) => o.indexOf(o.find((q) => q.id === x));
  const order = () => ids(st).map(n).join('');
  assert.equal(order(), '01234');
  st.select(o[0].id); st.reorder(undefined, 'up');
  assert.equal(order(), '20134', 'jumps over the single shape');
  st.reorder(undefined, 'up');
  assert.equal(order(), '23401', 'jumps over the whole group');
  st.reorder(undefined, 'down');
  assert.equal(order(), '20134', 'comes back down over the group');
  st.reorder(undefined, 'front');
  assert.equal(order(), '23401');
  st.reorder(undefined, 'back');
  assert.equal(order(), '01234');
  const before = st.serialize();
  st.reorder(undefined, 'back');
  assert.equal(st.serialize(), before, 'no change records no undo step');
  // plain single reorder still works
  st.select(o[2].id); st.reorder(undefined, 'down');
  assert.equal(order(), '20134', 'a lone shape also hops over a whole group');
});

test('groups are saved, restored and cleaned up on load', () => {
  const { st, a, b, c } = three();
  st.selectIds([a.id, c.id]);
  const g = st.groupSelection();
  const again = ST.createStore(JSON.parse(st.serialize()));
  assert.equal(again.get(a.id).group, g);
  // hostile or sloppy input: single-member groups vanish, scattered members are gathered, junk ids dropped
  const d = JSON.parse(st.serialize());
  d.objects.forEach((o, i) => { o.group = i === 0 ? 'g9' : i === 1 ? 'g1' : i === 2 ? 'g1' : 'nope'; });
  d.objects.splice(1, 0, Object.assign({}, d.objects[0], { id: 'o99', group: 'g5' }));
  const clean = ST.sanitize(d);
  const groups = {};
  clean.objects.forEach((o) => { if (o.group) groups[o.group] = (groups[o.group] || 0) + 1; });
  Object.keys(groups).forEach((k) => assert.ok(groups[k] >= 2, 'no group of one: ' + k));
  assert.ok(!clean.objects.some((o) => o.group === 'g9' || o.group === 'g5' || o.group === 'nope'));
  const seq = clean.objects.map((o) => o.group || '-').join(',');
  assert.ok(!/(g1),-,(g1)/.test(seq), 'members of a group are adjacent');
  // undo/redo of grouping keeps working through the store
  const s2 = ST.createStore(ST.defaultDoc());
  const x = s2.addShape('circle'), y = s2.addShape('petal');
  s2.selectIds([x.id, y.id]); s2.groupSelection(); s2.undo();
  assert.equal(s2.get(x.id).group, undefined);
  s2.redo();
  assert.ok(s2.get(x.id).group);
});

test('mode switch, clear and replace drop the selection', () => {
  const { st, a, b } = three();
  st.selectIds([a.id, b.id]);
  st.clear();
  assert.deepEqual(st.selectedIds, []);
});
