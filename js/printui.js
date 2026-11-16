/*
 * printui.js - the Print template dialog: preview, options, warnings, Print and Download PDF.
 * The pages themselves come from print.js; nothing here draws anything.
 */
(function (root) {
  'use strict';
  var SF = root.SF, AN = SF.analyze, PR = SF.print;
  var $ = function (id) { return document.getElementById(id); };

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function init(ctx) {
    var store = ctx.store, dlg = $('printDlg'), analysis = null, pages = [];

    /** The typed name (kid mode: required; otherwise optional, and only while the Name line is on). */
    function studentName() { return ctx.kids || $('optName').checked ? PR.cleanName($('printName').value) : ''; }
    function opts() {
      return { guide: $('optGuide').checked, shade: $('optShade').checked, name: $('optName').checked, studentName: studentName(),
        siteUrl: ctx.kids ? SF.config.kidsUrl : SF.config.siteUrl };      // the QR code leads back to the same mode
    }

    function refresh() {
      var res = PR.layout(analysis, opts());
      pages = res.pages;
      $('printPreview').innerHTML = pages.map(function (p, i) {
        return '<figure><figcaption>Page ' + (i + 1) + (i ? ': fold guide' : ': template') + '</figcaption>' + PR.toSVG(p) + '</figure>';
      }).join('');
      $('printSummary').textContent = plural(pages.length, 'page', 'pages') + ' · ' + res.info.arms + ' arms · difficulty ' + res.info.score + '/10';
      if (ctx.kids) $('printPdf').disabled = !studentName();           // the name is a required step before saving
    }

    /** Kid mode: big text, few words. Holes that do not reach an edge need a grown-up to poke through. */
    function kidWarnings() {
      var st = analysis.stats, items = [];
      if (st.interiorHoles) items.push('<b>Ask a grown-up!</b> A hole is in the middle. A grown-up pokes it through.');
      if (st.islands) items.push('Some pieces will fall out.');
      if (st.thinPaper || st.thinCut) items.push('Some parts are too small to cut.');
      var box = $('printWarn');
      box.hidden = !items.length;
      box.innerHTML = items.map(function (t) { return '<p>' + t + '</p>'; }).join('');
    }

    function warnings() {
      if (ctx.kids) { kidWarnings(); return; }
      var st = analysis.stats, tn = AN.TOOLS[ctx.getTool()].short.toLowerCase(), items = [];
      if (st.islands) {
        items.push(st.fallsApart ? 'Nothing holds this design together: it would fall into ' + plural(st.islandPieces, 'piece', 'pieces') + '.'
          : plural(st.islands, 'island', 'islands') + ' would fall out (' + plural(st.islandPieces, 'loose piece', 'loose pieces') + ' once unfolded).');
      }
      if (st.thinPaper) items.push(plural(st.thinPaper, 'paper bridge or tip is', 'paper bridges or tips are') + ' too thin for ' + tn + '.');
      if (st.thinCut) items.push(plural(st.thinCut, 'cutout is', 'cutouts are') + ' too narrow for ' + tn + '.');
      var box = $('printWarn');
      box.hidden = !items.length;
      box.innerHTML = items.length
        ? '<b>Heads up</b><br>' + items.join('<br>') + '<br>You can print anyway, or close this and fix it first (see Cut checks).'
        : '';
    }

    function open() {
      if (!store.doc.objects.length) { ctx.toast('Add a shape first, then print.'); return; }
      if (ctx.kids) {                                    // kid mode adds bridges for you, so nothing falls out
        var res = AN.autoBridge(store.doc, ctx.getTool(), { kids: true });
        var added = res.bars.length ? store.addObjects(res.bars).length : 0;
        $('printKidNote').hidden = !added;               // a toast would hide behind the dialog, so say it in here
        $('optName').checked = true;
      }
      analysis = AN.analyze(store.doc, { tool: ctx.getTool(), kids: !!ctx.kids });
      warnings();
      refresh();
      if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
      // with a mouse, jump straight to the name; on a tablet the keyboard would cover the preview, so let them tap it
      var fine = root.matchMedia && root.matchMedia('(pointer: fine)').matches;
      if (ctx.kids && !studentName() && fine) $('printName').focus();
    }
    function close() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }

    function download() {
      var who = studentName();
      if (ctx.kids && !who) { $('printName').focus(); return; }
      var meta = who ? { title: who + "'s snowflake", author: who, subject: SF.config.appName + ' fold-and-cut template' } : undefined;
      var bytes = PR.toPDF(pages, meta), name = PR.fileName(store.doc, who);
      var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      if (ctx.kids) { close(); ctx.toast('Saved your snowflake PDF!'); return; }   // close first, or the toast hides behind the dialog
      ctx.toast('Saved ' + name + '. Print it at 100% (Actual size).');
    }

    function print() {
      $('printRoot').innerHTML = pages.map(function (p) { return '<section class="print-page">' + PR.toSVG(p) + '</section>'; }).join('');
      document.body.classList.add('printing');
      var done = function () { document.body.classList.remove('printing'); $('printRoot').innerHTML = ''; };
      root.addEventListener('afterprint', done, { once: true });
      root.print();
    }

    $('btnPrint').addEventListener('click', open);
    $('printClose').addEventListener('click', close);
    $('printCancel').addEventListener('click', close);
    $('printPdf').addEventListener('click', download);
    $('printGo').addEventListener('click', print);
    ['optGuide', 'optShade', 'optName'].forEach(function (id) { $(id).addEventListener('change', refresh); });
    $('optName').addEventListener('change', function () { $('nameField').hidden = !this.checked; });

    var nameTimer = 0;                               // the preview follows the typed name
    $('printName').addEventListener('input', function () {
      if (ctx.kids) $('printPdf').disabled = !studentName();
      clearTimeout(nameTimer);
      nameTimer = setTimeout(function () { if (dlg.open) refresh(); }, 150);
    });
    $('printName').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault(); clearTimeout(nameTimer); refresh();
      if (ctx.kids) download();
    });

    if (ctx.kids) {                                  // kid mode: type your name, then save a PDF. No print options.
      $('printTitle').textContent = 'Save your snowflake';
      $('btnPrint').title = 'Save your snowflake as a PDF';
      $('btnPrint').querySelector('.lbl').textContent = 'Save my PDF';
      $('printPdf').querySelector('span').textContent = 'Save my PDF';
      $('printPdf').classList.add('primary');
      $('printNameLabel').textContent = 'Type your name';
      $('printNameHint').innerHTML = 'Then tap <b>Save my PDF</b>.';
    }
    document.addEventListener('keydown', function (e) {                       // Ctrl/Cmd+P opens this instead of printing the app
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); if (!dlg.open) open(); }
    });
  }

  root.SF.printUI = { init: init };
})(typeof self !== 'undefined' ? self : this);
