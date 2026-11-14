'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry');
const S = require('../js/shapes');

test('library has unique ids and enough shapes', () => {
  const ids = S.list.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 18);
});

for (const s of S.list) {
  test(`shape "${s.id}" is a valid normalized simple polygon`, () => {
    assert.ok(s.aspect > 0.05 && s.aspect < 20, 'aspect sane: ' + s.aspect);
    assert.equal(s.polys.length, 1);
    const poly = s.polys[0];
    assert.ok(poly.length >= 3);
    const bb = G.polygonBBox(poly);
    assert.ok(Math.abs(bb.x0 + 0.5) < 1e-3 && Math.abs(bb.x1 - 0.5) < 1e-3, 'x spans -0.5..0.5');
    assert.ok(Math.abs(bb.y0 + 0.5) < 1e-3 && Math.abs(bb.y1 - 0.5) < 1e-3, 'y spans -0.5..0.5');
    assert.ok(Math.abs(G.polygonArea(poly)) > 0.08, 'has real area');
    assert.ok(G.isSimplePolygon(poly), 'does not cross itself');
  });
}

test('fit keeps the longest side at 1', () => {
  assert.deepEqual(S.fit(2), { sx: 1, sy: 0.5 });
  assert.deepEqual(S.fit(0.25), { sx: 0.25, sy: 1 });
  assert.deepEqual(S.fit(1), { sx: 1, sy: 1 });
});

test('resolve handles library shapes, inline polys and unknown ids', () => {
  assert.equal(S.resolve({ shapeId: 'circle' }).id, 'circle');
  const inline = S.resolve({ polys: [[[0, 0], [1, 0], [1, 1]]], aspect: 2 });
  assert.equal(inline.aspect, 2);
  assert.equal(S.resolve({ shapeId: 'nope' }), null);
});

test('pathD builds a closed path per polygon and is cached', () => {
  const sh = S.get('square');
  const d = S.pathD(sh);
  assert.match(d, /^M.*Z$/);
  assert.equal(S.pathD(sh), d);
  assert.equal((d.match(/M/g) || []).length, 1);
});

test('the crescent really is concave (area well below its bounding circle)', () => {
  const c = S.get('crescent');
  assert.ok(Math.abs(G.polygonArea(c.polys[0])) < 0.5);
});
