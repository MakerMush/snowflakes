/* Flake Lab config. Change siteUrl if the site moves; the printed QR code uses it. */
(function (root) {
  'use strict';
  root.SF = root.SF || {};
  root.SF.config = {
    siteUrl: 'https://makermush.github.io/snowflakes/',
    appName: 'Flake Lab',
    storageKey: 'flakelab.v1',
    tipUrl: 'https://ko-fi.com/makermush',   // tip jar (Ko-fi). Empty hides every tip link.
    kids: kidsFromUrl()                  // kid mode (?kids in the URL): a simplified, first-grade-friendly app
  };
  root.SF.config.kidsUrl = root.SF.config.siteUrl + '?kids';   // kid-mode printouts send people back to kid mode
  /** True for ?kids, ?kids=1 and the like; ?kids=0 or ?kids=false leave it off. */
  function kidsFromUrl() {
    try {
      var m = /[?&]kids(?:=([^&#]*))?(?:[&#]|$)/.exec(root.location ? root.location.search : '');
      return !!m && !/^(0|false|no|off)$/i.test(m[1] || '');
    } catch (e) { return false; }
  }
  if (typeof module === 'object' && module.exports) module.exports = root.SF.config;     // lets node tests read it
})(typeof self !== 'undefined' ? self : this);
