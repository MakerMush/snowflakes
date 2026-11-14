'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry');
const ST = require('../js/state');
const SM = require('../js/sampler');

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function docWith(arms, objs, extra) {
  const d = ST.defaultDoc();
  d.arms = arms;
  Object.assign(d, extra || {});
  objs.forEach((o, i) => d.objects.push(Object.assign({ id: 'o' + (i + 1), type: 'shape', rot: 0, flip: false, role: 'cut' }, o)));
  d.nextId = objs.length + 1;
  return d;
}

for (const arms of [4, 6]) {
  test(`arms=${arms}: a random design is identical under every symmetry of the unfolded paper`, () => {
    const rand = seeded(99);
    for (let trial = 0; trial < 12; trial++) {
      const doc = ST.randomDoc(arms, rand);
      doc.objects[0].role = 'keep';                         // exercise both roles
      const c = SM.compile(doc);
      for (let i = 0; i < 150; i++) {
        const p = [(rand() * 2 - 1) * G.R, (rand() * 2 - 1) * G.R];
        if (Math.hypot(p[0], p[1]) > G.R - 0.5) continue;
        const here = c.paperAt(p[0], p[1]);
        G.orbit(arms, G.foldToWedge(arms, p)).forEach(q => {
          assert.equal(c.paperAt(q[0], q[1]), here, 'same answer at every image of the point');
        });
      }
    }
  });
}

test('empty doc is all paper inside the disc and null outside', () => {
  const c = SM.compile(ST.defaultDoc());
  assert.equal(c.paperAt(0, 0), true);
  assert.equal(c.paperAt(50, 50), true);
  assert.equal(c.paperAt(99, 0), true);
  assert.equal(c.paperAt(101, 0), null);
  assert.equal(SM.cutFraction(ST.defaultDoc()), 0);
});

test('a cut shape removes paper at all 12 mirrored places (hub off)', () => {
  const doc = docWith(6, [{ shapeId: 'circle', x: 0, y: -50, sx: 10, sy: 10 }], { hub: false });
  const c = SM.compile(doc);
  assert.equal(c.paperAt(0, -50), false);
  G.orbit(6, [0, -50]).forEach(q => assert.equal(c.paperAt(q[0], q[1]), false));
  assert.equal(c.paperAt(0, -70), true);
});

test('keep paints over cut when it comes later, and loses when it comes earlier', () => {
  const big = { shapeId: 'square', x: 0, y: -50, sx: 20, sy: 20 };
  const small = { shapeId: 'circle', x: 0, y: -50, sx: 6, sy: 6 };
  const keepOnTop = SM.compile(docWith(6, [big, Object.assign({ role: 'keep' }, small)], { hub: false }));
  assert.equal(keepOnTop.paperAt(0, -50), true, 'kept island in the middle');
  assert.equal(keepOnTop.paperAt(0, -42), false, 'cut around it');
  const keepBelow = SM.compile(docWith(6, [Object.assign({ role: 'keep' }, small), big], { hub: false }));
  assert.equal(keepBelow.paperAt(0, -50), false, 'cut painted last wins');
});

test('hub protects the center', () => {
  const cutAll = { shapeId: 'square', x: 0, y: -8, sx: 40, sy: 40 };
  const withHub = SM.compile(docWith(6, [cutAll], { hub: true, hubR: 7 }));
  const noHub = SM.compile(docWith(6, [cutAll], { hub: false }));
  assert.equal(withHub.paperAt(0, -3), true);
  assert.equal(noHub.paperAt(0, -3), false);
  assert.equal(withHub.paperAt(0, -12), false);
});

test('rotation and flip move the cut where the matrix says', () => {
  const base = { shapeId: 'triangle', x: 0, y: -50, sx: 12, sy: 12 };
  const up = SM.compile(docWith(6, [base], { hub: false }));
  const flipped = SM.compile(docWith(6, [Object.assign({ rot: 180 }, base)], { hub: false }));
  // The triangle points up: narrow tip at y=-56, wide base at y=-44. Probe off the center axis.
  assert.equal(up.paperAt(3, -54), true, 'near the tip, off-axis: still paper');
  assert.equal(up.paperAt(3, -46), false, 'near the base, off-axis: cut');
  assert.equal(flipped.paperAt(3, -54), false, 'rotated 180 degrees: wide end is now on top');
  assert.equal(flipped.paperAt(3, -46), true);
});

test('cutFraction: covering the whole wedge cuts nearly everything, half-ish for a half', () => {
  const huge = docWith(6, [{ shapeId: 'square', x: 0, y: -50, sx: 200, sy: 200 }], { hub: false });
  assert.ok(SM.cutFraction(huge, 64) > 0.99);
  const some = docWith(6, [{ shapeId: 'circle', x: 0, y: -50, sx: 20, sy: 20 }], { hub: false });
  const f = SM.cutFraction(some, 96);
  const expected = (Math.PI * 100) / (Math.PI * 100 * 100 / 12);   // circle area over wedge area
  assert.ok(Math.abs(f - expected) < 0.01, `fraction ${f} vs expected ${expected}`);
});

test('build mode: nothing is paper until a keep shape adds it, and cuts carve the paper back out', () => {
  const SM = require('../js/sampler'), ST2 = require('../js/state');
  const doc = ST2.defaultDoc(); doc.mode = 'build'; doc.hub = false;
  assert.equal(SM.compile(doc).paperAt(0, -50), false, 'empty build wedge is all cut away');
  assert.equal(SM.compile(doc).paperAt(0, -120), null, 'outside the disc stays outside');
  doc.objects.push({ id: 'o1', type: 'shape', shapeId: 'circle', x: 0, y: -50, sx: 20, sy: 20, rot: 0, flip: false, role: 'keep' });
  let c = SM.compile(doc);
  assert.equal(c.paperAt(0, -50), true, 'kept circle is paper');
  assert.equal(c.paperAt(0, -80), false);
  doc.objects.push({ id: 'o2', type: 'shape', shapeId: 'circle', x: 0, y: -50, sx: 8, sy: 8, rot: 0, flip: false, role: 'cut' });
  c = SM.compile(doc);
  assert.equal(c.paperAt(0, -50), false, 'a cut on top carves a hole in the kept shape');
  assert.equal(c.paperAt(0, -58), true);
  // symmetry: the unfolded flake is still 12 images of the same point
  const G2 = require('../js/geometry');
  const pts = G2.orbit(6, [3, -52]);
  assert.equal(new Set(pts.map(p => c.paperAt(p[0], p[1]))).size, 1);
  doc.hub = true; doc.objects = [];
  assert.equal(SM.compile(doc).paperAt(0, -3), true, 'the protected center is paper in build mode too');
  assert.equal(SM.compile(doc).paperAt(0, -30), false);
});

test('indexed point-in-shape tests agree exactly with the plain even-odd test (big traced shapes)', () => {
  const SM2 = require('../js/sampler'), G2 = require('../js/geometry');
  // a wiggly ring with a hole, 600 points per outline
  const ring = (r, wob, n) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, rr = r + wob * Math.sin(a * 9); return [rr * Math.cos(a), rr * Math.sin(a)]; });
  const polys = [ring(0.45, 0.04, 600), ring(0.2, 0.03, 600)];
  const bb = G2.polygonBBox([].concat.apply([], polys));
  const t = SM2.makeTester(polys, bb);
  let seed = 3; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 20000; i++) {
    const x = (rnd() - 0.5) * 1.2, y = (rnd() - 0.5) * 1.2;
    assert.equal(t(x, y), G2.pointInPolys(polys, x, y), `(${x.toFixed(3)}, ${y.toFixed(3)})`);
  }
  assert.equal(t(0, -5), false, 'far outside');
  // small shapes take the direct path and still work
  const tri = [[[-0.5, 0.5], [0.5, 0.5], [0, -0.5]]];
  assert.equal(SM2.makeTester(tri, G2.polygonBBox(tri[0]))(0, 0.2), true);
});
