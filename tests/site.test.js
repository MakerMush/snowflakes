'use strict';
// Site-level checks: the offline file list, the tip link setting, and the page's security policy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('offline: sw.js saves every script and stylesheet the page loads, and only files that exist', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const list = JSON.parse(sw.match(/var FILES = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  const used = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(used.length > 10);
  used.forEach(f => assert.ok(list.includes(f), f + ' is saved for offline use'));
  list.filter(f => f !== './').forEach(f => assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists'));
});

test('tip link: empty (hidden) or an https address', () => {
  const CFG = require('../js/config');
  assert.equal(typeof CFG.tipUrl, 'string');
  assert.ok(CFG.tipUrl === '' || /^https:\/\/\S+$/.test(CFG.tipUrl));
});

test('security policy still blocks outside connections and scripts', () => {
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'none'/);
});
