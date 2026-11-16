/*
 * sw.js - lets Flake Lab open with no internet once it has loaded once (flaky school Wi-Fi).
 * Network first: online you always get the newest version; offline you get the last copy saved.
 * Nothing here talks to any other site, and nothing about designs or names is stored or sent.
 * Keep FILES in step with the scripts in index.html (a test checks this).
 */
'use strict';
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
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { return c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {   // ?kids and the plain page share one copy
      return hit || (req.mode === 'navigate' ? caches.match('./') : Response.error());
    });
  }));
});
