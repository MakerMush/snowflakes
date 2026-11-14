'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../js/state');
const AN = require('../js/analyze');
const P = require('../js/presets');
const S = require('../js/shapes');

test('there are four presets with unique ids, names and blurbs', () => {
  assert.equal(P.list.length, 4);
  assert.equal(new Set(P.list.map(p => p.id)).size, 4);
  P.list.forEach(p => { assert.ok(p.name && p.blurb); assert.equal(P.get(p.id), p); });
  assert.equal(P.get('nope'), null);
  assert.equal(P.toDoc('nope'), null);
});

for (const p of P.list) {
  test(`${p.id}: loads through the sanitizer without losing anything`, () => {
    const d = P.toDoc(p);
    assert.equal(d.arms, 6);
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
    // the preset has the six arms reaching the rim: paper exists in the outer 15% of the disc
    const N = a.N; let rim = 0;
    for (let i = 0; i < N * N; i++) if (a.grid.inDisc[i] && a.grid.r2[i] > 85 * 85 && a.paper[i]) rim++;
    assert.ok(rim > 30, 'paper reaches the rim');
  });
}

test('presets look different from each other', () => {
  const sig = P.list.map(p => { const a = AN.analyze(P.toDoc(p)); return Math.round(a.stats.cutLenUnits) + '/' + a.stats.interiorHoles + '/' + a.stats.edgeCuts; });
  assert.equal(new Set(sig).size, 4, sig.join(' '));
});
