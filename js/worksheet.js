/*
 * worksheet.js - the symmetry worksheet and its answer key, as printable pages.
 *
 * layout(analysis, { key, name }) returns { pages, facts }. Pages are the same draw lists print.js uses
 * (see pdf.js), so print.toSVG() and print.toPDF() draw them. The worksheet shows the student's own
 * snowflake and asks questions whose answers depend on the number of arms (4 or 6) and on the design.
 * With key: true the same pages come back with the answers written in blue, plus a teacher notes page.
 */
(function (root, factory) {
  var G, PR, PDF, CFG;
  if (typeof module === 'object' && module.exports) {
    G = require('./geometry'); PR = require('./print'); PDF = require('./pdf'); CFG = require('./config');
  } else {
    var SF = root.SF; G = SF.geometry; PR = SF.print; PDF = SF.pdf; CFG = SF.config;
  }
  var api = factory(G, PR, PDF, CFG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SF.worksheet = api;
})(typeof self !== 'undefined' ? self : this, function (G, PR, PDF, CFG) {
  'use strict';

  var D = PR.draw, C = D.colors, text = D.text, line = D.line, wrap = D.wrap;
  var KEY = '#1a6fb0', PAPER = PR.PAPER;          // the same printable paper color as the template preview
  var LEFT = 36, WIDTH = 540, LEAD = 13.5;

  function num(v) { return String(Math.round(v * 100) / 100); }
  function deg(v) { return num(v) + '°'; }
  function plural(n, one, many) { return n === 1 ? one : many; }

  /** Every number the worksheet asks about, for this design. */
  function facts(analysis) {
    var n = analysis.doc.arms, a = 180 / n, holes = analysis.stats.interiorHoles, theta = n === 6 ? 10 : 15;
    return {
      n: n, layers: 2 * n, wedge: a, rays: 2 * n, mirrors: n, rotStep: 360 / n, rotations: n, total: 2 * n,
      holes: holes, holesAfter: Math.max(holes, 1) * 2 * n, imagined: holes === 0, notches: n,
      theta: theta, images: G.imageAngles(n, theta),
      predict: [{ arms: 8, wedge: 180 / 8, layers: 16 }, { arms: 12, wedge: 180 / 12, layers: 24 }],
      lines: G.mirrorLines(n)
    };
  }

  /* ---------- building blocks ---------- */

  function header(items, o, page, pages) {
    items.push(text(LEFT, 40, CFG.appName, 20, { font: 'F2' }));
    items.push(text(LEFT + PDF.textWidth(CFG.appName, 'F2', 20) + 8, 40, 'symmetry worksheet', 10, { fill: C.MUTED }));
    if (o.key) {
      items.push(text(576, 40, 'ANSWER KEY', 16, { font: 'F2', anchor: 'end', fill: KEY }));
    } else if (o.name) {
      items.push(text(318, 40, 'Name', 9, { fill: C.MUTED }), line(346, 41, 456, 41, { lw: 0.6 }));
      items.push(text(466, 40, 'Date', 9, { fill: C.MUTED }), line(490, 41, 576, 41, { lw: 0.6 }));
    }
    items.push(text(LEFT, 770, CFG.appName + ' · ' + D.displayUrl(o.siteUrl) + (o.key ? ' · answer key' : ''), 8, { fill: C.MUTED }));
    items.push(text(576, 770, 'Page ' + page + ' of ' + pages, 8, { fill: C.MUTED, anchor: 'end' }));
  }

  /** "n. text" with the number in bold; returns the y just below the last line. */
  function question(items, x, y, w, label, body) {
    items.push(text(x, y, label, 10.5, { font: 'F2' }));
    var ind = PDF.textWidth(label, 'F2', 10.5) + 5, lines = wrap(body, 'F1', 10.5, w - ind);
    lines.forEach(function (ln, k) { items.push(text(x + ind, y + k * LEAD, ln, 10.5)); });
    return y + (lines.length - 1) * LEAD;
  }

  /** A row of "label ____" blanks. parts: [{ label, w, ans }]. In the key the answers sit on the lines. */
  function blanks(items, x, y, parts, o) {
    var cx = x;
    parts.forEach(function (p) {
      if (p.label) { items.push(text(cx, y, p.label, 10, { fill: C.MUTED })); cx += PDF.textWidth(p.label, 'F1', 10) + 5; }
      items.push(line(cx, y + 2, cx + p.w, y + 2, { lw: 0.6 }));
      if (o.key && p.ans != null) items.push(text(cx + 4, y - 1, p.ans, 11, { font: 'F2', fill: KEY }));
      cx += p.w + 14;
    });
  }

  /** Ruled lines for a written answer; in the key the answer is written on them. */
  function ruled(items, x, y, w, count, ans, o) {
    for (var k = 0; k < count; k++) items.push(line(x, y + 2 + k * 18, x + w, y + 2 + k * 18, { stroke: C.FAINT, lw: 0.6 }));
    if (o.key && ans) wrap(ans, 'F2', 10, w - 8).slice(0, count).forEach(function (ln, k) { items.push(text(x + 4, y - 1 + k * 18, ln, 10, { font: 'F2', fill: KEY })); });
  }

  /* ---------- pictures ---------- */

  /** The student's snowflake: paper tinted, cutouts white. In the key the mirror lines are drawn and numbered. */
  function flakeFigure(items, analysis, cx, cy, r, o, f) {
    var k = r / G.R, out = PR.outlines(analysis);
    items.push({ t: 'path', d: D.circleOps(cx, cy, r), fill: PAPER });
    if (out.shade.length) {
      var ops = [];
      out.shade.forEach(function (l) { ops = ops.concat(D.polyOps(l.map(function (p) { return [cx + p[0] * k, cy + p[1] * k]; }), true)); });
      items.push({ t: 'path', d: ops, fill: '#ffffff', evenodd: true });
    }
    items.push({ t: 'path', d: D.circleOps(cx, cy, r), stroke: C.INK, lw: 1.1 });
    if (o.key) {
      f.lines.forEach(function (l) {
        var dx = Math.cos(l.angle), dy = Math.sin(l.angle);
        items.push(line(cx - (r + 10) * dx, cy - (r + 10) * dy, cx + (r + 10) * dx, cy + (r + 10) * dy, { stroke: C.INK, lw: 1.2, dash: [5, 3] }));
        items.push(text(cx + (r + 18) * dx, cy + (r + 18) * dy + 3, String(l.label), 9, { font: 'F2', fill: KEY, anchor: 'middle' }));
      });
    }
    items.push({ t: 'path', d: D.circleOps(cx, cy, 2), fill: C.INK });
  }

  /** The numbered sectors with the point P in sector 0 (and, in the key, all its copies). */
  function sectorFigure(items, cx, cy, r, f, o) {
    var n = f.n, a0 = G.leftEdgeAngle(n), al = Math.PI / n, i;
    items.push({ t: 'path', d: D.sectorOps(cx, cy, r, a0, a0 + al), fill: C.TINT });
    for (i = 0; i < 2 * n; i++) items.push(line(cx, cy, cx + r * Math.cos(a0 + i * al), cy + r * Math.sin(a0 + i * al), { stroke: C.LINE, lw: 0.8 }));
    items.push({ t: 'path', d: D.circleOps(cx, cy, r), stroke: C.INK, lw: 1 });
    for (i = 0; i < 2 * n; i++) {
      var m = a0 + (i + 0.5) * al;
      items.push(text(cx + (r * 0.86) * Math.cos(m), cy + (r * 0.86) * Math.sin(m) + 3, String(i), 9, { font: 'F2', anchor: 'middle', fill: C.MUTED }));
    }
    var pr = r * 0.52, pa = a0 + f.theta * G.DEG;
    if (o.key) {
      f.images.forEach(function (im) {
        var t = a0 + im.deg * G.DEG;
        items.push({ t: 'path', d: D.circleOps(cx + pr * Math.cos(t), cy + pr * Math.sin(t), 2.6), fill: im.sector ? KEY : C.INK });
      });
    }
    items.push({ t: 'path', d: D.circleOps(cx + pr * Math.cos(pa), cy + pr * Math.sin(pa), 3.4), fill: C.INK });
    items.push(text(cx + (pr + 10) * Math.cos(pa) - 2, cy + (pr + 10) * Math.sin(pa) + 4, 'P', 11, { font: 'F2' }));
    items.push({ t: 'path', d: D.circleOps(cx, cy, 1.8), fill: C.INK });
  }

  /* ---------- pages ---------- */

  function page1(analysis, f, o, pages) {
    var items = [], n = f.n, y;
    header(items, o, 1, pages);
    wrap('Every snowflake you cut is one wedge of paper, copied around the center: some copies are turned, some are flipped like a mirror image. ' +
      'Use the picture of your own snowflake and what you know about the folds to answer. Write in the margins if you need room to think.', 'F1', 10.5, WIDTH)
      .forEach(function (ln, k) { items.push(text(LEFT, 70 + k * LEAD, ln, 10.5)); });

    var cx = 160, cy = 240, r = 112;
    flakeFigure(items, analysis, cx, cy, r, o, f);
    items.push(text(cx, 378, 'Your snowflake, unfolded (' + n + ' arms)', 9, { anchor: 'middle', fill: C.MUTED }));

    var X = 322, W = 254;
    items.push(text(X, 126, 'A. The fold', 12, { font: 'F2' }));
    y = 148;
    y = question(items, X, y, W, '1.', 'Layers. After all the folds, how many layers of paper are stacked in the wedge?');
    blanks(items, X + 14, y + 20, [{ label: 'layers', w: 60, ans: String(f.layers) }], o);
    y += 52;
    y = question(items, X, y, W, '2.', 'Wedge angle. The full circle is 360°. Use your answer to question 1 to find the angle at the tip of the folded wedge.');
    blanks(items, X + 14, y + 20, [{ label: 'angle', w: 60, ans: deg(f.wedge) }], o);
    y += 52;
    y = question(items, X, y, W, '3.', 'Fold lines. How many creases run from the center to the edge? How many of them are whole straight lines across the circle (two creases in a row)?');
    blanks(items, X + 14, y + 20, [{ label: 'creases', w: 38, ans: String(f.rays) }, { label: 'whole lines', w: 38, ans: String(f.mirrors) }], o);

    items.push(line(LEFT, 400, 576, 400, { stroke: C.FAINT, lw: 0.6 }));
    items.push(text(LEFT, 422, 'B. Symmetry', 12, { font: 'F2' }));
    y = 446;
    y = question(items, LEFT, y, WIDTH, '4.', 'Turning. Spin your snowflake around its center. What is the smallest turn that makes it look exactly as it did before? How many different turns land it on itself, counting 0° ("no turn")?');
    blanks(items, LEFT + 16, y + 20, [{ label: 'smallest turn', w: 56, ans: deg(f.rotStep) }, { label: 'number of turns', w: 44, ans: String(f.rotations) }], o);
    y += 56;
    y = question(items, LEFT, y, WIDTH, '5.', 'Mirror lines. On the picture, draw every straight line through the center that splits the snowflake into two matching halves, then number them. How many are there? Use a protractor to measure the angle between two neighboring lines.');
    blanks(items, LEFT + 16, y + 20, [{ label: 'mirror lines', w: 44, ans: String(f.mirrors) }, { label: 'angle between neighbors', w: 56, ans: deg(f.wedge) }], o);
    y += 56;
    y = question(items, LEFT, y, WIDTH, '6.', 'Counting symmetries. Add the turns from question 4 to the flips (one for each mirror line). How many ways can you move the snowflake so it lands on itself? Mathematicians call this set of moves the dihedral group D with a small number next to it.');
    blanks(items, LEFT + 16, y + 20, [{ label: 'moves', w: 44, ans: String(f.total) }, { label: 'group name: D', w: 36, ans: String(n) }], o);
    return { w: PR.PAGE_W, h: PR.PAGE_H, items: items };
  }

  function page2(analysis, f, o, pages) {
    var items = [], n = f.n, y, i;
    header(items, o, 2, pages);
    items.push(text(LEFT, 74, 'C. Your wedge, copied around', 12, { font: 'F2' }));
    y = 96;
    var q7 = f.imagined
      ? 'Counting holes. Imagine you cut one small hole in the middle of the folded wedge, away from every fold and edge. After you unfold, how many holes does the paper have?'
      : 'Counting holes. In your folded wedge, ' + f.holes + ' ' + plural(f.holes, 'cutout touches', 'cutouts touch') + ' no fold line and no edge. After you unfold, how many separate holes do ' + plural(f.holes, 'it make', 'they make') + ' in the paper?';
    y = question(items, LEFT, y, WIDTH, '7.', q7);
    blanks(items, LEFT + 16, y + 20, [{ label: 'holes', w: 50, ans: String(f.holesAfter) }], o);
    y += 52;
    y = question(items, LEFT, y, WIDTH, '8.', 'Cutting on a fold. Now imagine a small half-circle notch cut into one fold line of the wedge (not at the tip). When you unfold, each notch joins its mirror image into a whole circle. How many whole circles appear?');
    blanks(items, LEFT + 16, y + 20, [{ label: 'circles', w: 50, ans: String(f.notches) }], o);
    y += 52;
    y = question(items, LEFT, y, WIDTH, '9.', 'Following a point. Point P sits ' + f.theta + '° clockwise from the left fold edge of the wedge (sector 0). Each flip and turn makes another copy of P, one in every sector. Write the angle of each copy, measured clockwise from the same fold edge. (Sector 0 is done for you.)');
    var top = y + 14, cr = 72;
    sectorFigure(items, LEFT + cr + 10, top + cr + 6, cr, f, o);
    var colW = 156, rows = n, i0;
    for (i = 0; i < 2 * n; i++) {
      var col = i < n ? 0 : 1, row = i < n ? i : i - n, bx = 260 + col * (colW + 14), by = top + 18 + row * 22;
      items.push(text(bx, by, 'sector ' + i, 10, { fill: C.MUTED }));
      items.push(line(bx + 50, by + 2, bx + 50 + 70, by + 2, { lw: 0.6 }));
      if (i === 0 || o.key) items.push(text(bx + 54, by - 1, deg(f.images[i].deg), 11, { font: 'F2', fill: i === 0 && !o.key ? C.INK : KEY }));
    }
    y = top + 2 * cr + 26;
    y = question(items, LEFT, y, WIDTH, '10.', 'Pattern. Which sectors hold turned copies of P and which hold flipped copies? What do you notice about the angles in each group?');
    ruled(items, LEFT + 16, y + 20, WIDTH - 16, 2, 'Even sectors are turned copies (' + deg(f.images[2].deg - f.images[0].deg) + ' more each time). Odd sectors are flipped copies: each one sits as far before a fold line as P sits after one.', o);
    y += 70;
    y = question(items, LEFT, y, WIDTH, '11.', 'Predict. A snowflake with more arms has a narrower wedge. Fill in the table.');
    var ty = y + 22;
    ['Arms', 'Wedge angle', 'Layers'].forEach(function (h, c) { items.push(text(LEFT + 20 + c * 120, ty, h, 9, { font: 'F2', fill: C.MUTED })); });
    f.predict.forEach(function (p, r) {
      var yy = ty + 22 + r * 22;
      items.push(text(LEFT + 20, yy, String(p.arms), 10.5));
      blanks(items, LEFT + 140, yy, [{ w: 70, ans: deg(p.wedge) }], o);
      blanks(items, LEFT + 260, yy, [{ w: 70, ans: String(p.layers) }], o);
    });
    y = ty + 76;
    y = question(items, LEFT, y, WIDTH, '12.', 'Think about it. Would a 4-arm or a 12-arm snowflake be harder to cut by hand? Use layers in your answer.');
    ruled(items, LEFT + 16, y + 20, WIDTH - 16, 2, 'The 12-arm one: its wedge has 24 layers (4 arms has 8), so the scissors must cut through three times as much paper, and the narrow wedge leaves less room for detail.', o);
    return { w: PR.PAGE_W, h: PR.PAGE_H, items: items };
  }

  function notesPage(f, o, pages) {
    var items = [], y = 74, n = f.n;
    header(items, o, 3, pages);
    items.push(text(LEFT, y, 'Teacher notes', 14, { font: 'F2' }));
    y += 22;
    var notes = [
      ['Overview.', 'This worksheet was made for a ' + n + '-arm snowflake. The paper is folded into ' + f.layers + ' equal wedges of ' + deg(f.wedge) + ' (360° / ' + f.layers + '). Every wedge is a copy of the one on top; neighbors are mirror images across the crease they share.'],
      ['1 to 3.', 'Layers = 2 × ' + n + ' = ' + f.layers + '. The wedge angle is 360° / ' + f.layers + ' = ' + deg(f.wedge) + '. There are ' + f.layers + ' creases from the center, but a crease and the one opposite it make one straight line, so there are ' + n + ' whole lines. Check: ' + n + ' × ' + deg(f.wedge) + ' = 180°, half a turn.'],
      ['4 and 5.', 'Turned copies are every second wedge, so the smallest turn is 2 × ' + deg(f.wedge) + ' = ' + deg(f.rotStep) + ' and there are ' + f.rotations + ' turns including 0°. The ' + n + ' mirror lines are the creases; neighbors are ' + deg(f.wedge) + ' apart, the same as the wedge angle. Numbering in the picture runs by the angle each line makes with straight up.'],
      ['6.', n + ' turns + ' + n + ' flips = ' + f.total + ' moves, the dihedral group D' + n + ' (order ' + f.total + '). It is the same number as the layers: each move sends the top wedge to a different layer.'],
      ['7.', f.imagined
        ? 'A hole that touches no fold appears once in every one of the ' + f.layers + ' wedges, so 1 × ' + f.layers + ' = ' + f.layers + ' holes.'
        : 'The count of ' + f.holes + ' comes from the analysis of this design: cutouts in the wedge that touch no fold line and no edge. Each appears once per wedge, so ' + f.holes + ' × ' + f.layers + ' = ' + f.holesAfter + ' holes. Very small cutouts are ignored, and a cutout that reaches a fold or the rim merges across it, so it is not counted here.'],
      ['8.', 'A half-circle on a crease has only half a circle in each of two neighboring wedges. The ' + f.layers + ' halves pair up, giving ' + f.layers + ' / 2 = ' + n + ' whole circles.'],
      ['9 and 10.', 'Sector k covers ' + deg(f.wedge) + ' × k to ' + deg(f.wedge) + ' × (k + 1). A turned copy (even k) has angle k × ' + deg(f.wedge) + ' + ' + f.theta + '°. A flipped copy (odd k) has angle (k + 1) × ' + deg(f.wedge) + ' - ' + f.theta + '°, because a mirror swaps "after the fold" and "before the fold". The turned copies are spaced ' + deg(f.rotStep) + ' apart, matching question 4.'],
      ['11 and 12.', '180° / arms gives the wedge angle (8 arms: 22.5°, 12 arms: 15°) and layers are 2 × arms (16 and 24). Accept any answer that links more layers to harder cutting.']
    ];
    notes.forEach(function (nt) {
      var lines = wrap(nt[1], 'F1', 10, WIDTH - 78);
      items.push(text(LEFT, y, nt[0], 10, { font: 'F2' }));
      lines.forEach(function (ln, k) { items.push(text(LEFT + 78, y + k * LEAD, ln, 10)); });
      y += lines.length * LEAD + 9;
    });
    return { w: PR.PAGE_W, h: PR.PAGE_H, items: items };
  }

  /**
   * analysis: the result of analyze(doc). opts: { key: false, name: true, siteUrl }.
   * Returns { pages, facts }.
   */
  function layout(analysis, opts) {
    opts = opts || {};
    var o = { key: !!opts.key, name: opts.name !== false, siteUrl: opts.siteUrl || CFG.siteUrl };
    var f = facts(analysis), total = o.key ? 3 : 2;
    var pages = [page1(analysis, f, o, total), page2(analysis, f, o, total)];
    if (o.key) pages.push(notesPage(f, o, total));
    return { pages: pages, facts: f };
  }

  function toPDF(pages, key) {
    return PDF.build(pages, { title: CFG.appName + ' symmetry worksheet' + (key ? ' answer key' : ''), author: CFG.appName });
  }
  function fileName(doc, key) { return 'flake-lab-' + doc.arms + 'arm-symmetry-' + (key ? 'answer-key' : 'worksheet') + '.pdf'; }

  return { layout: layout, facts: facts, toPDF: toPDF, fileName: fileName };
});
