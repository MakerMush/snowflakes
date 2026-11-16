/*
 * state.js - the design document and its undo history. No DOM in here.
 *
 * doc = {
 *   v: 1, arms: 4 | 6, hub: bool, hubR: number, nextId: number,
 *   objects: [{ id, type:'shape', shapeId | (polys, aspect, name), x, y, sx, sy, rot, flip, role:'cut'|'keep', group?:'g1' }]
 * }
 * Objects are listed bottom to top; whatever is painted last wins (cut removes paper, keep restores it).
 * Objects sharing a `group` id (two or more, always side by side in the list) are edited as one unit.
 * The selection (one or more ids) lives in the store but is not part of the document or the undo history.
 */
(function (root, factory) {
  var G, S;
  if (typeof module === 'object' && module.exports) { G = require('./geometry'); S = require('./shapes'); }
  else { G = root.SF.geometry; S = root.SF.shapes; }
  var api = factory(G, S);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.SF.state = api; }
})(typeof self !== 'undefined' ? self : this, function (G, S) {
  'use strict';

  var MAX_OBJECTS = 60;
  var MAX_HISTORY = 100;
  var MAX_POINTS = 40000;                 // traced vertices in a whole document (keeps loaded files from freezing the page)
  var ARMS = [4, 6];
  var KID_MIN_SIZE = 12;                  // kid mode: no shape smaller than this (about 11 mm), so kid scissors can cut it

  /** Smallest width/height a shape may have. Bridges are exempt: they are thin bars on purpose. */
  function minSizeOf(opts) { return opts && opts.kids ? KID_MIN_SIZE : 1; }
  function clampSize(o, min) {
    var m = o.bridge ? 1 : min;
    o.sx = G.clamp(o.sx, m, 200); o.sy = G.clamp(o.sy, m, 200);
  }

  function defaultDoc() {
    return { v: 1, arms: 6, mode: 'cut', hub: true, hubR: 7, nextId: 1, objects: [] };
  }

  /** A pleasant first design so the preview is not an empty disc. Fits both fold types. */
  function starterDoc() {
    var d = defaultDoc();
    var items = [
      ['petal', 0, -84, 7, 20, 0],
      ['diamond', 0, -62, 9, 17, 0],
      ['circle', 0, -43, 8, 8, 0],
      ['teardrop', 0, -26, 6, 11, 180]
    ];
    items.forEach(function (it) {
      var s = S.get(it[0]);
      d.objects.push({
        id: 'o' + d.nextId++, type: 'shape', shapeId: it[0],
        x: it[1], y: it[2], sx: it[3], sy: it[4], rot: it[5], flip: false, role: 'cut'
      });
      if (!s) throw new Error('starter shape missing: ' + it[0]);
    });
    return d;
  }

  /**
   * Kid mode's first design: 4 arms, chunky shapes that each touch an edge (a fold or the outer rim),
   * so kid scissors can cut every one without a grown-up poking a hole through the middle.
   */
  function kidStarterDoc() {
    var d = defaultDoc(), k = Math.tan(Math.PI / 8);        // fold edges of the 4-arm wedge: x = +-k * |y|
    d.arms = 4;
    [['circle', 0, -98, 24, 24, 0], ['heart', -k * 60, -60, 16, 16, 337.5], ['circle', k * 35, -35, 14, 14, 0]].forEach(function (it) {
      d.objects.push({ id: 'o' + d.nextId++, type: 'shape', shapeId: it[0], x: it[1], y: it[2], sx: it[3], sy: it[4], rot: it[5], flip: false, role: 'cut' });
    });
    return d;
  }

  /** Labels are shown as text, never markup: drop angle brackets, quotes, ampersands and control characters. */
  function cleanText(v, max, fallback) {
    var t = String(v === undefined || v === null ? '' : v).replace(/[<>&"'`\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
    return t || fallback;
  }

  function num(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }

  function validPolys(polys) {
    if (!Array.isArray(polys) || !polys.length) return false;
    var total = 0;
    for (var i = 0; i < polys.length; i++) {
      var p = polys[i];
      if (!Array.isArray(p) || p.length < 3) return false;
      for (var j = 0; j < p.length; j++) {
        if (!Array.isArray(p[j]) || !isFinite(p[j][0]) || !isFinite(p[j][1])) return false;
      }
      total += p.length;
    }
    return total <= 8000;
  }

  /**
   * Groups behave as one unit, so keep them tidy: a group needs at least two members, and its members
   * sit side by side in the stacking order (at the spot of its topmost member).
   */
  function normalizeGroups(objs) {
    var count = {}, top = {};
    objs.forEach(function (o, i) { if (o.group) { count[o.group] = (count[o.group] || 0) + 1; top[o.group] = i; } });
    objs.forEach(function (o) { if (o.group && count[o.group] < 2) delete o.group; });
    var out = [];
    objs.forEach(function (o, i) {
      if (!o.group) { out.push(o); return; }
      if (i !== top[o.group]) return;
      objs.forEach(function (m) { if (m.group === o.group) out.push(m); });
    });
    return out;
  }

  /** Axis-aligned box around the selection boxes of some objects (what the group handles wrap). */
  function boundsOf(objs) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    objs.forEach(function (o) {
      var r = (o.rot || 0) * G.DEG, c = Math.cos(r), sn = Math.sin(r), hx = o.sx / 2, hy = o.sy / 2;
      [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].forEach(function (q) {
        var x = o.x + c * q[0] - sn * q[1], y = o.y + sn * q[0] + c * q[1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      });
    });
    if (x0 === Infinity) return null;
    return { x0: x0, y0: y0, x1: x1, y1: y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }

  /** Make any input safe to use: unknown shapes, bad numbers and bad roles are dropped or clamped.
   *  opts.kids also enforces the kid-mode minimum shape size. */
  function sanitize(input, opts) {
    var d = defaultDoc(), minSize = minSizeOf(opts);
    if (!input || typeof input !== 'object') return d;
    d.arms = ARMS.indexOf(input.arms) >= 0 ? input.arms : 6;
    d.mode = input.mode === 'build' ? 'build' : 'cut';
    d.hub = input.hub !== false;
    d.hubR = G.clamp(num(input.hubR, 7), 0, 20);
    var maxId = 0, points = 0;
    (Array.isArray(input.objects) ? input.objects : []).forEach(function (o) {
      if (!o || d.objects.length >= MAX_OBJECTS) return;
      var hasPolys = o.polys !== undefined;
      if (hasPolys ? !validPolys(o.polys) : !S.get(o.shapeId)) return;
      if (hasPolys) {
        var np = o.polys.reduce(function (a, p) { return a + p.length; }, 0);
        if (points + np > MAX_POINTS) return;
        points += np;
      }
      var id = typeof o.id === 'string' && /^o\d+$/.test(o.id) ? o.id : null;
      if (!id || d.objects.some(function (x) { return x.id === id; })) id = 'o' + (maxId + 1 + d.objects.length);
      var m = /^o(\d+)$/.exec(id);
      if (m) maxId = Math.max(maxId, +m[1]);
      var out = {
        id: id, type: 'shape',
        x: G.clamp(num(o.x, 0), -200, 200), y: G.clamp(num(o.y, -50), -200, 200),
        sx: G.clamp(num(o.sx, 15), 1, 200), sy: G.clamp(num(o.sy, 15), 1, 200),
        rot: ((num(o.rot, 0) % 360) + 360) % 360, flip: !!o.flip,
        role: o.role === 'keep' ? 'keep' : 'cut'
      };
      if (hasPolys) { out.polys = o.polys; out.aspect = num(o.aspect, 1); out.name = cleanText(o.name, 40, 'Traced shape'); }
      else out.shapeId = o.shapeId;
      if (typeof o.label === 'string' && cleanText(o.label, 40, '')) out.label = cleanText(o.label, 40, '');
      if (o.bridge) out.bridge = true;
      clampSize(out, minSize);
      if (typeof o.group === 'string' && /^g\d+$/.test(o.group)) out.group = o.group;
      d.objects.push(out);
    });
    d.objects = normalizeGroups(d.objects);
    d.nextId = Math.max(num(input.nextId, 1), maxId + 1, d.objects.length + 1);
    return d;
  }

  /** Where a newly added shape lands, and how big it is, so repeated adds do not stack. */
  function placement(k, arms) {
    var ys = [-58, -36, -80, -22, -68, -46];
    var y = ys[k % ys.length];
    var hw = G.wedgeHalfWidthAt(arms, y);
    var size = G.clamp(hw * 2 * 0.6, 9, 26);
    var x = (k % 2 ? 1 : -1) * hw * 0.12 * (k % 3) + 0;   // "+ 0" turns -0 into 0
    return { x: x, y: y, size: size };
  }

  /** A random starting flake ("Surprise me"). rand() defaults to Math.random; pass a seeded one in tests. */
  function randomDoc(arms, rand, mode) {
    rand = rand || Math.random;
    var d = defaultDoc();
    d.arms = ARMS.indexOf(arms) >= 0 ? arms : 6;
    d.mode = mode === 'build' ? 'build' : 'cut';
    var build = d.mode === 'build';
    var count = 4 + Math.floor(rand() * 4);
    for (var i = 0; i < count; i++) {
      var sh = S.list[Math.floor(rand() * S.list.length)];
      var y = -(16 + rand() * 72);
      var hw = G.wedgeHalfWidthAt(d.arms, y);
      var size = G.clamp(6 + rand() * 14, 6, Math.max(7, hw * 2.2));
      var f = S.fit(sh.aspect);
      d.objects.push({
        id: 'o' + d.nextId++, type: 'shape', shapeId: sh.id,
        x: (rand() * 2 - 1) * hw * (build ? 0.3 : 0.7), y: y,
        sx: size * f.sx, sy: size * f.sy,
        rot: Math.floor(rand() * 24) * 15, flip: rand() < 0.5, role: build ? 'keep' : 'cut'
      });
    }
    return d;
  }

  /** opts.kids: kid mode (shapes never shrink below KID_MIN_SIZE). */
  function createStore(initial, opts) {
    var storeOpts = { kids: !!(opts && opts.kids) }, MIN = minSizeOf(storeOpts);
    var doc = sanitize(initial || defaultDoc(), storeOpts);
    var selection = [];                  // ids, in the order they were picked
    var past = [], future = [];
    var lastKey = null, lastT = 0;
    var subs = [];

    function snapshot() { return JSON.stringify(doc); }
    function emit(kind) { for (var i = 0; i < subs.length; i++) subs[i](kind); }

    /** Record an undo step. Calls with the same key within 700 ms (arrow-key nudges) share one step. */
    function begin(key) {
      var now = Date.now();
      if (key && key === lastKey && now - lastT < 700) { lastT = now; return; }
      past.push(snapshot());
      if (past.length > MAX_HISTORY) past.shift();
      future.length = 0;
      lastKey = key || null;
      lastT = now;
    }

    function find(id) {
      for (var i = 0; i < doc.objects.length; i++) if (doc.objects[i].id === id) return doc.objects[i];
      return null;
    }
    function newId() { return 'o' + doc.nextId++; }
    function newGroupId() {
      var max = 0;
      doc.objects.forEach(function (o) { var m = o.group && /^g(\d+)$/.exec(o.group); if (m) max = Math.max(max, +m[1]); });
      return 'g' + (max + 1);
    }
    function idsOf(objs) { return objs.map(function (o) { return o.id; }); }
    function sameList(a, b) { return a.length === b.length && a.every(function (v, i) { return v === b[i]; }); }
    function setSelection(ids) {
      if (sameList(ids, selection)) return;
      selection = ids;
      emit('select');
    }
    function fixSelection() { selection = selection.filter(function (id) { return !!find(id); }); }

    /** The objects an operation applies to, bottom to top: every member of any group touched. */
    function expand(ids) {
      var hit = {}, groups = {};
      ids.forEach(function (id) { var o = find(id); if (o) { hit[id] = true; if (o.group) groups[o.group] = true; } });
      return doc.objects.filter(function (o) { return hit[o.id] || (o.group && groups[o.group]); });
    }
    /** arg: undefined = the current selection, an id, or an array of ids. */
    function target(arg) {
      return expand(arg === undefined ? selection : typeof arg === 'string' ? [arg] : (arg || []));
    }
    function clampPos(o) { o.x = G.clamp(o.x, -200, 200); o.y = G.clamp(o.y, -200, 200); }

    var store = {
      get doc() { return doc; },
      minSize: MIN,
      /** The selected id when exactly one object is selected, else null. */
      get selectedId() { return selection.length === 1 ? selection[0] : null; },
      get selectedIds() { return selection.slice(); },
      get: find,
      subscribe: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (s) { return s !== fn; }); }; },

      /* ----- selection (a click on a grouped object selects its whole group) ----- */
      select: function (id) { setSelection(id && find(id) ? idsOf(expand([id])) : []); },
      selectIds: function (ids, additive) {
        var all = (additive ? selection : []).concat(ids || []);
        setSelection(idsOf(expand(all)));
      },
      toggleSelect: function (id) {
        if (!find(id)) return;
        var members = idsOf(expand([id]));
        if (selection.indexOf(id) >= 0) setSelection(selection.filter(function (x) { return members.indexOf(x) < 0; }));
        else setSelection(idsOf(expand(selection.concat(members))));
      },
      selectAll: function () { setSelection(idsOf(doc.objects)); },
      selectionBounds: function () { return boundsOf(selection.map(find).filter(Boolean)); },
      isGrouped: function (id) { var o = find(id); return !!(o && o.group); },

      /* ----- editing ----- */
      begin: begin,
      /** Change an object in place. Call begin() first (once per gesture) so it can be undone. */
      patch: function (id, p) {
        var o = find(id);
        if (!o) return;
        for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) o[k] = p[k];
        clampSize(o, MIN);
        clampPos(o);
        emit('change');
      },
      /**
       * Move / scale / rotate several objects as one, from the state they had when the gesture began.
       * base: [{id,x,y,sx,sy,rot}] snapshots; t: { dx, dy, s, theta (deg, clockwise), cx, cy } with the
       * scale and rotation centred on (cx, cy). Call begin() once per gesture first.
       */
      transform: function (base, t) {
        var s = t.s === undefined ? 1 : t.s, th = (t.theta || 0) * G.DEG, c = Math.cos(th), sn = Math.sin(th);
        var lo = 0, hi = Infinity;
        base.forEach(function (b) {
          var o = find(b.id), m = o && !o.bridge ? MIN : 1;
          lo = Math.max(lo, m / b.sx, m / b.sy); hi = Math.min(hi, 200 / b.sx, 200 / b.sy);
        });
        s = G.clamp(s, Math.min(lo, hi), hi);         // sizes stay between the minimum (1, or more in kid mode) and 200 for every member
        base.forEach(function (b) {
          var o = find(b.id);
          if (!o) return;
          var px = b.x - t.cx, py = b.y - t.cy;
          o.x = t.cx + (t.dx || 0) + s * (c * px - sn * py);
          o.y = t.cy + (t.dy || 0) + s * (sn * px + c * py);
          o.sx = b.sx * s; o.sy = b.sy * s;
          o.rot = (((b.rot + (t.theta || 0)) % 360) + 360) % 360;
          clampPos(o);
        });
        emit('change');
      },
      /** Snapshot of the selection (or the given ids) in the shape transform() wants. */
      snapshotOf: function (arg) {
        return target(arg).map(function (o) { return { id: o.id, x: o.x, y: o.y, sx: o.sx, sy: o.sy, rot: o.rot }; });
      },

      addShape: function (shapeId, opts) {
        opts = opts || {};
        var sh = S.get(shapeId);
        if (!sh || doc.objects.length >= MAX_OBJECTS) return null;
        begin();
        var pl = placement(doc.objects.length, doc.arms);
        var f = S.fit(sh.aspect);
        var o = {
          id: newId(), type: 'shape', shapeId: shapeId,
          x: pl.x, y: pl.y, sx: pl.size * f.sx, sy: pl.size * f.sy,
          rot: 0, flip: false,
          role: opts.role ? (opts.role === 'keep' ? 'keep' : 'cut') : (doc.mode === 'build' ? 'keep' : 'cut')
        };
        clampSize(o, MIN);
        doc.objects.push(o);
        selection = [o.id];
        emit('change');
        return o;
      },
      /**
       * Add a traced outline (polygons already normalized to the unit box, see shapes.normalize).
       * It lands mid-wedge at a size that shows the whole picture; the role follows the mode.
       */
      addTrace: function (polys, aspect, name, opts) {
        opts = opts || {};
        if (doc.objects.length >= MAX_OBJECTS) return null;
        var probe = sanitize({ arms: doc.arms, objects: [{ id: 'o1', polys: polys, aspect: aspect, name: name }] });
        if (!probe.objects.length) return null;
        begin();
        var f = S.fit(aspect), size = Math.min(40, 28 / f.sx);   // about one wedge wide at y = -58
        var o = {
          id: newId(), type: 'shape', polys: probe.objects[0].polys, aspect: probe.objects[0].aspect,
          name: probe.objects[0].name, x: 0, y: -58, sx: size * f.sx, sy: size * f.sy, rot: 0, flip: false,
          role: opts.role ? (opts.role === 'keep' ? 'keep' : 'cut') : (doc.mode === 'build' ? 'keep' : 'cut')
        };
        clampSize(o, MIN);
        doc.objects.push(o);
        selection = [o.id];
        emit('change');
        return o;
      },
      /** Add several ready-made objects (such as bridges) as one undo step. Selection is left alone. */
      addObjects: function (drafts) {
        var room = MAX_OBJECTS - doc.objects.length, added = [];
        if (!drafts || !drafts.length || room <= 0) return added;
        begin();
        drafts.slice(0, room).forEach(function (d) {
          var o = sanitize({ arms: doc.arms, objects: [Object.assign({}, d, { id: 'o1', group: undefined })] }, storeOpts).objects[0];
          if (!o) return;
          o.id = newId();
          doc.objects.push(o);
          added.push(o);
        });
        emit('change');
        return added;
      },
      removeBridges: function () {
        var keep = doc.objects.filter(function (o) { return !o.bridge; });
        if (keep.length === doc.objects.length) return 0;
        begin();
        var removed = doc.objects.length - keep.length;
        doc.objects = normalizeGroups(keep);
        fixSelection();
        emit('change');
        return removed;
      },
      /**
       * Snap an object to the wedge. mode: 'center' (onto the middle line, rotation 0) or
       * 'left' / 'right' (rotated to that fold edge's angle and moved onto it). With opts.flush the
       * object sits inside the wedge with its side touching the fold; otherwise it is centred on the
       * fold line, so the mirrored copy completes a symmetric shape. Distance from the tip is kept.
       * With several objects selected only 'center' works: they move together so the group's middle
       * sits on the middle line (no rotation).
       */
      alignTo: function (arg, mode, opts) {
        var objs = target(arg);
        if (!objs.length) return;
        if (objs.length > 1) {
          if (mode !== 'center') return;
          var bb = boundsOf(objs);
          if (Math.abs(bb.cx) < 1e-9) return;
          begin();
          objs.forEach(function (o) { o.x -= bb.cx; clampPos(o); });
          emit('change');
          return;
        }
        var o = objs[0];
        var H = G.halfAngle(doc.arms), patch;
        if (mode === 'center') {
          patch = { x: 0, rot: 0 };
        } else if (mode === 'left' || mode === 'right') {
          var sg = mode === 'left' ? -1 : 1;
          var u = [sg * Math.sin(H), -Math.cos(H)];                      // direction of the edge, away from the tip
          var t = G.clamp(o.x * u[0] + o.y * u[1], 2, G.R - 2);          // how far along the edge the object sits
          var x = u[0] * t, y = u[1] * t;
          if (opts && opts.flush) {
            var inward = mode === 'left' ? [Math.cos(H), -Math.sin(H)] : [-Math.cos(H), -Math.sin(H)];
            x += inward[0] * o.sx / 2; y += inward[1] * o.sx / 2;
          }
          patch = { x: x, y: y, rot: (((sg * H * 180 / Math.PI) % 360) + 360) % 360 };
        } else return;
        begin();
        for (var k in patch) o[k] = patch[k];
        emit('change');
      },
      remove: function (arg) {
        var objs = target(arg);
        if (!objs.length) return;
        begin();
        doc.objects = normalizeGroups(doc.objects.filter(function (o) { return objs.indexOf(o) < 0; }));
        fixSelection();
        emit('change');
      },
      /** Copies land on top, a little off to the side. A copied group becomes its own new group.
       *  Returns the copy (one object) or an array of copies, or null when there is no room. */
      duplicate: function (arg) {
        var objs = target(arg);
        if (!objs.length || doc.objects.length + objs.length > MAX_OBJECTS) return null;
        begin();
        var gmap = {}, copies = [];
        objs.forEach(function (o) {
          var c = JSON.parse(JSON.stringify(o));
          c.id = newId(); c.x += 3; c.y -= 3;
          clampPos(c);
          if (c.group) {
            if (!gmap[c.group]) {
              var max = 0;
              doc.objects.concat(copies).forEach(function (q) { var m = q.group && /^g(\d+)$/.exec(q.group); if (m) max = Math.max(max, +m[1]); });
              gmap[c.group] = 'g' + (max + 1);
            }
            c.group = gmap[c.group];
          }
          copies.push(c);
        });
        copies.forEach(function (c) { doc.objects.push(c); });
        selection = idsOf(copies);
        emit('change');
        return copies.length === 1 ? copies[0] : copies;
      },
      setRole: function (arg, role) {
        if (role !== 'cut' && role !== 'keep') return;
        var objs = target(arg).filter(function (o) { return o.role !== role; });
        if (!objs.length) return;
        begin();
        objs.forEach(function (o) { o.role = role; });
        emit('change');
      },
      /** One object: mirrors it in place. Several: mirrors the whole set left to right about its middle. */
      toggleFlip: function (arg) {
        var objs = target(arg);
        if (!objs.length) return;
        begin();
        if (objs.length === 1) objs[0].flip = !objs[0].flip;
        else {
          var cx = boundsOf(objs).cx;
          objs.forEach(function (o) {
            o.x = 2 * cx - o.x; o.rot = (((-o.rot) % 360) + 360) % 360; o.flip = !o.flip; clampPos(o);
          });
        }
        emit('change');
      },
      /** dir: 'front' | 'back' | 'up' | 'down'. Groups move as one block and hop over whole groups. */
      reorder: function (arg, dir) {
        var objs = target(arg), a = doc.objects;
        if (!objs.length) return;
        var rest = a.filter(function (o) { return objs.indexOf(o) < 0; });
        var below = function (o) { return rest.filter(function (r) { return a.indexOf(r) < a.indexOf(o); }).length; };
        var idx;
        if (dir === 'front') idx = rest.length;
        else if (dir === 'back') idx = 0;
        else if (dir === 'up') {
          idx = below(objs[objs.length - 1]);
          if (idx < rest.length) { var g = rest[idx].group; idx++; while (g && idx < rest.length && rest[idx].group === g) idx++; }
        } else {
          idx = below(objs[0]);
          if (idx > 0) { var g2 = rest[idx - 1].group; idx--; while (g2 && idx > 0 && rest[idx - 1].group === g2) idx--; }
        }
        var next = rest.slice(0, idx).concat(objs, rest.slice(idx));
        if (next.every(function (o, i) { return o === a[i]; })) return;
        begin(); doc.objects = next; emit('change');
      },
      /** Tie the selected shapes together so they select, move, scale and rotate as one. */
      groupSelection: function () {
        var objs = target();
        if (objs.length < 2) return null;
        var g0 = objs[0].group;
        if (g0 && objs.every(function (o) { return o.group === g0; })) return g0;   // already one group
        begin();
        var gid = newGroupId();
        objs.forEach(function (o) { o.group = gid; });
        doc.objects = normalizeGroups(doc.objects);
        emit('change');
        return gid;
      },
      /** Release every group touched by the selection. The shapes stay selected. Returns how many were released. */
      ungroupSelection: function () {
        var objs = target().filter(function (o) { return o.group; });
        if (!objs.length) return 0;
        begin();
        objs.forEach(function (o) { delete o.group; });
        emit('change');
        return objs.length;
      },

      setArms: function (n) {
        if (ARMS.indexOf(n) < 0 || n === doc.arms) return;
        begin(); doc.arms = n; emit('change');
      },
      /** Switch between Cut mode (full paper, shapes cut holes) and Build mode (no paper, shapes add it).
       *  Each mode starts from a fresh wedge so shapes never silently change meaning. One undo step. */
      setMode: function (mode) {
        if (mode !== 'cut' && mode !== 'build') return false;
        if (mode === doc.mode) return false;
        begin(); doc.mode = mode; doc.objects = []; selection = []; emit('change');
        return true;
      },
      setHub: function (on) {
        on = !!on;
        if (on === doc.hub) return;
        begin(); doc.hub = on; emit('change');
      },
      setHubR: function (v) {
        v = G.clamp(num(v, 7), 0, 20);
        if (v === doc.hubR) return;
        begin('hubR'); doc.hubR = v; emit('change');
      },
      clear: function () {
        if (!doc.objects.length) return;
        begin(); doc.objects = []; selection = []; emit('change');
      },
      replaceAll: function (next) {
        begin(); doc = sanitize(next, storeOpts); selection = []; emit('change');
      },
      undo: function () {
        if (!past.length) return false;
        future.push(snapshot());
        doc = JSON.parse(past.pop());
        lastKey = null; fixSelection(); emit('change');
        return true;
      },
      redo: function () {
        if (!future.length) return false;
        past.push(snapshot());
        doc = JSON.parse(future.pop());
        lastKey = null; fixSelection(); emit('change');
        return true;
      },
      canUndo: function () { return past.length > 0; },
      canRedo: function () { return future.length > 0; },
      serialize: function () { return snapshot(); }
    };
    return store;
  }

  return {
    createStore: createStore, defaultDoc: defaultDoc, starterDoc: starterDoc, kidStarterDoc: kidStarterDoc,
    randomDoc: randomDoc, sanitize: sanitize, placement: placement, boundsOf: boundsOf,
    MAX_OBJECTS: MAX_OBJECTS, ARMS: ARMS, KID_MIN_SIZE: KID_MIN_SIZE
  };
});
