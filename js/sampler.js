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
      items.push({ inv: G.invert(G.objectMatrix(o)), polys: sh.polys, keep: o.role === 'keep',
        x0: bb.x0, x1: bb.x1, y0: bb.y0, y1: bb.y1 });
    });
    var hubR2 = doc.hub ? doc.hubR * doc.hubR : -1;
    var R2 = G.R * G.R;

    /** Paper test for a point that is already inside the base wedge (no folding needed). */
    function paperAtWedge(x, y) {
      for (var i = items.length - 1; i >= 0; i--) {   // last painted wins, like the preview
        var it = items[i], m = it.inv;
        var lx = m[0] * x + m[2] * y + m[4], ly = m[1] * x + m[3] * y + m[5];
        if (lx < it.x0 || lx > it.x1 || ly < it.y0 || ly > it.y1) continue;
        if (G.pointInPolys(it.polys, lx, ly)) return it.keep;
      }
      return true;
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

  return { compile: compile, cutFraction: cutFraction };
});
