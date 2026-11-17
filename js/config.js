/* Flake Lab config. Change siteUrl if the site moves; the printed QR code uses it. */
(function (root) {
  'use strict';
  root.SF = root.SF || {};
  root.SF.config = {
    siteUrl: 'https://makermush.github.io/snowflakes/',
    appName: 'Flake Lab',
    storageKey: 'flakelab.v1',
    tipUrl: 'https://ko-fi.com/makermush',   // tip jar (Ko-fi). Empty hides every tip link.
    // Feedback, suggestions and requests (More > Support). An email wins if set: a short message box opens it in
    // the sender's mail app. A GitHub "issues/new" address gets the message filled in. Any other https address
    // (like this Google Form) is a single "Open the feedback form" button. Leave both empty to hide feedback.
    feedbackEmail: '',
    feedbackUrl: 'https://forms.gle/PNEUX6VGuLZZHEeR6',
    kids: flagFromUrl('kids'),           // kid mode (?kids in the URL): a simplified, first-grade-friendly app
    math: flagFromUrl('math')            // math mode (?math): the full app plus the geometry lab and worksheets
  };
  if (root.SF.config.kids) root.SF.config.math = false;        // kid mode wins if both are asked for
  root.SF.config.kidsUrl = root.SF.config.siteUrl + '?kids';   // printouts send people back to the mode they used
  root.SF.config.mathUrl = root.SF.config.siteUrl + '?math';
  /** True for ?name, ?name=1 and the like; ?name=0 or ?name=false leave it off. */
  function flagFromUrl(name) {
    try {
      var m = new RegExp('[?&]' + name + '(?:=([^&#]*))?(?:[&#]|$)').exec(root.location ? root.location.search : '');
      return !!m && !/^(0|false|no|off)$/i.test(m[1] || '');
    } catch (e) { return false; }
  }
  if (typeof module === 'object' && module.exports) module.exports = root.SF.config;     // lets node tests read it
})(typeof self !== 'undefined' ? self : this);
