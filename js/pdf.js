/*
 * pdf.js - a tiny PDF writer for flat vector pages (paths and text). No dependencies.
 *
 * A page is a "draw list" in points, origin at the top left, y pointing down:
 *   { w: 612, h: 792, items: [ item, ... ] }
 * item = path:  { t:'path', d:[['M',x,y],['L',x,y],['C',x1,y1,x2,y2,x,y],['Z']], fill, stroke, lw, dash:[on,off],
 *                 evenodd:bool, cap:'butt'|'round', join:'miter'|'round' }
 *      | text:  { t:'text', x, y (baseline), s, size, font:'F1'|'F2', fill, anchor:'start'|'middle'|'end' }
 * Colours are '#rrggbb' (or '#rgb'), or null for none. Fonts are the built-in Helvetica (F1) and Helvetica-Bold (F2),
 * so nothing is embedded. Text should be plain ASCII plus the degree sign, middle dot and multiplication sign.
 * The same draw list can be drawn as SVG (see print.js), so the screen preview and the PDF agree.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SF = root.SF || {}; root.SF.pdf = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Advance widths per 1000 em for characters 32..126 (Adobe's Helvetica metrics). */
  var W1 = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  var W2 = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  var EXTRA = { 0xB0: 400, 0xB7: 278, 0xD7: 584 };          // degree sign, middle dot, multiplication sign (same in both fonts)

  /** Reduce text to the byte codes the PDF font will draw (WinAnsi). Anything else becomes '?'. */
  function codes(str) {
    var out = [];
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 32 && c <= 126) out.push(c);
      else if (c === 0xB0 || c === 0xB7 || c === 0xD7) out.push(c);
      else if (c === 0x2013 || c === 0x2014) out.push(45);    // dashes become hyphens
      else if (c === 0x2019 || c === 0x2018) out.push(39);
      else if (c === 0x201C || c === 0x201D) out.push(34);
      else out.push(63);
    }
    return out;
  }
  /** Text exactly as it will be drawn (unsupported characters shown as '?'). */
  function clean(str) { return codes(str).map(function (c) { return String.fromCharCode(c); }).join(''); }

  function textWidth(str, font, size) {
    var t = font === 'F2' ? W2 : W1, w = 0;
    codes(str).forEach(function (c) { w += c >= 32 && c <= 126 ? t[c - 32] : (EXTRA[c] || 556); });
    return w * size / 1000;
  }

  function num(v) {
    var r = Math.round(v * 1000) / 1000;
    return (r === 0 ? 0 : r).toString();      // never "-0", never exponent form for our magnitudes
  }

  function colour(hex) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4].map(function (i) { return num(parseInt(h.substr(i, 2), 16) / 255); }).join(' ');
  }

  function escapeString(codeList) {
    var s = '';
    codeList.forEach(function (c) {
      if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
      else if (c > 126) s += '\\' + ('00' + c.toString(8)).slice(-3);
      else s += String.fromCharCode(c);
    });
    return s;
  }

  function pageStream(page) {
    var H = page.h, out = [];
    page.items.forEach(function (it) {
      if (it.t === 'path') {
        var fill = colour(it.fill), stroke = colour(it.stroke);
        if (!fill && !stroke) return;
        var s = 'q\n';
        if (fill) s += fill + ' rg\n';
        if (stroke) {
          s += stroke + ' RG\n' + num(it.lw === undefined ? 1 : it.lw) + ' w\n';
          s += (it.cap === 'round' ? 1 : 0) + ' J ' + (it.join === 'round' ? 1 : 0) + ' j\n';
          if (it.dash && it.dash.length) s += '[' + it.dash.map(num).join(' ') + '] 0 d\n';
        }
        it.d.forEach(function (op) {
          var k = op[0];
          if (k === 'M') s += num(op[1]) + ' ' + num(H - op[2]) + ' m\n';
          else if (k === 'L') s += num(op[1]) + ' ' + num(H - op[2]) + ' l\n';
          else if (k === 'C') s += num(op[1]) + ' ' + num(H - op[2]) + ' ' + num(op[3]) + ' ' + num(H - op[4]) + ' ' + num(op[5]) + ' ' + num(H - op[6]) + ' c\n';
          else if (k === 'Z') s += 'h\n';
        });
        var eo = it.evenodd ? '*' : '';
        s += (fill && stroke ? 'B' + eo : fill ? 'f' + eo : 'S') + '\nQ\n';
        out.push(s);
      } else if (it.t === 'text') {
        var col = colour(it.fill) || '0 0 0', cl = codes(it.s);
        if (!cl.length) return;
        var w = textWidth(it.s, it.font, it.size), x = it.x;
        if (it.anchor === 'middle') x -= w / 2; else if (it.anchor === 'end') x -= w;
        out.push('q\nBT\n/' + (it.font === 'F2' ? 'F2' : 'F1') + ' ' + num(it.size) + ' Tf\n' + col + ' rg\n' +
          num(x) + ' ' + num(H - it.y) + ' Td\n(' + escapeString(cl) + ') Tj\nET\nQ\n');
      }
    });
    return out.join('');
  }

  /**
   * Build a PDF file from draw-list pages. meta: { title, author, subject } (plain text).
   * Returns a Uint8Array.
   */
  function build(pages, meta) {
    meta = meta || {};
    var objs = [];                            // objs[i] is the body of object i + 1
    function add(body) { objs.push(body); return objs.length; }
    var catalog = add(''), pagesObj = add(''), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
      f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var kids = [];
    pages.forEach(function (pg) {
      var stream = pageStream(pg);
      var cs = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
      var po = add('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 ' + num(pg.w) + ' ' + num(pg.h) + '] ' +
        '/Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> >> /Contents ' + cs + ' 0 R >>');
      kids.push(po + ' 0 R');
    });
    objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>';
    objs[pagesObj - 1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>';
    var info = '<< /Producer (Flake Lab)';
    if (meta.title) info += ' /Title (' + escapeString(codes(meta.title)) + ')';
    if (meta.author) info += ' /Author (' + escapeString(codes(meta.author)) + ')';
    if (meta.subject) info += ' /Subject (' + escapeString(codes(meta.subject)) + ')';
    var infoObj = add(info + ' >>');

    var text = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', offsets = [];
    objs.forEach(function (body, i) {
      offsets.push(text.length);
      text += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });
    var xref = text.length;
    text += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) { text += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    text += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + infoObj + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    var bytes = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
    return bytes;
  }

  return { build: build, textWidth: textWidth, clean: clean, codes: codes, colour: colour, num: num };
});
