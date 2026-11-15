/* app.js - wires the store, editor, preview, analysis and page controls together. */
(function (root) {
  'use strict';
  var SF = root.SF, G = SF.geometry, S = SF.shapes, ST = SF.state, SM = SF.sampler, AN = SF.analyze, P = SF.presets;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = SF.config.storageKey, TOOL_KEY = SF.config.storageKey + '.tool';

  /* ---------- load / save ---------- */

  function loadSaved() {
    try { var s = root.localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) { /* storage blocked */ }
    return null;
  }
  var saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { root.localStorage.setItem(KEY, store.serialize()); } catch (e) { /* storage blocked */ }
    }, 250);
  }
  function loadTool() {
    try { var t = +root.localStorage.getItem(TOOL_KEY); if (t >= 0 && t <= 2) return t; } catch (e) { /* storage blocked */ }
    return 0;
  }

  var store = ST.createStore(loadSaved() || ST.starterDoc());
  var editor = new SF.Editor($('editor'), store);
  var tool = loadTool();                              // 0 kid scissors, 1 sharp scissors, 2 craft knife
  var edgeMode = 'fold';                              // 'fold' (centered on the fold) or 'inside'
  var analysis = null, overlayURL = null, stale = true, anTimer = 0;
  SF.store = store;                                   // handy in the browser console
  SF.getAnalysis = function () { return analysis; };

  /* ---------- shape library ---------- */

  $('tiles').innerHTML = S.list.map(function (sh) {
    var f = S.fit(sh.aspect);
    return '<button type="button" class="tile" data-shape="' + sh.id + '" title="' + sh.name + '" aria-label="Add ' + sh.name + '">' +
      '<svg viewBox="-0.62 -0.62 1.24 1.24" aria-hidden="true"><path d="' + S.pathD(sh) + '" transform="scale(' + f.sx + ' ' + f.sy + ')" fill-rule="evenodd"/></svg>' +
      '<span>' + sh.name + '</span></button>';
  }).join('');

  $('tiles').addEventListener('click', function (e) {
    var b = e.target.closest('[data-shape]');
    if (!b) return;
    if (!store.addShape(b.getAttribute('data-shape'))) toast('That is the most shapes the wedge can hold.');
    else if (isNarrow()) go('design');
  });

  /* ---------- left panel tabs + presets ---------- */

  var presetsBuilt = false;
  function buildPresets() {                       // thumbnails and ratings are made the first time the tab opens
    if (presetsBuilt) return;
    presetsBuilt = true;
    var host = $('presets');
    host.innerHTML = P.list.map(function (p) {
      return '<button type="button" class="preset" data-preset="' + p.id + '" aria-label="Load the ' + p.name + ' preset">' +
        '<svg viewBox="-108 -108 216 216" aria-hidden="true"></svg><b>' + p.name + '</b><span>' + p.blurb + '</span>' +
        '<span class="meta"></span></button>';
    }).join('');
    P.list.forEach(function (p) {
      var btn = host.querySelector('[data-preset="' + p.id + '"]'), doc = P.toDoc(p);
      SF.preview.render(btn.querySelector('svg'), doc, { idPrefix: 'pz-' + p.id });
      var r = AN.analyze(doc, { tool: 0 }).report;
      btn.querySelector('.meta').textContent = r.score + '/10 · ' + r.tool.short;
    });
  }
  function leftTab(name) {
    $('paneShapes').hidden = name !== 'shapes';
    $('panePresets').hidden = name !== 'presets';
    $('panePhoto').hidden = name !== 'photo';
    document.querySelectorAll('[data-ltab]').forEach(function (b) {
      var on = b.getAttribute('data-ltab') === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (name === 'presets') buildPresets();
  }
  document.querySelectorAll('[data-ltab]').forEach(function (b) {
    b.addEventListener('click', function () { leftTab(b.getAttribute('data-ltab')); });
  });
  $('presets').addEventListener('click', function (e) {
    var b = e.target.closest('[data-preset]');
    if (!b) return;
    var p = P.get(b.getAttribute('data-preset'));
    store.replaceAll(P.toDoc(p));
    if (p.needsImage) {
      leftTab('photo');                                   // the next step is adding a picture, so go straight there
      toast('Loaded ' + p.name + '. Add your picture, then drag or resize it until it touches the frame.', 'Undo', function () { store.undo(); });
    } else {
      toast('Loaded ' + p.name + ' in Build mode. Change anything you like.', 'Undo', function () { store.undo(); });
      if (isNarrow()) go('design');
    }
  });

  /* ---------- top bar ---------- */

  document.querySelectorAll('[data-arms]').forEach(function (b) {
    b.addEventListener('click', function () { store.setArms(+b.getAttribute('data-arms')); });
  });
  $('btnUndo').addEventListener('click', function () { store.undo(); });
  $('btnRedo').addEventListener('click', function () { store.redo(); });
  $('btnSurprise').addEventListener('click', function () {
    var d = ST.randomDoc(store.doc.arms, null, store.doc.mode);
    if (d.mode === 'build') {                      // loose pieces of paper would fall out, so link them up
      AN.autoBridge(d, tool).bars.forEach(function (bar) {
        d.objects.push(Object.assign({ id: 'o' + (d.nextId++), type: 'shape' }, bar));
      });
    }
    store.replaceAll(d);
  });
  document.querySelectorAll('[data-setmode]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-setmode'), had = store.doc.objects.length;
      if (!store.setMode(m)) return;
      var msg = m === 'build' ? 'Build mode: nothing is kept yet. Add shapes to build the flake.'
        : 'Cut mode: a full sheet of paper. Add shapes to cut them out.';
      if (had) toast(msg + ' Your design was cleared.', 'Undo', function () { store.undo(); });
      else toast(msg);
    });
  });
  $('btnReset').addEventListener('click', function () {
    if (!store.doc.objects.length) { toast('The wedge is already empty.'); return; }
    store.clear();
    toast('Template cleared.', 'Undo', function () { store.undo(); });
  });

  /* ---------- selection bar and align tools ---------- */

  function act(fn) { return function () { if (store.selectedIds.length) fn(); }; }
  $('btnFlip').addEventListener('click', act(function () { store.toggleFlip(); }));
  $('btnDup').addEventListener('click', act(function () {
    if (!store.duplicate()) toast('That is the most shapes the wedge can hold.');
  }));
  $('btnFront').addEventListener('click', act(function () { store.reorder(undefined, 'up'); }));
  $('btnBack').addEventListener('click', act(function () { store.reorder(undefined, 'down'); }));
  $('btnDel').addEventListener('click', act(function () { store.remove(); }));
  $('roleCut').addEventListener('click', act(function () { store.setRole(undefined, 'cut'); }));
  $('roleKeep').addEventListener('click', act(function () { store.setRole(undefined, 'keep'); }));
  $('btnGroup').addEventListener('click', function () {
    if (store.groupSelection()) toast('Grouped. They now move, resize and rotate together.', 'Undo', function () { store.undo(); });
  });
  $('btnUngroup').addEventListener('click', function () {
    if (store.ungroupSelection()) toast('Ungrouped. Click one shape to work on it alone.', 'Undo', function () { store.undo(); });
  });
  $('btnSelAll').addEventListener('click', function () { store.selectAll(); });

  $('alignCenter').addEventListener('click', act(function () { store.alignTo(undefined, 'center'); }));
  $('alignLeft').addEventListener('click', act(function () { store.alignTo(undefined, 'left', { flush: edgeMode === 'inside' }); }));
  $('alignRight').addEventListener('click', act(function () { store.alignTo(undefined, 'right', { flush: edgeMode === 'inside' }); }));
  document.querySelectorAll('[data-edge]').forEach(function (b) {
    b.addEventListener('click', function () {
      edgeMode = b.getAttribute('data-edge');
      document.querySelectorAll('[data-edge]').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
    });
  });

  $('hubOn').addEventListener('change', function () { store.setHub(this.checked); });
  $('hubR').addEventListener('input', function () { store.setHubR(+this.value); });
  $('showFolds').addEventListener('change', function () { renderPreview(); });
  $('showProblems').addEventListener('change', function () { applyOverlay(); });

  /* ---------- layers list ---------- */

  $('layers').addEventListener('click', function (e) {
    var li = e.target.closest('[data-id]');
    if (!li) return;
    var id = li.getAttribute('data-id');
    if (e.shiftKey || e.ctrlKey || e.metaKey) store.toggleSelect(id); else store.select(id);
  });

  function esc(t) {                                // belt and braces: every label is escaped before it becomes markup
    return String(t).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
  }
  function nameOf(o) { return o.label || (S.resolve(o) || { name: 'Shape' }).name; }

  function renderLayers() {
    var doc = store.doc, sel = store.selectedIds;
    $('layerCount').textContent = doc.objects.length;
    if (!doc.objects.length) {
      $('layers').innerHTML = '<li class="empty">Nothing yet. Pick a shape above.</li>';
      return;
    }
    $('layers').innerHTML = doc.objects.slice().reverse().map(function (o) {
      var chip = o.group ? '<span class="gchip" title="In a group. Click to select the whole group.">G' + o.group.slice(1) + '</span>' : '';
      return '<li' + (o.group ? ' class="in-group"' : '') + '><button type="button" class="layer' + (sel.indexOf(o.id) >= 0 ? ' on' : '') +
        '" data-id="' + o.id + '" aria-pressed="' + (sel.indexOf(o.id) >= 0) + '">' +
        '<span class="layer-main">' + chip + '<span class="layer-name">' + esc(nameOf(o)) + '</span></span>' +
        '<span class="pill pill-' + o.role + '">' + o.role + '</span></button></li>';
    }).join('');
  }

  /* ---------- controls ---------- */

  function renderControls() {
    var doc = store.doc, ids = store.selectedIds, objs = ids.map(store.get), o = objs[0], multi = objs.length > 1;
    var grouped = objs.filter(function (x) { return x.group; }), oneGroup = multi && objs.every(function (x) { return x.group && x.group === o.group; });
    document.querySelectorAll('[data-arms]').forEach(function (b) {
      b.setAttribute('aria-checked', String(+b.getAttribute('data-arms') === doc.arms));
    });
    document.querySelectorAll('[data-setmode]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-setmode') === doc.mode));
    });
    document.body.setAttribute('data-mode', doc.mode);
    $('editor').setAttribute('data-mode', doc.mode);
    $('shapesHint').textContent = doc.mode === 'build'
      ? 'Build mode: nothing is kept yet. Click a shape to add paper, then drag, resize and rotate it. Connect everything to the center.'
      : 'Click a shape to drop it on the wedge, then drag, resize and rotate it.';
    var info = G.groupInfo(doc.arms);
    $('foldMeta').textContent = info.wedgeDeg + '° wedge · ' + info.order + ' layers';
    $('foldChip').textContent = info.wedgeDeg + '° · ' + info.order + ' layers';
    $('btnUndo').disabled = !store.canUndo();
    $('btnRedo').disabled = !store.canRedo();
    $('hubOn').checked = doc.hub;
    $('hubR').value = doc.hubR;
    $('hubR').disabled = !doc.hub;

    ['btnFlip', 'btnDup', 'btnFront', 'btnBack', 'btnDel', 'roleCut', 'roleKeep', 'alignCenter'].forEach(function (id) { $(id).disabled = !o; });
    ['alignLeft', 'alignRight'].forEach(function (id) { $(id).disabled = !o || multi; });
    $('btnGroup').disabled = !multi || oneGroup;
    $('btnUngroup').disabled = !grouped.length;
    $('selName').textContent = !o ? 'Nothing selected'
      : multi ? (oneGroup ? 'Group · ' : '') + objs.length + ' shapes' : nameOf(o);
    $('selInfo').textContent = o && !multi ? 'rot ' + Math.round(o.rot) + '°' : '';
    var allRole = function (r) { return !!o && objs.every(function (x) { return x.role === r; }); };
    $('roleCut').setAttribute('aria-checked', String(allRole('cut')));
    $('roleKeep').setAttribute('aria-checked', String(allRole('keep')));
    $('selbar').classList.toggle('idle', !o);
    $('alignbar').classList.toggle('idle', !o);

    var H = Math.round(info.wedgeDeg / 2 * 10) / 10;
    $('alignCenter').title = multi ? 'Center (C): move the selection so its middle sits on the middle line'
      : 'Center (C): move to the middle line and rotate to 0°';
    $('alignLeft').title = 'Left edge: rotate to ' + H + '° along the left fold and snap onto it';
    $('alignRight').title = 'Right edge: rotate to ' + H + '° along the right fold and snap onto it';
  }

  /* ---------- preview, analysis, overlays ---------- */

  function problemOverlay() { return $('showProblems').checked && !stale && overlayURL ? overlayURL : null; }

  function renderPreview() {
    SF.preview.render($('preview'), store.doc, { idPrefix: 'pv', showFolds: $('showFolds').checked, overlayHref: problemOverlay() });
    var cut = SM.cutFraction(store.doc, 56);
    $('stat').textContent = store.doc.objects.length + ' shape' + (store.doc.objects.length === 1 ? '' : 's') +
      ' · ' + Math.round(cut * 100) + '% cut away';
  }

  function applyOverlay() {
    editor.setOverlay(problemOverlay());
    renderPreview();
  }

  function overlayDataURL(a) {
    var px = AN.overlayRGBA(a);
    if (!px) return null;
    var c = document.createElement('canvas');
    c.width = c.height = a.N;
    c.getContext('2d').putImageData(new ImageData(px, a.N, a.N), 0, 0);
    return c.toDataURL('image/png');
  }

  function scheduleAnalysis() {
    stale = true;
    editor.setOverlay(null);
    $('cardCx').classList.add('stale');
    $('cardChecks').classList.add('stale');
    clearTimeout(anTimer);
    anTimer = setTimeout(runAnalysis, 140);
  }

  function runAnalysis() {
    anTimer = 0;
    analysis = AN.analyze(store.doc, { tool: tool });
    overlayURL = overlayDataURL(analysis);
    stale = false;
    $('cardCx').classList.remove('stale');
    $('cardChecks').classList.remove('stale');
    renderComplexity();
    renderChecks();
    applyOverlay();
  }

  function renderComplexity() {
    var r = analysis.report, st = analysis.stats;
    $('cxNum').textContent = r.score;
    $('cxLabel').textContent = r.label;
    $('cxTool').textContent = r.tool.name;
    var meter = $('meter10');
    if (!meter.children.length) for (var i = 0; i < 10; i++) meter.appendChild(document.createElement('i'));
    for (var k = 0; k < 10; k++) meter.children[k].className = k < r.score ? 'on lvl' + (k < 3 ? 'a' : k < 6 ? 'b' : 'c') : '';
    meter.setAttribute('aria-label', 'Complexity ' + r.score + ' out of 10');
    $('cxNote').textContent = r.tooFine ? 'Some details are too fine even for a craft knife. Make them chunkier.' : r.tool.note;
    $('cxDrivers').innerHTML = st.cutLenUnits < 1 ? '<li>Nothing to cut yet. Add a shape.</li>'
      : r.drivers.map(function (d) { return '<li>' + d + '</li>'; }).join('') || '<li>Simple cuts, nothing tricky.</li>';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function renderChecks() {
    var st = analysis.stats, items = [], tn = AN.TOOLS[tool].short.toLowerCase();
    if (st.islands) {
      items.push({ sw: 'sw-island', text: st.fallsApart
        ? 'Nothing holds this design together: it would fall into ' + plural(st.islandPieces, 'piece', 'pieces') + '.'
        : plural(st.islands, 'island', 'islands') + ' would fall out (' + plural(st.islandPieces, 'loose piece', 'loose pieces') + ' once unfolded).' });
    }
    if (st.thinPaper) items.push({ sw: 'sw-thinpaper', text: plural(st.thinPaper, 'paper bridge or tip is', 'paper bridges or tips are') + ' too thin for ' + tn + '.' });
    if (st.thinCut) items.push({ sw: 'sw-thincut', text: plural(st.thinCut, 'cutout is', 'cutouts are') + ' too narrow for ' + tn + '.' });
    $('issues').innerHTML = items.length
      ? items.map(function (i) { return '<li class="issue bad"><i class="sw ' + i.sw + '"></i><span>' + i.text + '</span></li>'; }).join('')
      : '<li class="issue good"><i class="tick"></i><span>All clear. Nothing will fall out' + (store.doc.objects.length ? ' and every detail suits ' + tn + '.' : '.') + '</span></li>';
    $('checksTag').textContent = items.length ? plural(items.length, 'issue', 'issues') : 'all clear';
    $('checksTag').classList.toggle('tag-bad', items.length > 0);
    $('btnBridges').disabled = !st.islands;
    $('btnClearBridges').hidden = !store.doc.objects.some(function (o) { return o.bridge; });
  }

  /* tool picker */
  $('toolSeg').innerHTML = AN.TOOLS.map(function (t, i) {
    return '<button type="button" role="radio" aria-checked="' + (i === tool) + '" data-tool="' + i + '" title="' + t.name + ': handles details down to about ' + t.width + ' mm">' + t.short + '</button>';
  }).join('');
  $('toolSeg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tool]');
    if (!b) return;
    tool = +b.getAttribute('data-tool');
    try { root.localStorage.setItem(TOOL_KEY, String(tool)); } catch (err) { /* storage blocked */ }
    $('toolSeg').querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
    scheduleAnalysis();
  });

  $('btnBridges').addEventListener('click', function () {
    var res = AN.autoBridge(store.doc, tool);
    if (!res.bars.length) { toast('Could not find a spot for a bridge. Try moving a shape.'); return; }
    store.addObjects(res.bars);
    toast('Added ' + plural(res.bars.length, 'bridge', 'bridges') + (res.remaining ? ', but ' + plural(res.remaining, 'island is', 'islands are') + ' still loose.' : '.'),
      'Undo', function () { store.undo(); });
  });
  $('btnClearBridges').addEventListener('click', function () {
    var n = store.removeBridges();
    if (n) toast('Removed ' + plural(n, 'bridge', 'bridges') + '.', 'Undo', function () { store.undo(); });
  });

  /* ---------- render loop ---------- */

  var raf = 0;
  function renderAll() {
    raf = 0;
    editor.render();
    renderPreview();
    renderControls();
    renderLayers();
  }
  store.subscribe(function (kind) {
    if (!raf) raf = requestAnimationFrame(renderAll);
    if (kind === 'change') { saveSoon(); scheduleAnalysis(); }
  });
  renderAll();
  scheduleAnalysis();

  /* ---------- toast ---------- */

  var toastTimer = 0;
  function toast(msg, actionLabel, action) {
    var t = $('toast');
    $('toastMsg').textContent = msg;
    var b = $('toastAction');
    b.hidden = !actionLabel;
    b.textContent = actionLabel || '';
    b.onclick = function () { if (action) action(); t.hidden = true; };
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 5000);
  }

  SF.printUI.init({ store: store, toast: toast, getTool: function () { return tool; } });
  SF.geoLab.init({ store: store, toast: toast, getTool: function () { return tool; } });
  SF.photoPanel.init({ store: store, toast: toast, onAdded: function () { if (isNarrow()) go('design'); } });

  /* ---------- phone tabs ---------- */

  function isNarrow() { return root.matchMedia && root.matchMedia('(max-width: 960px)').matches; }
  function go(tab) {
    document.body.setAttribute('data-tab', tab);
    document.querySelectorAll('[data-go]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-go') === tab); });
  }
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { go(b.getAttribute('data-go')); });
  });
})(typeof self !== 'undefined' ? self : this);
