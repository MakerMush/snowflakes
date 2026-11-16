/*
 * editor.js - the wedge canvas. Click a shape to select it, drag to move, use the square
 * handles to resize, the round handle to rotate. Shift-click adds shapes to the selection, dragging
 * on empty paper draws a selection box, and a selection (or a group) moves, scales and rotates as one.
 * Everything goes through the store so undo works.
 *
 * Zoom and pan only change the view (the SVG viewBox), never the design: pinch or Ctrl/Cmd + scroll zooms,
 * two fingers, scroll, the middle mouse button or Space + drag pans, and + / - / 0 zoom in, out and reset.
 */
(function (root) {
  'use strict';
  var G = root.SF.geometry, S = root.SF.shapes, ST = root.SF.state;

  function f(v) { return Math.round(v * 1000) / 1000; }
  function deg(r) { return r * 180 / Math.PI; }
  var MAX_ZOOM = 6;

  function Editor(svg, store) {
    this.svg = svg;
    this.store = store;
    this.drag = null;
    this.builtArms = null;
    this.upp = 0.2;                      // wedge units per screen pixel, kept fresh by measure()
    this.pointers = {};                  // pointers currently down, for two-finger pinch and pan
    this.pinch = null;
    this.space = false;                  // Space held: drag pans
    this.zoomListeners = [];
    var self = this;
    svg.addEventListener('wheel', function (e) { self.wheel(e); }, { passive: false });
    document.addEventListener('keyup', function (e) { if (e.key === ' ') self.setSpace(false); });
    root.addEventListener('blur', function () { self.setSpace(false); });
    svg.addEventListener('pointerdown', function (e) { self.down(e); });
    svg.addEventListener('pointermove', function (e) { self.move(e); });
    svg.addEventListener('pointerup', function (e) { self.up(e); });
    svg.addEventListener('pointercancel', function (e) { self.up(e); });
    document.addEventListener('keydown', function (e) { self.key(e); });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () { self.measure(); self.renderSelection(); }).observe(svg);
    }
    this.render();
  }

  Editor.prototype.measure = function () {
    var ctm = this.svg.getScreenCTM();
    if (ctm && ctm.a > 0) this.upp = 1 / ctm.a;
  };

  Editor.prototype.toWorld = function (e) {
    var ctm = this.svg.getScreenCTM();
    if (!ctm) return [0, 0];
    var pt = this.svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    var q = pt.matrixTransform(ctm.inverse());
    return [q.x, q.y];
  };

  /* ---------- zoom and pan (the view only; the design is untouched) ---------- */

  /** How a view box lands on screen (the SVG keeps its aspect ratio and centres it). */
  Editor.prototype.mapping = function (v) {
    var r = this.svg.getBoundingClientRect(), k = Math.min(r.width / v.w, r.height / v.h) || 1;
    return { k: k, ox: r.left + (r.width - v.w * k) / 2, oy: r.top + (r.height - v.h * k) / 2 };
  };
  Editor.prototype.worldAt = function (v, cx, cy) {
    var m = this.mapping(v);
    return [v.x + (cx - m.ox) / m.k, v.y + (cy - m.oy) / m.k];
  };
  Editor.prototype.zoomLevel = function () { return this.home && this.view ? this.home.w / this.view.w : 1; };
  Editor.prototype.onZoom = function (fn) { this.zoomListeners.push(fn); fn(this.zoomLevel()); };

  /** Show view box v, kept between "whole wedge" (zoom 1) and MAX_ZOOM and never panned off the wedge. */
  Editor.prototype.setView = function (v) {
    var H = this.home, z = G.clamp(H.w / v.w, 1, MAX_ZOOM), w = H.w / z, h = H.h / z;
    var x = G.clamp(v.x + (v.w - w) / 2, H.x, H.x + H.w - w), y = G.clamp(v.y + (v.h - h) / 2, H.y, H.y + H.h - h);
    this.view = { x: x, y: y, w: w, h: h };
    this.svg.setAttribute('viewBox', [x, y, w, h].map(f).join(' '));
    this.measure();
    this.renderSelection();
    var zl = this.zoomLevel();
    this.zoomListeners.forEach(function (fn) { fn(zl); });
  };
  /** The view box zoomed by `factor` around the screen point (cx, cy) of view v0, then moved by (dx, dy) pixels. */
  Editor.prototype.zoomedView = function (v0, factor, cx, cy, dx, dy) {
    var H = this.home, z0 = H.w / v0.w, z1 = G.clamp(z0 * factor, 1, MAX_ZOOM), r = z0 / z1;
    var p = this.worldAt(v0, cx, cy), k1 = this.mapping(v0).k / r;
    return { x: p[0] - (p[0] - v0.x) * r - (dx || 0) / k1, y: p[1] - (p[1] - v0.y) * r - (dy || 0) / k1, w: v0.w * r, h: v0.h * r };
  };
  Editor.prototype.centre = function () {
    var r = this.svg.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  Editor.prototype.zoomBy = function (factor) {
    var c = this.centre();
    this.setView(this.zoomedView(this.view, factor, c[0], c[1]));
  };
  Editor.prototype.zoomIn = function () { this.zoomBy(1.5); };
  Editor.prototype.zoomOut = function () { this.zoomBy(1 / 1.5); };
  Editor.prototype.resetZoom = function () { this.setView(this.home); };

  Editor.prototype.wheel = function (e) {
    if (!this.view) return;
    e.preventDefault();
    var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;     // lines or pages to pixels
    if (e.ctrlKey || e.metaKey) {                                       // pinch on a trackpad, or Ctrl/Cmd + scroll
      var dz = G.clamp(e.deltaY * unit, -50, 50);                       // one mouse-wheel notch is about 1.35x; trackpad pinches are smooth
      this.setView(this.zoomedView(this.view, Math.exp(-dz * 0.006), e.clientX, e.clientY));
    } else if (this.zoomLevel() > 1.001) {                              // scroll pans while zoomed in
      var k = this.mapping(this.view).k, dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit, dy = e.shiftKey ? 0 : e.deltaY * unit;
      this.setView({ x: this.view.x + dx / k, y: this.view.y + dy / k, w: this.view.w, h: this.view.h });
    }
  };

  Editor.prototype.setSpace = function (on) {
    this.space = on;
    this.svg.classList.toggle('panning', on);
  };

  Editor.prototype.pointerList = function () {
    var ps = this.pointers;
    return Object.keys(ps).map(function (k) { return ps[k]; });
  };

  /* ---------- static layers (rebuilt only when the fold type changes) ---------- */

  Editor.prototype.build = function () {
    var svg = this.svg, n = this.store.doc.arms, R = G.R;
    var h = G.halfAngle(n), hw = R * Math.sin(h), m = 24;
    var vb = { x: -hw - m, y: -R - m, w: 2 * hw + 2 * m, h: R + m + 12 };
    this.bounds = { x0: vb.x + 2, x1: vb.x + vb.w - 2, y0: vb.y + 2, y1: vb.y + vb.h - 2 };
    this.home = vb;                                    // zoom 1: the whole wedge
    this.view = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
    svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].map(f).join(' '));

    var wedgeD = G.wedgePathD(n, R, 0);
    var lx = -R * Math.sin(h), ly = -R * Math.cos(h), rx = -lx;
    var arcD = 'M' + f(lx) + ' ' + f(ly) + 'A' + R + ' ' + R + ' 0 0 1 ' + f(rx) + ' ' + f(ly);
    var angL = deg(Math.atan2(-Math.cos(h), -Math.sin(h)));
    var angR = deg(Math.atan2(-Math.cos(h), Math.sin(h)));
    var mx = 0.5 * R * Math.sin(h), my = -0.5 * R * Math.cos(h);

    svg.innerHTML =
      '<defs>' +
        '<clipPath id="ed-clip"><path d="' + wedgeD + '"/></clipPath>' +
        '<pattern id="ed-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" class="ed-gridline"/></pattern>' +
        '<pattern id="ed-hatch" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
          '<rect width="1.2" height="1.2" fill="#fff"/><line x1="0" y1="0" x2="0" y2="1.2" class="ed-hatchline"/></pattern>' +
      '</defs>' +
      '<rect class="ed-bg" x="' + f(vb.x) + '" y="' + f(vb.y) + '" width="' + f(vb.w) + '" height="' + f(vb.h) + '"/>' +
      '<path class="ed-paper" d="' + wedgeD + '"/>' +
      '<path d="' + wedgeD + '" fill="url(#ed-grid)"/>' +
      '<g id="ed-objs" clip-path="url(#ed-clip)"></g>' +
      '<g id="ed-hub" clip-path="url(#ed-clip)"></g>' +
      '<image id="ed-overlay" x="-100" y="-100" width="200" height="200" preserveAspectRatio="none" clip-path="url(#ed-clip)" visibility="hidden" pointer-events="none"/>' +
      '<path class="ed-edge-arc" d="' + arcD + '"/>' +
      '<path class="ed-edge-fold" d="M0 0L' + f(lx) + ' ' + f(ly) + 'M0 0L' + f(rx) + ' ' + f(ly) + '"/>' +
      '<text class="ed-label" transform="translate(' + f(-mx) + ' ' + f(my) + ') rotate(' + f(angL) + ')" dy="-1.8" text-anchor="middle">FOLD</text>' +
      '<text class="ed-label" transform="translate(' + f(mx) + ' ' + f(my) + ') rotate(' + f(angR) + ')" dy="4.2" text-anchor="middle">FOLD</text>' +
      '<text class="ed-label" x="0" y="' + f(-R - 4) + '" text-anchor="middle">OUTER EDGE: CUT THROUGH</text>' +
      '<text class="ed-label" x="0" y="7" text-anchor="middle">CENTER</text>' +
      '<g id="ed-ghost"></g>' +
      '<g id="ed-sel"></g>' +
      '<g id="ed-marq" pointer-events="none"></g>';

    this.gObjs = svg.querySelector('#ed-objs');
    this.gHub = svg.querySelector('#ed-hub');
    this.overlay = svg.querySelector('#ed-overlay');
    this.setOverlay(this.overlayHref || null);
    this.gGhost = svg.querySelector('#ed-ghost');
    this.gSel = svg.querySelector('#ed-sel');
    this.gMarq = svg.querySelector('#ed-marq');
    this.builtArms = n;
    this.measure();
    var zl = this.zoomLevel();                         // a new fold type starts zoomed out
    this.zoomListeners.forEach(function (fn) { fn(zl); });
  };

  /** Show (or hide, with null) the problem overlay: a PNG covering the whole unfolded disc. */
  Editor.prototype.setOverlay = function (href) {
    this.overlayHref = href;
    if (!this.overlay) return;
    if (href) { this.overlay.setAttribute('href', href); this.overlay.setAttribute('visibility', 'visible'); }
    else { this.overlay.removeAttribute('href'); this.overlay.setAttribute('visibility', 'hidden'); }
  };

  /* ---------- dynamic layers ---------- */

  Editor.prototype.render = function () {
    var doc = this.store.doc;
    if (doc.arms !== this.builtArms) this.build();
    var sel = this.store.selectedIds;
    var objs = '', ghosts = '';
    doc.objects.forEach(function (o) {
      var sh = S.resolve(o);
      if (!sh) return;
      var d = S.pathD(sh), t = G.matrixStr(G.objectMatrix(o));
      objs += '<path class="o-' + o.role + '" d="' + d + '" transform="' + t + '" fill-rule="evenodd"/>';
      ghosts += '<path class="ghost' + (sel.indexOf(o.id) >= 0 ? ' sel' : '') + (o.group ? ' grp' : '') + '" data-id="' + o.id + '" d="' + d +
        '" transform="' + t + '" fill-rule="evenodd"/>';
    });
    this.gObjs.innerHTML = objs;
    this.gGhost.innerHTML = ghosts;
    this.gHub.innerHTML = doc.hub && doc.hubR > 0
      ? '<path class="ed-hub" d="' + G.wedgePathD(doc.arms, doc.hubR, 0.02) + '"/>' : '';
    this.renderSelection();
  };

  Editor.prototype.renderSelection = function () {
    if (!this.gSel) return;
    var ids = this.store.selectedIds;
    if (!ids.length) { this.gSel.innerHTML = ''; return; }
    // bigger handles for fingers than for mice
    var coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    var k = coarse ? 1.8 : 1;
    var u = this.upp, hs = 4.8 * u * k, off = 26 * u * k, hs2 = hs * 2, html, handles;
    if (ids.length > 1) {                                  // several shapes or a group: one upright box
      var bb = this.store.selectionBounds();
      if (!bb) { this.gSel.innerHTML = ''; return; }
      html = '<g class="sel-group">' +
        '<rect class="sel-box" x="' + f(bb.x0) + '" y="' + f(bb.y0) + '" width="' + f(bb.w) + '" height="' + f(bb.h) + '"/>' +
        '<line class="sel-stem" x1="' + f(bb.cx) + '" y1="' + f(bb.y0) + '" x2="' + f(bb.cx) + '" y2="' + f(bb.y0 - off) + '"/>';
      handles = [['nw', bb.x0, bb.y0], ['ne', bb.x1, bb.y0], ['se', bb.x1, bb.y1], ['sw', bb.x0, bb.y1]];
      handles.forEach(function (h) {
        html += '<rect class="hdl hdl-' + h[0] + '" data-handle="' + h[0] + '" x="' + f(h[1] - hs) + '" y="' + f(h[2] - hs) +
          '" width="' + f(hs2) + '" height="' + f(hs2) + '"/>';
      });
      html += '<circle class="hdl hdl-rot" data-handle="rot" cx="' + f(bb.cx) + '" cy="' + f(bb.y0 - off) + '" r="' + f(5.8 * u * k) + '"/></g>';
      this.gSel.innerHTML = html;
      return;
    }
    var o = this.store.get(ids[0]);
    if (!o) { this.gSel.innerHTML = ''; return; }
    var hx = o.sx / 2, hy = o.sy / 2;
    html = '<g transform="translate(' + f(o.x) + ' ' + f(o.y) + ') rotate(' + f(o.rot) + ')">' +
      '<rect class="sel-box" x="' + f(-hx) + '" y="' + f(-hy) + '" width="' + f(o.sx) + '" height="' + f(o.sy) + '"/>' +
      '<line class="sel-stem" x1="0" y1="' + f(-hy) + '" x2="0" y2="' + f(-hy - off) + '"/>';
    handles = [['nw', -hx, -hy], ['ne', hx, -hy], ['se', hx, hy], ['sw', -hx, hy]];
    if (o.sx > hs2 * 4) handles.push(['n', 0, -hy], ['s', 0, hy]);
    if (o.sy > hs2 * 4) handles.push(['e', hx, 0], ['w', -hx, 0]);
    handles.forEach(function (h) {
      html += '<rect class="hdl hdl-' + h[0] + '" data-handle="' + h[0] + '" x="' + f(h[1] - hs) + '" y="' + f(h[2] - hs) +
        '" width="' + f(hs2) + '" height="' + f(hs2) + '"/>';
    });
    html += '<circle class="hdl hdl-rot" data-handle="rot" cx="0" cy="' + f(-hy - off) + '" r="' + f(5.8 * u * k) + '"/></g>';
    this.gSel.innerHTML = html;
  };

  /* ---------- pointer interaction ---------- */

  Editor.prototype.down = function (e) {
    this.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var pts = this.pointerList();
    if (e.pointerType !== 'mouse' && pts.length === 2) {          // a second finger: pinch and pan instead
      if (this.drag && this.drag.kind === 'marquee') this.gMarq.innerHTML = '';
      this.drag = null;
      var mid = [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2];
      this.pinch = { v0: this.view, mid0: mid, d0: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) };
      try { this.svg.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      e.preventDefault();
      return;
    }
    if (this.pinch || pts.length > 2) return;
    if ((e.pointerType === 'mouse' && e.button === 1) || (this.space && e.button === 0)) {   // middle button or Space + drag
      this.drag = { kind: 'pan', v0: this.view, c0: [e.clientX, e.clientY] };
      this.svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var t = e.target.closest ? e.target : null;
    var hEl = t && t.closest('[data-handle]');
    var oEl = t && t.closest('[data-id]');
    var p = this.toWorld(e), store = this.store, o, sel = store.selectedIds;
    var additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (hEl && sel.length > 1) {                                  // handle of a multi-selection box
      var bb = store.selectionBounds(), h = hEl.getAttribute('data-handle');
      var base = store.snapshotOf(), c = { x: bb.cx, y: bb.cy };
      if (h === 'rot') {
        this.drag = { kind: 'grotate', base: base, c: c, a0: Math.atan2(p[1] - c.y, p[0] - c.x), p0: p, began: false };
      } else {
        var hxp = h.charAt(1) === 'w' ? bb.x0 : bb.x1, hyp = h.charAt(0) === 'n' ? bb.y0 : bb.y1;
        this.drag = { kind: 'gscale', base: base, c: c, r0: Math.max(1, Math.hypot(hxp - c.x, hyp - c.y)), p0: p, began: false };
      }
    } else if (hEl && (o = store.get(store.selectedId))) {
      this.drag = {
        kind: hEl.getAttribute('data-handle') === 'rot' ? 'rotate' : 'scale',
        handle: hEl.getAttribute('data-handle'), id: o.id,
        start: { x: o.x, y: o.y, sx: o.sx, sy: o.sy, rot: o.rot }, p0: p, began: false
      };
    } else if (oEl) {
      var id = oEl.getAttribute('data-id'), clickId = null;
      if (additive) {
        store.toggleSelect(id);
        if (store.selectedIds.indexOf(id) < 0) return;           // it was switched off: nothing to drag
      } else if (sel.length > 1 && sel.indexOf(id) >= 0) {
        clickId = id;                                            // click without a drag narrows to this one
      } else {
        store.select(id);
      }
      if (store.selectedIds.length > 1) {
        var b2 = store.selectionBounds();
        this.drag = { kind: 'gmove', base: store.snapshotOf(), c: { x: b2.cx, y: b2.cy }, p0: p, began: false, clickId: clickId };
      } else {
        o = store.get(store.selectedId);
        this.drag = { kind: 'move', id: o.id, start: { x: o.x, y: o.y }, p0: p, began: false };
      }
    } else {                                                     // empty paper: draw a selection box
      if (!additive) store.select(null);
      this.drag = { kind: 'marquee', p0: p, began: false, keep: additive ? store.selectedIds : [] };
    }
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  Editor.prototype.drawMarquee = function (p0, p) {
    var x = Math.min(p0[0], p[0]), y = Math.min(p0[1], p[1]), w = Math.abs(p[0] - p0[0]), h = Math.abs(p[1] - p0[1]);
    this.gMarq.innerHTML = '<rect class="marquee" x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '"/>';
    return { x0: x, y0: y, x1: x + w, y1: y + h };
  };

  Editor.prototype.move = function (e) {
    if (this.pointers[e.pointerId]) this.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (this.pinch) {
      var pts = this.pointerList(), pc = this.pinch;
      if (pts.length < 2) return;
      var mid = [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2];
      var s = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / pc.d0;
      this.setView(this.zoomedView(pc.v0, s, pc.mid0[0], pc.mid0[1], mid[0] - pc.mid0[0], mid[1] - pc.mid0[1]));
      return;
    }
    var d = this.drag;
    if (!d) return;
    if (d.kind === 'pan') {
      var k = this.mapping(d.v0).k;
      this.setView({ x: d.v0.x - (e.clientX - d.c0[0]) / k, y: d.v0.y - (e.clientY - d.c0[1]) / k, w: d.v0.w, h: d.v0.h });
      return;
    }
    var p = this.toWorld(e), store = this.store;
    var dx = p[0] - d.p0[0], dy = p[1] - d.p0[1];
    if (!d.began) {
      if (Math.hypot(dx, dy) < 3 * this.upp) return;      // a click, not a drag
      if (d.kind !== 'marquee') store.begin();
      d.began = true;
    }
    var s = d.start, b = this.bounds;
    if (d.kind === 'marquee') {
      var r = this.drawMarquee(d.p0, p), hits = [];
      store.doc.objects.forEach(function (o) {
        var bb = ST.boundsOf([o]);
        if (bb && bb.x1 >= r.x0 && bb.x0 <= r.x1 && bb.y1 >= r.y0 && bb.y0 <= r.y1) hits.push(o.id);
      });
      store.selectIds(d.keep.concat(hits));
    } else if (d.kind === 'gmove') {
      store.transform(d.base, {
        dx: G.clamp(d.c.x + dx, b.x0, b.x1) - d.c.x, dy: G.clamp(d.c.y + dy, b.y0, b.y1) - d.c.y,
        cx: d.c.x, cy: d.c.y
      });
    } else if (d.kind === 'grotate') {
      var th = deg(Math.atan2(p[1] - d.c.y, p[0] - d.c.x) - d.a0);
      if (e.shiftKey) th = Math.round(th / 15) * 15;
      store.transform(d.base, { theta: th, cx: d.c.x, cy: d.c.y });
    } else if (d.kind === 'gscale') {
      store.transform(d.base, { s: Math.hypot(p[0] - d.c.x, p[1] - d.c.y) / d.r0, cx: d.c.x, cy: d.c.y });
    } else if (d.kind === 'move') {
      store.patch(d.id, { x: G.clamp(s.x + dx, b.x0, b.x1), y: G.clamp(s.y + dy, b.y0, b.y1) });
    } else if (d.kind === 'rotate') {
      var a = deg(Math.atan2(p[1] - s.y, p[0] - s.x)) + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      store.patch(d.id, { rot: ((a % 360) + 360) % 360 });
    } else {
      var rr = s.rot * G.DEG, c = Math.cos(rr), sn = Math.sin(rr);
      var qx = p[0] - s.x, qy = p[1] - s.y;
      var lx = c * qx + sn * qy, ly = -sn * qx + c * qy;      // pointer in the object's own frame
      var h = d.handle, patch;
      if (h.length === 2) {                                   // corner: keep proportions
        var k = Math.hypot(lx, ly) / Math.hypot(s.sx / 2, s.sy / 2);
        patch = { sx: s.sx * k, sy: s.sy * k };
      } else if (h === 'e' || h === 'w') patch = { sx: Math.abs(lx) * 2 };
      else patch = { sy: Math.abs(ly) * 2 };
      store.patch(d.id, patch);
    }
  };

  Editor.prototype.up = function (e) {
    delete this.pointers[e.pointerId];
    if (this.pinch) {                                     // lifting a finger ends the pinch; nothing else happens
      if (!this.pointerList().length) this.pinch = null;
      return;
    }
    var d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.kind === 'marquee') this.gMarq.innerHTML = '';
    else if (d.kind === 'gmove' && !d.began && d.clickId) this.store.select(d.clickId);
    try { this.svg.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  };

  /* ---------- keyboard ---------- */

  Editor.prototype.key = function (e) {
    var t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (t && t.closest && t.closest('dialog')) return;
    var store = this.store, k = e.key, meta = e.ctrlKey || e.metaKey;
    if (!meta && !e.altKey) {                                     // view keys work with or without a selection
      if (k === ' ' && !(t && t.closest && t.closest('button, a'))) { e.preventDefault(); this.setSpace(true); return; }
      if (k === '+' || k === '=') { this.zoomIn(); return; }
      if (k === '-' || k === '_') { this.zoomOut(); return; }
      if (k === '0') { this.resetZoom(); return; }
    }
    if (meta && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
    if (meta && (k === 'y' || k === 'Y')) { e.preventDefault(); store.redo(); return; }
    if (meta && (k === 'a' || k === 'A')) { e.preventDefault(); store.selectAll(); return; }
    if (meta && (k === 'g' || k === 'G')) {
      e.preventDefault();
      if (root.SF.config && root.SF.config.kids) return;
      if (e.shiftKey) store.ungroupSelection(); else store.groupSelection();
      return;
    }
    var ids = store.selectedIds;
    if (!ids.length) return;
    var kids = !!(root.SF.config && root.SF.config.kids);     // kid mode has no Keep, grouping or stacking order
    if (meta && (k === 'd' || k === 'D')) { e.preventDefault(); store.duplicate(); return; }
    if (meta || e.altKey) return;
    var step = e.shiftKey ? 2 : 0.5;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); store.remove(); }
    else if (k === 'Escape') store.select(null);
    else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      var dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
      var dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
      store.begin('nudge');
      if (ids.length === 1) { var o = store.get(ids[0]); store.patch(o.id, { x: o.x + dx, y: o.y + dy }); }
      else store.transform(store.snapshotOf(), { dx: dx, dy: dy, cx: 0, cy: 0 });
    }
    else if (kids && (k === 'k' || k === 'K' || k === '[' || k === ']')) return;
    else if (k === 'k' || k === 'K') {
      var allCut = ids.every(function (id) { return store.get(id).role === 'cut'; });
      store.setRole(undefined, allCut ? 'keep' : 'cut');
    }
    else if (k === 'f' || k === 'F') store.toggleFlip();
    else if (k === 'c' || k === 'C') store.alignTo(undefined, 'center');
    else if (k === '[') store.reorder(undefined, 'down');
    else if (k === ']') store.reorder(undefined, 'up');
  };

  root.SF.Editor = Editor;
})(typeof self !== 'undefined' ? self : this);
