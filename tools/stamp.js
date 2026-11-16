#!/usr/bin/env node
/*
 * tools/stamp.js - version-stamp the scripts and stylesheet so browsers never mix old and new files.
 *
 * GitHub Pages lets browsers reuse files for 10 minutes. Without a stamp, a reload right after an update
 * can load the new index.html with the old scripts (new buttons that do nothing). This tool hashes the
 * CSS and JS, then writes that hash into index.html (as ?v=...) and into sw.js (VERSION).
 *
 * Run it after changing any file in css/ or js/, before committing:   node tools/stamp.js
 * The tests fail if you forget.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ASSET = /((?:src|href)=")((?:js|css)\/[^"?]+)(?:\?v=[0-9a-f]*)?(")/g;

function assets(html) { return [...html.matchAll(ASSET)].map(m => m[2]); }

/** Short hash of every script and stylesheet the page loads, in page order. */
function version(root) {
  root = root || ROOT;
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const h = crypto.createHash('sha256');
  assets(html).forEach(f => { h.update(f + '\n'); h.update(fs.readFileSync(path.join(root, f))); });
  return h.digest('hex').slice(0, 10);
}

function stamp(root) {
  root = root || ROOT;
  const v = version(root);
  const htmlPath = path.join(root, 'index.html'), swPath = path.join(root, 'sw.js');
  const html = fs.readFileSync(htmlPath, 'utf8').replace(ASSET, (m, a, f, b) => a + f + '?v=' + v + b);
  const sw = fs.readFileSync(swPath, 'utf8').replace(/var VERSION = '[0-9a-f]*';/, "var VERSION = '" + v + "';");
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(swPath, sw);
  return v;
}

module.exports = { version: version, stamp: stamp, assets: assets };
if (require.main === module) console.log('Stamped version ' + stamp());
