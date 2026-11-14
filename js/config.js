/* Flake Lab config. Change siteUrl if the site moves; the printed QR code uses it. */
(function (root) {
  'use strict';
  root.SF = root.SF || {};
  root.SF.config = {
    siteUrl: 'https://makermush.github.io/snowflakes/',
    appName: 'Flake Lab',
    storageKey: 'flakelab.v1'
  };
})(typeof self !== 'undefined' ? self : this);
