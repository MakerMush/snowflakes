/*
 * qr.js - a small QR code encoder (byte mode, error correction level M, versions 1 to 10).
 * Enough for a web address on a printed handout. No dependencies.
 *
 *   SF.qr.encode('https://example.org/')  ->  { version, size, mask, modules: [[0|1, ...], ...] }
 *
 * modules[y][x] is 1 for a dark square. The quiet zone (blank border) is the caller's job.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SF = root.SF || {}; root.SF.qr = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Level M: [error-correction codewords per block, [[blocks, data codewords per block], ...]] */
  var BLOCKS_M = {
    1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
    6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]]
  };
  var ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  var ECC_BITS_M = 0;                       // level M is "00" in the format information

  /* ---------- Reed-Solomon over GF(256), polynomial 0x11D ---------- */

  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]; }

  function generator(n) {                   // (x - a^0)(x - a^1)...(x - a^(n-1)), highest power first, leading 1 implied
    var g = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(g.length + 1);
      for (var k = 0; k < next.length; k++) next[k] = 0;
      for (var j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= gmul(g[j], EXP[i]);
      }
      g = next;
    }
    return g.slice(1);
  }

  /** The n error-correction bytes for a block of data bytes. */
  function rsEncode(data, n) {
    var gen = generator(n), rem = [];
    for (var i = 0; i < n; i++) rem.push(0);
    data.forEach(function (b) {
      var factor = b ^ rem.shift();
      rem.push(0);
      for (var k = 0; k < n; k++) rem[k] ^= gmul(gen[k], factor);
    });
    return rem;
  }

  /* ---------- data codewords ---------- */

  function utf8(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c >= 0xD800 && c < 0xDC00 && i + 1 < text.length) { c = 0x10000 + ((c - 0xD800) << 10) + (text.charCodeAt(++i) - 0xDC00); }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function dataCapacity(v) { return BLOCKS_M[v][1].reduce(function (a, b) { return a + b[0] * b[1]; }, 0); }

  function pickVersion(nBytes) {
    for (var v = 1; v <= 10; v++) {
      var countBits = v < 10 ? 8 : 16;
      if (4 + countBits + nBytes * 8 <= dataCapacity(v) * 8) return v;
    }
    return 0;
  }

  function dataCodewords(bytes, v) {
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4);                                  // byte mode
    put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCapacity(v) * 8;
    put(0, Math.min(4, cap - bits.length));     // terminator
    while (bits.length % 8) bits.push(0);
    var out = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      out.push(b);
    }
    for (var pad = 0xEC; out.length < dataCapacity(v); pad ^= 0xEC ^ 0x11) out.push(pad);
    return out;
  }

  /** Split into blocks, add error correction to each, and interleave. */
  function interleave(data, v) {
    var info = BLOCKS_M[v], ecLen = info[0], blocks = [], pos = 0;
    info[1].forEach(function (grp) {
      for (var i = 0; i < grp[0]; i++) { blocks.push(data.slice(pos, pos + grp[1])); pos += grp[1]; }
    });
    var ecs = blocks.map(function (b) { return rsEncode(b, ecLen); });
    var out = [], maxLen = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (var i = 0; i < maxLen; i++) blocks.forEach(function (b) { if (i < b.length) out.push(b[i]); });
    for (var k = 0; k < ecLen; k++) ecs.forEach(function (e) { out.push(e[k]); });
    return out;
  }

  /* ---------- the matrix ---------- */

  function bit(x, i) { return (x >>> i) & 1; }

  function formatBits(mask) {
    var data = (ECC_BITS_M << 3) | mask, rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }
  function versionBits(v) {
    var rem = v;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    return (v << 12) | rem;
  }

  function maskTest(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return (r * c) % 2 + (r * c) % 3 === 0;
      case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
    }
  }

  function penalty(m, size) {
    var score = 0, x, y, i;
    function runs(get) {
      for (var a = 0; a < size; a++) {
        var run = 1, hist = [];
        for (var b = 1; b <= size; b++) {
          if (b < size && get(a, b) === get(a, b - 1)) run++;
          else { if (run >= 5) score += 3 + run - 5; hist.push(run); run = 1; }
        }
        // finder-like 1:1:3:1:1 runs with a light margin of 4 on one side
        var cells = [];
        for (b = 0; b < size; b++) cells.push(get(a, b));
        for (b = 0; b + 11 <= size; b++) {
          var s = cells.slice(b, b + 11).join('');
          if (s === '10111010000' || s === '00001011101') score += 40;
        }
      }
    }
    runs(function (r, c) { return m[r][c]; });
    runs(function (c, r) { return m[r][c]; });
    for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
      var v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
    var dark = 0;
    for (y = 0; y < size; y++) for (i = 0; i < size; i++) dark += m[y][i];
    var total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  function build(version, codewords) {
    var size = 17 + 4 * version, m = [], fn = [], x, y, i, j;
    for (y = 0; y < size; y++) { m.push(new Array(size).fill(0)); fn.push(new Array(size).fill(false)); }
    function setFn(px, py, dark) { if (px < 0 || py < 0 || px >= size || py >= size) return; m[py][px] = dark ? 1 : 0; fn[py][px] = true; }

    for (i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }      // timing
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {                           // finders + separators
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(c[0] + dx, c[1] + dy, d !== 2 && d !== 4);
      }
    });
    var al = ALIGN[version], last = al.length - 1;
    for (i = 0; i < al.length; i++) for (j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (var ay = -2; ay <= 2; ay++) for (var ax = -2; ax <= 2; ax++) setFn(al[i] + ax, al[j] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
    }
    function drawFormat(mask) {
      var b = formatBits(mask);
      for (var k = 0; k <= 5; k++) setFn(8, k, bit(b, k));
      setFn(8, 7, bit(b, 6)); setFn(8, 8, bit(b, 7)); setFn(7, 8, bit(b, 8));
      for (k = 9; k < 15; k++) setFn(14 - k, 8, bit(b, k));
      for (k = 0; k < 8; k++) setFn(size - 1 - k, 8, bit(b, k));
      for (k = 8; k < 15; k++) setFn(8, size - 15 + k, bit(b, k));
      setFn(8, size - 8, 1);                                                                 // the always-dark module
    }
    drawFormat(0);
    if (version >= 7) {
      var vb = versionBits(version);
      for (i = 0; i < 18; i++) { var a = size - 11 + (i % 3), b2 = Math.floor(i / 3); setFn(a, b2, bit(vb, i)); setFn(b2, a, bit(vb, i)); }
    }

    // data, zigzag from the bottom right
    var n = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        var cx = right - j, upward = ((right + 1) & 2) === 0, cy = upward ? size - 1 - vert : vert;
        if (!fn[cy][cx] && n < codewords.length * 8) { m[cy][cx] = bit(codewords[n >>> 3], 7 - (n & 7)); n++; }
      }
    }

    // pick the mask with the lowest penalty
    var best = -1, bestScore = Infinity, bestM = null;
    for (var mask = 0; mask < 8; mask++) {
      var t = m.map(function (row) { return row.slice(); });
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (!fn[y][x] && maskTest(mask, y, x)) t[y][x] ^= 1;
      // format bits for this mask go in before scoring
      var saved = m; m = t; drawFormat(mask); m = saved;
      var s = penalty(t, size);
      if (s < bestScore) { bestScore = s; best = mask; bestM = t; }
    }
    return { version: version, size: size, mask: best, modules: bestM };
  }

  /** Encode text (UTF-8, byte mode, level M). Throws if it does not fit in version 10. */
  function encode(text) {
    var bytes = utf8(String(text)), v = pickVersion(bytes.length);
    if (!v) throw new Error('QR code: text too long (' + bytes.length + ' bytes, at most ' + (dataCapacity(10) - 3) + ')');
    return build(v, interleave(dataCodewords(bytes, v), v));
  }

  return { encode: encode, rsEncode: rsEncode, formatBits: formatBits, versionBits: versionBits, utf8: utf8, dataCodewords: dataCodewords };
});
