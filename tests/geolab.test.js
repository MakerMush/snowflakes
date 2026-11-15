'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry');
const ST = require('../js/state');
const AN = require('../js/analyze');
const PDF = require('../js/pdf');
const PR = require('../js/print');
const WS = require('../js/worksheet');

const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const norm = (d) => ((d % 360) + 360) % 360;

function docWith(arms, objs, mode) {
  const d = ST.defaultDoc();
  d.arms = arms;
  if (mode) d.mode = mode;
  objs.forEach((o) => d.objects.push(Object.assign({ id: 'o' + d.nextId++, type: 'shape', x: 0, y: -50, sx: 20, sy: 20, rot: 0, flip: false, role: 'cut' }, o)));
  return d;
}

test('flapMatrix: folded equals the previous sector, open equals the real copy, edge-on is flat', () => {
  [4, 6].forEach((n) => {
    const c = G.copies(n);
    for (let k = 1; k < 2 * n; k++) {
      const open = G.flapMatrix(n, k, -1), fold = G.flapMatrix(n, k, 1), mid = G.flapMatrix(n, k, 0);
      for (let i = 0; i < 6; i++) {
        assert.ok(near(open[i], c[k].m[i]), `n=${n} k=${k} open[${i}]`);
        assert.ok(near(fold[i], c[k - 1].m[i]), `n=${n} k=${k} fold[${i}]`);
      }
      assert.ok(near(mid[0] * mid[3] - mid[1] * mid[2], 0, 1e-9), 'edge-on has no area');
    }
  });
});

test('mirrorLines: n lines, sorted, bearings step by 180/n and cover [0, 180)', () => {
  [4, 6].forEach((n) => {
    const L = G.mirrorLines(n);
    assert.equal(L.length, n);
    L.forEach((l, i) => {
      assert.equal(l.label, i + 1);
      assert.ok(l.bearingDeg >= 0 && l.bearingDeg < 180);
      if (i) assert.ok(near(l.bearingDeg - L[i - 1].bearingDeg, 180 / n, 1e-6));
    });
  });
  assert.deepEqual(G.mirrorLines(6).map((l) => l.bearingDeg), [15, 45, 75, 105, 135, 165]);
  assert.deepEqual(G.mirrorLines(4).map((l) => l.bearingDeg), [22.5, 67.5, 112.5, 157.5]);
});

test('every mirror line really is a symmetry of the unfolded paper', () => {
  [4, 6].forEach((n) => {
    const pts = [[10, -40], [-25, -70], [3, -90]];
    G.mirrorLines(n).forEach((l) => {
      const M = G.reflection(l.angle);
      pts.forEach((p) => G.orbit(n, p).forEach((q) => {
        const r = G.apply(M, q);
        assert.ok(G.orbit(n, p).some((o) => Math.hypot(o[0] - r[0], o[1] - r[1]) < 1e-6), `n=${n} line ${l.label}`);
      }));
    });
  });
});

test('imageAngles matches where the unfold matrices really put the point', () => {
  [4, 6].forEach((n) => {
    const theta = n === 6 ? 10 : 15, a0 = G.leftEdgeAngle(n), r = 60;
    const p = [r * Math.cos(a0 + theta * G.DEG), r * Math.sin(a0 + theta * G.DEG)];
    const im = G.imageAngles(n, theta);
    assert.equal(im.length, 2 * n);
    G.copies(n).forEach((c, k) => {
      const q = G.apply(c.m, p), got = norm((Math.atan2(q[1], q[0]) - a0) / G.DEG);
      assert.ok(near(got, norm(im[k].deg), 1e-6), `n=${n} sector ${k}: ${got} vs ${im[k].deg}`);
      assert.equal(im[k].mirrored, k % 2 === 1);
    });
  });
  assert.deepEqual(G.imageAngles(6, 10).map((x) => x.deg), [10, 50, 70, 110, 130, 170, 190, 230, 250, 290, 310, 350]);
});

test('isRotationSymmetry: multiples of 360/n only', () => {
  assert.ok(G.isRotationSymmetry(6, 0) && G.isRotationSymmetry(6, 60) && G.isRotationSymmetry(6, 360));
  assert.ok(!G.isRotationSymmetry(6, 45) && !G.isRotationSymmetry(6, 30));
  assert.ok(G.isRotationSymmetry(4, 90) && G.isRotationSymmetry(4, 270) && !G.isRotationSymmetry(4, 60));
});

test('worksheet facts: 6 arms and 4 arms', () => {
  const f6 = WS.facts(AN.analyze(docWith(6, []), { tool: 0 }));
  assert.equal(f6.layers, 12); assert.equal(f6.wedge, 30); assert.equal(f6.mirrors, 6); assert.equal(f6.rotStep, 60); assert.equal(f6.total, 12);
  const f4 = WS.facts(AN.analyze(docWith(4, []), { tool: 0 }));
  assert.equal(f4.layers, 8); assert.equal(f4.wedge, 45); assert.equal(f4.mirrors, 4); assert.equal(f4.rotStep, 90); assert.equal(f4.theta, 15);
  assert.deepEqual(f4.predict.map((p) => [p.arms, p.wedge, p.layers]), [[8, 22.5, 16], [12, 15, 24]]);
});

test('worksheet counts the cutouts that touch nothing, and multiplies by the layers', () => {
  const none = AN.analyze(docWith(6, [], 'cut'), { tool: 0 });
  assert.equal(WS.facts(none).imagined, true);
  assert.equal(WS.facts(none).holesAfter, 12);
  const one = AN.analyze(docWith(6, [{ shapeId: 'circle', x: 0, y: -55, sx: 14, sy: 14 }], 'cut'), { tool: 0 });
  const f = WS.facts(one);
  assert.equal(f.holes, 1); assert.equal(f.imagined, false); assert.equal(f.holesAfter, 12);
  const two = AN.analyze(docWith(4, [{ shapeId: 'circle', x: 0, y: -40, sx: 12, sy: 12 }, { shapeId: 'circle', x: 0, y: -75, sx: 10, sy: 10 }], 'cut'), { tool: 0 });
  assert.equal(WS.facts(two).holes, 2); assert.equal(WS.facts(two).holesAfter, 16);
  const text = WS.layout(one, {}).pages[1].items.filter((i) => i.t === 'text').map((i) => i.s).join(' ');
  assert.ok(/1 cutout touches no fold line/.test(text), 'singular wording');
});

test('worksheet pages: counts, ASCII-safe, inside the margins, valid PDF', () => {
  [4, 6].forEach((n) => {
    const an = AN.analyze(docWith(n, [{ shapeId: 'circle', x: 0, y: -55, sx: 14, sy: 14 }], 'cut'), { tool: 0 });
    [false, true].forEach((key) => {
      const res = WS.layout(an, { key });
      assert.equal(res.pages.length, key ? 3 : 2);
      res.pages.forEach((pg, pi) => {
        assert.equal(pg.w, 612); assert.equal(pg.h, 792);
        pg.items.filter((i) => i.t === 'text').forEach((t) => {
          assert.equal(PDF.clean(t.s), t.s, `unsupported character on page ${pi + 1}: ${t.s}`);
          assert.ok(!/[\u2013\u2014]/.test(t.s), 'no dashes');
          const w = PDF.textWidth(t.s, t.font, t.size);
          const x0 = t.anchor === 'end' ? t.x - w : t.anchor === 'middle' ? t.x - w / 2 : t.x;
          assert.ok(x0 >= 30 && x0 + w <= 582, `text leaves the margins on page ${pi + 1}: "${t.s}" ${x0}..${x0 + w}`);
          assert.ok(t.y > 20 && t.y < 780, 'text inside the page vertically');
        });
      });
      const bytes = WS.toPDF(res.pages, key);
      const head = Buffer.from(bytes.slice(0, 5)).toString(), tail = Buffer.from(bytes.slice(-6)).toString();
      assert.equal(head, '%PDF-'); assert.ok(tail.includes('%%EOF'));
    });
  });
});

test('the key carries the answers; the student sheet does not', () => {
  [4, 6].forEach((n) => {
    const an = AN.analyze(docWith(n, [], 'cut'), { tool: 0 });
    const ws = WS.layout(an, { key: false }), key = WS.layout(an, { key: true }), f = ws.facts;
    const wsText = ws.pages.map((p) => p.items.filter((i) => i.t === 'text').map((i) => i.s)).flat();
    const keyItems = key.pages.map((p) => p.items.filter((i) => i.t === 'text' && i.fill === '#1a6fb0').map((i) => i.s)).flat();
    assert.ok(!ws.pages.some((p) => p.items.some((i) => i.fill === '#1a6fb0' || i.stroke === '#1a6fb0')), 'no blue key ink on the student sheet');
    assert.ok(!wsText.includes('ANSWER KEY'));
    ['' + f.layers, f.wedge + '°', '' + f.mirrors, f.rotStep + '°', '' + f.total, '' + f.holesAfter, '' + f.notches].forEach((a) => assert.ok(keyItems.includes(a), `n=${n} key has ${a}`));
    f.images.forEach((im) => assert.ok(keyItems.includes(im.deg + '°'), `key has sector ${im.sector} angle ${im.deg}`));
    assert.ok(key.pages[2].items.some((i) => i.t === 'text' && i.s === 'Teacher notes'));
    // the one answer printed on the student sheet is the worked example for sector 0
    assert.ok(wsText.includes(f.theta + '°'));
  });
});

test('the key notes give the same numbers the code computes', () => {
  const an = AN.analyze(docWith(6, [], 'cut'), { tool: 0 });
  const t = WS.layout(an, { key: true }).pages[2].items.filter((i) => i.t === 'text').map((i) => i.s).join(' ');
  assert.ok(t.includes('12 equal wedges of 30°'));
  assert.ok(t.includes('6 × 30° = 180°'));
  assert.ok(t.includes('D6 (order 12)'));
  assert.ok(t.includes('1 × 12 = 12 holes'));
});

test('file names', () => {
  assert.equal(WS.fileName({ arms: 6 }, false), 'flake-lab-6arm-symmetry-worksheet.pdf');
  assert.equal(WS.fileName({ arms: 4 }, true), 'flake-lab-4arm-symmetry-answer-key.pdf');
});
