/*
 * editor.js - the wedge canvas. Click a shape to select it, drag to move, use the square
 * handles to resize, the round handle to rotate. Everything goes through the store so undo works.
 */
(function (root) {
  'use strict';
  var G = root.SF.geometry, S = root.SF.shapes;

  function f(v) { return Math.round(v * 1000) / 1000; }
  function deg(r) { return r * 180 / Math.PI; }

  function Editor(svg, store) {
    this.svg = svg;
    this.store = store;
    this.drag = null;
    this.builtArms = null;
    this.upp = 0.2;                      // wedge units per screen pixel, kept fresh by measure()
    var self = this;
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

  /* ---------- static layers (rebuilt only when the fold type changes) ---------- */

  Editor.prototype.build = function () {
    var svg = this.svg, n = this.store.doc.arms, R = G.R;
    var h = G.halfAngle(n), hw = R * Math.sin(h), m = 24;
    var vb = { x: -hw - m, y: -R - m, w: 2 * hw + 2 * m, h: R + m + 12 };
    this.bounds = { x0: vb.x + 2, x1: vb.x + vb.w - 2, y0: vb.y + 2, y1: vb.y + vb.h - 2 };
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
        '<pattern id="ed-hatch" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
          '<rect width="2.4" height="2.4" fill="#fff"/><line x1="0" y1="0" x2="0" y2="2.4" class="ed-hatchline"/></pattern>' +
      '</defs>' +
      '<rect class="ed-bg" x="' + f(vb.x) + '" y="' + f(vb.y) + '" width="' + f(vb.w) + '" height="' + f(vb.h) + '"/>' +
      '<path class="ed-paper" d="' + wedgeD + '"/>' +
      '<path d="' + wedgeD + '" fill="url(#ed-grid)"/>' +
      '<g id="ed-objs" clip-path="url(#ed-clip)"></g>' +
      '<g id="ed-hub" clip-path="url(#ed-clip)"></g>' +
      '<path class="ed-edge-arc" d="' + arcD + '"/>' +
      '<path class="ed-edge-fold" d="M0 0L' + f(lx) + ' ' + f(ly) + 'M0 0L' + f(rx) + ' ' + f(ly) + '"/>' +
      '<text class="ed-label" transform="translate(' + f(-mx) + ' ' + f(my) + ') rotate(' + f(angL) + ')" dy="-1.8" text-anchor="middle">FOLD</text>' +
      '<text class="ed-label" transform="translate(' + f(mx) + ' ' + f(my) + ') rotate(' + f(angR) + ')" dy="4.2" text-anchor="middle">FOLD</text>' +
      '<text class="ed-label" x="0" y="' + f(-R - 4) + '" text-anchor="middle">OUTER EDGE: CUT THROUGH</text>' +
      '<text class="ed-label" x="0" y="7" text-anchor="middle">CENTER</text>' +
      '<g id="ed-ghost"></g>' +
      '<g id="ed-sel"></g>';

    this.gObjs = svg.querySelector('#ed-objs');
    this.gHub = svg.querySelector('#ed-hub');
    this.gGhost = svg.querySelector('#ed-ghost');
    this.gSel = svg.querySelector('#ed-sel');
    this.builtArms = n;
    this.measure();
  };

  /* ---------- dynamic layers ---------- */

  Editor.prototype.render = function () {
    var doc = this.store.doc;
    if (doc.arms !== this.builtArms) this.build();
    var sel = this.store.selectedId;
    var objs = '', ghosts = '';
    doc.objects.forEach(function (o) {
      var sh = S.resolve(o);
      if (!sh) return;
      var d = S.pathD(sh), t = G.matrixStr(G.objectMatrix(o));
      objs += '<path class="o-' + o.role + '" d="' + d + '" transform="' + t + '" fill-rule="evenodd"/>';
      ghosts += '<path class="ghost' + (o.id === sel ? ' sel' : '') + '" data-id="' + o.id + '" d="' + d +
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
    var o = this.store.get(this.store.selectedId);
    if (!o) { this.gSel.innerHTML = ''; return; }
    // bigger handles for fingers than for mice
    var coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    var k = coarse ? 1.8 : 1;
    var u = this.upp, hx = o.sx / 2, hy = o.sy / 2, hs = 4.8 * u * k, off = 26 * u * k;
    var html = '<g transform="translate(' + f(o.x) + ' ' + f(o.y) + ') rotate(' + f(o.rot) + ')">' +
      '<rect class="sel-box" x="' + f(-hx) + '" y="' + f(-hy) + '" width="' + f(o.sx) + '" height="' + f(o.sy) + '"/>' +
      '<line class="sel-stem" x1="0" y1="' + f(-hy) + '" x2="0" y2="' + f(-hy - off) + '"/>';
    var hs2 = hs * 2;
    var handles = [['nw', -hx, -hy], ['ne', hx, -hy], ['se', hx, hy], ['sw', -hx, hy]];
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
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var t = e.target.closest ? e.target : null;
    var hEl = t && t.closest('[data-handle]');
    var oEl = t && t.closest('[data-id]');
    var p = this.toWorld(e), store = this.store, o;
    if (hEl && (o = store.get(store.selectedId))) {
      this.drag = {
        kind: hEl.getAttribute('data-handle') === 'rot' ? 'rotate' : 'scale',
        handle: hEl.getAttribute('data-handle'), id: o.id,
        start: { x: o.x, y: o.y, sx: o.sx, sy: o.sy, rot: o.rot }, p0: p, began: false
      };
    } else if (oEl) {
      var id = oEl.getAttribute('data-id');
      store.select(id);
      o = store.get(id);
      this.drag = { kind: 'move', id: id, start: { x: o.x, y: o.y }, p0: p, began: false };
    } else {
      store.select(null);
      return;
    }
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  Editor.prototype.move = function (e) {
    var d = this.drag;
    if (!d) return;
    var p = this.toWorld(e), store = this.store;
    var dx = p[0] - d.p0[0], dy = p[1] - d.p0[1];
    if (!d.began) {
      if (Math.hypot(dx, dy) < 3 * this.upp) return;      // a click, not a drag
      store.begin();
      d.began = true;
    }
    var s = d.start, b = this.bounds;
    if (d.kind === 'move') {
      store.patch(d.id, { x: G.clamp(s.x + dx, b.x0, b.x1), y: G.clamp(s.y + dy, b.y0, b.y1) });
    } else if (d.kind === 'rotate') {
      var a = deg(Math.atan2(p[1] - s.y, p[0] - s.x)) + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      store.patch(d.id, { rot: ((a % 360) + 360) % 360 });
    } else {
      var r = s.rot * G.DEG, c = Math.cos(r), sn = Math.sin(r);
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
    if (!this.drag) return;
    this.drag = null;
    try { this.svg.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  };

  /* ---------- keyboard ---------- */

  Editor.prototype.key = function (e) {
    var t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    var store = this.store, k = e.key, meta = e.ctrlKey || e.metaKey;
    if (meta && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
    if (meta && (k === 'y' || k === 'Y')) { e.preventDefault(); store.redo(); return; }
    var id = store.selectedId;
    if (!id) return;
    if (meta && (k === 'd' || k === 'D')) { e.preventDefault(); store.duplicate(id); return; }
    if (meta || e.altKey) return;
    var o = store.get(id), step = e.shiftKey ? 2 : 0.5;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); store.remove(id); }
    else if (k === 'Escape') store.select(null);
    else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      store.begin('nudge');
      store.patch(id, {
        x: o.x + (k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0),
        y: o.y + (k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0)
      });
    }
    else if (k === 'k' || k === 'K') store.setRole(id, o.role === 'cut' ? 'keep' : 'cut');
    else if (k === 'f' || k === 'F') store.toggleFlip(id);
    else if (k === '[') store.reorder(id, 'down');
    else if (k === ']') store.reorder(id, 'up');
  };

  root.SF.Editor = Editor;
})(typeof self !== 'undefined' ? self : this);
