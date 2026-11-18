'use strict';
// Kid mode (?kids): minimum shape size in the store and chunkier kid-scissors thresholds in the analysis.
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../js/state');
const AN = require('../js/analyze');

const MIN = ST.KID_MIN_SIZE;

function mk(arms, objs, extra) {
  const d = ST.defaultDoc();
  d.arms = arms;
  Object.assign(d, extra || {});
  objs.forEach((o, i) => d.objects.push(Object.assign({ id: 'o' + (i + 1), type: 'shape', rot: 0, flip: false, role: 'cut' }, o)));
  d.nextId = objs.length + 1;
  return d;
}
const tiny = () => mk(4, [{ shapeId: 'circle', x: 0, y: -50, sx: 3, sy: 4 }]);

test('kid minimum size is big enough for kid scissors', () => {
  assert.ok(MIN >= AN.KID_TOOLS[0].width * 2, 'a shape at the minimum is at least twice the kid cut width');
});

test('regular mode is unchanged: tiny shapes stay tiny', () => {
  const st = ST.createStore(tiny());
  assert.equal(st.minSize, 1);
  assert.equal(st.doc.objects[0].sx, 3);
  st.begin(); st.patch('o1', { sx: 1.5, sy: 0.2 });
  assert.equal(st.doc.objects[0].sx, 1.5);
  assert.equal(st.doc.objects[0].sy, 1);
  assert.equal(ST.sanitize(tiny()).objects[0].sx, 3);
});

test('kid mode: loading a saved design grows tiny shapes to the minimum', () => {
  const st = ST.createStore(tiny(), { kids: true });
  assert.equal(st.minSize, MIN);
  assert.equal(st.doc.objects[0].sx, MIN);
  assert.equal(st.doc.objects[0].sy, MIN);
  assert.equal(ST.sanitize(tiny(), { kids: true }).objects[0].sx, MIN);
});

test('kid mode: handle resizes (patch) cannot go below the minimum', () => {
  const st = ST.createStore(mk(4, [{ shapeId: 'circle', x: 0, y: -50, sx: 20, sy: 20 }]), { kids: true });
  st.begin(); st.patch('o1', { sx: 2, sy: 30 });
  assert.equal(st.doc.objects[0].sx, MIN);
  assert.equal(st.doc.objects[0].sy, 30);
});

test('kid mode: corner scaling (transform) stops at the minimum and keeps the aspect ratio', () => {
  const st = ST.createStore(mk(4, [{ shapeId: 'circle', x: 0, y: -50, sx: 20, sy: 40 }]), { kids: true });
  st.begin();
  st.transform(st.snapshotOf('o1'), { s: 0.05, cx: 0, cy: -50 });
  const o = st.doc.objects[0];
  assert.ok(Math.abs(o.sx - MIN) < 1e-9, 'narrow side stops at the minimum, got ' + o.sx);
  assert.ok(Math.abs(o.sy / o.sx - 2) < 1e-9, 'aspect ratio kept');
});

test('kid mode: new shapes, surprise flakes and replaced designs respect the minimum', () => {
  const st = ST.createStore(ST.defaultDoc(), { kids: true });
  ['circle', 'star', 'teardrop', 'diamond'].forEach(id => {
    const o = st.addShape(id);
    assert.ok(o.sx >= MIN && o.sy >= MIN, id + ' added at ' + o.sx + ' x ' + o.sy);
  });
  let r = 1;
  st.replaceAll(ST.randomDoc(4, () => (r = (r * 9301 + 49297) % 233280) / 233280, 'cut'));
  st.doc.objects.forEach(o => assert.ok(o.sx >= MIN && o.sy >= MIN));
});

test('kid mode: bridges are exempt from the minimum (they are thin bars on purpose)', () => {
  const st = ST.createStore(ST.defaultDoc(), { kids: true });
  const [b] = st.addObjects([{ type: 'shape', shapeId: 'square', bridge: true, role: 'keep', x: 0, y: -50, sx: 8, sy: 6, rot: 0, flip: false }]);
  assert.equal(b.sy, 6);
  assert.equal(b.sx, 8);
});

test('kid thresholds: only kid scissors change, and only in kid mode', () => {
  assert.equal(AN.TOOLS[0].width, 3.0);
  assert.equal(AN.TOOLS[0].bridge, 3.4);
  assert.equal(AN.KID_TOOLS[0].width, 6.0);
  assert.equal(AN.KID_TOOLS[0].bridge, 6.0);
  assert.equal(AN.KID_TOOLS[0].id, 'kid');
  assert.equal(AN.KID_TOOLS[1], AN.TOOLS[1]);
  assert.equal(AN.KID_TOOLS[2], AN.TOOLS[2]);
  assert.equal(AN.toolsFor(false), AN.TOOLS);
  assert.equal(AN.toolsFor(true), AN.KID_TOOLS);
});

test('kid thresholds: a 4.5 mm slit is fine for kid scissors normally, too narrow in kid mode', () => {
  const doc = mk(4, [{ shapeId: 'square', x: 0, y: -50, sx: 4.5, sy: 30 }], { hub: false });
  const reg = AN.analyze(doc, { tool: 0 });
  const kid = AN.analyze(doc, { tool: 0, kids: true });
  assert.equal(reg.stats.thinCut, 0);
  assert.ok(kid.stats.thinCut >= 1);
  assert.equal(kid.kids, true);
  assert.equal(reg.kids, false);
});

test('kid thresholds: autoBridge makes kid-wide bridges in kid mode only', () => {
  const doc = mk(4, [{ shapeId: 'circle', x: 0, y: -55, sx: 30, sy: 30 }, { shapeId: 'circle', x: 0, y: -55, sx: 14, sy: 14, role: 'keep' }]);
  const reg = AN.autoBridge(doc, 0);
  const kid = AN.autoBridge(doc, 0, { kids: true });
  assert.ok(reg.bars.length && kid.bars.length);
  reg.bars.forEach(b => assert.equal(b.sy, AN.TOOLS[0].bridge));
  kid.bars.forEach(b => assert.equal(b.sy, AN.KID_TOOLS[0].bridge));
  assert.equal(kid.remaining, 0);
});

test('kid mode: a hole that touches no edge is reported, so print can ask for a grown-up', () => {
  const inner = AN.analyze(mk(4, [{ shapeId: 'circle', x: 0, y: -50, sx: 16, sy: 16 }], { hub: false }), { kids: true });
  assert.equal(inner.stats.interiorHoles, 1);
  const notch = AN.analyze(mk(4, [{ shapeId: 'circle', x: 0, y: -96, sx: 20, sy: 20 }], { hub: false }), { kids: true });   // bites the outer edge
  assert.equal(notch.stats.interiorHoles, 0);
});

test('kid starter design is clean for kid scissors: 4 arms, no fine details, no holes in the middle', () => {
  const doc = ST.createStore(ST.kidStarterDoc(), { kids: true }).doc;
  assert.equal(doc.arms, 4);
  assert.equal(doc.mode, 'cut');
  const a = AN.analyze(doc, { tool: 0, kids: true });
  assert.equal(a.stats.islands + a.stats.thinCut + a.stats.thinPaper + a.stats.interiorHoles, 0);
  assert.equal(a.report.tool.id, 'kid');
  assert.ok(doc.objects.length >= 5, 'a full snowflake, not a couple of shapes');
  assert.ok(a.stats.edgeCuts >= 5, 'every shape reaches an edge');
});

/* ---------- kid mode PDF: the student's name ---------- */

const PR = require('../js/print');

function nameItems(page) { return page.items.filter(it => it.t === 'text' && it.name); }

test('student name: cleaned for the PDF fonts', () => {
  assert.equal(PR.cleanName('  Zoë   Núñez '), 'Zoe Nunez');
  assert.equal(PR.cleanName('Ana<script>\u0007'), 'Ana<script>');      // the PDF writer and SVG escaping handle < >
  assert.equal(PR.cleanName('李'), '');
  assert.equal(PR.cleanName('x'.repeat(50)).length, 30);
  assert.equal(PR.cleanName(undefined), '');
});

test('student name: printed big and bold on every page, replacing the blank name line', () => {
  const doc = ST.createStore(ST.kidStarterDoc(), { kids: true }).doc;
  const an = AN.analyze(doc, { tool: 0, kids: true });
  const res = PR.layout(an, { studentName: 'Maya' });
  assert.equal(res.pages.length, 2);
  res.pages.forEach((p, i) => {
    const n = nameItems(p);
    assert.equal(n.length, 1, 'page ' + (i + 1) + ' shows the name once');
    assert.equal(n[0].s, 'Maya');
    assert.equal(n[0].font, 'F2');
    assert.ok(n[0].size >= 20, 'the name is the biggest text on the page');
    assert.ok(!p.items.some(it => it.t === 'text' && it.s === 'Name'), 'no blank name line when a name is given');
  });
  assert.ok(PR.toSVG(res.pages[0]).includes('>Maya</text>'));
});

test('student name: long names shrink to fit beside the title', () => {
  const an = AN.analyze(ST.kidStarterDoc(), { tool: 0, kids: true });
  const n = nameItems(PR.layout(an, { studentName: 'Maximiliana Wolfeschlegel' }).pages[0])[0];
  assert.ok(require('../js/pdf').textWidth(n.s, 'F2', n.size) <= 276 + 1e-6);
});

test('student name: the PDF file contains the name, and the file is named after it', () => {
  const an = AN.analyze(ST.kidStarterDoc(), { tool: 0, kids: true });
  const pages = PR.layout(an, { studentName: 'Maya Lee' }).pages;
  const bytes = PR.toPDF(pages, { title: "Maya Lee's snowflake", author: 'Maya Lee' });
  const txt = Buffer.from(bytes).toString('latin1');
  assert.ok(txt.includes('(Maya Lee) Tj'), 'name drawn on the page');
  assert.ok(txt.includes('/Author (Maya Lee)'), 'name in the PDF info');
  assert.equal(PR.fileName(an.doc, 'Maya Lee'), 'flake-lab-maya-lee-snowflake.pdf');
  assert.equal(PR.fileName(an.doc, ''), 'flake-lab-4arm-template.pdf');
});

test('regular mode PDF is unchanged: no student name, blank name line', () => {
  const an = AN.analyze(ST.starterDoc());
  const p = PR.layout(an).pages[0];
  assert.equal(nameItems(p).length, 0);
  assert.ok(p.items.some(it => it.t === 'text' && it.s === 'Name'));
});

test('QR code: kid-mode templates lead back to kid mode, full templates to the full app, both inside the margin', () => {
  const CFG = require('../js/config');
  const Q = require('../js/qr');
  assert.equal(CFG.kidsUrl, CFG.siteUrl + '?kids');
  const an = AN.analyze(ST.kidStarterDoc(), { tool: 0, kids: true });
  [[CFG.kidsUrl, 'kids'], [CFG.siteUrl, 'full']].forEach(([url, label]) => {
    const p = PR.layout(an, { siteUrl: url }).pages[0];
    assert.ok(p.items.some(it => it.t === 'text' && it.s === PR.draw.displayUrl(url)), label + ' address printed');
    const size = Q.encode(url).size;
    const qr = p.items.find(it => it.t === 'path' && it.fill && it.d.length === Q.encode(url).modules.flat().filter(Boolean).length * 5);
    assert.ok(qr, label + ' QR drawn from its own address');
    const xs = qr.d.filter(op => op.length > 1).map(op => op[1]);
    assert.ok(Math.max(...xs) <= 576 + 1e-9, label + ' QR stays inside the right margin');
    assert.ok(Math.abs(Math.max(...xs) - 576) < 1e-9 && size > 0);
  });
});

/* ---------- classroom feedback: shapes that start out clean, dropped where you let go ---------- */

test('kid shape library: only shapes that land clean, at every kid drop spot (no red warnings on a new shape)', () => {
  const S = require('../js/shapes');
  assert.ok(S.kidList.length >= 6 && S.kidList.every(Boolean), 'a real list of library shapes');
  ['star', 'sparkle', 'snowstar', 'triangle', 'diamond'].forEach(id => assert.ok(!S.kidList.some(s => s.id === id), id + ' is too pointy for kid mode'));
  S.kidList.forEach(sh => {
    for (let n = 0; n < 8; n++) {
      const d = ST.defaultDoc(); d.arms = 4;
      const st = ST.createStore(d, { kids: true });
      for (let i = 0; i < n; i++) st.addShape('circle');
      const o = st.addShape(sh.id);
      const solo = ST.defaultDoc(); solo.arms = 4; solo.objects = [Object.assign({}, o)]; solo.nextId = 2;
      const a = AN.analyze(solo, { tool: 0, kids: true }).stats;
      assert.equal(a.thinCut + a.thinPaper + a.islands, 0, sh.id + ' as shape #' + (n + 1));
    }
  });
});

test('full mode keeps every shape and its usual drop spots', () => {
  const S = require('../js/shapes');
  assert.ok(S.list.length > S.kidList.length);
  const st = ST.createStore(ST.defaultDoc());
  const ys = [0, 1, 2, 3].map(() => st.addShape('circle').y);
  assert.deepEqual(ys, [-58, -36, -80, -22]);
});

test('a shape dragged from the library lands where it is dropped (and still respects the kid minimum)', () => {
  const st = ST.createStore(ST.defaultDoc(), { kids: true });
  const o = st.addShape('circle', { at: [12.5, -40] });
  assert.equal(o.x, 12.5); assert.equal(o.y, -40);
  assert.ok(o.sx >= MIN);
  const far = st.addShape('square', { at: [999, -999] });
  assert.ok(Math.abs(far.x) <= 150 && Math.abs(far.y) <= 150, 'a wild drop is kept near the wedge');
});
