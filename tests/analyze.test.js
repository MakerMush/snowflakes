'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry');
const ST = require('../js/state');
const AN = require('../js/analyze');

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function mk(arms, objs, extra) {
  const d = ST.defaultDoc();
  d.arms = arms;
  Object.assign(d, extra || {});
  objs.forEach((o, i) => d.objects.push(Object.assign({ id: 'o' + (i + 1), type: 'shape', rot: 0, flip: false, role: 'cut' }, o)));
  d.nextId = objs.length + 1;
  return d;
}

test('empty design: nothing to flag, easiest score, kid scissors', () => {
  const a = AN.analyze(ST.defaultDoc());
  assert.equal(a.stats.islands, 0);
  assert.equal(a.stats.thinPaper + a.stats.thinCut, 0);
  assert.equal(a.stats.cutLenUnits, 0);
  assert.equal(a.report.score, 1);
  assert.equal(a.report.tool.id, 'kid');
});

test('starter design is clean and mid-low difficulty', () => {
  const a = AN.analyze(ST.starterDoc());
  assert.equal(a.stats.islands, 0);
  assert.equal(a.stats.thinPaper + a.stats.thinCut, 0);
  assert.ok(a.report.score >= 3 && a.report.score <= 5, 'score ' + a.report.score);
  assert.equal(a.stats.interiorHoles, 4);
});

test('cut line length is measured on the wedge (circle of radius 10 is about 63)', () => {
  const a = AN.analyze(mk(6, [{ shapeId: 'circle', x: 0, y: -50, sx: 20, sy: 20 }], { hub: false }));
  assert.ok(Math.abs(a.stats.cutLenUnits - 2 * Math.PI * 10) < 4, 'got ' + a.stats.cutLenUnits);
  assert.equal(a.stats.interiorHoles, 1);
  assert.equal(a.stats.edgeCuts, 0);
});

test('a cut touching the fold counts as a notch, not an interior cutout', () => {
  const a = AN.analyze(mk(6, [{ shapeId: 'triangle', x: -9, y: -50, sx: 10, sy: 10 }], { hub: false }));
  assert.equal(a.stats.edgeCuts, 1);
  assert.equal(a.stats.interiorHoles, 0);
});

test('a kept disc inside a cut disc is an island (and shows up as 12 loose pieces)', () => {
  const doc = mk(6, [
    { shapeId: 'circle', x: 0, y: -55, sx: 24, sy: 24 },
    { shapeId: 'circle', x: 0, y: -55, sx: 9, sy: 9, role: 'keep' }
  ]);
  const a = AN.analyze(doc);
  assert.equal(a.stats.islands, 1);
  assert.equal(a.stats.islandPieces, 12);
  assert.equal(a.stats.fallsApart, false);
  assert.ok(a.islandMask.some(v => v));
});

test('cutting all the way around the hub strands it', () => {
  const a = AN.analyze(mk(6, [{ shapeId: 'circle', x: 0, y: -8, sx: 60, sy: 60 }]));
  assert.equal(a.stats.islands, 1);
  assert.equal(a.stats.islandPieces, 1);
});

test('thin paper bridge is flagged for exactly the tools that cannot handle it', () => {
  const gap = (g) => mk(6, [
    { shapeId: 'square', x: -6, y: -50, sx: 8, sy: 10 },
    { shapeId: 'square', x: 2 + g, y: -50, sx: 8, sy: 10 }
  ], { hub: false });
  const flags = (g, tool) => { const s = AN.analyze(gap(g), { tool }).stats; return s.thinPaper; };
  assert.equal(AN.analyze(gap(1.5)).stats.tierNeeded, 2, '1.5 units needs a knife');
  assert.equal(AN.analyze(gap(2.5)).stats.tierNeeded, 1, '2.5 units needs sharp scissors');
  assert.equal(AN.analyze(gap(4)).stats.tierNeeded, 0, '4 units is fine for kid scissors');
  assert.ok(flags(1.5, 0) > 0 && flags(1.5, 1) > 0 && flags(1.5, 2) === 0);
  assert.ok(flags(2.5, 0) > 0 && flags(2.5, 1) === 0);
  assert.equal(flags(4, 0), 0);
  assert.equal(AN.analyze(gap(0.9)).stats.tierNeeded, 3, 'finer than a knife can do');
  assert.equal(AN.analyze(gap(0.9)).report.tooFine, true);
});

test('a long narrow slit is flagged as a thin cut', () => {
  const a = AN.analyze(mk(6, [{ shapeId: 'square', x: 0, y: -50, sx: 1.4, sy: 22 }], { hub: false }), { tool: 0 });
  assert.ok(a.stats.thinCut >= 1);
  assert.equal(AN.analyze(mk(6, [{ shapeId: 'square', x: 0, y: -50, sx: 1.4, sy: 22 }], { hub: false }), { tool: 2 }).stats.thinCut, 0, 'a knife can do 1.4');
});

test('sharp cut tips alone are not flagged (scissors cut points easily)', () => {
  const a = AN.analyze(mk(6, [{ shapeId: 'diamond', x: 0, y: -50, sx: 9, sy: 18 }], { hub: false }));
  assert.equal(a.stats.thinCut, 0);
});

test('score rises with more cutting, more holes and more layers', () => {
  const one = mk(6, [{ shapeId: 'circle', x: 0, y: -50, sx: 10, sy: 10 }]);
  const many = ST.randomDoc(6, seeded(3));
  const aOne = AN.analyze(one).report, aMany = AN.analyze(many).report;
  assert.ok(aMany.raw > aOne.raw);
  const six = AN.analyze(Object.assign({}, many, { arms: 6 })).report.raw;
  const four = AN.analyze(Object.assign({}, many, { arms: 4 })).report.raw;
  assert.ok(six > four - 1e-9, '12 layers is never easier than 8 for the same design');
});

test('score is always 1 to 10 and the tool never gets easier than the finest detail requires', () => {
  const rand = seeded(8);
  for (let i = 0; i < 12; i++) {
    const a = AN.analyze(ST.randomDoc(i % 2 ? 4 : 6, rand));
    assert.ok(a.report.score >= 1 && a.report.score <= 10);
    assert.ok(a.report.toolIndex >= Math.min(a.stats.tierNeeded, 2));
    assert.ok(a.report.label && a.report.tool.name);
  }
});

test('interior cutouts push the tool to something with a sharp point', () => {
  const a = AN.analyze(mk(6, [{ shapeId: 'circle', x: 0, y: -50, sx: 10, sy: 10 }]));
  assert.ok(a.report.toolIndex >= 1);
});

test('analysis sees the same symmetric paper the preview draws (4 arms rotate exactly 90 degrees)', () => {
  const rand = seeded(21);
  for (let t = 0; t < 4; t++) {
    const a = AN.analyze(ST.randomDoc(4, rand));
    const N = a.N;
    let diff = 0, count = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const idx = j * N + i, rot = (i) * N + (N - 1 - j);     // pixel rotated a quarter turn
      if (!a.grid.inDisc[idx] || !a.grid.inDisc[rot]) continue;
      count++;
      if (a.paper[idx] !== a.paper[rot]) diff++;
    }
    assert.ok(diff / count < 0.002, `quarter-turn symmetry off by ${(100 * diff / count).toFixed(3)}%`);
  }
});

test('bridges: every kind of island gets reconnected', () => {
  const cases = [
    mk(6, [{ shapeId: 'circle', x: 0, y: -55, sx: 24, sy: 24 }, { shapeId: 'circle', x: 0, y: -55, sx: 9, sy: 9, role: 'keep' }]),
    mk(4, [{ shapeId: 'circle', x: 0, y: -55, sx: 30, sy: 30 }, { shapeId: 'star', x: 0, y: -55, sx: 14, sy: 14, role: 'keep' }]),
    mk(6, [{ shapeId: 'circle', x: 0, y: -8, sx: 60, sy: 60 }]),
    mk(6, [{ shapeId: 'square', x: 0, y: -50, sx: 60, sy: 8 }]),                      // a cut band all the way across: strands the middle
    mk(4, [{ shapeId: 'hexagon', x: 0, y: -60, sx: 40, sy: 40 }, { shapeId: 'circle', x: 0, y: -60, sx: 14, sy: 14, role: 'keep' },
      { shapeId: 'circle', x: 0, y: -60, sx: 5, sy: 5 }])
  ];
  cases.forEach((doc, n) => {
    const before = AN.analyze(doc);
    assert.ok(before.stats.islands >= 1, `case ${n} starts with an island`);
    const res = AN.autoBridge(doc, 0);
    assert.ok(res.bars.length >= 1, `case ${n} adds a bridge`);
    assert.equal(res.remaining, 0, `case ${n} ends with no islands`);
    res.bars.forEach(b => { assert.equal(b.role, 'keep'); assert.equal(b.bridge, true); assert.ok(b.sy >= AN.TOOLS[0].bridge - 1e-9); });
    // apply to the real store logic and re-check from scratch
    const st = ST.createStore(doc);
    st.addObjects(res.bars);
    assert.equal(AN.analyze(st.doc).stats.islands, 0, `case ${n} verified through the store`);
    st.undo();
    assert.equal(st.doc.objects.length, doc.objects.length, 'one undo removes all the bridges');
  });
});

test('bridges: random messy designs never throw and never end worse than they began', () => {
  const rand = seeded(55);
  let fixed = 0, tried = 0;
  for (let i = 0; i < 40; i++) {
    const doc = ST.randomDoc(i % 2 ? 4 : 6, rand);
    doc.objects.forEach((o, k) => { if (k % 3 === 2) o.role = 'keep'; if (k === 0) { o.sx *= 1.8; o.sy *= 1.8; } });
    const before = AN.analyze(doc).stats.islands;
    if (!before) continue;
    tried++;
    const res = AN.autoBridge(doc, 1);
    assert.ok(res.remaining <= before);
    if (res.remaining === 0) fixed++;
  }
  assert.ok(tried >= 3, 'the trial produced islands to fix (' + tried + ')');
  assert.ok(fixed >= Math.ceil(tried * 0.8), `fixed ${fixed} of ${tried}`);
});

test('a design with no islands gets no bridges', () => {
  assert.deepEqual(AN.autoBridge(ST.starterDoc(), 0).bars, []);
});

test('overlay marks islands and thin features, and is null when everything is fine', () => {
  assert.equal(AN.overlayRGBA(AN.analyze(ST.starterDoc())), null);
  const bad = AN.analyze(mk(6, [{ shapeId: 'circle', x: 0, y: -55, sx: 24, sy: 24 }, { shapeId: 'circle', x: 0, y: -55, sx: 9, sy: 9, role: 'keep' }]));
  const px = AN.overlayRGBA(bad);
  assert.ok(px && px.length === bad.N * bad.N * 4);
  let coral = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 150 && px[i] === 255 && px[i + 1] === 93) coral++;
  assert.ok(coral > 1000, 'plenty of coral pixels: ' + coral);
});

test('analysis is fast enough to run live', () => {
  AN.analyze(ST.starterDoc());                                   // warm the grid cache
  const rand = seeded(1);
  let worst = 0;
  for (let i = 0; i < 6; i++) worst = Math.max(worst, AN.analyze(ST.randomDoc(i % 2 ? 4 : 6, rand), { tool: 2 }).ms);
  assert.ok(worst < 700, 'worst run ' + worst.toFixed(0) + ' ms');
});

test('distance transform and components behave on a known picture', () => {
  const N = 12, m = new Uint8Array(N * N);
  for (let j = 2; j < 6; j++) for (let i = 2; i < 6; i++) m[j * N + i] = 1;
  for (let j = 8; j < 11; j++) for (let i = 8; i < 11; i++) m[j * N + i] = 1;
  const c = AN.labelComponents(m, N);
  assert.equal(c.count, 2);
  assert.deepEqual(c.areas.slice(1).sort(), [16, 9].sort());
  const d = AN.edtFrom(m, N);
  assert.equal(d[2 * N + 2], 0);
  assert.equal(d[2 * N + 8], 9);                               // squared distance: the nearest block pixel is 3 columns away (column 5)
});

function mkBuild(arms, objs, extra) {
  return Object.assign(mk(arms, objs.map(o => Object.assign({ role: 'keep' }, o)), extra), { mode: 'build' });
}

test('build mode: an empty wedge does not crash and is trivially easy', () => {
  for (const hub of [true, false]) {
    const a = AN.analyze(mkBuild(6, [], { hub }));
    assert.equal(a.stats.islands, 0);
    assert.ok(a.report.score >= 1 && a.report.score <= 10);
  }
});

test('build mode: a shape joined to the center is fine, a floating one is an island with 12 pieces', () => {
  const joined = AN.analyze(mkBuild(6, [{ shapeId: 'capsule', x: 0, y: -20, sx: 6, sy: 30 }]));
  assert.equal(joined.stats.islands, 0, 'capsule touches the protected center');
  assert.equal(joined.stats.fallsApart, false);
  const floating = AN.analyze(mkBuild(6, [{ shapeId: 'circle', x: 0, y: -60, sx: 14, sy: 14 }], { hub: false }));
  assert.equal(floating.stats.islands, 1);
  assert.equal(floating.stats.islandPieces, 12);
  const withHub = AN.analyze(mkBuild(6, [{ shapeId: 'circle', x: 0, y: -60, sx: 14, sy: 14 }]));
  assert.equal(withHub.stats.islands, 2, 'the floating circle and the center are separate pieces');
});

test('build mode: bridges link floating pieces back to the center', () => {
  const doc = mkBuild(6, [
    { shapeId: 'circle', x: 0, y: -45, sx: 14, sy: 14 },
    { shapeId: 'diamond', x: 0, y: -75, sx: 9, sy: 18 }
  ]);
  const res = AN.autoBridge(doc, 0);
  assert.ok(res.bars.length >= 1);
  assert.equal(res.remaining, 0);
  const st = ST.createStore(doc);
  st.addObjects(res.bars);
  assert.equal(AN.analyze(st.doc).stats.islands, 0);
  assert.equal(st.doc.mode, 'build');
});

test('build mode: thin arms are flagged as thin paper for the weakest tool', () => {
  const a = AN.analyze(mkBuild(6, [{ shapeId: 'square', x: 0, y: -45, sx: 2.2, sy: 40 }]), { tool: 0 });
  assert.ok(a.stats.thinPaper >= 1);
  assert.equal(AN.analyze(mkBuild(6, [{ shapeId: 'square', x: 0, y: -45, sx: 6, sy: 40 }]), { tool: 0 }).stats.thinPaper, 0);
});

test('build mode: the same shapes as a cut design give the complementary flake', () => {
  const objs = [{ shapeId: 'circle', x: 0, y: -50, sx: 16, sy: 16 }];
  const cutDoc = mk(6, objs.map(o => Object.assign({ role: 'cut' }, o)), { hub: false });
  const buildDoc = mkBuild(6, objs, { hub: false });
  const c = AN.analyze(cutDoc), b = AN.analyze(buildDoc);
  let both = 0, total = 0;
  for (let i = 0; i < c.N * c.N; i++) if (c.grid.inDisc[i]) { total++; if (c.paper[i] === b.paper[i]) both++; }
  assert.ok(both / total < 0.002, 'every pixel is paper in exactly one of the two');
});
