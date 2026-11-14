/* app.js - wires the store, editor, preview and page controls together. */
(function (root) {
  'use strict';
  var SF = root.SF, G = SF.geometry, S = SF.shapes, ST = SF.state, SM = SF.sampler;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = SF.config.storageKey;

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

  var store = ST.createStore(loadSaved() || ST.starterDoc());
  var editor = new SF.Editor($('editor'), store);
  SF.store = store;                                   // handy in the browser console

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

  /* ---------- top bar ---------- */

  document.querySelectorAll('[data-arms]').forEach(function (b) {
    b.addEventListener('click', function () { store.setArms(+b.getAttribute('data-arms')); });
  });
  $('btnUndo').addEventListener('click', function () { store.undo(); });
  $('btnRedo').addEventListener('click', function () { store.redo(); });
  $('btnSurprise').addEventListener('click', function () { store.replaceAll(ST.randomDoc(store.doc.arms)); });
  $('btnReset').addEventListener('click', function () {
    if (!store.doc.objects.length) { toast('The wedge is already empty.'); return; }
    store.clear();
    toast('Template cleared.', 'Undo', function () { store.undo(); });
  });

  /* ---------- selection bar ---------- */

  function withSel(fn) { return function () { var id = store.selectedId; if (id) fn(id); }; }
  $('btnFlip').addEventListener('click', withSel(function (id) { store.toggleFlip(id); }));
  $('btnDup').addEventListener('click', withSel(function (id) { store.duplicate(id); }));
  $('btnFront').addEventListener('click', withSel(function (id) { store.reorder(id, 'up'); }));
  $('btnBack').addEventListener('click', withSel(function (id) { store.reorder(id, 'down'); }));
  $('btnDel').addEventListener('click', withSel(function (id) { store.remove(id); }));
  $('roleCut').addEventListener('click', withSel(function (id) { store.setRole(id, 'cut'); }));
  $('roleKeep').addEventListener('click', withSel(function (id) { store.setRole(id, 'keep'); }));

  $('hubOn').addEventListener('change', function () { store.setHub(this.checked); });
  $('hubR').addEventListener('input', function () { store.setHubR(+this.value); });
  $('showFolds').addEventListener('change', function () { renderPreview(); });

  /* ---------- layers list ---------- */

  $('layers').addEventListener('click', function (e) {
    var li = e.target.closest('[data-id]');
    if (li) store.select(li.getAttribute('data-id'));
  });

  function renderLayers() {
    var doc = store.doc, sel = store.selectedId;
    $('layerCount').textContent = doc.objects.length;
    if (!doc.objects.length) {
      $('layers').innerHTML = '<li class="empty">Nothing yet. Pick a shape above.</li>';
      return;
    }
    $('layers').innerHTML = doc.objects.slice().reverse().map(function (o) {
      var sh = S.resolve(o);
      return '<li><button type="button" class="layer' + (o.id === sel ? ' on' : '') + '" data-id="' + o.id + '">' +
        '<span class="layer-name">' + (sh ? sh.name : 'Shape') + '</span>' +
        '<span class="pill pill-' + o.role + '">' + o.role + '</span></button></li>';
    }).join('');
  }

  /* ---------- panels ---------- */

  function renderControls() {
    var doc = store.doc, o = store.get(store.selectedId);
    document.querySelectorAll('[data-arms]').forEach(function (b) {
      b.setAttribute('aria-checked', String(+b.getAttribute('data-arms') === doc.arms));
    });
    var info = G.groupInfo(doc.arms);
    $('foldMeta').textContent = info.wedgeDeg + '° wedge · ' + info.order + ' layers';
    $('foldChip').textContent = info.wedgeDeg + '° · ' + info.order + ' layers';
    $('btnUndo').disabled = !store.canUndo();
    $('btnRedo').disabled = !store.canRedo();
    $('hubOn').checked = doc.hub;
    $('hubR').value = doc.hubR;
    $('hubR').disabled = !doc.hub;

    ['btnFlip', 'btnDup', 'btnFront', 'btnBack', 'btnDel', 'roleCut', 'roleKeep'].forEach(function (id) { $(id).disabled = !o; });
    $('selName').textContent = o ? (S.resolve(o) || { name: 'Shape' }).name : 'Nothing selected';
    $('roleCut').setAttribute('aria-checked', String(!!o && o.role === 'cut'));
    $('roleKeep').setAttribute('aria-checked', String(!!o && o.role === 'keep'));
    $('selbar').classList.toggle('idle', !o);
  }

  function renderPreview() {
    SF.preview.render($('preview'), store.doc, { idPrefix: 'pv', showFolds: $('showFolds').checked });
    var cut = SM.cutFraction(store.doc, 56);
    $('stat').textContent = store.doc.objects.length + ' shape' + (store.doc.objects.length === 1 ? '' : 's') +
      ' · ' + Math.round(cut * 100) + '% cut away';
  }

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
    if (kind === 'change') saveSoon();
  });
  renderAll();

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
