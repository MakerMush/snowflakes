/*
 * trace.js - turns a photo into a cuttable outline.
 *
 * Pipeline (all plain arrays, so it runs in the browser and in node tests):
 *   RGBA pixels -> gray -> blur -> threshold (Otsu "auto" or manual) -> invert?
 *   -> clean up (drop specks, fill pin holes) -> follow the pixel edges into closed loops
 *   -> smooth the loops (Taubin, so shapes do not shrink) -> simplify (Douglas-Peucker).
 *
 * The result is a list of polygons in pixel coordinates. Hole outlines and outer outlines are
 * both just polygons: the editor fills them with the even-odd rule, so holes come out right.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.SF = root.SF || {}; root.SF.trace = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    threshold: null,     // 0..255, pixels darker than this are traced; null = pick automatically (Otsu)
    invert: false,       // trace the light parts instead of the dark parts
    noise: 8,            // 0..40: specks and pin holes smaller than about noise squared pixels disappear
    smoothing: 4,        // 0..10: blur before thresholding and rounding of the outline
    detail: 6,           // 1..10: how closely the outline follows the picture (higher = more points)
    maxPoints: 3000      // never return more points than this in total
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /** RGBA bytes to 0..255 brightness. Transparent pixels count as white paper. */
  function toGray(rgba, w, h) {
    var g = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < g.length; i++, p += 4) {
      var a = rgba[p + 3] / 255;
      var v = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
      g[i] = Math.round(v * a + 255 * (1 - a));
    }
    return g;
  }

  /** Three box blurs of radius r (a close match for a gaussian). r = 0 returns the input. */
  function blur(gray, w, h, r) {
    if (r < 1) return gray;
    var a = new Float32Array(gray), b = new Float32Array(gray.length);
    function pass(src, dst, horizontal) {
      var n = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 1 : w, ls = horizontal ? w : 1;
      var win = 2 * r + 1;
      for (var l = 0; l < lines; l++) {
        var base = l * ls, sum = 0, k;
        for (k = -r; k <= r; k++) sum += src[base + clamp(k, 0, n - 1) * step];
        for (k = 0; k < n; k++) {
          dst[base + k * step] = sum / win;
          sum += src[base + clamp(k + r + 1, 0, n - 1) * step] - src[base + clamp(k - r, 0, n - 1) * step];
        }
      }
    }
    for (var i = 0; i < 3; i++) { pass(a, b, true); pass(b, a, false); }
    var out = new Uint8Array(gray.length);
    for (var j = 0; j < out.length; j++) out[j] = Math.round(a[j]);
    return out;
  }

  /** Otsu's method: the threshold that best separates dark from light. */
  function otsu(gray) {
    var hist = new Float64Array(256), total = gray.length, i;
    for (i = 0; i < total; i++) hist[gray[i]]++;
    var sumAll = 0;
    for (i = 0; i < 256; i++) sumAll += i * hist[i];
    var wB = 0, sumB = 0, best = -1, thr = 128;
    for (var t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB, mF = (sumAll - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t + 1; }      // pixels with gray < thr are "dark"
    }
    return clamp(thr, 1, 255);
  }

  /** 1 where the shape is. Dark pixels by default, light pixels when invert is on. */
  function binarize(gray, threshold, invert) {
    var m = new Uint8Array(gray.length);
    for (var i = 0; i < gray.length; i++) m[i] = (gray[i] < threshold) !== !!invert ? 1 : 0;
    return m;
  }

  /**
   * Label connected regions of `value` in a mask. Returns { labels, count, areas, border } where
   * border[l] is 1 when the region touches the picture edge. conn8 picks 8 or 4 connectivity.
   */
  function label(mask, w, h, value, conn8) {
    var labels = new Int32Array(w * h), stack = new Int32Array(w * h), areas = [0], border = [0], count = 0;
    for (var s = 0; s < labels.length; s++) {
      if (mask[s] !== value || labels[s]) continue;
      count++;
      var sp = 0, area = 0, touches = 0;
      stack[sp++] = s; labels[s] = count;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p - x) / w;
        area++;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = 1;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if ((!dx && !dy) || (!conn8 && dx && dy)) continue;
            var nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            var q = ny * w + nx;
            if (mask[q] === value && !labels[q]) { labels[q] = count; stack[sp++] = q; }
          }
        }
      }
      areas.push(area); border.push(touches);
    }
    return { labels: labels, count: count, areas: areas, border: border };
  }

  /** Remove shape specks smaller than minArea, and fill holes (not touching the edge) smaller than minHole. */
  function clean(mask, w, h, minArea, minHole) {
    var out = new Uint8Array(mask), i;
    if (minArea > 0) {
      var fg = label(out, w, h, 1, true);
      for (i = 0; i < out.length; i++) if (out[i] && fg.areas[fg.labels[i]] < minArea) out[i] = 0;
    }
    if (minHole > 0) {
      var bg = label(out, w, h, 0, false);
      for (i = 0; i < out.length; i++) if (!out[i] && !bg.border[bg.labels[i]] && bg.areas[bg.labels[i]] < minHole) out[i] = 1;
    }
    return out;
  }

  /**
   * Follow the boundary between shape and background pixels. Returns closed loops of integer
   * corner points (one point per unit step, so smoothing has something to work with). The shape
   * is on the right of every edge; where two shape pixels touch only at a corner they are joined.
   */
  function loops(mask, w, h) {
    var W1 = w + 1;
    var next = new Map();            // vertex id -> list of outgoing edges [x2, y2]
    function at(x, y) { return x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1; }
    function add(x1, y1, x2, y2) {
      var k = y1 * W1 + x1, l = next.get(k);
      if (!l) { l = []; next.set(k, l); }
      l.push([x2, y2, false]);
    }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (!at(x, y - 1)) add(x, y, x + 1, y);
        if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
        if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
        if (!at(x - 1, y)) add(x, y + 1, x, y);
      }
    }
    var result = [];
    next.forEach(function (list, key) {
      for (var e = 0; e < list.length; e++) {
        if (list[e][2]) continue;
        var sx = key % W1, sy = (key - sx) / W1;
        var pts = [], cx = sx, cy = sy, edge = list[e], guard = 0;
        for (;;) {
          edge[2] = true;
          pts.push([cx, cy]);
          var dx = edge[0] - cx, dy = edge[1] - cy;
          cx = edge[0]; cy = edge[1];
          if (cx === sx && cy === sy) break;
          var outs = next.get(cy * W1 + cx), pick = null, i;
          if (!outs) break;
          // at a corner touching vertex prefer the left turn (joins diagonal pixels), then the right turn
          var lx = dy, ly = -dx, rx = -dy, ry = dx;
          for (i = 0; i < outs.length && !pick; i++) if (!outs[i][2] && outs[i][0] - cx === lx && outs[i][1] - cy === ly) pick = outs[i];
          for (i = 0; i < outs.length && !pick; i++) if (!outs[i][2] && outs[i][0] - cx === rx && outs[i][1] - cy === ry) pick = outs[i];
          for (i = 0; i < outs.length && !pick; i++) if (!outs[i][2]) pick = outs[i];
          if (!pick) break;
          edge = pick;
          if (++guard > 4000000) break;
        }
        if (pts.length >= 4) result.push(pts);
      }
    });
    return result;
  }

  /** Signed area (shoelace). */
  function area(pts) {
    var a = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] * pts[i][1]) - (pts[i][0] * pts[j][1]);
    return a / 2;
  }

  /** Taubin smoothing of a closed loop: rounds the staircase without shrinking the shape. */
  function smoothLoop(pts, iterations) {
    var n = pts.length;
    if (iterations < 1 || n < 8) return pts;
    var xs = new Float64Array(n), ys = new Float64Array(n), tx = new Float64Array(n), ty = new Float64Array(n), i;
    for (i = 0; i < n; i++) { xs[i] = pts[i][0]; ys[i] = pts[i][1]; }
    var LAMBDA = 0.6307, MU = -0.6732;
    function step(k) {
      for (var j = 0; j < n; j++) {
        var p = j === 0 ? n - 1 : j - 1, q = j === n - 1 ? 0 : j + 1;
        tx[j] = xs[j] + k * ((xs[p] + xs[q]) / 2 - xs[j]);
        ty[j] = ys[j] + k * ((ys[p] + ys[q]) / 2 - ys[j]);
      }
      var sx = xs; xs = tx; tx = sx; var sy = ys; ys = ty; ty = sy;
    }
    for (var it = 0; it < iterations; it++) { step(LAMBDA); step(MU); }
    var out = new Array(n);
    for (i = 0; i < n; i++) out[i] = [xs[i], ys[i]];
    return out;
  }

  function segDist2(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    var t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
    var ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1];
    return ex * ex + ey * ey;
  }

  /** Douglas-Peucker on an open run of points (iterative). Returns the kept points including both ends. */
  function dp(pts, eps) {
    var n = pts.length;
    if (n < 3) return pts.slice();
    var keep = new Uint8Array(n), stack = [[0, n - 1]], e2 = eps * eps;
    keep[0] = keep[n - 1] = 1;
    while (stack.length) {
      var seg = stack.pop(), s = seg[0], e = seg[1], best = -1, idx = -1;
      for (var i = s + 1; i < e; i++) {
        var d = segDist2(pts[i], pts[s], pts[e]);
        if (d > best) { best = d; idx = i; }
      }
      if (best > e2) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    var out = [];
    for (var k = 0; k < n; k++) if (keep[k]) out.push(pts[k]);
    return out;
  }

  /** Douglas-Peucker for a closed loop: split at the two points farthest apart so neither end is arbitrary. */
  function simplifyLoop(pts, eps) {
    var n = pts.length;
    if (n < 6 || eps <= 0) return pts;
    var a = 0, b = 0, best = -1, i;
    for (i = 1; i < n; i++) {
      var d = (pts[i][0] - pts[0][0]) * (pts[i][0] - pts[0][0]) + (pts[i][1] - pts[0][1]) * (pts[i][1] - pts[0][1]);
      if (d > best) { best = d; b = i; }
    }
    best = -1;
    for (i = 0; i < n; i++) {
      var d2 = (pts[i][0] - pts[b][0]) * (pts[i][0] - pts[b][0]) + (pts[i][1] - pts[b][1]) * (pts[i][1] - pts[b][1]);
      if (d2 > best) { best = d2; a = i; }
    }
    if (a > b) { var t = a; a = b; b = t; }
    var first = dp(pts.slice(a, b + 1), eps);
    var second = dp(pts.slice(b).concat(pts.slice(0, a + 1)), eps);
    return first.slice(0, -1).concat(second.slice(0, -1));
  }

  function count(polys) { var n = 0; for (var i = 0; i < polys.length; i++) n += polys[i].length; return n; }

  /** Merge user settings over the defaults and clamp them. */
  function settings(p) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    if (p) for (k in p) if (p[k] !== undefined) o[k] = p[k];
    o.noise = clamp(+o.noise || 0, 0, 40);
    o.smoothing = clamp(+o.smoothing || 0, 0, 10);
    o.detail = clamp(+o.detail || 1, 1, 10);
    o.maxPoints = clamp(+o.maxPoints || 3000, 100, 7000);
    o.invert = !!o.invert;
    o.threshold = o.threshold == null ? null : clamp(Math.round(+o.threshold), 1, 255);
    return o;
  }

  /**
   * The whole pipeline. input: { gray (Uint8Array) or rgba, width, height }.
   * Returns { polys, width, height, threshold, mask, points, loops }. mask is the cleaned
   * shape-pixel mask (handy for drawing a live preview).
   */
  function trace(input, params) {
    var o = settings(params), w = input.width, h = input.height;
    var gray = input.gray || toGray(input.rgba, w, h);
    var soft = blur(gray, w, h, Math.round(o.smoothing / 3));
    var thr = o.threshold == null ? otsu(soft) : o.threshold;
    var mask = binarize(soft, thr, o.invert);
    var minArea = Math.round(o.noise * o.noise * 0.6);
    mask = clean(mask, w, h, minArea, minArea);
    var raw = loops(mask, w, h);
    var rounds = Math.round(o.smoothing * 2);
    var eps = 3.2 - o.detail * 0.28;                       // detail 10 -> 0.4 px, detail 1 -> 2.9 px
    var smooth = raw.map(function (l) { return smoothLoop(l, rounds); });
    var polys = [];
    for (var tries = 0; tries < 24; tries++) {
      polys = smooth.map(function (l) { return simplifyLoop(l, eps); }).filter(function (l) { return l.length >= 3 && Math.abs(area(l)) >= 1; });
      if (count(polys) <= o.maxPoints) break;
      eps *= 1.25;
    }
    if (count(polys) > o.maxPoints) {                      // still too busy: keep the biggest outlines that fit
      polys.sort(function (a, b) { return Math.abs(area(b)) - Math.abs(area(a)); });
      var kept = [], total = 0;
      for (var q = 0; q < polys.length; q++) {
        if (kept.length && total + polys[q].length > o.maxPoints) continue;
        kept.push(polys[q]); total += polys[q].length;
      }
      polys = kept;
    }
    return { polys: polys, width: w, height: h, threshold: thr, mask: mask, points: count(polys), loops: polys.length };
  }

  /** Scale a picture so its longest side is at most maxSide. Returns the new size. */
  function fitSize(w, h, maxSide) {
    var s = Math.min(1, maxSide / Math.max(w, h));
    return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
  }

  return {
    DEFAULTS: DEFAULTS, settings: settings, toGray: toGray, blur: blur, otsu: otsu, binarize: binarize,
    label: label, clean: clean, loops: loops, area: area, smoothLoop: smoothLoop, simplifyLoop: simplifyLoop,
    trace: trace, fitSize: fitSize, count: count
  };
});
