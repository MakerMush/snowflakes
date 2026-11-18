/* app.js - wires the store, editor, preview, analysis and page controls together. */
(function (root) {
  'use strict';
  var SF = root.SF, G = SF.geometry, S = SF.shapes, ST = SF.state, SM = SF.sampler, AN = SF.analyze, P = SF.presets;
  var $ = function (id) { return document.getElementById(id); };
  var KIDS = !!SF.config.kids;                          // kid mode: 4 arms, Cut mode, kid scissors, simplified UI
  var KEY = SF.config.storageKey + (KIDS ? '.kids' : ''), TOOL_KEY = SF.config.storageKey + '.tool';
  var MATH = !!SF.config.math;                          // math mode: the full app plus the geometry lab up front
  if (KIDS) document.body.classList.add('kids');
  if (MATH) document.body.classList.add('math');

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

  /** Kid mode keeps the saved shapes but forces 4 arms and Cut mode (a saved Build design would mean the opposite). */
  function kidDoc(saved) {
    var d = saved && typeof saved === 'object' && saved.mode !== 'build' ? saved : ST.kidStarterDoc();
    d.arms = 4; d.mode = 'cut';
    if (Array.isArray(d.objects)) d.objects.forEach(function (o) { if (o && !o.bridge) o.role = 'cut'; });
    return d;
  }

  var store = KIDS ? ST.createStore(kidDoc(loadSaved()), { kids: true }) : ST.createStore(loadSaved() || ST.starterDoc());
  var editor = new SF.Editor($('editor'), store);
  SF.editor = editor;
  var tool = KIDS ? 0 : loadTool();                   // 0 kid scissors, 1 sharp scissors, 2 craft knife
  var edgeMode = 'fold';                              // 'fold' (centered on the fold) or 'inside'
  var analysis = null, overlayURL = null, stale = true, anTimer = 0;
  SF.store = store;                                   // handy in the browser console
  SF.getAnalysis = function () { return analysis; };

  /* ---------- shape library ---------- */

  $('tiles').innerHTML = (KIDS ? S.kidList : S.list).map(function (sh) {
    var f = S.fit(sh.aspect);
    return '<button type="button" class="tile" data-shape="' + sh.id + '" title="' + sh.name + '" aria-label="Add ' + sh.name + '">' +
      '<svg viewBox="-0.62 -0.62 1.24 1.24" aria-hidden="true"><path d="' + S.pathD(sh) + '" transform="scale(' + f.sx + ' ' + f.sy + ')" fill-rule="evenodd"/></svg>' +
      '<span>' + sh.name + '</span></button>';
  }).join('');

  var dragJustEnded = false;                          // a drag onto the wedge already added the shape
  $('tiles').addEventListener('click', function (e) {
    var b = e.target.closest('[data-shape]');
    if (!b || dragJustEnded) return;
    if (!store.addShape(b.getAttribute('data-shape'))) toast('That is the most shapes the wedge can hold.');
    else if (isNarrow()) go('design');
  });

  /* drag a tile straight onto the wedge (a tap still adds it at the next free spot) */
  (function () {
    var drag = null;
    function overEditor(x, y) {
      var r = $('editor').getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && !isNarrow();
    }
    function end() {
      if (!drag) return;
      if (drag.ghost) drag.ghost.remove();
      $('editor').classList.remove('drop-target');
      document.body.classList.remove('tile-dragging');
      drag = null;
    }
    $('tiles').addEventListener('pointerdown', function (e) {
      var b = e.target.closest('[data-shape]');
      if (!b || e.button > 0 || isNarrow()) return;
      drag = { id: b.getAttribute('data-shape'), tile: b, pid: e.pointerId, x0: e.clientX, y0: e.clientY, ghost: null };
    });
    root.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.pid) return;
      if (!drag.ghost) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;
        drag.ghost = document.createElement('div');
        drag.ghost.className = 'tile-ghost';
        drag.ghost.appendChild(drag.tile.querySelector('svg').cloneNode(true));
        document.body.appendChild(drag.ghost);
        document.body.classList.add('tile-dragging');
      }
      e.preventDefault();
      drag.ghost.style.transform = 'translate(' + (e.clientX - 32) + 'px,' + (e.clientY - 32) + 'px)';
      $('editor').classList.toggle('drop-target', overEditor(e.clientX, e.clientY));
    }, { passive: false });
    root.addEventListener('pointerup', function (e) {
      if (!drag || e.pointerId !== drag.pid) return;
      var d = drag;
      end();
      if (!d.ghost) return;                                  // no movement: the click handler adds it
      dragJustEnded = true;
      setTimeout(function () { dragJustEnded = false; }, 0);
      if (!overEditor(e.clientX, e.clientY)) return;
      var at = editor.worldAt(editor.view, e.clientX, e.clientY);
      if (!store.addShape(d.id, { at: at })) toast('That is the most shapes the wedge can hold.');
    });
    root.addEventListener('pointercancel', function (e) { if (drag && e.pointerId === drag.pid) end(); });
  })();

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
      toast('Loaded ' + p.name + (p.mode === 'cut' ? ' (' + p.arms + ' arms, Cut mode)' : ' in Build mode') + '. Change anything you like.', 'Undo', function () { store.undo(); });
      if (isNarrow()) go('design');
    }
  });

  /* kid mode: start from one of the simple snowflakes instead of a blank wedge */
  if (KIDS) {
    $('kidStarters').hidden = false;
    $('kidStarterList').innerHTML = P.kidList.map(function (p) {
      return '<button type="button" class="kid-starter" data-kidpreset="' + p.id + '" aria-label="Start from the ' + p.name + ' snowflake">' +
        '<svg viewBox="-108 -108 216 216" aria-hidden="true"></svg><span>' + p.name + '</span></button>';
    }).join('');
    P.kidList.forEach(function (p) {
      SF.preview.render($('kidStarterList').querySelector('[data-kidpreset="' + p.id + '"] svg'), P.toDoc(p), { idPrefix: 'kz-' + p.id });
    });
    $('kidStarterList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kidpreset]');
      if (!b) return;
      var p = P.get(b.getAttribute('data-kidpreset'));
      store.replaceAll(P.toDoc(p));
      editor.resetZoom();
      toast('Here is the ' + p.name + '. Change anything you like!', 'Undo', function () { store.undo(); });
      if (isNarrow()) go('design');
    });
  }

  /* ---------- top bar ---------- */

  document.querySelectorAll('[data-arms]').forEach(function (b) {
    b.addEventListener('click', function () { if (!KIDS) store.setArms(+b.getAttribute('data-arms')); });
  });
  $('btnUndo').addEventListener('click', function () { store.undo(); });
  $('btnRedo').addEventListener('click', function () { store.redo(); });
  $('btnSurprise').addEventListener('click', function () {
    var d = KIDS ? ST.randomDoc(4, null, 'cut') : ST.randomDoc(store.doc.arms, null, store.doc.mode);
    if (d.mode === 'build') {                      // loose pieces of paper would fall out, so link them up
      AN.autoBridge(d, tool, { kids: KIDS }).bars.forEach(function (bar) {
        d.objects.push(Object.assign({ id: 'o' + (d.nextId++), type: 'shape' }, bar));
      });
    }
    store.replaceAll(d);
  });
  document.querySelectorAll('[data-setmode]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-setmode'), had = store.doc.objects.length;
      if (KIDS || !store.setMode(m)) return;
      setSetup(false);
      var msg = m === 'build' ? 'Build mode: nothing is kept yet. Add shapes to build the flake.'
        : 'Cut mode: a full sheet of paper. Add shapes to cut them out.';
      if (had) toast(msg + ' Your design was cleared.', 'Undo', function () { store.undo(); });
      else toast(msg);
    });
  });
  /* ---------- zoom ---------- */

  $('zoomIn').addEventListener('click', function () { editor.zoomIn(); });
  $('zoomOut').addEventListener('click', function () { editor.zoomOut(); });
  $('zoomReset').addEventListener('click', function () { editor.resetZoom(); });
  editor.onZoom(function (z) {
    var zoomed = Math.abs(z - 1) > 0.001;                  // in or out: Reset brings back the whole wedge
    $('zoomPct').textContent = Math.round(z * 100) + '%';
    $('zoomReset').disabled = !zoomed;
    $('zoomReset').classList.toggle('zoomed', zoomed);
    $('zoomOut').disabled = z <= SF.Editor.MIN_ZOOM + 0.001;
    $('zoomIn').disabled = z >= SF.Editor.MAX_ZOOM - 0.001;
  });

  /* ---------- popovers (More menu, Align) ---------- */

  var popClosers = [];
  function closePops(except) { popClosers.forEach(function (p) { if (p.set !== except && !p.sticky) p.set(false); }); }
  /* keep an open popover on screen: when the top bar wraps (iPad landscape), More can sit at the far left */
  function keepOnScreen(pop) {
    pop.style.transform = '';
    var r = pop.getBoundingClientRect(), vw = document.documentElement.clientWidth, dx = 0;
    if (r.right > vw - 8) dx = vw - 8 - r.right;
    if (r.left + dx < 8) dx = 8 - r.left;
    if (dx) pop.style.transform = 'translateX(' + Math.round(dx) + 'px)';
  }
  function popover(btnId, popId, opts) {
    var btn = $(btnId), pop = $(popId), entry = { sticky: !!(opts && opts.sticky) };
    function set(open) {
      pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.classList.toggle('on', open);
      if (open) keepOnScreen(pop);
      if (opts && opts.onToggle) opts.onToggle(open);
    }
    entry.set = set;
    btn.addEventListener('click', function () { var open = pop.hidden; closePops(set); set(open); });
    popClosers.push(entry);
    return set;
  }
  /* Align stays open until you tap Align again, so you can line up shape after shape */
  var alignWanted = false;
  var setMore = popover('btnMore', 'moreMenu'), setSetup = popover('btnSetup', 'setupMenu');
  var setAlign = popover('btnAlign', 'alignMenu', { sticky: true, onToggle: function (open) { if (store.selectedIds.length) alignWanted = open; } });
  document.addEventListener('pointerdown', function (e) { if (!(e.target.closest && e.target.closest('.pop-wrap'))) closePops(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closePops(); if (alignWanted) { alignWanted = false; setAlign(false); }
  });
  root.addEventListener('resize', function () { ['moreMenu', 'setupMenu', 'alignMenu'].forEach(function (id) { if (!$(id).hidden) keepOnScreen($(id)); }); });

  /* More > Modes: full, kid and math mode each have their own address */
  var MODE = KIDS ? 'kids' : MATH ? 'math' : 'full';
  document.querySelectorAll('.mode-item').forEach(function (a) {
    var on = a.getAttribute('data-mode') === MODE;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
  });
  $('btnModes').addEventListener('click', function () {
    var open = $('modeList').hidden;
    $('modeList').hidden = !open; this.setAttribute('aria-expanded', String(open));
    keepOnScreen($('moreMenu'));
  });

  /* small dialogs: Shortcuts and Support */
  function openDlg(id) { var d = $(id); if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', ''); }
  function closeDlg(d) { if (d.close) d.close(); else d.removeAttribute('open'); }
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { closeDlg(b.closest('dialog')); }); });
  $('btnKeys').addEventListener('click', function () { setMore(false); openDlg('keysDlg'); });
  $('btnSupport').addEventListener('click', function () { setMore(false); openDlg('supportDlg'); });

  /* feedback: no server, so the message goes out through the sender's own email or a form (config.js) */
  var FB_EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(SF.config.feedbackEmail || '') ? SF.config.feedbackEmail : '';
  var FB_URL = /^https:\/\/[^\s"'<>]+$/.test(SF.config.feedbackUrl || '') ? SF.config.feedbackUrl : '';
  var fbKind = 'Idea';
  $('feedbackSec').hidden = !(FB_EMAIL || FB_URL);
  var FB_GITHUB = /github\.com\/.+\/issues\/new/.test(FB_URL), FB_FORM = !FB_EMAIL && !FB_GITHUB;
  $('fbHow').textContent = FB_EMAIL ? 'Opens your email app with your message ready to send.'
    : FB_GITHUB ? 'Opens GitHub with your message filled in (a free GitHub account is needed to post).'
    : 'A short form, about 2 minutes. No sign-in needed. Opens in a new tab.';
  if (FB_FORM) {                                   // the form asks its own questions, so just a button here
    $('fbKindSeg').hidden = true; $('fbText').hidden = true;
    $('fbSend').disabled = false; $('fbSend').classList.add('primary');
    $('fbSend').textContent = 'Open the feedback form';
  }
  document.querySelectorAll('[data-fb]').forEach(function (b) {
    b.addEventListener('click', function () {
      fbKind = b.getAttribute('data-fb');
      document.querySelectorAll('[data-fb]').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
    });
  });
  $('fbText').addEventListener('input', function () { $('fbSend').disabled = !this.value.trim(); });
  $('fbSend').addEventListener('click', function () {
    var msg = $('fbText').value.trim();
    if (!msg && !FB_FORM) return;
    var title = SF.config.appName + ' ' + fbKind.toLowerCase() + ': ' + msg.split('\n')[0].slice(0, 60);
    var body = msg + '\n\n---\nKind: ' + fbKind + '\nMode: ' + MODE + '\nArms: ' + store.doc.arms;
    var url = FB_EMAIL ? 'mailto:' + FB_EMAIL + '?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body)
      : /github\.com\/.+\/issues\/new/.test(FB_URL) ? FB_URL + '?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body)
      : FB_URL;
    var a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    $('fbText').value = ''; $('fbSend').disabled = !FB_FORM;
    closeDlg($('supportDlg'));
    toast(FB_FORM ? 'Thanks! The feedback form opened in a new tab.' : 'Thanks! Finish sending it in the window that opened.');
  });

  /* tip jar: only when a Ko-fi (or other https) address is set in config.js, and never in kid mode */
  var TIP = /^https:\/\/[^\s"'<>]+$/.test(SF.config.tipUrl || '') && !KIDS ? SF.config.tipUrl : '';
  ['tipLink', 'printTipLink'].forEach(function (id) { if (TIP) $(id).href = TIP; });
  $('tipSec').hidden = $('printTip').hidden = !TIP;

  /* Clear (Start over in kid mode): one simple question first, and Undo still brings it back */
  function closeClear() { closeDlg($('clearDlg')); }
  if (KIDS) {
    $('btnClearLbl').textContent = 'Start over';
    $('btnClear').title = 'Clear the whole snowflake';
  } else {
    $('clearTitle').textContent = 'Clear the wedge?';
    $('clearMsg').textContent = 'This removes every shape. Undo brings them back.';
    $('clearNo').textContent = 'Keep it';
    $('clearYes').textContent = 'Clear';
  }
  $('btnClear').addEventListener('click', function () {
    if (!store.doc.objects.length) { toast(KIDS ? 'Your wedge is already empty.' : 'The wedge is already empty.'); return; }
    openDlg('clearDlg');
    $('clearNo').focus();                                    // the safe answer is the default
  });
  $('clearNo').addEventListener('click', closeClear);
  $('clearYes').addEventListener('click', function () {
    closeClear();
    store.clear();
    editor.resetZoom();
    toast(KIDS ? 'All clear! Tap a shape to start again.' : 'Wedge cleared.', 'Undo', function () { store.undo(); });
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
  $('roleKeep').addEventListener('click', act(function () { if (!KIDS) store.setRole(undefined, 'keep'); }));
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

  $('btnHub').addEventListener('click', function () { store.setHub(!store.doc.hub); });
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
    $('shapesHint').textContent = KIDS ? 'Tap a shape, or drag it onto the wedge.' : doc.mode === 'build'
      ? 'Build mode: nothing is kept yet. Click a shape (or drag it onto the wedge) to add paper, then drag, resize and rotate it. Connect everything to the center.'
      : 'Click a shape or drag it onto the wedge, then drag, resize and rotate it.';
    var info = G.groupInfo(doc.arms);
    $('setupLbl').textContent = doc.arms + ' arms · ' + (doc.mode === 'build' ? 'Build' : 'Cut') + ' mode';
    $('foldChip').textContent = info.wedgeDeg + '° · ' + info.order + ' layers';
    $('btnUndo').disabled = !store.canUndo();
    $('btnRedo').disabled = !store.canRedo();
    $('btnHub').setAttribute('aria-pressed', String(!!doc.hub));
    $('btnHub').classList.toggle('on', !!doc.hub);
    $('hubR').value = doc.hubR;
    $('hubR').disabled = !doc.hub;

    ['btnFlip', 'btnDup', 'btnFront', 'btnBack', 'btnDel', 'roleCut', 'roleKeep', 'alignCenter', 'btnAlign'].forEach(function (id) { $(id).disabled = !o; });
    setAlign(!!o && alignWanted);                         // Align stays open from shape to shape
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
    analysis = AN.analyze(store.doc, { tool: tool, kids: KIDS });
    overlayURL = overlayDataURL(analysis);
    stale = false;
    $('cardCx').classList.remove('stale');
    $('cardChecks').classList.remove('stale');
    renderComplexity();
    renderChecks();
    if (KIDS) renderKidStatus();
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

  /** Kid mode's one-line status, in place of the complexity and cut-check cards. */
  function renderKidStatus() {
    var st = analysis.stats, n = store.doc.objects.length, s;
    if (!n) s = ['\uD83D\uDC46', 'Tap a shape to start!', 'Pick one from the left.'];
    else if (st.islands) s = ['\uD83E\uDDE9', 'Some pieces will fall out.', 'Tap Fix it to hold them on.', true];
    else if (st.thinPaper || st.thinCut) s = ['\uD83D\uDD0D', 'Some parts are too tiny.', 'Make the red parts bigger.'];
    else if (st.interiorHoles) s = ['\u2702\uFE0F', 'Ready to cut!', 'A grown-up helps with holes in the middle.'];
    else s = ['\u2702\uFE0F', 'Ready to cut!', 'Tap Save my PDF when you are done.'];
    $('ksIcon').textContent = s[0];
    $('ksTitle').textContent = s[1];
    $('ksSub').textContent = s[2];
    $('ksFix').hidden = !s[3];
    $('kidStatus').classList.toggle('ks-bad', !!st.islands || !!(st.thinPaper || st.thinCut));
  }
  $('ksFix').addEventListener('click', function () { $('btnBridges').click(); });

  function renderChecks() {
    var st = analysis.stats, items = [], tn = AN.toolsFor(KIDS)[tool].short.toLowerCase();
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
  $('toolSeg').innerHTML = AN.toolsFor(KIDS).map(function (t, i) {
    return '<button type="button" role="radio" aria-checked="' + (i === tool) + '" data-tool="' + i + '" title="' + t.name + ': handles details down to about ' + t.width + ' mm">' + t.short + '</button>';
  }).join('');
  $('toolSeg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tool]');
    if (!b || KIDS) return;
    tool = +b.getAttribute('data-tool');
    try { root.localStorage.setItem(TOOL_KEY, String(tool)); } catch (err) { /* storage blocked */ }
    $('toolSeg').querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
    scheduleAnalysis();
  });

  $('btnBridges').addEventListener('click', function () {
    var res = AN.autoBridge(store.doc, tool, { kids: KIDS });
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

  /* ---------- dialogs fit what you can actually see ----------
     iPad Safari doesn't shrink the page when the keyboard comes up, so a centered dialog ends up under it.
     Track the visible area and let the CSS size and pin dialogs to it (--vvh, --vvt, html.kb). */
  (function () {
    var vv = root.visualViewport, de = root.document && root.document.documentElement;
    if (!vv || !de) return;
    function fit() {
      de.style.setProperty('--vvh', Math.round(vv.height) + 'px');
      de.style.setProperty('--vvt', Math.round(vv.offsetTop) + 'px');
      de.classList.toggle('kb', vv.height < root.innerHeight - 100);
    }
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    root.addEventListener('orientationchange', function () { setTimeout(fit, 300); });
    fit();
  })();

  /* ---------- first-run welcome (full mode only; "How it works" in the More menu reopens it) ---------- */

  var WELCOME_KEY = SF.config.storageKey + '.welcomed';
  function showWelcome() {
    var d = $('welcomeDlg');
    if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
  }
  function closeWelcome() {
    var d = $('welcomeDlg');
    if (d.close) d.close(); else d.removeAttribute('open');
    try { root.localStorage.setItem(WELCOME_KEY, '1'); } catch (e) { /* storage blocked */ }
  }
  $('welcomeGo').addEventListener('click', closeWelcome);
  $('welcomeClose').addEventListener('click', closeWelcome);
  $('welcomeDlg').addEventListener('cancel', function () { try { root.localStorage.setItem(WELCOME_KEY, '1'); } catch (e) { /* storage blocked */ } });
  $('btnHelp').addEventListener('click', function () { setMore(false); showWelcome(); });
  if (!KIDS) {
    var seen = false;
    try { seen = !!root.localStorage.getItem(WELCOME_KEY); } catch (e) { seen = true; }   // no storage: do not nag on every visit
    if (!seen) showWelcome();
  }

  SF.printUI.init({ store: store, toast: toast, kids: KIDS, getTool: function () { return tool; } });
  SF.geoLab.init({ store: store, toast: toast, getTool: function () { return tool; } });
  SF.photoPanel.init({ store: store, toast: toast, onAdded: function () { if (isNarrow()) go('design'); } });

  /* ---------- offline: keep a copy of the app for flaky school Wi-Fi (see sw.js) ---------- */

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () { /* offline copy is a bonus, never an error */ });
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
