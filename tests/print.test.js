'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../js/state');
const AN = require('../js/analyze');
const G = require('../js/geometry');
const PDF = require('../js/pdf');
const Q = require('../js/qr');
const PR = require('../js/print');

function docWith(arms, objs) {
  const d = ST.defaultDoc();
  d.arms = arms;
  objs.forEach((o) => d.objects.push(Object.assign({ id: 'o' + d.nextId++, type: 'shape', x: 0, y: -50, sx: 20, sy: 20, rot: 0, flip: false, role: 'cut' }, o)));
  return d;
}
const analyse = (d) => AN.analyze(d, { tool: 0 });
const area = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return Math.abs(a / 2); };

test('fold rays: right count, right steps, opposite rays share a step', () => {
  [6, 4].forEach((n) => {
    const rays = PR.foldRays(n);
    assert.equal(rays.length, 2 * n);
    assert.ok(Math.abs(rays[0].angle - G.leftEdgeAngle(n)) < 1e-12, 'ray 0 is the left edge');
    assert.ok(Math.abs(rays[1].angle - rays[0].angle - Math.PI / n) < 1e-12);
    for (let k = 0; k < n; k++) assert.equal(rays[k].step, rays[k + n].step, 'ray ' + k + ' and its opposite');
    const count = (s) => rays.filter((r) => r.step === s).length;
    if (n === 6) assert.deepEqual([count(1), count(2), count(3)], [2, 4, 6]);
    else assert.deepEqual([count(1), count(2), count(3)], [2, 2, 4]);
  });
  assert.equal(PR.foldRays(6)[1].step, 3, 'the right edge of the base wedge is a step 3 line');
  assert.equal(PR.foldRays(6)[0].step, 1, 'the left edge of the base wedge is the step 1 line');
});

test('rim splitting keeps loops that stay inside and opens loops that touch the rim', () => {
  const u = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [0, 1]];
  assert.deepEqual(PR.splitRim(u, [false, false, false, false, false, false]).closed, u);
  assert.equal(PR.splitRim(u, [true, true, true, true, true, true]).closed, null);
  const s = PR.splitRim(u, [false, true, true, false, false, false]);
  assert.equal(s.closed, null);
  assert.equal(s.open.length, 1);
  assert.deepEqual(s.open[0], [[2, 0], [3, 0], [3, 1], [0, 1], [0, 0], [1, 0]], 'runs from one rim point round to the next');
  const two = PR.splitRim(u, [true, false, false, true, false, false]);
  assert.equal(two.open.length, 2);
});

test('a cutout inside the paper becomes closed outlines of the right size', () => {
  const d = docWith(6, [{ shapeId: 'circle', sx: 20, sy: 20 }]);
  const o = PR.outlines(analyse(d));
  assert.equal(o.closed.length, 12, 'a circle in the wedge unfolds to twelve circles');
  assert.equal(o.open.length, 0);
  o.closed.forEach((l) => assert.ok(Math.abs(area(l) - Math.PI * 100) / (Math.PI * 100) < 0.04, 'area ' + area(l)));
  assert.equal(o.shade.length, 12);
});

test('a cutout that reaches the edge gives open lines that end on the rim', () => {
  const d = docWith(6, [{ shapeId: 'circle', sx: 24, sy: 24, y: -98 }]);
  const o = PR.outlines(analyse(d));
  assert.ok(o.open.length > 0 && o.closed.length === 0);
  o.open.forEach((run) => {
    [run[0], run[run.length - 1]].forEach((p) => assert.ok(Math.hypot(p[0], p[1]) > G.R - 1.4, 'endpoint at radius ' + Math.hypot(p[0], p[1])));
    run.slice(1, -1).forEach((p) => assert.ok(Math.hypot(p[0], p[1]) <= G.R - 0.9 + 1e-9, 'middle points stay off the rim'));
  });
});

test('nothing to cut means no outlines', () => {
  const o = PR.outlines(analyse(docWith(4, [])));
  assert.deepEqual([o.closed.length, o.open.length, o.shade.length], [0, 0, 0]);
});

test('page 1 is true to scale: 7.5 inch disc, 1 inch scale bar', () => {
  const res = PR.layout(analyse(docWith(6, [{ shapeId: 'circle' }])), { siteUrl: 'https://example.org/' });
  const p1 = res.pages[0];
  assert.deepEqual([p1.w, p1.h], [612, 792]);
  // the disc outline is the circle path of radius 270 pt (diameter 7.5 in)
  const circ = p1.items.find((it) => it.t === 'path' && it.stroke === '#0a0e13' && it.lw === 1.2 && it.d.length === 6);
  const xs = circ.d.filter((op) => op[0] !== 'Z').map((op) => op[op.length - 2]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 540) < 1e-9);
  assert.ok(Math.abs(PR.PT_PER_UNIT * 2 * G.R - 540) < 1e-9);
  // 1 inch = 72 pt: the scale bar's long line
  const bars = p1.items.filter((it) => it.t === 'path' && it.d.length === 2 && it.d[0][2] === it.d[1][2] && Math.abs(it.d[1][1] - it.d[0][1]) === 72);
  assert.equal(bars.length, 1, 'one 72 pt horizontal scale bar');
  // disc centred on the page
  assert.equal(Math.round((Math.max(...xs) + Math.min(...xs)) / 2), 306);
});

test('everything stays inside the printable area and is plain text', () => {
  [6, 4].forEach((arms) => {
    const res = PR.layout(analyse(docWith(arms, [{ shapeId: 'petal', sx: 10, sy: 30, y: -70 }, { shapeId: 'circle', y: -30 }])), {});
    assert.equal(res.pages.length, 2);
    res.pages.forEach((pg, pi) => pg.items.forEach((it) => {
      if (it.t === 'path') it.d.forEach((op) => {
        for (let i = 1; i < op.length; i += 2) {
          assert.ok(op[i] >= 18 - 1e-6 && op[i] <= 594 + 1e-6, `page ${pi + 1} x ${op[i]}`);
          assert.ok(op[i + 1] >= 18 - 1e-6 && op[i + 1] <= 774 + 1e-6, `page ${pi + 1} y ${op[i + 1]}`);
        }
      });
      else {
        assert.equal(PDF.clean(it.s), it.s, 'text survives the PDF font unchanged: ' + it.s);
        assert.ok(!/[\u2013\u2014]/.test(it.s), 'no long dashes');
        const w = PDF.textWidth(it.s, it.font, it.size), x0 = it.anchor === 'middle' ? it.x - w / 2 : it.anchor === 'end' ? it.x - w : it.x;
        assert.ok(x0 >= 18 && x0 + w <= 594, `text fits across: ${it.s}`);
        assert.ok(it.y >= 18 && it.y <= 774, 'text y ' + it.y);
      }
    }));
  });
});

test('the QR code on the page encodes the configured address', () => {
  const url = 'https://makermush.github.io/snowflakes/';
  const res = PR.layout(analyse(docWith(6, [])), { siteUrl: url });
  const q = Q.encode(url);
  const dark = q.modules.reduce((a, r) => a + r.reduce((b, v) => b + v, 0), 0);
  const item = res.pages[0].items.find((it) => it.t === 'path' && it.fill === '#0a0e13' && it.d.length === dark * 5);
  assert.ok(item, 'a path with one square per dark module');
  const xs = item.d.filter((op) => op[0] !== 'Z').map((op) => op[1]);
  assert.equal(Math.max(...xs) - Math.min(...xs), q.size * 2, 'drawn at 2 pt per module');
  assert.ok(res.pages[0].items.some((it) => it.t === 'text' && it.s === 'makermush.github.io/snowflakes'), 'the address is also printed as text');
});

test('options: one page without the guide, no name line, no gray shading', () => {
  const an = analyse(docWith(6, [{ shapeId: 'circle' }]));
  const all = PR.layout(an, {});
  const lean = PR.layout(an, { guide: false, name: false, shade: false });
  assert.equal(all.pages.length, 2); assert.equal(lean.pages.length, 1);
  assert.ok(all.pages[0].items.some((it) => it.t === 'text' && it.s === 'Name'));
  assert.ok(!lean.pages[0].items.some((it) => it.t === 'text' && it.s === 'Name'));
  assert.ok(all.pages[0].items.some((it) => it.fill === '#dde2e8' && it.evenodd));
  assert.ok(!lean.pages[0].items.some((it) => it.fill === '#dde2e8'));
});

test('fold guide: steps match the fold type and tips follow the design', () => {
  const six = PR.foldStepsInfo(6), four = PR.foldStepsInfo(4);
  assert.deepEqual(six.map((s) => s.shape), [180, 60, 30]);
  assert.deepEqual(four.map((s) => s.shape), [180, 90, 45]);
  assert.deepEqual(six.map((s) => s.layers), [2, 6, 12]);
  assert.deepEqual(four.map((s) => s.layers), [2, 4, 8]);
  const withHole = PR.layout(analyse(docWith(6, [{ shapeId: 'circle' }])), {}).pages[1].items.filter((i) => i.t === 'text').map((i) => i.s).join(' ');
  assert.match(withHole, /small snip/);
  const noHole = PR.layout(analyse(docWith(6, [{ shapeId: 'circle', y: -98, sx: 24, sy: 24 }])), {}).pages[1].items.filter((i) => i.t === 'text').map((i) => i.s).join(' ');
  assert.doesNotMatch(noHole, /small snip/);
});

test('hostile text cannot break the SVG or the PDF', () => {
  const evil = '<script>alert(1)</script> "&\' ) Tj ET (';
  const res = PR.layout(analyse(docWith(6, [{ shapeId: 'circle' }])), { appName: evil });
  const svg = PR.toSVG(res.pages[0]);
  assert.ok(!svg.includes('<script'), 'markup is escaped in the SVG');
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  const pdf = Buffer.from(PR.toPDF(res.pages, { title: evil })).toString('latin1');
  assert.ok(pdf.includes('\\) Tj ET \\('), 'parentheses are escaped in the PDF');
  assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
});

test('SVG and PDF are made from the same draw list', () => {
  const res = PR.layout(analyse(docWith(4, [{ shapeId: 'diamond' }])), {});
  const svg = PR.toSVG(res.pages[0]);
  assert.equal((svg.match(/<path /g) || []).length, res.pages[0].items.filter((i) => i.t === 'path').length);
  assert.equal((svg.match(/<text /g) || []).length, res.pages[0].items.filter((i) => i.t === 'text').length);
  assert.equal(PR.fileName({ arms: 4 }), 'flake-lab-4arm-template.pdf');
});

test('optional name: a typed name replaces the blank name line on a regular 6-arm template', () => {
  const an = AN.analyze(ST.starterDoc());
  const pages = PR.layout(an, { studentName: '  Ms. Rivera ' }).pages;
  pages.forEach(p => {
    const t = p.items.filter(it => it.t === 'text');
    assert.ok(t.some(it => it.s === 'Ms. Rivera' && it.font === 'F2' && it.size >= 20), 'name printed big');
    assert.ok(!t.some(it => it.s === 'Name'), 'no blank line');
  });
  assert.equal(PR.fileName(an.doc, 'Ms. Rivera'), 'flake-lab-ms-rivera-snowflake.pdf');
  const blank = PR.layout(an, { studentName: '   ' }).pages[0].items;
  assert.ok(blank.some(it => it.t === 'text' && it.s === 'Name'), 'a blank name keeps the write-in line');
});

/* ---------- cut lines on the blue wedge only ---------- */

test('one-wedge option: every cut line sits inside the blue wedge, and the full template has lines elsewhere', () => {
  const ST2 = require('../js/state'), AN2 = require('../js/analyze'), PR2 = require('../js/print'), G2 = require('../js/geometry');
  [4, 6].forEach(arms => {
    const doc = ST2.starterDoc(); doc.arms = arms;
    const an = AN2.analyze(doc);
    const a0 = G2.leftEdgeAngle(arms), al = Math.PI / arms;
    const cutPts = page => page.items.filter(it => it.t === 'path' && it.stroke === '#0a0e13' && it.lw === 1.3)
      .flatMap(it => it.d.filter(op => op.length > 1).map(op => [op[1] - 306, op[2] - 400]))
      .filter(([x, y]) => Math.hypot(x, y) <= 271);                     // the paper circle only (not the legend sample)
    const inWedge = ([x, y]) => {
      if (Math.hypot(x, y) < 3) return true;
      let d = Math.atan2(y, x) - a0; d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI;
      return d >= -0.03 && d <= al + 0.03;
    };
    const full = cutPts(PR2.layout(an).pages[0]), one = cutPts(PR2.layout(an, { oneWedge: true }).pages[0]);
    assert.ok(full.some(p => !inWedge(p)), arms + ' arms: the full template draws lines on other wedges');
    assert.ok(one.length > 0, arms + ' arms: the blue wedge still has its lines');
    assert.ok(one.every(inWedge), arms + ' arms: no cut line outside the blue wedge');
    assert.ok(PR2.layout(an, { oneWedge: true }).pages[0].items.some(it => it.t === 'text' && /black lines in the blue wedge/.test(it.s)));
  });
});

test('math mode has its own address for the printed QR code', () => {
  const CFG = require('../js/config');
  assert.equal(CFG.mathUrl, CFG.siteUrl + '?math');
  assert.equal(CFG.math, false);
  assert.ok(CFG.feedbackEmail === '' || /@/.test(CFG.feedbackEmail));
  assert.ok(CFG.feedbackUrl === '' || /^https:\/\//.test(CFG.feedbackUrl));
});
