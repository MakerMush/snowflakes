/*
 * sw.js - lets Flake Lab open with no internet once it has loaded once (flaky school Wi-Fi).
 * Online, every file is checked with the server first (never a stale copy, so an update can't
 * mix old scripts with a new page); offline, you get the last copy saved.
 * Nothing here talks to any other site, and nothing about designs or names is stored or sent.
 * Keep FILES in step with index.html (a test checks this). VERSION is written by tools/stamp.js.
 */
'use strict';
var VERSION = 'de9eb061d6';
var CACHE = 'flakelab';
var FILES = [
  './',
  'index.html',
  'css/styles.css',
  'js/config.js',
  'js/geometry.js',
  'js/shapes.js',
  'js/sampler.js',
  'js/analyze.js',
  'js/state.js',
  'js/preview.js',
  'js/presets.js',
  'js/trace.js',
  'js/qr.js',
  'js/pdf.js',
  'js/print.js',
  'js/worksheet.js',
  'js/photo.js',
  'js/printui.js',
  'js/geolab.js',
  'js/editor.js',
  'js/app.js'
];

self.addEventListener('install', function (e) {
  var urls = FILES.map(function (f) { return /\.(js|css)$/.test(f) ? f + '?v=' + VERSION : f; });   // the same URLs the page asks for
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(urls); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Ask the server every time (it answers "not changed" cheaply), so the browser's own cache can never
  // hand back an old file. A page load can't be re-made with options, so it is rebuilt from its address.
  var fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' });
  e.respondWith(fetch(fresh).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { return c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {   // ?kids, ?v=... and the plain page share one copy
      return hit || (req.mode === 'navigate' ? caches.match('./') : Response.error());
    });
  }));
});
