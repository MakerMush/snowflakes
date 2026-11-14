/*
 * analyze.js - "will this actually cut out, and how hard is it?"
 *
 * The whole unfolded paper is rasterized from the same model the preview draws (see sampler.js),
 * then checked on that raster:
 *   - islands: pieces of paper not connected to the main body (they would fall out)
 *   - thin paper: bridges and tips narrower than the chosen tool can leave intact
 *   - thin cuts: slits and holes narrower than the chosen tool can cut
 * It also measures how much cutting there is, scores the design 1 to 10, recommends a tool,
 * and can plan "bridges" (keep bars) that reconnect islands.
 *
 * Units: the paper disc has radius 100 and is printed 7.5 inches across, so 1 unit is about 1 mm.
 */
(function (root, factory) {
  var G, S, SM;
  if (typeof module === 'object' && module.exports) { G = require('./geometry'); S = require('./shapes'); SM = require('./sampler'); }
  else { G = root.SF.geometry; S = root.SF.shapes; SM = root.SF.sampler; }
  var api = factory(G, S, SM);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.SF.analyze = api; }
})(typeof self !== 'undefined' ? self : this, function (G, S, SM) {
  'use strict';

  var STEP = 0.4;                       // wedge units per raster pixel
  var MM_PER_UNIT = 95.25 / G.R;        // 7.5 in disc = 190.5 mm across

  /** Cutting tools, easiest first. width = narrowest paper bridge or cut the tool handles, in units (about mm). */
  var TOOLS = [
    { id: 'kid', name: 'Kid scissors', short: 'Kid scissors', width: 3.0, bridge: 3.4,
      note: 'Regular classroom scissors are fine.' },
    { id: 'sharp', name: 'Sharp craft scissors', short: 'Sharp scissors', width: 2.0, bridge: 2.4,
      note: 'Use small scissors with a sharp point.' },
    { id: 'knife', name: 'Craft knife + cutting mat', short: 'Craft knife', width: 1.0, bridge: 1.6,
      note: 'Use a craft knife on a cutting mat, and cut away from your fingers.' }
  ];

  var MIN_ISLAND_AREA = 1.0;            // units squared: ignore specks smaller than this
  var MIN_THIN_AREA = 5.0;              // units squared: ignore corner residue (sharp tips are easy to cut; long slivers are not)

  function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

  /* ---------- the raster grid (cached per fold type) ---------- */

  var gridCache = {};
  function grid(n) {
    if (gridCache[n]) return gridCache[n];
    var N = Math.round((2 * G.R) / STEP), total = N * N, R2 = G.R * G.R;
    var g = {
      n: n, N: N, step: STEP,
      fx: new Float32Array(total), fy: new Float32Array(total),       // folded (wedge) coordinates of each pixel
      r2: new Float32Array(total),
      inDisc: new Uint8Array(total), inW: new Uint8Array(total),      // inW: pixel lies in the base wedge
      sec: new Uint8Array(total)                                      // which of the 2n sectors
    };
    for (var j = 0; j < N; j++) {
      var y = -G.R + (j + 0.5) * STEP;
      for (var i = 0; i < N; i++) {
        var x = -G.R + (i + 0.5) * STEP, idx = j * N + i, rr = x * x + y * y;
        g.r2[idx] = rr;
        if (rr > R2) continue;
        g.inDisc[idx] = 1;
        var q = G.foldToWedge(n, [x, y]);
        g.fx[idx] = q[0]; g.fy[idx] = q[1];
        var k = G.sectorIndex(n, [x, y]);
        g.sec[idx] = k;
        if (k === 0) g.inW[idx] = 1;
      }
    }
    gridCache[n] = g;
    return g;
  }

  /* ---------- raster helpers ---------- */

  /** 4-connected components. Returns { labels (0 = background), count, areas[label] in pixels }. */
  function labelComponents(mask, N) {
    var total = N * N, labels = new Int32Array(total), stack = new Int32Array(total), areas = [0], count = 0;
    for (var s = 0; s < total; s++) {
      if (!mask[s] || labels[s]) continue;
      count++;
      var sp = 0, area = 0;
      stack[sp++] = s; labels[s] = count;
      while (sp) {
        var p = stack[--sp], i = p % N, q;
        area++;
        if (i > 0 && mask[q = p - 1] && !labels[q]) { labels[q] = count; stack[sp++] = q; }
        if (i < N - 1 && mask[q = p + 1] && !labels[q]) { labels[q] = count; stack[sp++] = q; }
        if (p >= N && mask[q = p - N] && !labels[q]) { labels[q] = count; stack[sp++] = q; }
        if (p < total - N && mask[q = p + N] && !labels[q]) { labels[q] = count; stack[sp++] = q; }
      }
      areas.push(area);
    }
    return { labels: labels, count: count, areas: areas };
  }

  var INF = 1e12;
  function dt1d(f, n, d, v, z) {
    var k = 0, q, s;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (q = 1; q < n; q++) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  }

  /** Squared distance (in pixels) from every pixel to the nearest pixel where set[] is 1. */
  function edtFrom(set, N) {
    var out = new Float64Array(N * N), col = new Float64Array(N), res = new Float64Array(N);
    var v = new Int32Array(N), z = new Float64Array(N + 1), i, j;
    for (i = 0; i < N * N; i++) out[i] = set[i] ? 0 : INF;
    for (i = 0; i < N; i++) {                                   // down each column
      for (j = 0; j < N; j++) col[j] = out[j * N + i];
      dt1d(col, N, res, v, z);
      for (j = 0; j < N; j++) out[j * N + i] = res[j];
    }
    for (j = 0; j < N; j++) {                                   // along each row
      var base = j * N;
      for (i = 0; i < N; i++) col[i] = out[base + i];
      dt1d(col, N, res, v, z);
      for (i = 0; i < N; i++) out[base + i] = res[i];
    }
    return out;
  }

  /**
   * Parts of `mask` thinner than 2 * rPx pixels: mask minus its morphological opening.
   * d1 is edtFrom(!mask), the squared distance from each pixel to the nearest non-mask pixel.
   */
  function thinResidue(mask, d1, rPx, N) {
    var total = N * N, eroded = new Uint8Array(total), i;
    for (i = 0; i < total; i++) if (mask[i] && Math.sqrt(d1[i]) - 0.5 >= rPx) eroded[i] = 1;
    var d2 = edtFrom(eroded, N), res = new Uint8Array(total), lim = rPx + 0.5;
    for (i = 0; i < total; i++) if (mask[i] && Math.sqrt(d2[i]) > lim) res[i] = 1;
    return res;
  }

  /* ---------- the analysis ---------- */

  function analyze(doc, opts) {
    var t0 = now();
    opts = opts || {};
    var tool = Math.max(0, Math.min(2, opts.tool == null ? 0 : opts.tool | 0));
    var n = doc.arms, g = grid(n), N = g.N, total = N * N;
    var comp = SM.compile(doc);

    var paper = new Uint8Array(total), notPaper = new Uint8Array(total), cutMask = new Uint8Array(total), idx;
    var hubR2 = comp.hubR2;
    for (idx = 0; idx < total; idx++) {
      if (!g.inDisc[idx]) { notPaper[idx] = 1; continue; }
      if (g.r2[idx] <= hubR2 || comp.paperAtWedge(g.fx[idx], g.fy[idx])) paper[idx] = 1;
      else { notPaper[idx] = 1; cutMask[idx] = 1; }
    }

    var minIslandPx = Math.ceil(MIN_ISLAND_AREA / (STEP * STEP));
    var minThinPx = Math.ceil(MIN_THIN_AREA / (STEP * STEP));

    /* islands */
    var pl = labelComponents(paper, N);
    var mainLabel = 0, mainArea = 0, l;
    for (l = 1; l <= pl.count; l++) if (pl.areas[l] > mainArea) { mainArea = pl.areas[l]; mainLabel = l; }
    var touchesBase = new Uint8Array(pl.count + 1), secSeen = new Uint8Array(2 * n);
    for (idx = 0; idx < total; idx++) {
      var lb = pl.labels[idx];
      if (!lb) continue;
      if (g.inW[idx]) touchesBase[lb] = 1;
      if (lb === mainLabel) secSeen[g.sec[idx]] = 1;
    }
    var mainSectors = 0;
    for (var s = 0; s < 2 * n; s++) mainSectors += secSeen[s];
    var fallsApart = mainLabel !== 0 && mainSectors < 2 * n;          // no single piece reaches around the whole flake
    var isIsland = new Uint8Array(pl.count + 1), islandOrbits = 0, islandPieces = 0;
    for (l = 1; l <= pl.count; l++) {
      if (pl.areas[l] < minIslandPx) continue;
      if (l === mainLabel && !fallsApart) continue;
      isIsland[l] = 1; islandPieces++;
      if (touchesBase[l]) islandOrbits++;
    }
    var islandMask = new Uint8Array(total);
    if (islandPieces) for (idx = 0; idx < total; idx++) if (pl.labels[idx] && isIsland[pl.labels[idx]]) islandMask[idx] = 1;

    /* how much cutting: measured on the folded wedge only, because every layer is cut at once */
    var wedgeCut = new Uint8Array(total), wedgePx = 0, wedgeCutPx = 0, nh = 0, nv = 0;
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        idx = j * N + i;
        if (!g.inW[idx]) continue;
        wedgePx++;
        if (cutMask[idx]) { wedgeCut[idx] = 1; wedgeCutPx++; }
        if (i < N - 1 && g.inW[idx + 1] && paper[idx] !== paper[idx + 1]) nh++;
        if (j < N - 1 && g.inW[idx + N] && paper[idx] !== paper[idx + N]) nv++;
      }
    }
    var cutLen = (Math.PI / 4) * (nh + nv) * STEP;                    // Crofton estimate of the cut line length
    var cl = labelComponents(wedgeCut, N);
    var touchesEdge = new Uint8Array(cl.count + 1);
    for (idx = 0; idx < total; idx++) {
      var c = cl.labels[idx];
      if (!c || touchesEdge[c]) continue;
      var ii = idx % N;
      if ((ii > 0 && !g.inW[idx - 1]) || (ii < N - 1 && !g.inW[idx + 1]) ||
          (idx >= N && !g.inW[idx - N]) || (idx < total - N && !g.inW[idx + N])) touchesEdge[c] = 1;
    }
    var interiorHoles = 0, edgeCuts = 0;
    for (l = 1; l <= cl.count; l++) {
      if (cl.areas[l] < minIslandPx) continue;
      if (touchesEdge[l]) edgeCuts++; else interiorHoles++;
    }

    /* thin features, per tool (computed lazily, easiest tool first) */
    var d1Paper = null, d1Cut = null, thinCache = [null, null, null];
    function thin(t) {
      if (thinCache[t]) return thinCache[t];
      var rPx = (TOOLS[t].width / 2) / STEP;
      if (!d1Paper) { d1Paper = edtFrom(notPaper, N); d1Cut = edtFrom(paper, N); }
      var pRes = thinResidue(paper, d1Paper, rPx, N);
      var cRes = thinResidue(notPaper, d1Cut, rPx, N);
      for (var k = 0; k < total; k++) if (cRes[k] && !cutMask[k]) cRes[k] = 0;      // only cuts inside the disc count
      var out = { paperMask: new Uint8Array(total), cutMask: new Uint8Array(total) };
      [['paper', pRes, out.paperMask], ['cut', cRes, out.cutMask]].forEach(function (w) {
        var lab = labelComponents(w[1], N), keep = new Uint8Array(lab.count + 1), hit = new Uint8Array(lab.count + 1), pieces = 0, orbits = 0;
        for (var q = 1; q <= lab.count; q++) if (lab.areas[q] >= minThinPx) { keep[q] = 1; pieces++; }
        for (var p = 0; p < total; p++) {
          var b = lab.labels[p];
          if (b && keep[b]) { w[2][p] = 1; if (g.inW[p]) hit[b] = 1; }
        }
        for (q = 1; q <= lab.count; q++) if (hit[q]) orbits++;
        out[w[0] + 'Pieces'] = pieces; out[w[0] + 'Orbits'] = orbits;
      });
      return (thinCache[t] = out);
    }
    var tierNeeded = 3;                                               // 3 means: finer than any tool here can manage
    for (var t = 0; t < 3; t++) {
      var r = thin(t);
      if (r.paperOrbits + r.cutOrbits === 0) { tierNeeded = t; break; }
    }
    var sel = thin(tool);

    var stats = {
      arms: n, layers: 2 * n,
      cutLenUnits: cutLen, cutLenMm: cutLen * MM_PER_UNIT,
      cutFraction: wedgePx ? wedgeCutPx / wedgePx : 0,
      interiorHoles: interiorHoles, edgeCuts: edgeCuts,
      islands: islandOrbits, islandPieces: islandPieces, fallsApart: fallsApart,
      thinPaper: sel.paperOrbits, thinCut: sel.cutOrbits,
      tierNeeded: tierNeeded, tool: tool
    };

    return {
      N: N, step: STEP, grid: g, doc: doc, stats: stats, report: score(stats),
      paper: paper, cutMask: cutMask,
      paperLabels: pl, mainLabel: mainLabel, islandMask: islandMask,
      thinPaperMask: sel.paperMask, thinCutMask: sel.cutMask,
      ms: now() - t0
    };
  }

  /* ---------- score and recommended tool ---------- */

  var LABELS = ['Easy peasy', 'Easy peasy', 'Chill', 'Chill', 'Takes patience', 'Takes patience', 'A real challenge', 'A real challenge', 'Expert mode', 'Expert mode'];

  function score(st) {
    var parts = {
      length: 3.0 * (1 - Math.exp(-st.cutLenUnits / 220)),
      interior: 0.3 * Math.min(st.interiorHoles, 8),
      notches: 0.06 * Math.min(st.edgeCuts, 25),
      layers: st.layers >= 12 ? 0.9 * Math.min(1, st.cutLenUnits / 80) : 0,     // thick stack only matters if there is cutting to do
      fine: [0, 0.8, 1.7, 2.6][st.tierNeeded]
    };
    var raw = 1 + parts.length + parts.interior + parts.notches + parts.layers + parts.fine;
    var value = Math.max(1, Math.min(10, Math.round(raw)));
    var byScore = raw >= 7.5 ? 2 : raw >= 4.5 ? 1 : 0;
    var needsPoint = st.interiorHoles > 0 && (st.layers >= 12 || st.interiorHoles >= 3) ? 1 : 0;   // starting a cut inside the paper takes a sharp point
    var toolIdx = Math.max(Math.min(st.tierNeeded, 2), byScore, needsPoint);
    var tooFine = st.tierNeeded === 3;

    var cm = Math.max(1, Math.round(st.cutLenMm / 10));
    var texts = {
      length: 'About ' + cm + ' cm of cutting',
      interior: st.interiorHoles + (st.interiorHoles === 1 ? ' cutout sits' : ' cutouts sit') + ' fully inside the paper, so you have to poke the tool through ' + st.layers + ' layers',
      notches: st.edgeCuts + (st.edgeCuts === 1 ? ' notch' : ' notches') + ' cut into the edges',
      layers: st.layers + ' layers is thick to cut through (4 arms has 8)',
      fine: tooFine ? 'Some details are thinner than 1 mm: simplify them'
        : 'Details as thin as ' + (st.tierNeeded === 2 ? '1-2' : '2-3') + ' mm'
    };
    var drivers = Object.keys(parts).filter(function (k) { return parts[k] >= 0.3; })
      .sort(function (a, b) { return parts[b] - parts[a]; }).slice(0, 3)
      .map(function (k) { return texts[k]; });

    return {
      score: value, raw: raw, label: LABELS[value - 1], toolIndex: toolIdx, tool: TOOLS[toolIdx],
      tooFine: tooFine, drivers: drivers, parts: parts
    };
  }

  /* ---------- the problem overlay (RGBA pixels, N x N over the whole disc) ---------- */

  function overlayRGBA(a, opts) {
    opts = opts || {};
    var N = a.N, out = new Uint8ClampedArray(N * N * 4), any = false;
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        var idx = j * N + i, o = idx * 4, alpha = 0;
        if (a.islandMask[idx]) alpha = 205;
        else if (a.thinPaperMask[idx]) alpha = ((i + j) % 8 < 3) ? 235 : 70;       // stripes one way: thin paper
        else if (a.thinCutMask[idx]) alpha = ((i - j + N) % 8 < 3) ? 235 : 70;     // stripes the other way: thin cut
        if (alpha) { out[o] = 255; out[o + 1] = 93; out[o + 2] = 77; out[o + 3] = alpha; any = true; }
      }
    }
    return any ? out : null;
  }

  /* ---------- bridges ---------- */

  /**
   * Plan keep-bars that connect every loose piece to the main body. Works in the base wedge: the
   * shortest link between two pieces always lies inside one wedge, and a bar placed there is
   * copied to every layer by the fold.
   * Returns draft objects (no ids) ready for the store.
   */
  function planBridges(a, toolIdx) {
    var g = a.grid, N = a.N, labels = a.paperLabels.labels, areas = a.paperLabels.areas;
    var minPx = Math.ceil(MIN_ISLAND_AREA / (STEP * STEP));
    var pts = [], total = N * N;
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        var idx = j * N + i;
        if (!g.inW[idx] || !a.paper[idx]) continue;
        var lb = labels[idx];
        if (!lb || areas[lb] < minPx) continue;
        var edge = (i > 0 && a.cutMask[idx - 1]) || (i < N - 1 && a.cutMask[idx + 1]) ||
          (j > 0 && a.cutMask[idx - N]) || (j < N - 1 && a.cutMask[idx + N]);
        if (edge) pts.push(idx);
      }
    }
    var stride = Math.max(1, Math.ceil(pts.length / 2600));
    var xs = [], ys = [], ls = [];
    for (var p = 0; p < pts.length; p += stride) {
      var q = pts[p];
      xs.push(-G.R + ((q % N) + 0.5) * STEP);
      ys.push(-G.R + (((q / N) | 0) + 0.5) * STEP);
      ls.push(labels[q]);
    }
    var best = {};                                     // shortest link for every pair of pieces
    for (var u = 0; u < xs.length; u++) {
      for (var w = u + 1; w < xs.length; w++) {
        if (ls[u] === ls[w]) continue;
        var dx = xs[u] - xs[w], dy = ys[u] - ys[w], d2 = dx * dx + dy * dy;
        var key = ls[u] < ls[w] ? ls[u] + '_' + ls[w] : ls[w] + '_' + ls[u];
        if (!best[key] || d2 < best[key].d2) best[key] = { d2: d2, a: ls[u], b: ls[w], u: u, w: w };
      }
    }
    var edges = Object.keys(best).map(function (k) { return best[k]; }).sort(function (x, y) { return x.d2 - y.d2; });
    var parent = {};
    function find(x) { while (parent[x] !== undefined && parent[x] !== x) x = parent[x]; return x; }
    ls.forEach(function (x) { parent[x] = x; });
    var groups = Object.keys(parent).length, bars = [], width = TOOLS[toolIdx].bridge, ext = 1.0;
    for (var e = 0; e < edges.length && groups > 1; e++) {            // cheapest links that join everything (a spanning tree)
      var ed = edges[e], ra = find(ed.a), rb = find(ed.b);
      if (ra === rb) continue;
      parent[ra] = rb; groups--;
      var x0 = xs[ed.u], y0 = ys[ed.u], x1 = xs[ed.w], y1 = ys[ed.w];
      var len = Math.hypot(x1 - x0, y1 - y0) || 0.1;
      bars.push({
        type: 'shape', shapeId: 'square', label: 'Bridge', bridge: true, role: 'keep', flip: false,
        x: (x0 + x1) / 2, y: (y0 + y1) / 2,
        sx: len + 2 * ext, sy: width,
        rot: ((Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI) % 360 + 360) % 360
      });
    }
    return bars;
  }

  /**
   * Repeatedly add bridges until nothing is loose (or it cannot make progress).
   * Returns { bars, remaining } where remaining is how many islands are still loose.
   */
  function autoBridge(doc, toolIdx) {
    var work = JSON.parse(JSON.stringify(doc)), bars = [], remaining = 0;
    for (var pass = 0; pass < 4; pass++) {
      var a = analyze(work, { tool: toolIdx });
      remaining = a.stats.islands;
      if (!remaining) break;
      var plan = planBridges(a, toolIdx);
      if (!plan.length) break;
      plan.forEach(function (b) {
        bars.push(b);
        var o = JSON.parse(JSON.stringify(b));
        o.id = 'o' + (work.nextId++);
        work.objects.push(o);
      });
    }
    if (bars.length) remaining = analyze(work, { tool: toolIdx }).stats.islands;
    return { bars: bars, remaining: remaining };
  }

  return {
    STEP: STEP, MM_PER_UNIT: MM_PER_UNIT, TOOLS: TOOLS, grid: grid,
    analyze: analyze, score: score, overlayRGBA: overlayRGBA,
    planBridges: planBridges, autoBridge: autoBridge,
    labelComponents: labelComponents, edtFrom: edtFrom
  };
});
