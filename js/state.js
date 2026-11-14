/*
 * state.js - the design document and its undo history. No DOM in here.
 *
 * doc = {
 *   v: 1, arms: 4 | 6, hub: bool, hubR: number, nextId: number,
 *   objects: [{ id, type:'shape', shapeId | (polys, aspect, name), x, y, sx, sy, rot, flip, role:'cut'|'keep' }]
 * }
 * Objects are listed bottom to top; whatever is painted last wins (cut removes paper, keep restores it).
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
  var ARMS = [4, 6];

  function defaultDoc() {
    return { v: 1, arms: 6, hub: true, hubR: 7, nextId: 1, objects: [] };
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

  /** Make any input safe to use: unknown shapes, bad numbers and bad roles are dropped or clamped. */
  function sanitize(input) {
    var d = defaultDoc();
    if (!input || typeof input !== 'object') return d;
    d.arms = ARMS.indexOf(input.arms) >= 0 ? input.arms : 6;
    d.hub = input.hub !== false;
    d.hubR = G.clamp(num(input.hubR, 7), 0, 20);
    var maxId = 0;
    (Array.isArray(input.objects) ? input.objects : []).forEach(function (o) {
      if (!o || d.objects.length >= MAX_OBJECTS) return;
      var hasPolys = o.polys !== undefined;
      if (hasPolys ? !validPolys(o.polys) : !S.get(o.shapeId)) return;
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
      if (hasPolys) { out.polys = o.polys; out.aspect = num(o.aspect, 1); out.name = String(o.name || 'Traced shape').slice(0, 40); }
      else out.shapeId = o.shapeId;
      d.objects.push(out);
    });
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
  function randomDoc(arms, rand) {
    rand = rand || Math.random;
    var d = defaultDoc();
    d.arms = ARMS.indexOf(arms) >= 0 ? arms : 6;
    var count = 4 + Math.floor(rand() * 4);
    for (var i = 0; i < count; i++) {
      var sh = S.list[Math.floor(rand() * S.list.length)];
      var y = -(16 + rand() * 72);
      var hw = G.wedgeHalfWidthAt(d.arms, y);
      var size = G.clamp(6 + rand() * 14, 6, Math.max(7, hw * 2.2));
      var f = S.fit(sh.aspect);
      d.objects.push({
        id: 'o' + d.nextId++, type: 'shape', shapeId: sh.id,
        x: (rand() * 2 - 1) * hw * 0.7, y: y,
        sx: size * f.sx, sy: size * f.sy,
        rot: Math.floor(rand() * 24) * 15, flip: rand() < 0.5, role: 'cut'
      });
    }
    return d;
  }

  function createStore(initial) {
    var doc = sanitize(initial || defaultDoc());
    var selected = null;
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
    function fixSelection() { if (selected && !find(selected)) selected = null; }

    var store = {
      get doc() { return doc; },
      get selectedId() { return selected; },
      get: find,
      subscribe: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (s) { return s !== fn; }); }; },
      select: function (id) {
        id = id && find(id) ? id : null;
        if (id === selected) return;
        selected = id;
        emit('select');
      },
      begin: begin,
      /** Change an object in place. Call begin() first (once per gesture) so it can be undone. */
      patch: function (id, p) {
        var o = find(id);
        if (!o) return;
        for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) o[k] = p[k];
        o.sx = G.clamp(o.sx, 1, 200); o.sy = G.clamp(o.sy, 1, 200);
        o.x = G.clamp(o.x, -200, 200); o.y = G.clamp(o.y, -200, 200);
        emit('change');
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
          rot: 0, flip: false, role: opts.role === 'keep' ? 'keep' : 'cut'
        };
        doc.objects.push(o);
        selected = o.id;
        emit('change');
        return o;
      },
      remove: function (id) {
        var i = doc.objects.indexOf(find(id));
        if (i < 0) return;
        begin();
        doc.objects.splice(i, 1);
        fixSelection();
        emit('change');
      },
      duplicate: function (id) {
        var o = find(id);
        if (!o || doc.objects.length >= MAX_OBJECTS) return null;
        begin();
        var c = JSON.parse(JSON.stringify(o));
        c.id = newId(); c.x += 3; c.y -= 3;
        doc.objects.push(c);
        selected = c.id;
        emit('change');
        return c;
      },
      setRole: function (id, role) {
        var o = find(id);
        if (!o || (role !== 'cut' && role !== 'keep') || o.role === role) return;
        begin(); o.role = role; emit('change');
      },
      toggleFlip: function (id) {
        var o = find(id);
        if (!o) return;
        begin(); o.flip = !o.flip; emit('change');
      },
      /** dir: 'front' | 'back' | 'up' | 'down' */
      reorder: function (id, dir) {
        var o = find(id), a = doc.objects, i = a.indexOf(o);
        if (i < 0) return;
        var j = dir === 'front' ? a.length - 1 : dir === 'back' ? 0 : dir === 'up' ? Math.min(a.length - 1, i + 1) : Math.max(0, i - 1);
        if (j === i) return;
        begin(); a.splice(i, 1); a.splice(j, 0, o); emit('change');
      },
      setArms: function (n) {
        if (ARMS.indexOf(n) < 0 || n === doc.arms) return;
        begin(); doc.arms = n; emit('change');
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
        begin(); doc.objects = []; selected = null; emit('change');
      },
      replaceAll: function (next) {
        begin(); doc = sanitize(next); selected = null; emit('change');
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
    createStore: createStore, defaultDoc: defaultDoc, starterDoc: starterDoc,
    randomDoc: randomDoc, sanitize: sanitize, placement: placement,
    MAX_OBJECTS: MAX_OBJECTS, ARMS: ARMS
  };
});
