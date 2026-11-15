/*
 * geolab.js - Geometry mode: a dialog with three activities on the student's own snowflake.
 *   Unfold:   the wedge swings open one sector at a time, each fold line acting as a mirror.
 *   Symmetry: turn the flake (it lands on itself every 360/n degrees) or flip it across a mirror line.
 *   Worksheet: preview and download the worksheet and its answer key (see worksheet.js).
 * The drawing is done by preview.renderFlaps(); this file only runs the controls and the animation.
 */
(function (root) {
  'use strict';
  var SF = root.SF, G = SF.geometry, AN = SF.analyze, PR = SF.print, WS = SF.worksheet;
  var $ = function (id) { return document.getElementById(id); };

  function r1(v) { return Math.round(v * 10) / 10; }
  function reduced() { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  function init(ctx) {
    var store = ctx.store, dlg = $('geoDlg'), view = null, n = 6, doc = null;
    var tab = 'unfold', move = 'turn', sheetKind = 'ws', analysis = null, sheets = {};
    var progress = 0, raf = 0, tmr = 0, playing = false, turn = 0, flipLine = -1, lines = [];

    /* ---------- the numbers ---------- */

    function facts() {
      var gi = G.groupInfo(n);
      $('geoFacts').innerHTML = [
        ['Arms', n], ['Layers', gi.order], ['Wedge angle', gi.wedgeDeg + '°'], ['Mirror lines', gi.mirrorLines],
        ['Smallest turn', gi.rotationStepDeg + '°'], ['Symmetry group', gi.groupName + ' (' + gi.order + ' moves)']
      ].map(function (p) { return '<li><span>' + p[0] + '</span><b>' + p[1] + '</b></li>'; }).join('');
    }

    /* ---------- animation helpers ---------- */

    function stop() { if (raf) cancelAnimationFrame(raf); if (tmr) clearTimeout(tmr); raf = 0; tmr = 0; playing = false; $('gPlay').textContent = 'Play'; }
    function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
    /** Run fn(eased 0..1) over ms milliseconds, then done(). Jumps straight to the end when motion is reduced. */
    function tween(ms, fn, done) {
      if (raf) cancelAnimationFrame(raf);
      if (reduced()) { fn(1); raf = 0; if (done) done(); return; }
      var t0 = null;
      (function step(ts) {
        if (t0 === null) t0 = ts;
        var u = Math.min(1, (ts - t0) / ms);
        fn(ease(u));
        if (u < 1) raf = requestAnimationFrame(step); else { raf = 0; if (done) done(); }
      })(performance.now ? performance.now() : 0);
    }

    /* ---------- unfold ---------- */

    function caption() {
      var a = 180 / n, m = Math.floor(progress + 1e-9), total = 2 * n;
      var frac = progress - m, open = m + 1, ln;
      if (progress >= total - 1 - 1e-9) {
        ln = 'All ' + total + ' wedges are open: ' + total + ' × ' + a + '° = 360°, the whole circle.';
      } else if (progress < 1e-9) {
        ln = 'Folded: one ' + a + '° wedge on top of a stack of ' + total + ' layers. Press Play to unfold it.';
      } else if (frac < 1e-9) {
        ln = open + ' of ' + total + ' wedges open (' + r1(open * a) + '° of the circle). The next fold line works like a mirror.';
      } else {
        ln = 'Wedge ' + (m + 2) + ' swings over the fold line. It lands as the mirror image of wedge ' + (m + 1) + '.';
      }
      $('gCap').textContent = ln;
    }
    function setProgress(p) {
      progress = G.clamp(p, 0, 2 * n - 1);
      view.setUnfold(progress);
      $('gUnfoldRange').value = progress;
      caption();
    }
    function play() {
      if (playing) { stop(); return; }
      if (progress >= 2 * n - 1 - 1e-9) setProgress(0);
      playing = true; $('gPlay').textContent = 'Pause';
      var from = progress, to = 2 * n - 1, per = 650;
      if (reduced()) {                                                    // step one wedge at a time, no swinging
        (function tick() {
          if (!playing) return;
          if (progress >= to - 1e-9) { stop(); return; }
          setProgress(Math.floor(progress + 1e-9) + 1);
          tmr = setTimeout(tick, 800);
        })();
        return;
      }
      var t0 = null;
      (function step(ts) {
        if (!playing) return;
        if (t0 === null) t0 = ts;
        var p = from + (ts - t0) / per;
        if (p >= to) { setProgress(to); stop(); return; }
        setProgress(p);
        raf = requestAnimationFrame(step);
      })(performance.now());
    }
    function stepTo(dir) {
      stop();
      var cur = Math.round(progress * 100) / 100, target = dir > 0 ? Math.floor(cur + 1e-6) + 1 : Math.ceil(cur - 1e-6) - 1;
      target = G.clamp(target, 0, 2 * n - 1);
      var from = progress;
      tween(450, function (u) { setProgress(from + (target - from) * u); });
    }

    /* ---------- symmetry ---------- */

    function symText() {
      var step = 360 / n;
      if (move === 'turn') {
        var t = Math.round(turn);
        if (t === 0) { $('gSym').textContent = 'Not turned yet. Drag the slider, or use the button to jump to the next match.'; return; }
        if (G.isRotationSymmetry(n, t)) {
          $('gSym').textContent = 'Turned ' + t + '°: it lands exactly on itself, so this turn is a symmetry (' + (Math.round(t / step) % n || n) + ' of ' + n + ' turns).';
        } else {
          var next = Math.ceil(t / step) * step;
          $('gSym').textContent = 'Turned ' + t + '°: not a match. The flag shows it moved. The next match is at ' + next + '°.';
        }
      } else if (flipLine < 0) {
        $('gSym').textContent = 'Pick a line. The whole snowflake flips over it like a page turning.';
      } else {
        var l = lines[flipLine];
        $('gSym').textContent = 'Flipped across mirror line ' + l.label + ' (tilted ' + r1(l.bearingDeg) + '° from straight up): it lands exactly on itself. Every one of the ' + n + ' lines does this.';
      }
    }
    function applyTurn(deg) {
      turn = G.clamp(deg, 0, 360);
      view.setWorld(G.rotation(turn * G.DEG));
      $('gTurnRange').value = turn;
      symText();
    }
    function flipAcross(i) {
      stop();
      flipLine = i;
      var beta = lines[i].angle, h = function (t) { return G.mul(G.rotation(beta), G.mul(G.scaling(1, t), G.rotation(-beta))); };
      document.querySelectorAll('#gLines [data-line]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-line') === i)); });
      view.setWorld(h(1));
      tween(800, function (u) { view.setWorld(h(1 - 2 * u)); }, symText);
    }
    function resetSym() {
      stop(); flipLine = -1; turn = 0;
      view.setWorld(null);
      $('gTurnRange').value = 0;
      document.querySelectorAll('#gLines [data-line]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      symText();
    }

    /* ---------- worksheet ---------- */

    function sheetOpts(key) { return { key: key, name: $('gName').checked }; }
    function buildSheets() {
      analysis = AN.analyze(doc, { tool: ctx.getTool() });
      sheets = { ws: WS.layout(analysis, sheetOpts(false)), key: WS.layout(analysis, sheetOpts(true)) };
      showSheet();
    }
    function showSheet() {
      var res = sheets[sheetKind];
      if (!res) return;
      $('geoSheet').innerHTML = res.pages.map(function (p, i) {
        return '<figure><figcaption>' + (sheetKind === 'key' ? 'Answer key, page ' : 'Worksheet, page ') + (i + 1) + '</figcaption>' + PR.toSVG(p) + '</figure>';
      }).join('');
    }
    function download(key) {
      var res = WS.layout(analysis, sheetOpts(key)), bytes = WS.toPDF(res.pages, key), name = WS.fileName(doc, key);
      var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      ctx.toast('Saved ' + name + '.');
    }

    /* ---------- tabs ---------- */

    function setTab(t) {
      stop();
      tab = t;
      document.querySelectorAll('[data-gtab]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-gtab') === t)); });
      $('gpUnfold').hidden = t !== 'unfold';
      $('gpSymmetry').hidden = t !== 'symmetry';
      $('gpSheet').hidden = t !== 'sheet';
      $('geoViewBox').hidden = t === 'sheet';
      $('geoSheet').hidden = t !== 'sheet';
      $('geoFacts').hidden = t === 'sheet';
      if (t === 'unfold') {
        view.setWorld(null); view.setFlag(false); view.setMirrors($('gShowLines').checked);
        setProgress(progress);
      } else if (t === 'symmetry') {
        view.setUnfold(2 * n - 1); view.setFlag(true); view.setMirrors(true);
        $('gUnfoldRange').value = progress;
        resetSym();
      } else {
        if (!analysis) buildSheets();
      }
    }
    function setMove(m) {
      stop(); move = m;
      document.querySelectorAll('[data-gmove]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-gmove') === m)); });
      $('gTurn').hidden = m !== 'turn';
      $('gFlip').hidden = m !== 'flip';
      resetSym();
    }

    function open() {
      doc = JSON.parse(JSON.stringify(store.doc));
      n = doc.arms; lines = G.mirrorLines(n); analysis = null; sheets = {}; progress = 0; stop();
      view = SF.preview.renderFlaps($('geoView'), doc, { idPrefix: 'geo' });
      $('gUnfoldRange').max = 2 * n - 1;
      $('gLines').innerHTML = lines.map(function (l, i) {
        return '<button type="button" class="chip-btn" data-line="' + i + '" aria-pressed="false" title="Flip across the line tilted ' + r1(l.bearingDeg) + '° from vertical">Line ' + l.label + '</button>';
      }).join('');
      facts();
      setTab('unfold');
      if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    }
    function close() { stop(); if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }

    $('btnGeo').addEventListener('click', open);
    $('geoClose').addEventListener('click', close);
    $('geoDone').addEventListener('click', close);
    dlg.addEventListener('close', stop);
    document.querySelectorAll('[data-gtab]').forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-gtab')); }); });
    document.querySelectorAll('[data-gmove]').forEach(function (b) { b.addEventListener('click', function () { setMove(b.getAttribute('data-gmove')); }); });
    document.querySelectorAll('[data-gsheet]').forEach(function (b) {
      b.addEventListener('click', function () {
        sheetKind = b.getAttribute('data-gsheet');
        document.querySelectorAll('[data-gsheet]').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        showSheet();
      });
    });
    $('gPlay').addEventListener('click', play);
    $('gStepFwd').addEventListener('click', function () { stepTo(1); });
    $('gStepBack').addEventListener('click', function () { stepTo(-1); });
    $('gUnfoldRange').addEventListener('input', function () { stop(); setProgress(+this.value); });
    $('gShowLines').addEventListener('change', function () { view.setMirrors(this.checked); });
    $('gTurnRange').addEventListener('input', function () { stop(); flipLine = -1; applyTurn(+this.value); });
    $('gTurnStep').addEventListener('click', function () {
      stop();
      var step = 360 / n, target = (Math.floor(turn / step + 1e-9) + 1) * step, from = turn;
      if (target > 360 + 1e-9) { from = 0; applyTurn(0); target = step; }
      tween(600, function (u) { applyTurn(from + (target - from) * u); });
    });
    $('gTurnReset').addEventListener('click', resetSym);
    $('gFlipReset').addEventListener('click', resetSym);
    $('gLines').addEventListener('click', function (e) {
      var b = e.target.closest('[data-line]');
      if (b) flipAcross(+b.getAttribute('data-line'));
    });
    $('gName').addEventListener('change', function () { if (analysis) buildSheets(); });
    $('gDlWs').addEventListener('click', function () { if (!analysis) buildSheets(); download(false); });
    $('gDlKey').addEventListener('click', function () { if (!analysis) buildSheets(); download(true); });
  }

  SF.geoLab = { init: init };
})(typeof self !== 'undefined' ? self : this);
