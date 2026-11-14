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
      items.push({ inv: G.invert(G.objectMatrix(o)), polys: sh.polys, keep: o.role === 'keep' });
    });
    var hubR2 = doc.hub ? doc.hubR * doc.hubR : -1;
    var R2 = G.R * G.R;

    function paperAt(x, y) {
      var r2 = x * x + y * y;
      if (r2 > R2) return null;
      if (r2 <= hubR2) return true;
      var q = G.foldToWedge(n, [x, y]);
      for (var i = items.length - 1; i >= 0; i--) {   // last painted wins, like the preview
        var it = items[i];
        var l = G.apply(it.inv, q);
        if (G.pointInPolys(it.polys, l[0], l[1])) return it.keep;
      }
      return true;
    }
    return { paperAt: paperAt };
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
