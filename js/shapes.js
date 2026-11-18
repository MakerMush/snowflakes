/*
 * shapes.js - the built-in shape library.
 *
 * Every shape is stored as a list of polygons (so shapes with holes work later, drawn
 * even-odd) and is normalized to fill the unit box [-0.5, 0.5] x [-0.5, 0.5]. The original
 * proportions are kept in `aspect` (width / height). An object on the wedge then only needs
 * sx and sy (its width and height in wedge units) to place the shape.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.SF = root.SF || {}; root.SF.shapes = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAU = Math.PI * 2;

  function regular(n, start) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (start == null ? -Math.PI / 2 : start) + (TAU * i) / n;
      pts.push([Math.cos(a), Math.sin(a)]);
    }
    return pts;
  }

  function star(points, outer, inner) {
    var pts = [];
    for (var i = 0; i < points * 2; i++) {
      var r = i % 2 === 0 ? outer : inner;
      var a = -Math.PI / 2 + (Math.PI * i) / points;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return pts;
  }

  function dome() {
    var pts = [], N = 18;
    for (var i = 0; i <= N; i++) {
      var a = Math.PI + (Math.PI * i) / N;
      pts.push([Math.cos(a), Math.sin(a)]);
    }
    return pts;
  }

  function teardrop() {
    var pts = [], N = 44;
    for (var i = 0; i < N; i++) {
      var t = (TAU * i) / N;
      pts.push([Math.sin(t) * Math.pow(Math.sin(t / 2), 1.3), -Math.cos(t)]);
    }
    return pts;
  }

  function heart() {
    var pts = [], N = 56;
    for (var i = 0; i < N; i++) {
      var t = (TAU * i) / N;
      pts.push([
        16 * Math.pow(Math.sin(t), 3),
        -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
      ]);
    }
    return pts;
  }

  function crescent() {
    var r1 = 1, r2 = 0.8, d = 0.5, N = 28, i, a;
    var x = (d * d + r1 * r1 - r2 * r2) / (2 * d);
    var y = Math.sqrt(r1 * r1 - x * x);
    var phi = Math.atan2(y, x);
    var psi = Math.atan2(y, x - d);
    var pts = [];
    for (i = 0; i <= N; i++) {            // outer arc, the long way around the left side
      a = phi + ((TAU - 2 * phi) * i) / N;
      pts.push([r1 * Math.cos(a), r1 * Math.sin(a)]);
    }
    for (i = 1; i < N; i++) {             // inner arc back, through the bite
      a = -psi + ((2 * psi - TAU) * i) / N;
      pts.push([d + r2 * Math.cos(a), r2 * Math.sin(a)]);
    }
    return pts;
  }

  function petal() {
    var right = [], left = [], N = 22;
    for (var i = 0; i <= N; i++) {
      var t = i / N, y = -1 + 2 * t, x = 0.5 * Math.sin(Math.PI * t);
      right.push([x, y]);
      if (i > 0 && i < N) left.unshift([-x, y]);
    }
    return right.concat(left);
  }

  function capsule() {
    var pts = [], N = 14, i, a;
    for (i = 0; i <= N; i++) { a = Math.PI + (Math.PI * i) / N; pts.push([0.5 * Math.cos(a), -0.5 + 0.5 * Math.sin(a)]); }
    for (i = 0; i <= N; i++) { a = (Math.PI * i) / N; pts.push([0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]); }
    return pts;
  }

  var RAW = [
    ['circle', 'Circle', [regular(40, 0)]],
    ['dome', 'Dome', [dome()]],
    ['triangle', 'Triangle', [[[0, -1], [0.866, 0.5], [-0.866, 0.5]]]],
    ['square', 'Square', [[[-1, -1], [1, -1], [1, 1], [-1, 1]]]],
    ['diamond', 'Diamond', [[[0, -1], [0.6, 0], [0, 1], [-0.6, 0]]]],
    ['pentagon', 'Pentagon', [regular(5)]],
    ['hexagon', 'Hexagon', [regular(6, 0)]],
    ['star', 'Star', [star(5, 1, 0.42)]],
    ['snowstar', 'Snow star', [star(6, 1, 0.5)]],
    ['sparkle', 'Sparkle', [star(4, 1, 0.2)]],
    ['teardrop', 'Teardrop', [teardrop()]],
    ['heart', 'Heart', [heart()]],
    ['crescent', 'Crescent', [crescent()]],
    ['petal', 'Petal', [petal()]],
    ['chevron', 'Chevron', [[[-1, 0.2], [0, -0.8], [1, 0.2], [1, 0.8], [0, -0.2], [-1, 0.8]]]],
    ['cross', 'Cross', [[[-0.25, -1], [0.25, -1], [0.25, -0.25], [1, -0.25], [1, 0.25], [0.25, 0.25],
      [0.25, 1], [-0.25, 1], [-0.25, 0.25], [-1, 0.25], [-1, -0.25], [-0.25, -0.25]]]],
    ['capsule', 'Capsule', [capsule()]],
    ['spike', 'Spike', [[[0, -1], [0.25, 1], [-0.25, 1]]]],
    ['bolt', 'Bolt', [[[0.2, -1], [-0.6, 0.1], [-0.05, 0.1], [-0.25, 1], [0.6, -0.2], [0.05, -0.2]]]]
  ];

  function round4(v) { return Math.round(v * 10000) / 10000; }

  /** Scale polygons to fill [-0.5,0.5]^2 and report the original aspect ratio. */
  function normalize(polys) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    polys.forEach(function (poly) {
      poly.forEach(function (p) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      });
    });
    var w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return {
      polys: polys.map(function (poly) {
        return poly.map(function (p) { return [round4((p[0] - cx) / w), round4((p[1] - cy) / h)]; });
      }),
      aspect: round4(w / h)
    };
  }

  var list = RAW.map(function (r) {
    var n = normalize(r[2]);
    return { id: r[0], name: r[1], polys: n.polys, aspect: n.aspect };
  });
  var byId = {};
  list.forEach(function (s) { byId[s.id] = s; });

  function get(id) { return byId[id] || null; }

  /* Kid mode offers only the rounded and chunky shapes. Pointy ones (stars, sparkle, triangle, diamond...) have tips
     narrower than kid scissors can cut, so they came up red the moment they landed (a test keeps this list clean). */
  var KID_IDS = ['circle', 'dome', 'square', 'pentagon', 'hexagon', 'heart', 'capsule'];
  var kidList = KID_IDS.map(get);

  /** The shape data for an object: a library shape, or inline polys (traced photos, later). */
  function resolve(o) {
    if (o && o.polys) return { id: null, name: o.name || 'Traced shape', polys: o.polys, aspect: o.aspect || 1 };
    return o ? get(o.shapeId) : null;
  }

  /** Width and height (longest side = 1) that keep a shape's original proportions. */
  function fit(aspect) { return aspect >= 1 ? { sx: 1, sy: 1 / aspect } : { sx: aspect, sy: 1 }; }

  var pathCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  /** SVG path data (normalized coordinates) for a resolved shape. */
  function pathD(shape) {
    if (pathCache && pathCache.has(shape.polys)) return pathCache.get(shape.polys);
    var d = shape.polys.map(function (poly) {
      return 'M' + poly.map(function (p) { return p[0] + ' ' + p[1]; }).join('L') + 'Z';
    }).join('');
    if (pathCache) pathCache.set(shape.polys, d);
    return d;
  }

  return { list: list, kidList: kidList, get: get, resolve: resolve, fit: fit, pathD: pathD, normalize: normalize };
});
