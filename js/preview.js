/*
 * preview.js - draws the unfolded snowflake.
 *
 * The wedge's shapes are drawn once (black = cut, white = keep), clipped to the wedge, then
 * placed 2n times with the unfold matrices inside an SVG mask. The mask punches the holes in a
 * white paper disc. Everything uses plain attributes (no CSS classes) so the SVG can also be
 * serialized and rasterized on its own, which the print step and the tests rely on.
 */
(function (root) {
  'use strict';
  var G = root.SF.geometry, S = root.SF.shapes;

  /** Overlap (in wedge units) between neighbouring wedges so antialiasing never leaves a hairline on a fold. */
  var SEAM_PAD = 0.2;

  function f(v) { return Math.round(v * 1000) / 1000; }

  /**
   * opts: idPrefix (unique per SVG on the page), showFolds (bool), bg (table color),
   *       paper (paper color), foldColor, overlayHref (problem overlay image, optional).
   */
  function render(svg, doc, opts) {
    opts = opts || {};
    var id = opts.idPrefix || 'pv';
    var bg = opts.bg || '#0f161d';
    var paper = opts.paper || '#ffffff';
    var n = doc.arms, R = G.R;
    var copies = G.copies(n);

    var content = doc.objects.map(function (o) {
      var sh = S.resolve(o);
      if (!sh) return '';
      return '<path d="' + S.pathD(sh) + '" transform="' + G.matrixStr(G.objectMatrix(o)) +
        '" fill="' + (o.role === 'keep' ? '#fff' : '#000') + '" fill-rule="evenodd"/>';
    }).join('');

    var uses = copies.map(function (c) {
      return '<use href="#' + id + '-w" transform="' + G.matrixStr(c.m) + '"/>';
    }).join('');

    var hub = doc.hub && doc.hubR > 0 ? '<circle r="' + f(doc.hubR) + '" fill="#fff"/>' : '';

    var folds = '';
    if (opts.showFolds) {
      var b0 = G.leftEdgeAngle(n), a = G.wedgeAngle(n);
      for (var k = 0; k < 2 * n; k++) {
        var t = b0 + k * a;
        folds += 'M0 0L' + f(R * Math.cos(t)) + ' ' + f(R * Math.sin(t));
      }
      folds = '<path d="' + folds + '" fill="none" stroke="' + (opts.foldColor || '#5fa8cf') +
        '" stroke-width="0.45" stroke-dasharray="2 1.6" opacity="0.9"/>';
    }

    svg.setAttribute('viewBox', '-108 -108 216 216');
    svg.innerHTML =
      '<defs>' +
        '<clipPath id="' + id + '-clip"><path d="' + G.wedgeOffsetPathD(n, R + 1.5, SEAM_PAD) + '"/></clipPath>' +
        '<g id="' + id + '-w" clip-path="url(#' + id + '-clip)">' + content + '</g>' +
        '<mask id="' + id + '-mask" maskUnits="userSpaceOnUse" x="-110" y="-110" width="220" height="220">' +
          '<rect x="-110" y="-110" width="220" height="220" fill="#000"/>' +
          '<circle r="' + R + '" fill="#fff"/>' + uses + hub +
        '</mask>' +
      '</defs>' +
      '<rect x="-110" y="-110" width="220" height="220" fill="' + bg + '"/>' +
      '<circle r="' + R + '" fill="' + paper + '" mask="url(#' + id + '-mask)"/>' +
      (opts.overlayHref ? '<image href="' + opts.overlayHref + '" x="-100" y="-100" width="200" height="200" preserveAspectRatio="none"/>' : '') +
      folds;
  }

  root.SF.preview = { render: render, SEAM_PAD: SEAM_PAD };
})(typeof self !== 'undefined' ? self : this);
