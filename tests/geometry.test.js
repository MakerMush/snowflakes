'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry');

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const closePt = (p, q, eps = 1e-6) => close(p[0], q[0], eps) && close(p[1], q[1], eps);

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function randomWedgePoint(n, rand) {
  for (;;) {
    const p = [(rand() * 2 - 1) * G.R, -rand() * G.R];
    if (G.inWedge(n, p) && Math.hypot(p[0], p[1]) > 3) return p;
  }
}
const sameSet = (A, B, eps = 1e-6) => A.length === B.length && A.every(a => B.some(b => closePt(a, b, eps)));

for (const n of [4, 6]) {
  test(`n=${n}: unfold gives 2n copies that each land in a different sector`, () => {
    const rand = seeded(7);
    for (let i = 0; i < 50; i++) {
      const p = randomWedgePoint(n, rand);
      const imgs = G.orbit(n, p);
      assert.equal(imgs.length, 2 * n);
      const sectors = imgs.map(q => G.sectorIndex(n, q));
      assert.deepEqual([...sectors].sort((a, b) => a - b), [...Array(2 * n).keys()]);
      imgs.forEach((q, k) => assert.equal(G.sectorIndex(n, q), k, 'copy k lands in sector k'));
    }
  });

  test(`n=${n}: orbit is invariant under every rotation and mirror of the symmetry group`, () => {
    const rand = seeded(11);
    const info = G.groupInfo(n);
    for (let i = 0; i < 25; i++) {
      const p = randomWedgePoint(n, rand);
      const orb = G.orbit(n, p);
      for (let j = 0; j < n; j++) {
        const rot = G.rotation(j * 2 * Math.PI / n);
        assert.ok(sameSet(orb, orb.map(q => G.apply(rot, q))), 'rotation symmetry');
      }
      info.mirrorLineAnglesRad.forEach(beta => {
        const m = G.reflection(beta);
        assert.ok(sameSet(orb, orb.map(q => G.apply(m, q))), 'mirror symmetry');
      });
    }
  });

  test(`n=${n}: foldToWedge undoes the unfold`, () => {
    const rand = seeded(23);
    for (let i = 0; i < 100; i++) {
      const p = randomWedgePoint(n, rand);
      G.orbit(n, p).forEach(q => {
        const back = G.foldToWedge(n, q);
        assert.ok(closePt(back, p, 1e-6), `fold of ${q} should be ${p}, got ${back}`);
        assert.ok(G.inWedge(n, back, G.R + 1e-6));
      });
    }
  });

  test(`n=${n}: wedge area is 1/(2n) of the disc`, () => {
    const area = G.polygonArea(G.wedgePolygon(n, G.R, 600));
    assert.ok(Math.abs(Math.abs(area) / (Math.PI * G.R * G.R) - 1 / (2 * n)) < 1e-3);
  });

  test(`n=${n}: group info`, () => {
    const info = G.groupInfo(n);
    assert.equal(info.order, 2 * n);
    assert.equal(info.wedgeDeg, 180 / n);
    assert.equal(info.rotationStepDeg, 360 / n);
    assert.equal(info.groupName, 'D' + n);
    assert.equal(info.mirrorLineAnglesRad.length, n);
  });
}

test('wedge facts: 6 arms is a 30 degree wedge with 12 layers, 4 arms is 45 with 8', () => {
  assert.ok(close(G.wedgeAngle(6) / G.DEG, 30));
  assert.ok(close(G.wedgeAngle(4) / G.DEG, 45));
  assert.equal(G.layerCount(6), 12);
  assert.equal(G.layerCount(4), 8);
});

test('inWedge accepts the axis and rejects outside points', () => {
  assert.ok(G.inWedge(6, [0, -50]));
  assert.ok(G.inWedge(6, [0, 0]));
  assert.ok(!G.inWedge(6, [0, 5]));
  assert.ok(!G.inWedge(6, [40, -50]));
  assert.ok(!G.inWedge(6, [0, -101]));
  assert.ok(G.inWedge(6, [50 * Math.tan(15 * G.DEG) - 1e-3, -50]));
});

test('matrix helpers: invert and mul', () => {
  const m = G.mul(G.translation(3, -4), G.mul(G.rotation(0.7), G.scaling(2, 5)));
  const id = G.mul(m, G.invert(m));
  [0, 1, 2, 3, 4, 5].forEach(i => assert.ok(close(id[i], G.IDENT[i], 1e-9)));
  const p = [1.5, -2.5];
  assert.ok(closePt(G.apply(G.invert(m), G.apply(m, p)), p, 1e-9));
});

test('reflection across the y axis flips x', () => {
  const m = G.reflection(Math.PI / 2);
  assert.ok(closePt(G.apply(m, [3, 7]), [-3, 7]));
});

test('objectMatrix: translate, rotate, scale, flip', () => {
  const o = { x: 10, y: -20, sx: 4, sy: 2, rot: 90, flip: false };
  // normalized (0.5, 0) -> scaled (2, 0) -> rotated 90deg (0, 2) -> translated (10, -18)
  assert.ok(closePt(G.apply(G.objectMatrix(o), [0.5, 0]), [10, -18]));
  const f = Object.assign({}, o, { flip: true, rot: 0 });
  assert.ok(closePt(G.apply(G.objectMatrix(f), [0.5, 0]), [8, -20]));
});

test('polygon helpers', () => {
  const sq = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.equal(G.polygonArea(sq), 4);
  const bb = G.polygonBBox(sq);
  assert.deepEqual([bb.w, bb.h], [2, 2]);
  assert.ok(G.isSimplePolygon(sq));
  assert.ok(!G.isSimplePolygon([[0, 0], [2, 2], [2, 0], [0, 2]]), 'bowtie crosses itself');
});

test('pointInPolys is even-odd so holes work', () => {
  const donut = [[[-2, -2], [2, -2], [2, 2], [-2, 2]], [[-1, -1], [1, -1], [1, 1], [-1, 1]]];
  assert.ok(G.pointInPolys(donut, 1.5, 0));
  assert.ok(!G.pointInPolys(donut, 0, 0));
  assert.ok(!G.pointInPolys(donut, 3, 0));
});

for (const n of [4, 6]) {
  test(`n=${n}: offset wedge is the wedge plus a constant-width margin on both straight edges`, () => {
    const d = 0.2, H = G.halfAngle(n);
    const poly = G.wedgeOffsetPolygon(n, G.R + 1.5, d, 64);
    const inside = (p) => G.pointInPolys([poly], p[0], p[1]);
    // perpendicular distance from the left/right edge, at several depths including very near the tip
    for (const depth of [1, 5, 20, 60, 88]) {
      const edgeX = depth * Math.tan(H);                       // wedge edge at this depth (right side)
      const perp = (dist) => [edgeX + dist / Math.cos(H), -depth];   // a point dist away from the edge, horizontally scaled to be perpendicular
      assert.ok(inside(perp(-0.01)), `just inside the edge at depth ${depth}`);
      assert.ok(inside(perp(d * 0.9)), `0.9d outside the edge is still covered at depth ${depth}`);
      assert.ok(!inside(perp(d * 1.2)), `1.2d outside the edge is not covered at depth ${depth}`);
      const mirror = (p) => [-p[0], p[1]];
      assert.equal(inside(mirror(perp(d * 0.9))), true, 'left side matches the right');
    }
    G.wedgePolygon(n, G.R, 40).forEach((p) => assert.ok(inside([p[0] * 0.999, p[1] * 0.999]) || Math.hypot(p[0], p[1]) < 0.5, 'contains the real wedge'));
    assert.match(G.wedgeOffsetPathD(n, G.R + 1.5, d), /^M0 .*A.*Z$/);
  });
}

test('wedgePathD is a closed arc path with the right endpoints', () => {
  const d = G.wedgePathD(6, 100, 0);
  assert.match(d, /^M0 0L-25\.8819 -96\.5926A100 100 0 0 1 25\.8819 -96\.5926Z$/);
});
