'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Q = require('../js/qr');

test('Reed-Solomon matches the published worked example (version 1-M "HELLO WORLD")', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(Q.rsEncode(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('format and version information match the standard tables', () => {
  const fmt = ['101010000010010', '101000100100101', '101111001111100', '101101101001011',
    '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
  fmt.forEach((bits, mask) => assert.equal(Q.formatBits(mask).toString(2).padStart(15, '0'), bits, 'mask ' + mask));
  assert.equal(Q.versionBits(7), 0x07C94);
  assert.equal(Q.versionBits(10), 0x0A4D3);
});

test('the site address fits in version 3 and has the right structure', () => {
  const q = Q.encode('https://makermush.github.io/snowflakes/');
  assert.equal(q.version, 3);
  assert.equal(q.size, 29);
  assert.equal(q.modules.length, 29);
  // three finder patterns: 7x7 dark ring, light ring, 3x3 dark core
  [[0, 0], [22, 0], [0, 22]].forEach(([x, y]) => {
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
      const d = Math.max(Math.abs(i - 3), Math.abs(j - 3));
      assert.equal(q.modules[y + j][x + i], d === 2 ? 0 : 1, `finder at ${x},${y} (${i},${j})`);
    }
  });
  for (let i = 8; i < 21; i++) { assert.equal(q.modules[6][i], i % 2 === 0 ? 1 : 0, 'timing row'); assert.equal(q.modules[i][6], i % 2 === 0 ? 1 : 0, 'timing col'); }
  assert.equal(q.modules[29 - 8][8], 1, 'the always-dark module');
});

test('data codewords: byte mode header, terminator and padding', () => {
  const cw = Q.dataCodewords(Q.utf8('A'), 1);
  assert.equal(cw.length, 16);
  assert.deepEqual(cw.slice(0, 3), [0x40, 0x14, 0x10]);      // 0100 00000001 01000001 0000 -> 40 14 10
  assert.deepEqual(cw.slice(3, 6), [0xEC, 0x11, 0xEC]);
});

test('longer text picks a bigger version, and too much text is refused', () => {
  assert.equal(Q.encode('x'.repeat(14)).version, 1);
  assert.equal(Q.encode('x'.repeat(15)).version, 2);
  assert.equal(Q.encode('x'.repeat(213)).version, 10);
  assert.throws(() => Q.encode('x'.repeat(300)), /too long/);
  assert.equal(Q.encode('café').modules.length, 21, 'non-ASCII goes through UTF-8');
});

test('an independent decoder reads our codes (needs python3 with OpenCV, skipped otherwise)', (t) => {
  const probe = spawnSync('python3', ['-c', 'import cv2']);
  if (probe.status !== 0) { t.skip('OpenCV not available'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-'));
  const texts = ['https://makermush.github.io/snowflakes/', 'a', 'café ❄', 'x'.repeat(100), 'y'.repeat(213), 'https://example.org/' + 'z'.repeat(90)];
  texts.forEach((txt, k) => {
    const q = Q.encode(txt), s = 8, qz = 4, N = (q.size + 2 * qz) * s, buf = Buffer.alloc(N * N, 255);
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x])
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) buf[((y + qz) * s + dy) * N + (x + qz) * s + dx] = 0;
    fs.writeFileSync(path.join(dir, k + '.pgm'), Buffer.concat([Buffer.from(`P5\n${N} ${N}\n255\n`), buf]));
    fs.writeFileSync(path.join(dir, k + '.txt'), txt, 'utf8');
  });
  const py = `
import cv2, sys, os
d = cv2.QRCodeDetector(); bad = 0
for k in range(${texts.length}):
    img = cv2.imread(os.path.join(sys.argv[1], '%d.pgm' % k), cv2.IMREAD_GRAYSCALE)
    exp = open(os.path.join(sys.argv[1], '%d.txt' % k), encoding='utf8').read()
    val = d.detectAndDecode(img)[0]
    if val != exp: bad += 1; print('mismatch', k, repr(val))
sys.exit(1 if bad else 0)`;
  const r = spawnSync('python3', ['-c', py, dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
