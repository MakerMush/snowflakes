'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/pdf');

const asText = (bytes) => Buffer.from(bytes).toString('latin1');
const page = (items) => ({ w: 612, h: 792, items });

test('text widths match Helvetica metrics', () => {
  assert.ok(Math.abs(P.textWidth('Hello', 'F1', 12) - 27.336) < 1e-9);
  assert.ok(Math.abs(P.textWidth('Hello', 'F2', 12) - 29.34) < 1e-9, 'bold is wider');
  assert.equal(P.textWidth('', 'F1', 12), 0);
  assert.ok(Math.abs(P.textWidth('°', 'F1', 10) - 4) < 1e-9);
});

test('unsupported characters are shown as ? and dashes become hyphens', () => {
  assert.equal(P.clean('snow ❄ flake'), 'snow ? flake');
  assert.equal(P.clean('a\u2013b\u2014c'), 'a-b-c');
  assert.equal(P.clean('20°'), '20°');
});

test('a PDF has a valid cross-reference table and correct stream lengths', () => {
  const bytes = P.build([page([{ t: 'path', d: [['M', 10, 10], ['L', 100, 10], ['L', 100, 100], ['Z']], fill: '#336699', stroke: '#000', lw: 1.5 },
    { t: 'text', x: 50, y: 50, s: 'Hi', size: 12, font: 'F1', fill: '#000' }]), page([])], { title: 'T' });
  const s = asText(bytes);
  assert.ok(s.startsWith('%PDF-1.4\n') && s.endsWith('%%EOF\n'));
  const xrefAt = +/startxref\n(\d+)\n/.exec(s)[1];
  assert.equal(s.substr(xrefAt, 4), 'xref');
  const count = +/xref\n0 (\d+)\n/.exec(s)[1];
  const entries = s.substr(xrefAt).split('\n').slice(3, 3 + count - 1);
  assert.equal(entries.length, count - 1);
  entries.forEach((line, i) => {
    const off = +line.slice(0, 10);
    assert.equal(s.substr(off, String(i + 1).length + 6), (i + 1) + ' 0 obj', 'offset of object ' + (i + 1));
  });
  const re = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/g;
  let m, n = 0;
  while ((m = re.exec(s))) { assert.equal(m[2].length, +m[1], 'stream length'); n++; }
  assert.equal(n, 2);
  assert.match(s, /\/Count 2/);
  assert.match(s, /\/MediaBox \[0 0 612 792\]/);
});

test('page content uses top-left coordinates, even-odd fills and dashes', () => {
  const s = asText(P.build([page([
    { t: 'path', d: [['M', 0, 0], ['L', 612, 792], ['Z']], fill: '#fff', evenodd: true },
    { t: 'path', d: [['M', 10, 20], ['L', 30, 20]], stroke: '#f00', lw: 2, dash: [3, 2], cap: 'round' },
    { t: 'path', d: [['M', 1, 1], ['L', 2, 2]], fill: null, stroke: null }
  ])]));
  assert.match(s, /0 792 m\n612 0 l\nh\nf\*\n/, 'y is flipped and evenodd uses f*');
  assert.match(s, /1 0 0 RG\n2 w\n1 J 0 j\n\[3 2\] 0 d\n10 772 m\n30 772 l\nS/);
  assert.equal((s.match(/ m\n/g) || []).length, 2, 'a path with neither fill nor stroke draws nothing');
});

test('text is escaped, aligned and cannot break the file', () => {
  const nasty = 'a (b) \\ c) Tj ET Q (';
  const s = asText(P.build([page([{ t: 'text', x: 100, y: 100, s: nasty, size: 10, font: 'F2', fill: '#000', anchor: 'middle' }])], { title: nasty, author: nasty }));
  assert.ok(s.includes('(a \\(b\\) \\\\ c\\) Tj ET Q \\() Tj'), 'parentheses and backslashes are escaped');
  assert.ok(s.includes('/Title (a \\(b\\) \\\\ c\\) Tj ET Q \\()'), 'metadata is escaped too');
  const w = P.textWidth(nasty, 'F2', 10);
  assert.ok(s.includes((Math.round((100 - w / 2) * 1000) / 1000) + ' 692 Td'), 'centered text starts half its width to the left');
  const end = asText(P.build([page([{ t: 'text', x: 100, y: 100, s: 'abc', size: 10, font: 'F1', anchor: 'end' }])]));
  assert.ok(end.includes((100 - P.textWidth('abc', 'F1', 10)) + ' 692 Td'));
});

test('numbers never come out as -0 or in exponent form; colours parse', () => {
  assert.equal(P.num(-0.0001), '0');
  assert.equal(P.num(1e-9), '0');
  assert.equal(P.num(12.34567), '12.346');
  assert.equal(P.colour('#fff'), '1 1 1');
  assert.equal(P.colour('#000000'), '0 0 0');
  assert.equal(P.colour('red'), null);
  assert.equal(P.colour(null), null);
});
