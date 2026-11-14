'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/trace');
const G = require('../js/geometry');
const S = require('../js/shapes');

function img(w, h, bg, draw) {                       // gray image helper: draw(x, y) returns a gray value or undefined
  const g = new Uint8Array(w * h).fill(bg);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = draw(x, y); if (v !== undefined) g[y * w + x] = v; }
  return { gray: g, width: w, height: h };
}
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function iou(polys, mask, w, h) {                    // how well do the polygons (even-odd) reproduce the mask?
  let inter = 0, uni = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = G.pointInPolys(polys, x + 0.5, y + 0.5), b = mask[y * w + x] === 1;
    if (a && b) inter++; if (a || b) uni++;
  }
  return uni ? inter / uni : 1;
}
const disc = (cx, cy, r) => (x, y) => ((x - cx) ** 2 + (y - cy) ** 2 <= r * r ? 20 : undefined);

test('toGray composites transparency over white', () => {
  const g = T.toGray(new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 128]), 4, 1);
  assert.equal(g[0], 0); assert.equal(g[1], 255); assert.equal(g[2], 255); assert.ok(g[3] > 120 && g[3] < 135);
});

test('otsu splits a two-tone picture between its tones; auto threshold respects invert', () => {
  const a = img(60, 60, 220, (x, y) => (x < 30 ? 30 : undefined));
  const t = T.otsu(a.gray);
  assert.ok(t > 30 && t <= 220, 'threshold ' + t);
  const dark = T.binarize(a.gray, t, false), light = T.binarize(a.gray, t, true);
  for (let i = 0; i < dark.length; i++) assert.equal(dark[i] + light[i], 1);
  assert.equal(dark[0], 1); assert.equal(dark[59], 0);
});

test('blur smooths a hard edge and leaves flat areas alone', () => {
  const a = img(40, 10, 255, (x) => (x < 20 ? 0 : undefined));
  const b = T.blur(a.gray, 40, 10, 3);
  assert.equal(b[5], 0); assert.equal(b[35], 255);
  assert.ok(b[20] > 20 && b[20] < 235, 'edge pixel is in between: ' + b[20]);
  assert.equal(T.blur(a.gray, 40, 10, 0), a.gray);
});

test('label counts regions, areas and whether they touch the edge', () => {
  const m = new Uint8Array(8 * 8);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) m[y * 8 + x] = 1;       // touches the corner
  m[5 * 8 + 5] = 1; m[6 * 8 + 6] = 1;                                              // diagonal pair
  const e8 = T.label(m, 8, 8, 1, true), e4 = T.label(m, 8, 8, 1, false);
  assert.equal(e8.count, 2); assert.equal(e4.count, 3);
  assert.deepEqual(e8.areas.slice(1).sort(), [2, 6].sort());
  assert.equal(e8.border[e8.labels[0]], 1); assert.equal(e8.border[e8.labels[5 * 8 + 5]], 0);
});

test('clean removes specks, fills pin holes, and leaves big shapes and edge-touching gaps alone', () => {
  const w = 40, h = 40, m = new Uint8Array(w * h);
  for (let y = 5; y < 30; y++) for (let x = 5; x < 30; x++) m[y * w + x] = 1;       // big block
  m[15 * w + 15] = 0;                                                                // pin hole
  m[35 * w + 35] = 1; m[35 * w + 36] = 1;                                            // speck
  for (let y = 5; y < 10; y++) for (let x = 25; x < 30; x++) m[y * w + x] = 0;       // notch
  const c = T.clean(m, w, h, 6, 6);
  assert.equal(c[15 * w + 15], 1, 'pin hole filled');
  assert.equal(c[35 * w + 35], 0, 'speck gone');
  assert.equal(c[20 * w + 20], 1, 'block kept');
  assert.equal(c[7 * w + 27], 0, 'notch kept (it touches the outside)');
  assert.deepEqual(Array.from(T.clean(m, w, h, 0, 0)), Array.from(m), 'zero limits change nothing');
});

test('loops: a block is one loop with the right perimeter and area', () => {
  const w = 12, h = 10, m = new Uint8Array(w * h);
  for (let y = 2; y < 5; y++) for (let x = 3; x < 8; x++) m[y * w + x] = 1;          // 5 x 3
  const ls = T.loops(m, w, h);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].length, 16);
  assert.equal(Math.abs(T.area(ls[0])), 15);
});

test('loops: a ring gives an outer loop and a hole loop with opposite winding', () => {
  const w = 14, h = 14, m = new Uint8Array(w * h);
  for (let y = 2; y < 11; y++) for (let x = 2; x < 11; x++) m[y * w + x] = 1;
  for (let y = 5; y < 8; y++) for (let x = 5; x < 8; x++) m[y * w + x] = 0;
  const ls = T.loops(m, w, h).sort((a, b) => Math.abs(T.area(b)) - Math.abs(T.area(a)));
  assert.equal(ls.length, 2);
  assert.equal(Math.abs(T.area(ls[0])), 81); assert.equal(Math.abs(T.area(ls[1])), 9);
  assert.ok(T.area(ls[0]) * T.area(ls[1]) < 0, 'opposite winding');
  assert.ok(G.pointInPolys(ls, 3.5, 3.5) && !G.pointInPolys(ls, 6.5, 6.5), 'even-odd fill shows the hole');
});

test('loops: two separate blobs make two loops; diagonal pixels are joined into one', () => {
  const w = 10, h = 10, m = new Uint8Array(w * h);
  m[1 * w + 1] = 1; m[1 * w + 2] = 1; m[7 * w + 7] = 1; m[7 * w + 8] = 1;
  assert.equal(T.loops(m, w, h).length, 2);
  const d = new Uint8Array(w * h); d[3 * w + 3] = 1; d[4 * w + 4] = 1;
  const ls = T.loops(d, w, h);
  assert.equal(ls.length, 1, 'touching corners count as connected');
  assert.equal(ls[0].length, 8);
});

test('smoothing rounds the outline without shrinking it, and uses fewer points once simplified', () => {
  const w = 120, h = 120, a = img(w, h, 255, disc(60, 60, 40));
  const r = T.trace(a, { smoothing: 5, detail: 6, noise: 0 });
  assert.equal(r.loops, 1);
  const A = Math.abs(T.area(r.polys[0])), truth = Math.PI * 40 * 40;
  assert.ok(Math.abs(A - truth) / truth < 0.05, `area ${A.toFixed(0)} vs ${truth.toFixed(0)}`);
  assert.ok(r.points < 160, 'points ' + r.points);
  const jag = T.trace(a, { smoothing: 0, detail: 10, noise: 0 });
  assert.ok(jag.points > r.points, 'no smoothing and max detail keeps far more points');
  // smooth outline hugs the true circle
  r.polys[0].forEach(p => assert.ok(Math.abs(Math.hypot(p[0] - 60, p[1] - 60) - 40) < 2.2));
});

test('detail slider trades points for fidelity', () => {
  const rand = seeded(2);
  const a = img(150, 150, 255, (x, y) => {
    const ang = Math.atan2(y - 75, x - 75), rr = Math.hypot(x - 75, y - 75);
    return rr < 45 + 14 * Math.sin(ang * 6) ? 10 : undefined;
  });
  const lo = T.trace(a, { detail: 1, smoothing: 3, noise: 0 }), hi = T.trace(a, { detail: 10, smoothing: 3, noise: 0 });
  assert.ok(hi.points > lo.points * 1.5, `${hi.points} vs ${lo.points}`);
  assert.ok(iou(hi.polys, hi.mask, 150, 150) > iou(lo.polys, lo.mask, 150, 150) - 1e-9);
  assert.ok(iou(lo.polys, lo.mask, 150, 150) > 0.9);
});

test('noise slider removes specks and pin holes from a messy photo', () => {
  const rand = seeded(9);
  const specks = [];
  for (let i = 0; i < 40; i++) specks.push([5 + rand() * 190, 5 + rand() * 190]);
  const a = img(200, 200, 235, (x, y) => {
    if (Math.hypot(x - 100, y - 100) < 55 && Math.hypot(x - 100, y - 100) > 20) return 30;
    for (const [sx, sy] of specks) if (Math.abs(x - sx) < 1.6 && Math.abs(y - sy) < 1.6) return 30;
    return undefined;
  });
  const messy = T.trace(a, { noise: 0, smoothing: 0 }), tidy = T.trace(a, { noise: 12, smoothing: 0 });
  assert.ok(messy.loops > 10, 'noise 0 keeps the specks: ' + messy.loops);
  assert.equal(tidy.loops, 2, 'noise 12 leaves the ring (outer and inner outline)');
});

test('invert traces the light object on a dark background', () => {
  const a = img(100, 100, 25, (x, y) => (Math.hypot(x - 50, y - 50) < 30 ? 235 : undefined));
  const normal = T.trace(a, { noise: 0 }), inv = T.trace(a, { noise: 0, invert: true });
  const areaOf = r => r.polys.reduce((s, p) => s + Math.abs(T.area(p)), 0);
  assert.ok(areaOf(normal) > 8000, 'normal traces the dark background (frame with a hole)');
  assert.ok(Math.abs(areaOf(inv) - Math.PI * 900) < 250, 'invert traces just the disc: ' + areaOf(inv));
  assert.equal(inv.loops, 1);
});

test('manual threshold changes what counts as dark; auto reports the threshold it used', () => {
  const a = img(80, 40, 250, (x) => (x < 20 ? 60 : x < 40 ? 140 : undefined));
  const auto = T.trace(a, { noise: 0, smoothing: 0 });
  assert.ok(auto.threshold >= 1 && auto.threshold <= 255);
  const strict = T.trace(a, { threshold: 100, noise: 0, smoothing: 0 }), loose = T.trace(a, { threshold: 200, noise: 0, smoothing: 0 });
  const areaOf = r => r.polys.reduce((s, p) => s + Math.abs(T.area(p)), 0);
  assert.ok(Math.abs(areaOf(strict) - 20 * 40) < 40);
  assert.ok(Math.abs(areaOf(loose) - 40 * 40) < 40);
});

test('the point cap is honored even for a very busy picture', () => {
  const rand = seeded(5);
  const a = img(300, 300, 255, () => (rand() < 0.5 ? 0 : undefined));
  const r = T.trace(a, { noise: 0, smoothing: 0, detail: 10, maxPoints: 1500 });
  assert.ok(r.points <= 1500, 'points ' + r.points);
});

test('empty and all-dark pictures do not break anything', () => {
  const blank = T.trace(img(50, 50, 255, () => undefined), {});
  assert.equal(blank.polys.length, 0);
  const black = T.trace(img(50, 50, 0, () => undefined), { threshold: 128, noise: 0 });
  assert.equal(black.loops, 1, 'a solid picture traces to its outline');
});

test('traced polygons normalize into the unit box and survive the shape library path', () => {
  const a = img(160, 100, 255, (x, y) => (x > 30 && x < 130 && y > 20 && y < 80 ? 0 : undefined));
  const r = T.trace(a, { noise: 0, smoothing: 2 });
  const n = S.normalize(r.polys);
  assert.ok(Math.abs(n.aspect - 100 / 60) < 0.1, 'aspect ' + n.aspect);
  n.polys.forEach(p => p.forEach(q => assert.ok(Math.abs(q[0]) <= 0.5 + 1e-9 && Math.abs(q[1]) <= 0.5 + 1e-9)));
  assert.ok(S.pathD(S.resolve({ polys: n.polys, aspect: n.aspect, name: 'Photo trace' })).startsWith('M'));
});

test('fitSize only shrinks', () => {
  assert.deepEqual(T.fitSize(4000, 3000, 400), { width: 400, height: 300 });
  assert.deepEqual(T.fitSize(200, 100, 400), { width: 200, height: 100 });
});

test('settings clamp wild input', () => {
  const s = T.settings({ noise: 999, smoothing: -4, detail: 0, maxPoints: 5, threshold: 900, invert: 1 });
  assert.equal(s.noise, 40); assert.equal(s.smoothing, 0); assert.equal(s.detail, 1);
  assert.equal(s.maxPoints, 100); assert.equal(s.threshold, 255); assert.equal(s.invert, true);
  assert.equal(T.settings({}).threshold, null);
});
