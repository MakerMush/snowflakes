/*
 * print.js - the printable fold-and-cut template.
 *
 * layout(analysis, opts) turns a finished analysis (see analyze.js) into "draw lists": plain data
 * describing each US Letter page (see pdf.js for the format). The same draw list is drawn two ways:
 * toSVG() for the screen preview and for window.print(), and toPDF() for the downloaded file.
 *
 * Page 1 is the template: the 7.5 inch paper disc with its fold lines (numbered in folding order),
 * the cut lines traced from the analysed raster, a scale bar, a legend and a QR code.
 * Page 2 (optional) is a fold guide with one small diagram per step.
 */
(function (root, factory) {
  var G, T, AN, Q, PDF, CFG;
  if (typeof module === 'object' && module.exports) {
    G = require('./geometry'); T = require('./trace'); AN = require('./analyze'); Q = require('./qr'); PDF = require('./pdf'); CFG = require('./config');
  } else {
    var SF = root.SF; G = SF.geometry; T = SF.trace; AN = SF.analyze; Q = SF.qr; PDF = SF.pdf; CFG = SF.config;
  }
  var api = factory(G, T, AN, Q, PDF, CFG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SF.print = api;
})(typeof self !== 'undefined' ? self : this, function (G, T, AN, Q, PDF, CFG) {
  'use strict';

  var PAGE_W = 612, PAGE_H = 792;                  // US Letter in points
  var CX = PAGE_W / 2, CY = 400;                   // centre of the paper disc on page 1
  var K = 270 / G.R;                               // points per wedge unit: 7.5 in = 540 pt across
  var BLUE = '#5aa3d4', INK = '#0a0e13', LINE = '#4b5563', SHADE = '#dde2e8', TINT = '#e3f0f9', MUTED = '#5b6672', FAINT = '#b9c2cb';
  var KAPPA = 0.5522847498;

  /* ---------- small drawing helpers (points, y down) ---------- */

  function circleOps(cx, cy, r) {
    var k = KAPPA * r;
    return [['M', cx + r, cy], ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r], ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
      ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r], ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy], ['Z']];
  }
  /** Cubic pieces along a circular arc from angle a0 to a1 (radians, screen angles: x = cos, y = sin). */
  function arcOps(cx, cy, r, a0, a1) {
    var ops = [], pieces = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9)), da = (a1 - a0) / pieces;
    var k = 4 / 3 * Math.tan(da / 4);
    for (var i = 0; i < pieces; i++) {
      var s = a0 + i * da, e = s + da;
      var x0 = Math.cos(s), y0 = Math.sin(s), x1 = Math.cos(e), y1 = Math.sin(e);
      ops.push(['C', cx + r * (x0 - k * y0), cy + r * (y0 + k * x0), cx + r * (x1 + k * y1), cy + r * (y1 - k * x1), cx + r * x1, cy + r * y1]);
    }
    return ops;
  }
  /** A pie slice with its tip at (cx, cy), from angle a0 to a1. */
  function sectorOps(cx, cy, r, a0, a1) {
    return [['M', cx, cy], ['L', cx + r * Math.cos(a0), cy + r * Math.sin(a0)]].concat(arcOps(cx, cy, r, a0, a1), [['Z']]);
  }
  function polyOps(pts, closed) {
    var ops = pts.map(function (p, i) { return [i ? 'L' : 'M', p[0], p[1]]; });
    if (closed) ops.push(['Z']);
    return ops;
  }
  function line(x1, y1, x2, y2, style) {
    return Object.assign({ t: 'path', d: [['M', x1, y1], ['L', x2, y2]], stroke: INK, lw: 1 }, style);
  }
  function text(x, y, s, size, o) {
    return Object.assign({ t: 'text', x: x, y: y, s: s, size: size, font: 'F1', fill: INK, anchor: 'start' }, o);
  }
  function wrap(s, font, size, maxW) {
    var words = String(s).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (cur && PDF.textWidth(t, font, size) > maxW) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function X(u) { return CX + u * K; }
  function Y(u) { return CY + u * K; }

  /* ---------- fold plan ---------- */

  var DASH = { 1: [9, 4], 2: [5, 3.5], 3: [2, 3] };

  /**
   * Every fold line is a ray from the centre. Rays are numbered k = 0..2n-1 clockwise from the base wedge's
   * left edge (so the base wedge sits between rays 0 and 1). Step 1 halves the circle, step 2 folds the half
   * down to a 360/n degree sector, step 3 halves that to the final 180/n degree wedge.
   */
  function foldRays(n) {
    var a0 = G.leftEdgeAngle(n), al = Math.PI / n, out = [];
    for (var k = 0; k < 2 * n; k++) {
      var step = k % n === 0 ? 1 : (n === 6 ? (k % 2 === 0 ? 2 : 3) : (k % 4 === 2 ? 2 : 3));
      out.push({ k: k, angle: a0 + k * al, step: step });
    }
    return out;
  }

  function foldStepsInfo(n) {
    var six = n === 6;
    return [
      { step: 1, shape: 180, layers: 2, shapeName: 'Half circle',
        text: 'Fold the circle in half along the long dashed line marked 1. Fold away from you, so the half with the blue wedge stays in front.' },
      { step: 2, shape: 360 / n, layers: six ? 6 : 4, shapeName: six ? '60° sector' : '90° sector',
        text: six
          ? 'Fold the half circle into thirds along the two lines marked 2. First fold the far third back along its line, then fold the whole stack back along the other line. Always fold away from you; the blue wedge stays in front.'
          : 'Fold the half circle in half again along the line marked 2, away from you, so the blue wedge stays in front.' },
      { step: 3, shape: 180 / n, layers: 2 * n, shapeName: (180 / n) + '° wedge',
        text: 'Fold the sector in half along the short dashed line marked 3, away from you. You now have a ' + (180 / n) + '° wedge with ' + (2 * n) + ' layers. The blue wedge is on top, ready to cut.' }
    ];
  }

  /* ---------- cut outlines from the analysed raster ---------- */

  /** Split a closed loop (wedge units) into open runs that avoid the paper's rim. */
  function splitRim(u, rim) {
    var n = u.length, nr = 0, i;
    for (i = 0; i < n; i++) if (rim[i]) nr++;
    if (nr === 0) return { closed: u, open: [] };
    if (nr === n) return { closed: null, open: [] };
    var start = -1;
    for (i = 0; i < n; i++) if (rim[i] && !rim[(i + 1) % n]) { start = i; break; }
    var runs = [], run = [u[start]];
    for (var j = 1; j <= n; j++) {
      var idx = (start + j) % n, p = u[idx];
      if (run) {
        run.push(p);
        if (rim[idx]) { if (run.length > 2) runs.push(run); run = null; }
      }
      if (rim[idx] && j < n && !rim[(idx + 1) % n]) run = [p];
    }
    return { closed: null, open: runs };
  }

  /**
   * Vector outlines of everything that gets cut away, in wedge units.
   * closed: loops that stay inside the paper; open: lines that run from rim to rim; shade: every region's
   * outline (clamped to the disc) for the light gray fill.
   */
  function outlines(analysis) {
    var N = analysis.N, g = analysis.grid, total = N * N, mask = new Uint8Array(total), any = false, i;
    for (i = 0; i < total; i++) if (analysis.cutMask[i] && g.inDisc[i]) { mask[i] = 1; any = true; }
    var res = { closed: [], open: [], shade: [] };
    if (!any) return res;
    mask = T.clean(mask, N, N, 6, 6);
    var R = G.R, rimR2 = (R - 0.9) * (R - 0.9);
    T.loops(mask, N, N).forEach(function (loop) {
      var pts = T.simplifyLoop(T.smoothLoop(loop, 6), 0.35);
      if (pts.length < 3) return;
      var u = pts.map(function (p) { return [-R + p[0] * AN.STEP, -R + p[1] * AN.STEP]; });
      res.shade.push(u.map(function (p) {
        var d = Math.hypot(p[0], p[1]);
        return d > R ? [p[0] * R / d, p[1] * R / d] : p;
      }));
      var rim = u.map(function (p) { return p[0] * p[0] + p[1] * p[1] > rimR2; });
      var s = splitRim(u, rim);
      if (s.closed) res.closed.push(s.closed);
      s.open.forEach(function (r) { res.open.push(r); });
    });
    return res;
  }

  /* ---------- page 1: the template ---------- */

  function displayUrl(url) { return String(url).replace(/^https?:\/\//, '').replace(/\/$/, ''); }

  function qrItems(url, x, y, module) {
    var q = Q.encode(url), ops = [];
    for (var r = 0; r < q.size; r++) for (var c = 0; c < q.size; c++) if (q.modules[r][c]) {
      var px = x + c * module, py = y + r * module;
      ops.push(['M', px, py], ['L', px + module, py], ['L', px + module, py + module], ['L', px, py + module], ['Z']);
    }
    return { item: { t: 'path', d: ops, fill: INK }, size: q.size * module };
  }

  function header(items, title, info, o) {
    items.push(text(36, 40, o.appName, 20, { font: 'F2' }));
    items.push(text(36 + PDF.textWidth(o.appName, 'F2', 20) + 8, 40, title, 10, { fill: MUTED }));
    if (o.name) {
      items.push(text(380, 40, 'Name', 9, { fill: MUTED }));
      items.push(line(410, 41, 576, 41, { stroke: INK, lw: 0.6 }));
    }
    return items;
  }

  function templatePage(analysis, info, o) {
    var n = analysis.doc.arms, items = [], out = outlines(analysis), rays = foldRays(n), al = Math.PI / n, a0 = G.leftEdgeAngle(n);

    header(items, 'fold-and-cut template', info, o);
    items.push(text(36, 58, info.arms + ' arms · ' + info.layers + ' layers · ' + info.wedgeDeg + '° wedge', 10, { fill: MUTED }));
    items.push(text(36, 72, 'Difficulty ' + info.score + '/10 (' + info.label + ') · Best tool: ' + info.toolName, 10, { fill: MUTED }));
    items.push(text(36, 88, '1  Cut out the circle.   2  Fold on the dashed lines, in number order.   3  Cut on the black lines.   4  Unfold.', 9, { fill: INK }));

    items.push({ t: 'path', d: sectorOps(CX, CY, 270, a0, a0 + al), fill: TINT });                 // the wedge that ends up on top
    if (o.shade && out.shade.length) {
      var ops = [];
      out.shade.forEach(function (l) { ops = ops.concat(polyOps(l.map(function (p) { return [X(p[0]), Y(p[1])]; }), true)); });
      items.push({ t: 'path', d: ops, fill: SHADE, evenodd: true });
    }
    items.push({ t: 'path', d: sectorOps(CX, CY, 270, a0, a0 + al), stroke: BLUE, lw: 1.8, join: 'round' });    // frame it, shaded or not
    items.push({ t: 'path', d: circleOps(CX, CY, 270), stroke: INK, lw: 1.2 });
    rays.forEach(function (r) {
      items.push(line(CX, CY, CX + 270 * Math.cos(r.angle), CY + 270 * Math.sin(r.angle), { stroke: LINE, lw: 0.9, dash: DASH[r.step] }));
    });
    out.closed.forEach(function (l) {
      items.push({ t: 'path', d: polyOps(l.map(function (p) { return [X(p[0]), Y(p[1])]; }), true), stroke: INK, lw: 1.3, join: 'round', cap: 'round' });
    });
    out.open.forEach(function (l) {
      items.push({ t: 'path', d: polyOps(l.map(function (p) { return [X(p[0]), Y(p[1])]; }), false), stroke: INK, lw: 1.3, join: 'round', cap: 'round' });
    });
    items.push(line(CX - 5, CY, CX + 5, CY, { lw: 0.8 }), line(CX, CY - 5, CX, CY + 5, { lw: 0.8 }));
    rays.forEach(function (r) {                                                                   // step number chips on the rim
      var cx = CX + 281 * Math.cos(r.angle), cy = CY + 281 * Math.sin(r.angle);
      items.push({ t: 'path', d: circleOps(cx, cy, 6.5), fill: '#ffffff', stroke: LINE, lw: 0.8 });
      items.push(text(cx, cy + 3, String(r.step), 8.5, { font: 'F2', anchor: 'middle' }));
    });

    // legend
    var ly = 714;
    items.push(line(36, ly - 3, 60, ly - 3, { lw: 1.3, cap: 'round' }), text(68, ly, 'Cut on these lines', 8.5));
    var row = 1;
    if (o.shade) {
      items.push({ t: 'path', d: polyOps([[36, ly + 14 * row - 8], [60, ly + 14 * row - 8], [60, ly + 14 * row], [36, ly + 14 * row]], true), fill: SHADE, stroke: FAINT, lw: 0.5 });
      items.push(text(68, ly + 14 * row, 'Gray is paper that gets cut away', 8.5));
      row++;
    }
    items.push(line(36, ly + 14 * row - 3, 60, ly + 14 * row - 3, { stroke: LINE, lw: 0.9, dash: [5, 3] }), text(68, ly + 14 * row, 'Fold lines (1, then 2, then 3)', 8.5));
    row++;
    items.push({ t: 'path', d: polyOps([[36, ly + 14 * row - 8], [60, ly + 14 * row - 8], [60, ly + 14 * row], [36, ly + 14 * row]], true), fill: TINT, stroke: BLUE, lw: 1 });
    items.push(text(68, ly + 14 * row, 'Blue wedge ends up on top', 8.5));

    // scale bar: exactly one inch
    var bx = 254, by = 722;
    items.push(line(bx, by, bx + 72, by, { lw: 1.2 }), line(bx, by - 4, bx, by + 4, { lw: 1.2 }), line(bx + 72, by - 4, bx + 72, by + 4, { lw: 1.2 }));
    items.push(text(bx + 36, by + 15, '1 inch = 2.54 cm', 8, { anchor: 'middle', fill: MUTED }));
    items.push(text(bx + 36, by + 28, 'Print at 100% (Actual size)', 8, { anchor: 'middle', font: 'F2' }));

    // QR code and where it leads
    var qr = qrItems(o.siteUrl, 518, 702, 2);
    items.push(qr.item);
    items.push(text(504, 726, 'Design your own:', 8, { anchor: 'end', fill: MUTED }));
    items.push(text(504, 738, displayUrl(o.siteUrl), 8, { anchor: 'end', font: 'F2' }));

    return { w: PAGE_W, h: PAGE_H, items: items };
  }

  /* ---------- page 2: the fold guide ---------- */

  function foldDiagram(items, n, cx, cy, r, step) {
    var rays = foldRays(n), al = Math.PI / n, a0 = G.leftEdgeAngle(n);
    items.push({ t: 'path', d: sectorOps(cx, cy, r, a0, a0 + al), fill: TINT, stroke: BLUE, lw: 1 });
    rays.forEach(function (ray) {
      var on = ray.step === step;
      items.push(line(cx, cy, cx + r * Math.cos(ray.angle), cy + r * Math.sin(ray.angle),
        on ? { stroke: INK, lw: 1.4, dash: DASH[step] } : { stroke: FAINT, lw: 0.6 }));
    });
    items.push({ t: 'path', d: circleOps(cx, cy, r), stroke: INK, lw: 0.9 });
  }

  function foldedShape(items, cx, cy, r, deg) {
    var half = deg * Math.PI / 360, tipY = cy + r / 2;
    items.push({ t: 'path', d: sectorOps(cx, tipY, r, -Math.PI / 2 - half, -Math.PI / 2 + half), fill: TINT, stroke: INK, lw: 1.1, join: 'round' });
  }

  function guidePage(analysis, info, o) {
    var n = analysis.doc.arms, items = [], steps = foldStepsInfo(n);
    header(items, 'fold guide', info, Object.assign({}, o, { name: false }));
    items.push(text(36, 62, 'Folding is half the magic. Take your time, crease firmly, and keep the blue wedge in front.', 10, { fill: MUTED }));
    steps.forEach(function (s, i) {
      var y0 = 88 + i * 180, cy = y0 + 66, r = 54;
      items.push(text(36, y0 + 4, 'Step ' + s.step, 14, { font: 'F2' }));
      foldDiagram(items, n, 100, cy + 6, r, s.step);
      items.push(text(100, cy + r + 20, 'Fold on the bold lines', 8, { anchor: 'middle', fill: MUTED }));
      items.push({ t: 'path', d: [['M', 176, cy + 6], ['L', 204, cy + 6], ['M', 197, cy], ['L', 204, cy + 6], ['L', 197, cy + 12]], stroke: LINE, lw: 1.2, cap: 'round', join: 'round' });
      foldedShape(items, 276, cy, r, s.shape);
      items.push(text(276, cy + r + 20, s.shapeName + ' · ' + s.layers + ' layers', 8, { anchor: 'middle', fill: MUTED }));
      wrap(s.text, 'F1', 10.5, 214).forEach(function (ln, k) { items.push(text(362, y0 + 30 + k * 14, ln, 10.5)); });
    });

    var ty = 640;
    items.push(line(36, ty - 14, 576, ty - 14, { stroke: FAINT, lw: 0.6 }));
    items.push(text(36, ty, 'Cutting tips', 12, { font: 'F2' }));
    var tips = ['Use: ' + info.toolName + '. ' + info.toolNote,
      'Cut along the black lines on the top layer. The curved rim is the edge of the paper, so cut right through it where the lines reach it.'];
    if (info.interior > 0) tips.push('Some cutouts sit in the middle of the paper. Start each with a small snip through every layer using the scissor tip (or a craft knife on a cutting mat), then cut out to the line.');
    tips.push('Turn the paper, not the scissors, and go slowly around curves.');
    tips.push('Unfold gently and press flat under a heavy book. Check the scale bar on page 1: it should measure exactly one inch when printed.');
    var yy = ty + 18;
    tips.forEach(function (t) {
      wrap(t, 'F1', 10, 520).forEach(function (ln, k) { items.push(text(k ? 48 : 36, yy, (k ? '' : '- ') + ln, 10)); yy += 13.5; });
    });
    return { w: PAGE_W, h: PAGE_H, items: items };
  }

  /* ---------- public API ---------- */

  /**
   * analysis: the result of analyze(doc). opts: { guide (default true), shade (true), name (true),
   * siteUrl, appName }. Returns { pages: [...], info }.
   */
  function layout(analysis, opts) {
    opts = opts || {};
    var o = {
      guide: opts.guide !== false, shade: opts.shade !== false, name: opts.name !== false,
      siteUrl: opts.siteUrl || CFG.siteUrl, appName: opts.appName || CFG.appName
    };
    var n = analysis.doc.arms, gi = G.groupInfo(n), rep = analysis.report;
    var info = {
      arms: n, layers: gi.order, wedgeDeg: gi.wedgeDeg, score: rep.score, label: rep.label,
      toolName: rep.tool.name, toolNote: rep.tool.note, interior: analysis.stats.interiorHoles, siteUrl: o.siteUrl
    };
    var pages = [templatePage(analysis, info, o)];
    if (o.guide) pages.push(guidePage(analysis, info, o));
    return { pages: pages, info: info };
  }

  function r2(v) { return Math.round(v * 100) / 100; }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  /** One page as an SVG string, 8.5 x 11 inches. Text goes through the same cleaning as the PDF. */
  function toSVG(page) {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + page.w + ' ' + page.h + '" width="8.5in" height="11in" font-family="Helvetica, Arial, sans-serif">' +
      '<rect width="' + page.w + '" height="' + page.h + '" fill="#fff"/>';
    page.items.forEach(function (it) {
      if (it.t === 'path') {
        var d = it.d.map(function (op) {
          return op[0] + op.slice(1).map(r2).join(' ');
        }).join('');
        s += '<path d="' + d + '" fill="' + (it.fill || 'none') + '"' + (it.evenodd ? ' fill-rule="evenodd"' : '');
        if (it.stroke) {
          s += ' stroke="' + it.stroke + '" stroke-width="' + (it.lw === undefined ? 1 : it.lw) + '" stroke-linecap="' + (it.cap === 'round' ? 'round' : 'butt') +
            '" stroke-linejoin="' + (it.join === 'round' ? 'round' : 'miter') + '"';
          if (it.dash && it.dash.length) s += ' stroke-dasharray="' + it.dash.join(' ') + '"';
        }
        s += '/>';
      } else if (it.t === 'text') {
        s += '<text x="' + r2(it.x) + '" y="' + r2(it.y) + '" font-size="' + it.size + '"' + (it.font === 'F2' ? ' font-weight="bold"' : '') +
          ' fill="' + (it.fill || '#000') + '" text-anchor="' + (it.anchor === 'middle' ? 'middle' : it.anchor === 'end' ? 'end' : 'start') + '">' + esc(PDF.clean(it.s)) + '</text>';
      }
    });
    return s + '</svg>';
  }

  /** The pages as a PDF file (Uint8Array). */
  function toPDF(pages, meta) { return PDF.build(pages, meta || { title: CFG.appName + ' template', author: CFG.appName }); }

  function fileName(doc) { return 'flake-lab-' + doc.arms + 'arm-template.pdf'; }

  return {
    layout: layout, toSVG: toSVG, toPDF: toPDF, fileName: fileName,
    outlines: outlines, splitRim: splitRim, foldRays: foldRays, foldStepsInfo: foldStepsInfo,
    PAGE_W: PAGE_W, PAGE_H: PAGE_H, DISC_CENTER: [CX, CY], PT_PER_UNIT: K
  };
});
