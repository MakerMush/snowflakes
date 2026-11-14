/*
 * photo.js - the Photo tab: load a picture, trace it live with sliders, add the outline to the wedge.
 * The picture is decoded in the browser and never uploaded anywhere.
 */
(function (root) {
  'use strict';
  var SF = root.SF, T = SF.trace, S = SF.shapes;
  var $ = function (id) { return document.getElementById(id); };
  var MAX_SIDE = 400;

  function init(opts) {
    var store = opts.store, toast = opts.toast;
    var src = null;                         // { gray, width, height, canvas } for the loaded picture
    var result = null, view = 'result', pending = 0;
    var auto = true;
    var ctx = $('traceCanvas').getContext('2d');

    /* ---------- loading ---------- */

    function useCanvas(cv) {
      var w = cv.width, h = cv.height;
      var data = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      src = { gray: T.toGray(data, w, h), width: w, height: h, canvas: cv };
      auto = true; $('trAuto').checked = true;
      $('traceBox').hidden = false;
      run();
    }

    function loadBlob(blob) {
      if (!blob || !/^image\//.test(blob.type || 'image/')) { toast('That does not look like a picture. Try a JPG or PNG.'); return; }
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        var size = T.fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, MAX_SIDE);
        var cv = document.createElement('canvas');
        cv.width = size.width; cv.height = size.height;
        var g = cv.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);   // see-through PNGs trace as if on white paper
        g.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        useCanvas(cv);
      };
      img.onerror = function () { URL.revokeObjectURL(url); toast('That picture could not be opened. Try a JPG or PNG.'); };
      img.src = url;
    }

    function drawSample() {                 // a simple tree and moon, so there is something to try without a photo
      var cv = document.createElement('canvas'); cv.width = 360; cv.height = 360;
      var g = cv.getContext('2d');
      var grad = g.createLinearGradient(0, 0, 0, 360); grad.addColorStop(0, '#cfd8e0'); grad.addColorStop(1, '#f2f5f7');
      g.fillStyle = grad; g.fillRect(0, 0, 360, 360);
      g.fillStyle = '#22303c';
      [[180, 40, 70, 150], [180, 100, 95, 215], [180, 165, 120, 280]].forEach(function (t) {
        g.beginPath(); g.moveTo(t[0], t[1]); g.lineTo(t[0] + t[2] / 1.2, t[3]); g.lineTo(t[0] - t[2] / 1.2, t[3]); g.closePath(); g.fill();
      });
      g.fillRect(168, 278, 24, 52);
      g.beginPath(); g.arc(300, 70, 28, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#cfd8e0'; g.beginPath(); g.arc(310, 62, 24, 0, Math.PI * 2); g.fill();
      useCanvas(cv);
    }

    $('photoFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (f) loadBlob(f);
      this.value = '';                       // choosing the same file again should still work
    });
    $('photoSample').addEventListener('click', drawSample);
    var drop = $('photoDrop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      $('panePhoto').addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      $('panePhoto').addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    $('panePhoto').addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadBlob(f);
    });
    document.addEventListener('paste', function (e) {
      if ($('panePhoto').hidden) return;
      var items = e.clipboardData && e.clipboardData.items;
      for (var i = 0; items && i < items.length; i++) {
        if (/^image\//.test(items[i].type)) { loadBlob(items[i].getAsFile()); e.preventDefault(); return; }
      }
    });

    /* ---------- tracing ---------- */

    function params() {
      return {
        threshold: auto ? null : +$('trThr').value,
        noise: +$('trNoise').value, smoothing: +$('trSmooth').value, detail: +$('trDetail').value,
        invert: $('trInvert').checked
      };
    }

    function run() {
      if (!src) return;
      result = T.trace(src, params());
      if (auto) $('trThr').value = result.threshold;
      $('trThrVal').textContent = result.threshold + (auto ? ' auto' : '');
      $('trNoiseVal').textContent = $('trNoise').value;
      $('trSmoothVal').textContent = $('trSmooth').value;
      $('trDetailVal').textContent = $('trDetail').value;
      var has = result.polys.length > 0;
      $('traceAdd').disabled = !has;
      var stat = $('traceStat');
      stat.classList.toggle('warn', !has);
      stat.textContent = has
        ? result.loops + (result.loops === 1 ? ' outline' : ' outlines') + ' · ' + result.points + ' points'
        : 'Nothing found. Try the Threshold slider, or trace the light parts instead.';
      draw();
    }
    function schedule() {
      if (pending) return;
      pending = root.requestAnimationFrame(function () { pending = 0; run(); });
    }

    function pathOf(polys) {
      var p = new Path2D();
      polys.forEach(function (poly) {
        poly.forEach(function (pt, i) { if (i) p.lineTo(pt[0], pt[1]); else p.moveTo(pt[0], pt[1]); });
        p.closePath();
      });
      return p;
    }

    function draw() {
      if (!src || !result) return;
      var cv = $('traceCanvas');
      if (cv.width !== src.width || cv.height !== src.height) { cv.width = src.width; cv.height = src.height; }
      ctx.clearRect(0, 0, cv.width, cv.height);
      var p = pathOf(result.polys);
      if (view === 'original') {
        ctx.drawImage(src.canvas, 0, 0);
        ctx.lineWidth = 1.6; ctx.strokeStyle = '#ff5d4c'; ctx.stroke(p);
      } else {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#0a0e13'; ctx.fill(p, 'evenodd');
      }
      cv.setAttribute('aria-label', 'Traced shape preview: ' + $('traceStat').textContent);
    }

    ['trNoise', 'trSmooth', 'trDetail', 'trInvert'].forEach(function (id) { $(id).addEventListener('input', schedule); });
    $('trThr').addEventListener('input', function () { auto = false; $('trAuto').checked = false; schedule(); });
    $('trAuto').addEventListener('change', function () { auto = this.checked; schedule(); });
    document.querySelectorAll('[data-tview]').forEach(function (b) {
      b.addEventListener('click', function () {
        view = b.getAttribute('data-tview');
        document.querySelectorAll('[data-tview]').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        draw();
      });
    });

    $('traceAdd').addEventListener('click', function () {
      if (!result || !result.polys.length) return;
      var n = S.normalize(result.polys);
      var o = store.addTrace(n.polys, n.aspect, 'Photo trace');
      if (!o) { toast('That is the most shapes the wedge can hold.'); return; }
      toast('Added the traced shape. Drag, resize or rotate it like any other.', 'Undo', function () { store.undo(); });
      if (opts.onAdded) opts.onAdded();
    });

    SF.photo = { load: loadBlob, sample: drawSample, get result() { return result; } };
  }

  SF.photoPanel = { init: init };
})(typeof self !== 'undefined' ? self : this);
