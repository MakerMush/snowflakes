/*
 * geometry.js - the math under the whole app. Pure functions, no DOM.
 *
 * Conventions
 *  - Units: the paper disc has radius R = 100 units (printed at 3.75 in, so 1 unit = 0.0375 in).
 *  - Screen-style coordinates: x to the right, y DOWN. The folded wedge points UP:
 *    its tip (the paper's center) is at (0,0) and the outer edge arcs across the top.
 *  - n = number of arms (4 or 6). The folded wedge angle is 180/n degrees and the
 *    unfolded paper has 2n layers (the dihedral group D_n, which has order 2n).
 *  - Affine matrices are arrays [a,b,c,d,e,f], same order as SVG matrix(a b c d e f):
 *      x' = a*x + c*y + e      y' = b*x + d*y + f
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.SF = root.SF || {}; root.SF.geometry = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R = 100;
  var DEG = Math.PI / 180;
  var TAU = Math.PI * 2;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---------- wedge basics ---------- */

  function wedgeAngle(n) { return Math.PI / n; }          // full wedge angle, radians
  function halfAngle(n) { return Math.PI / (2 * n); }
  function layerCount(n) { return 2 * n; }

  /** Polygon (array of [x,y]) for the wedge: tip, then the arc from left to right. */
  function wedgePolygon(n, r, steps, pad) {
    r = r == null ? R : r;
    steps = steps || 32;
    var H = halfAngle(n) + (pad || 0);
    var pts = [[0, 0]];
    for (var i = 0; i <= steps; i++) {
      var t = -H + (2 * H * i) / steps;
      pts.push([r * Math.sin(t), -r * Math.cos(t)]);
    }
    return pts;
  }

  function r4(v) { return Math.round(v * 10000) / 10000; }

  /** SVG path for the wedge (true arc). pad widens each edge by that many radians. */
  function wedgePathD(n, r, pad) {
    r = r == null ? R : r;
    var H = halfAngle(n) + (pad || 0);
    var lx = -r * Math.sin(H), ly = -r * Math.cos(H);
    var rx = r * Math.sin(H);
    return 'M0 0L' + r4(lx) + ' ' + r4(ly) + 'A' + r4(r) + ' ' + r4(r) + ' 0 0 1 ' + r4(rx) + ' ' + r4(ly) + 'Z';
  }

  /**
   * The wedge with both straight edges pushed outward by a constant distance d. Drawing each
   * mirrored copy with this slightly fatter wedge makes neighbours overlap by 2d everywhere,
   * including near the tip, so antialiasing never leaves a hairline of paper on a fold.
   */
  function wedgeOffsetParts(n, r, d) {
    var H = halfAngle(n), sH = Math.sin(H), cH = Math.cos(H);
    var a = d / sH;                                          // the tip moves down the axis by d / sin(H)
    var s = a * cH + Math.sqrt(r * r - a * a * sH * sH);     // where each offset edge meets the arc
    return { apex: [0, a], left: [-s * sH, a - s * cH], right: [s * sH, a - s * cH], r: r };
  }
  function wedgeOffsetPolygon(n, r, d, steps) {
    var q = wedgeOffsetParts(n, r, d), N = steps || 32;
    var pts = [q.apex, q.left];
    // the arc is centred on the true tip (0,0), running from the left end to the right end over the top
    var start = Math.atan2(q.left[0], -q.left[1]), end = Math.atan2(q.right[0], -q.right[1]);
    for (var i = 1; i < N; i++) {
      var t = start + ((end - start) * i) / N;
      pts.push([r * Math.sin(t), -r * Math.cos(t)]);
    }
    pts.push(q.right);
    return pts;
  }
  function wedgeOffsetPathD(n, r, d) {
    var q = wedgeOffsetParts(n, r, d);
    return 'M' + r4(q.apex[0]) + ' ' + r4(q.apex[1]) + 'L' + r4(q.left[0]) + ' ' + r4(q.left[1]) +
      'A' + r4(r) + ' ' + r4(r) + ' 0 0 1 ' + r4(q.right[0]) + ' ' + r4(q.right[1]) + 'Z';
  }

  function inWedge(n, p, r) {
    r = r == null ? R : r;
    var x = p[0], y = p[1];
    if (Math.hypot(x, y) > r + 1e-9) return false;
    if (x === 0 && y === 0) return true;
    if (y > 1e-9) return false;
    return Math.abs(Math.atan2(x, -y)) <= halfAngle(n) + 1e-9;
  }

  /** Width of the wedge (half) at a given distance "depth" up the center axis. */
  function wedgeHalfWidthAt(n, depth) { return Math.abs(depth) * Math.tan(halfAngle(n)); }

  /** SVG-space angle (radians, atan2 convention) of the wedge's left edge. */
  function leftEdgeAngle(n) {
    var h = halfAngle(n);
    return Math.atan2(-Math.cos(h), -Math.sin(h));
  }

  /* ---------- affine matrices ---------- */

  var IDENT = [1, 0, 0, 1, 0, 0];

  /** Compose: result applies B first, then A. */
  function mul(A, B) {
    return [
      A[0] * B[0] + A[2] * B[1],
      A[1] * B[0] + A[3] * B[1],
      A[0] * B[2] + A[2] * B[3],
      A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4],
      A[1] * B[4] + A[3] * B[5] + A[5]
    ];
  }
  function apply(m, p) { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; }
  function invert(m) {
    var det = m[0] * m[3] - m[1] * m[2];
    var a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  }
  function rotation(t) { var c = Math.cos(t), s = Math.sin(t); return [c, s, -s, c, 0, 0]; }
  /** Reflection across the line through the origin at angle beta. */
  function reflection(beta) { var c = Math.cos(2 * beta), s = Math.sin(2 * beta); return [c, s, s, -c, 0, 0]; }
  function translation(x, y) { return [1, 0, 0, 1, x, y]; }
  function scaling(sx, sy) { return [sx, 0, 0, sy, 0, 0]; }

  function r6(v) { return Math.round(v * 1e6) / 1e6; }
  function matrixStr(m) { return 'matrix(' + m.map(r6).join(' ') + ')'; }

  /* ---------- the unfold: 2n copies of the wedge ---------- */

  var copyCache = {};
  /**
   * The 2n transforms that unfold the wedge into the full disc. copies(n)[k] maps the base
   * wedge onto sector k (sector 0 is the base wedge, then going clockwise on screen).
   * Even sectors are rotations of the wedge; odd sectors are mirror images.
   */
  function copies(n) {
    if (copyCache[n]) return copyCache[n];
    var a = wedgeAngle(n), refl0 = reflection(leftEdgeAngle(n)), out = [];
    for (var k = 0; k < 2 * n; k++) {
      var m = (k % 2 === 0) ? rotation(k * a) : mul(rotation((k + 1) * a), refl0);
      out.push({ k: k, m: m, inv: invert(m), mirrored: k % 2 === 1 });
    }
    copyCache[n] = out;
    return out;
  }

  /** Facts a geometry class can use: symmetry group, mirror lines, angles. */
  function groupInfo(n) {
    var a = wedgeAngle(n), b0 = leftEdgeAngle(n), lines = [];
    for (var j = 0; j < n; j++) lines.push(b0 + j * a);
    return {
      arms: n,
      order: 2 * n,                    // number of layers = size of the symmetry group
      rotations: n,                    // rotational symmetries (including the identity)
      mirrorLines: n,
      wedgeDeg: 180 / n,               // angle of the folded wedge
      rotationStepDeg: 360 / n,        // smallest rotation that maps the flake to itself
      mirrorLineAnglesRad: lines,      // SVG-space angles of the mirror lines
      groupName: 'D' + n               // dihedral group
    };
  }

  function sectorIndex(n, p) {
    var a = wedgeAngle(n);
    var t = Math.atan2(p[1], p[0]) - leftEdgeAngle(n);
    t = ((t % TAU) + TAU) % TAU;
    var k = Math.floor(t / a + 1e-9);
    return k >= 2 * n ? 0 : k;
  }

  /** Fold any point of the disc back into the base wedge. */
  function foldToWedge(n, p) {
    return apply(copies(n)[sectorIndex(n, p)].inv, p);
  }

  /** The 2n images of a wedge point across the unfolded paper. */
  function orbit(n, p) { return copies(n).map(function (c) { return apply(c.m, p); }); }

  /* ---------- objects ---------- */

  /**
   * Matrix taking a shape's normalized coordinates (unit box centered at 0) to wedge
   * coordinates: translate(x,y) * rotate(rot) * scale(+-sx, sy).
   */
  function objectMatrix(o) {
    var T = translation(o.x, o.y);
    var Rm = rotation((o.rot || 0) * DEG);
    var S = scaling(o.flip ? -o.sx : o.sx, o.sy);
    return mul(T, mul(Rm, S));
  }

  /* ---------- polygon helpers ---------- */

  function polygonArea(pts) {
    var a = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += (pts[j][0] * pts[i][1]) - (pts[i][0] * pts[j][1]);
    }
    return a / 2;
  }

  function polygonBBox(pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 };
  }

  /** Even-odd point test against a list of polygons (so holes work). */
  function pointInPolys(polys, x, y) {
    var inside = false;
    for (var k = 0; k < polys.length; k++) {
      var poly = polys[k];
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  function orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
  function properCross(a, b, c, d) {
    var o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    return o1 * o2 < 0 && o3 * o4 < 0;
  }
  /** True when no two non-adjacent edges of the polygon cross each other. */
  function isSimplePolygon(pts) {
    var n = pts.length;
    if (n < 3) return false;
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        if (properCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
      }
    }
    return true;
  }

  return {
    R: R, DEG: DEG, TAU: TAU, clamp: clamp,
    wedgeAngle: wedgeAngle, halfAngle: halfAngle, layerCount: layerCount,
    wedgePolygon: wedgePolygon, wedgePathD: wedgePathD, inWedge: inWedge,
    wedgeOffsetPolygon: wedgeOffsetPolygon, wedgeOffsetPathD: wedgeOffsetPathD,
    wedgeHalfWidthAt: wedgeHalfWidthAt, leftEdgeAngle: leftEdgeAngle,
    IDENT: IDENT, mul: mul, apply: apply, invert: invert,
    rotation: rotation, reflection: reflection, translation: translation, scaling: scaling,
    matrixStr: matrixStr,
    copies: copies, groupInfo: groupInfo, sectorIndex: sectorIndex,
    foldToWedge: foldToWedge, orbit: orbit,
    objectMatrix: objectMatrix,
    polygonArea: polygonArea, polygonBBox: polygonBBox, pointInPolys: pointInPolys,
    isSimplePolygon: isSimplePolygon
  };
});
