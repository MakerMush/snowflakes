/*
 * sampler.js - answers "is there paper at this point?" for a design, using the same fold
 * math as the preview. Phase 2 (islands, thin features, complexity) will rasterize with this,
 * so what the checks see is exactly what the preview draws.
 */
(function (root, factory) {
  var G, S;
  if (typeof module === 'object' && module.exports) { G = require('./geometry'); S = require('./shapes'); }
  else { G = root.SF.geometry; S = root.SF.shapes; }
  var api = factory(G, S);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.SF.sampler = api; }
})(typeof self !== 'undefined' ? self : this, function (G, S) {
  'use strict';

  var BIG_SHAPE_EDGES = 120;
  var testerCache = typeof WeakMap === 'function' ? new WeakMap() : null;

  /**
   * A point-in-shape test for a list of polygons (even-odd, same rule as G.pointInPolys). Shapes with many
   * edges, such as traced photos, get a horizontal bucket index so each test only looks at the few edges
   * that cross that row instead of all of them.
   */
  function makeTester(polys, bb) {
    var total = 0, k, i;
    for (k = 0; k < polys.length; k++) total += polys[k].length;
    if (total < BIG_SHAPE_EDGES) return function (x, y) { return G.pointInPolys(polys, x, y); };
    if (testerCache && testerCache.has(polys)) return testerCache.get(polys);
    var nb = Math.min(256, Math.max(8, Math.ceil(total / 6))), y0 = bb.y0, span = Math.max(1e-9, bb.y1 - bb.y0);
    var ex1 = new Float64Array(total), ey1 = new Float64Array(total), ex2 = new Float64Array(total), ey2 = new Float64Array(total);
    var buckets = new Array(nb), n = 0;
    for (i = 0; i < nb; i++) buckets[i] = [];
    for (k = 0; k < polys.length; k++) {
      var poly = polys[k];
      for (i = 0; i < poly.length; i++) {
        var a = poly[i], b = poly[i === 0 ? poly.length - 1 : i - 1];
        if (a[1] === b[1]) continue;                       // horizontal edges never count
        ex1[n] = a[0]; ey1[n] = a[1]; ex2[n] = b[0]; ey2[n] = b[1];
        var lo = Math.floor(((Math.min(a[1], b[1]) - y0) / span) * nb), hi = Math.floor(((Math.max(a[1], b[1]) - y0) / span) * nb);
        lo = Math.max(0, Math.min(nb - 1, lo)); hi = Math.max(0, Math.min(nb - 1, hi));
        for (var bk = lo; bk <= hi; bk++) buckets[bk].push(n);
        n++;
      }
    }
    var tester = function (x, y) {
      var bk = Math.floor(((y - y0) / span) * nb);
      if (bk < 0 || bk >= nb) { if (y < y0 || y > bb.y1) return false; bk = Math.max(0, Math.min(nb - 1, bk)); }
      var list = buckets[bk], inside = false;
      for (var j = 0; j < list.length; j++) {
        var e = list[j], yi = ey1[e], yj = ey2[e];
        if ((yi > y) !== (yj > y) && x < ((ex2[e] - ex1[e]) * (y - yi)) / (yj - yi) + ex1[e]) inside = !inside;
      }
      return inside;
    };
    if (testerCache) testerCache.set(polys, tester);
    return tester;
  }

  /**
   * Compile a doc into a fast lookup. paperAt(x, y) in unfolded-disc coordinates returns
   * true (paper), false (cut away) or null (outside the disc).
   */
  function compile(doc) {
    var n = doc.arms;
    var items = [];
    doc.objects.forEach(function (o) {
      var sh = S.resolve(o);
      if (!sh) return;
      var bb = G.polygonBBox([].concat.apply([], sh.polys));      // cheap reject before the exact test
      items.push({ inv: G.invert(G.objectMatrix(o)), inside: makeTester(sh.polys, bb), keep: o.role === 'keep',
        x0: bb.x0, x1: bb.x1, y0: bb.y0, y1: bb.y1 });
    });
    var base = doc.mode !== 'build';                 // Cut mode starts as solid paper, Build mode as nothing
    var hubR2 = doc.hub ? doc.hubR * doc.hubR : -1;
    var R2 = G.R * G.R;

    /** Paper test for a point that is already inside the base wedge (no folding needed). */
    function paperAtWedge(x, y) {
      for (var i = items.length - 1; i >= 0; i--) {   // last painted wins, like the preview
        var it = items[i], m = it.inv;
        var lx = m[0] * x + m[2] * y + m[4], ly = m[1] * x + m[3] * y + m[5];
        if (lx < it.x0 || lx > it.x1 || ly < it.y0 || ly > it.y1) continue;
        if (it.inside(lx, ly)) return it.keep;
      }
      return base;
    }

    function paperAt(x, y) {
      var r2 = x * x + y * y;
      if (r2 > R2) return null;
      if (r2 <= hubR2) return true;
      var q = G.foldToWedge(n, [x, y]);
      return paperAtWedge(q[0], q[1]);
    }
    return { paperAt: paperAt, paperAtWedge: paperAtWedge, hubR2: hubR2 };
  }

  /** Fraction of the paper that is cut away (0..1), sampled on a grid over the wedge. */
  function cutFraction(doc, cols) {
    cols = cols || 64;
    var n = doc.arms, c = compile(doc);
    var step = G.R / cols, total = 0, cut = 0;
    var hw = G.R * Math.sin(G.halfAngle(n));
    for (var y = -G.R + step / 2; y < 0; y += step) {
      for (var x = -hw + step / 2; x < hw; x += step) {
        if (!G.inWedge(n, [x, y])) continue;
        total++;
        if (c.paperAt(x, y) === false) cut++;
      }
    }
    return total ? cut / total : 0;
  }

  return { compile: compile, cutFraction: cutFraction, makeTester: makeTester };
});
