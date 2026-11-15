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
    var n = doc.arms, R = G.R, build = doc.mode === 'build';
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
          '<circle r="' + R + '" fill="' + (build ? '#000' : '#fff') + '"/>' + uses + hub +
        '</mask>' +
      '</defs>' +
      '<rect x="-110" y="-110" width="220" height="220" fill="' + bg + '"/>' +
      '<circle r="' + R + '" fill="' + paper + '" mask="url(#' + id + '-mask)"/>' +
      (build ? '<circle r="' + R + '" fill="none" stroke="#3a4a5a" stroke-width="0.5" stroke-dasharray="1.6 2.2"/>' : '') +
      (opts.overlayHref ? '<image href="' + opts.overlayHref + '" x="-100" y="-100" width="200" height="200" preserveAspectRatio="none"/>' : '') +
      folds;
  }

  /**
   * The unfold as separate pieces, so geometry mode can animate it. Returns a controller:
   *   setUnfold(p)   p from 0 (only the folded wedge) to 2n-1 (fully open); fractions are a sector swinging open
   *   setWorld(m)    a matrix applied to the whole flake (rotation or mirror demos)
   *   setMirrors(on) show the n mirror lines
   * The last frame matches render() exactly. opts: idPrefix, bg, paper.
   */
  function renderFlaps(svg, doc, opts) {
    opts = opts || {};
    var id = opts.idPrefix || 'fl', bg = opts.bg || '#0f161d', paper = opts.paper || '#ffffff';
    var n = doc.arms, R = G.R, build = doc.mode === 'build', N = 2 * n;
    var wedge = G.wedgeOffsetPathD(n, R + 1.5, SEAM_PAD);
    var content = doc.objects.map(function (o) {
      var sh = S.resolve(o);
      if (!sh) return '';
      return '<path d="' + S.pathD(sh) + '" transform="' + G.matrixStr(G.objectMatrix(o)) +
        '" fill="' + (o.role === 'keep' ? '#fff' : '#000') + '" fill-rule="evenodd"/>';
    }).join('');
    var hub = doc.hub && doc.hubR > 0 ? '<circle r="' + f(doc.hubR) + '" fill="#fff"/>' : '';
    var flaps = '';
    for (var k = 0; k < N; k++) flaps += '<path id="' + id + '-f' + k + '" d="' + wedge + '" fill="' + paper + '" mask="url(#' + id + '-m)"' + (k ? ' visibility="hidden"' : '') + '/>';
    var whole = G.copies(n).map(function (c) { return '<use href="#' + id + '-wc" transform="' + G.matrixStr(c.m) + '"/>'; }).join('');
    var lines = '', b0 = G.leftEdgeAngle(n), a = G.wedgeAngle(n);
    for (var j = 0; j < n; j++) {
      var t = b0 + j * a;
      lines += 'M' + f(-(R + 4) * Math.cos(t)) + ' ' + f(-(R + 4) * Math.sin(t)) + 'L' + f((R + 4) * Math.cos(t)) + ' ' + f((R + 4) * Math.sin(t));
    }
    svg.setAttribute('viewBox', '-108 -108 216 216');
    svg.innerHTML =
      '<defs>' +
        '<clipPath id="' + id + '-c"><path d="' + wedge + '"/></clipPath>' +
        '<mask id="' + id + '-m" maskUnits="userSpaceOnUse" x="-110" y="-110" width="220" height="220">' +
          '<rect x="-110" y="-110" width="220" height="220" fill="#000"/>' +
          '<g clip-path="url(#' + id + '-c)">' + (build ? '' : '<path d="' + wedge + '" fill="#fff"/>') + content + hub + '</g>' +
        '</mask>' +
        '<g id="' + id + '-wc" clip-path="url(#' + id + '-c)">' + content + '</g>' +
        '<mask id="' + id + '-m2" maskUnits="userSpaceOnUse" x="-110" y="-110" width="220" height="220">' +
          '<rect x="-110" y="-110" width="220" height="220" fill="#000"/>' +
          '<circle r="' + R + '" fill="' + (build ? '#000' : '#fff') + '"/>' + whole + hub +
        '</mask>' +
      '</defs>' +
      '<rect x="-110" y="-110" width="220" height="220" fill="' + bg + '"/>' +
      '<circle r="' + R + '" fill="none" stroke="#3a4a5a" stroke-width="0.5" stroke-dasharray="1.6 2.2"/>' +
      '<g id="' + id + '-w">' + flaps +
        '<circle id="' + id + '-whole" r="' + R + '" fill="' + paper + '" mask="url(#' + id + '-m2)" visibility="hidden"/>' +
        '<path id="' + id + '-flag" d="M0 -84V-98L9 -91Z" fill="#5aa3d4" stroke="#0a0e13" stroke-width="0.6" stroke-linejoin="round" visibility="hidden"/>' +
      '</g>' +
      '<path id="' + id + '-ml" d="' + lines + '" fill="none" stroke="#5fa8cf" stroke-width="0.6" stroke-dasharray="3 2" visibility="hidden"/>' +
      '<path id="' + id + '-hinge" d="M0 0" fill="none" stroke="#5aa3d4" stroke-width="1.2" stroke-linecap="round" visibility="hidden"/>';

    var els = [], i;
    for (i = 0; i < N; i++) els.push(svg.querySelector('#' + id + '-f' + i));
    var wholeEl = svg.querySelector('#' + id + '-whole'), world = svg.querySelector('#' + id + '-w'), hinge = svg.querySelector('#' + id + '-hinge'), flag = svg.querySelector('#' + id + '-flag'), ml = svg.querySelector('#' + id + '-ml');

    function setUnfold(p) {
      p = G.clamp(p, 0, N - 1);
      var open = p >= N - 1 - 1e-9;                         // fully open: show the one-piece disc, which has no seams at all
      wholeEl.setAttribute('visibility', open ? 'visible' : 'hidden');
      els[0].setAttribute('visibility', open ? 'hidden' : 'visible');
      for (var k = 1; k < N; k++) {
        var u = G.clamp(p - (k - 1), 0, 1), el = els[k];
        if (u <= 0 || open) { el.setAttribute('visibility', 'hidden'); continue; }
        el.setAttribute('visibility', 'visible');
        el.setAttribute('transform', G.matrixStr(G.flapMatrix(n, k, 1 - 2 * u)));
      }
      var act = Math.min(N - 1, Math.floor(p + 1e-9) + 1);
      if (p >= N - 1 - 1e-9) hinge.setAttribute('visibility', 'hidden');
      else {
        var t = b0 + act * a;
        hinge.setAttribute('d', 'M0 0L' + f((R + 3) * Math.cos(t)) + ' ' + f((R + 3) * Math.sin(t)));
        hinge.setAttribute('visibility', 'visible');
      }
    }
    function setWorld(m) { world.setAttribute('transform', m ? G.matrixStr(m) : ''); }
    function setMirrors(on) { ml.setAttribute('visibility', on ? 'visible' : 'hidden'); }
    function setFlag(on) { flag.setAttribute('visibility', on ? 'visible' : 'hidden'); }
    setUnfold(0);
    return { setUnfold: setUnfold, setWorld: setWorld, setMirrors: setMirrors, setFlag: setFlag, n: n, count: N };
  }

  root.SF.preview = { render: render, renderFlaps: renderFlaps, SEAM_PAD: SEAM_PAD };
})(typeof self !== 'undefined' ? self : this);
