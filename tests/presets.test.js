'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../js/state');
const AN = require('../js/analyze');
const P = require('../js/presets');
const S = require('../js/shapes');

test('there are five presets with unique ids, names and blurbs', () => {
  assert.equal(P.list.length, 5);
  assert.equal(new Set(P.list.map(p => p.id)).size, 5);
  P.list.forEach(p => { assert.ok(p.name && p.blurb); assert.equal(P.get(p.id), p); });
  assert.equal(P.get('nope'), null);
  assert.equal(P.toDoc('nope'), null);
});

for (const p of P.list) {
  test(`${p.id}: loads through the sanitizer without losing anything`, () => {
    const d = P.toDoc(p);
    assert.equal(d.arms, 6);
    assert.equal(d.mode, 'build', 'presets start in Build mode');
    assert.ok(d.objects.some(o => o.role === 'keep'), 'built from keep shapes');
    assert.equal(d.objects.length, p.objects.length);
    assert.ok(d.objects.length <= ST.MAX_OBJECTS);
    d.objects.forEach((o, i) => {
      assert.ok(S.get(o.shapeId), 'uses a shape from the library: ' + o.shapeId);
      assert.equal(o.label, p.objects[i].label);
      assert.equal(o.role, p.objects[i].role);
      assert.ok(o.sx >= 1 && o.sy >= 1);
    });
    assert.equal(new Set(d.objects.map(o => o.id)).size, d.objects.length);
  });

  test(`${p.id}: is cuttable with kid scissors (no islands, no thin features) and not too hard`, () => {
    const a = AN.analyze(P.toDoc(p), { tool: 0 });
    assert.equal(a.stats.islands, 0, 'no islands');
    assert.equal(a.stats.fallsApart, false, 'stays in one piece');
    assert.equal(a.stats.thinPaper + a.stats.thinCut, 0, 'nothing too thin');
    assert.equal(a.stats.tierNeeded, 0);
    assert.ok(a.report.score <= 5, 'score ' + a.report.score);
    assert.ok(a.stats.cutFraction > 0.05 && a.stats.cutFraction < 0.9, 'a real snowflake: ' + a.stats.cutFraction);
  });

  test(`${p.id}: arms stay joined to a solid center`, () => {
    const a = AN.analyze(P.toDoc(p));
    // the arms reach the rim (the medallion's outer ring sits at 72% of the radius)
    const N = a.N, edge = p.id === 'medallion' ? 66 : 85; let rim = 0;
    for (let i = 0; i < N * N; i++) if (a.grid.inDisc[i] && a.grid.r2[i] > edge * edge && a.paper[i]) rim++;
    assert.ok(rim > 30, 'paper reaches r > ' + edge);
  });
}

test('presets look different from each other', () => {
  const sig = P.list.map(p => { const a = AN.analyze(P.toDoc(p)); return Math.round(a.stats.cutLenUnits) + '/' + a.stats.interiorHoles + '/' + a.stats.edgeCuts; });
  assert.equal(new Set(sig).size, 5, sig.join(' '));
});

test('Photo medallion: marked as needing a picture, and any picture dropped in at the default spot stays connected', () => {
  assert.equal(P.get('medallion').needsImage, true);
  assert.ok(P.list.filter(p => p.needsImage).length === 1);
  const disc = (n, r) => [Array.from({ length: n }, (_, i) => [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)])];
  const star = [Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 0.22 : 0.5, a = Math.PI * i / 5 - Math.PI / 2; return [r * Math.cos(a), r * Math.sin(a)]; })];
  const heart = [Array.from({ length: 60 }, (_, i) => { const t = 2 * Math.PI * i / 60; return [16 * Math.sin(t) ** 3 / 36, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 36]; })];
  const pics = {
    circle: [disc(48, 0.5), 1], square: [[[[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]], 1], star: [star, 1], heart: [heart, 1],
    tall: [[[[-.2, -.5], [.2, -.5], [.2, .5], [-.2, .5]]], 0.4], wide: [[[[-.5, -.2], [.5, -.2], [.5, .2], [-.5, .2]]], 2.5]
  };
  for (const [name, [polys, aspect]] of Object.entries(pics)) {
    const st = ST.createStore(P.toDoc('medallion'));
    const o = st.addTrace(polys, aspect, name);
    assert.equal(o.role, 'keep', name + ' becomes paper in Build mode');
    const a = AN.analyze(st.doc, { tool: 0 });
    assert.equal(a.stats.islands, 0, name + ' is attached to the frame');
    assert.equal(a.stats.fallsApart, false);
  }
});

test('Photo medallion: the frame has no problems on its own and the center stays solid', () => {
  const a = AN.analyze(P.toDoc('medallion'), { tool: 0 });
  assert.equal(a.stats.thinPaper + a.stats.thinCut, 0);
  assert.ok(a.stats.cutFraction > 0.5, 'plenty of open window area for a picture: ' + a.stats.cutFraction);
});
