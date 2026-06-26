/* ==========================================================================
   DHL Label Splitter — Browser-Portierung des Python-Tools (dhl_label_splitter.py)
   Verarbeitung komplett clientseitig mit pdf-lib (Aufteilen) + pdf.js (Vorschau/Autofit).
   ========================================================================== */
(function () {
  'use strict';

  // ----- Konstanten (1:1 aus dem Python-Tool, in PDF-Punkten) -----
  const mm2pt = (mm) => mm * 72 / 25.4;
  const DEFAULT_CROP = { x0: 4.24, y0: 483.99, x1: 595.5, y1: 784.9 };
  const CUT1_MM = 64.0, CUT2_MM = 123.0;
  const QL_W = 62.0, QL_H = 100.0, QL_MLR = 3.0, QL_MTB = 4.0;
  const BRIEF_CROP = { x0: 39.2, y0: 632.29, x1: 282.3, y1: 753.49 };
  const BRIEF_MARGIN = 2.0, BRIEF_ROTATE = 90;

  const PRESETS = {
    paket:      { label: 'DHL Paket',      hint: '3 Streifen · 62×100 mm', mode: 'split3' },
    brief:      { label: 'DHL Brief',      hint: '1 Etikett · gedreht',     mode: 'single', rotate: BRIEF_ROTATE, margin: BRIEF_MARGIN, autofit: false },
    briefGross: { label: 'DHL Brief Groß', hint: '1 Etikett · Auto-Zoom',   mode: 'single', rotate: BRIEF_ROTATE, margin: BRIEF_MARGIN, autofit: true },
  };

  let pdfjsReady = false;
  function ensurePdfJs() {
    if (pdfjsReady) return;
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      pdfjsReady = true;
    }
  }

  // ----- DOM -----
  let fileBytes = null, fileName = '', activePreset = 'paket';
  const $ = (id) => document.getElementById(id);

  function init() {
    const dz = $('lblDrop'); if (!dz) return;
    const input = $('lblFile');

    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); dz.classList.remove('drag');
      const f = e.dataTransfer.files[0]; if (f) loadFile(f);
    });
    input.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadFile(f); });

    document.querySelectorAll('.lbl-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        activePreset = btn.dataset.preset;
        document.querySelectorAll('.lbl-preset').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    $('lblProcess').addEventListener('click', process);
  }

  async function loadFile(file) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      status('Bitte eine PDF-Datei wählen.', 'err'); return;
    }
    fileBytes = new Uint8Array(await file.arrayBuffer());
    fileName = file.name.replace(/\.pdf$/i, '');
    $('lblDropText').textContent = file.name;
    $('lblDrop').classList.add('has-file');
    $('lblProcess').disabled = false;
    $('lblResults').innerHTML = '';
    status('Bereit zum Aufteilen.', 'ok');
  }

  function status(msg, kind) {
    const el = $('lblStatus');
    el.textContent = msg;
    el.className = 'lbl-status' + (kind ? ' ' + kind : '');
  }

  // ----- detect label area (Paket) -----
  function detectCrop(page) {
    const { width, height } = page.getSize();
    const mb = page.getMediaBox ? page.getMediaBox() : { x: 0, y: 0, width, height };
    if (Math.abs(width - 595.28) < 5 && Math.abs(height - 841.89) < 5) return { ...DEFAULT_CROP };
    return { x0: mb.x, y0: mb.y, x1: mb.x + mb.width, y1: mb.y + mb.height };
  }

  // ----- Autofit: engster Inhalts-Crop via pdf.js Raster -----
  async function autofitCrop(region, pad = 4, dpi = 200) {
    try {
      ensurePdfJs();
      if (!window.pdfjsLib) return region;
      const doc = await pdfjsLib.getDocument({ data: fileBytes.slice() }).promise;
      const page = await doc.getPage(1);
      const H = page.getViewport({ scale: 1 }).height;
      const scale = dpi / 72;
      const vp = page.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const sx = Math.max(0, Math.floor(region.x0 * scale));
      const ex = Math.min(cv.width, Math.ceil(region.x1 * scale));
      const syTop = Math.max(0, Math.floor((H - region.y1) * scale));
      const syBot = Math.min(cv.height, Math.ceil((H - region.y0) * scale));
      const w = ex - sx, h = syBot - syTop;
      if (w <= 0 || h <= 0) return region;
      const data = ctx.getImageData(sx, syTop, w, h).data;
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return region;
      const cx0 = Math.max(region.x0, region.x0 + minX / scale - pad);
      const cx1 = Math.min(region.x1, region.x0 + (maxX + 1) / scale + pad);
      const yTop = Math.min(region.y1, region.y1 - minY / scale + pad);
      const yBot = Math.max(region.y0, region.y1 - (maxY + 1) / scale - pad);
      return { x0: cx0, y0: yBot, x1: cx1, y1: yTop };
    } catch (e) { return region; }
  }

  // ----- split3 (Paket) -----
  async function buildSplit3(srcPage, crop) {
    const { PDFDocument } = PDFLib;
    const x0 = crop.x0, y0 = crop.y0, x1 = crop.x1, y1 = crop.y1;
    const lh = y1 - y0;
    const cut1 = x0 + mm2pt(CUT1_MM), cut2 = x0 + mm2pt(CUT2_MM);
    const strips = [[x0, cut1], [cut1, cut2], [cut2, x1]];
    const lw_pt = mm2pt(QL_W), lh_pt = mm2pt(QL_H);
    const sw_pt = mm2pt(QL_W - 2 * QL_MLR), sh_pt = mm2pt(QL_H - 2 * QL_MTB);
    const ox = mm2pt(QL_MLR), oy = mm2pt(QL_MTB);
    const out = [];
    for (let i = 0; i < strips.length; i++) {
      const [sx0, sx1] = strips[i];
      const sw = sx1 - sx0;
      const doc = await PDFDocument.create();
      const emb = await doc.embedPage(srcPage, { left: sx0, bottom: y0, right: sx1, top: y1 });
      const pg = doc.addPage([lw_pt, lh_pt]);
      const sc = Math.min(sw_pt / sw, sh_pt / lh);
      const cx = ox + (sw_pt - sw * sc) / 2;
      const cy = i < 2 ? oy + (sh_pt - lh * sc) : oy + (sh_pt - lh * sc) / 2;
      pg.drawPage(emb, { x: cx, y: cy, xScale: sc, yScale: sc });
      out.push({ name: `${fileName}_Streifen_${i + 1}.pdf`, bytes: await doc.save() });
    }
    return out;
  }

  // ----- single (Brief / Brief Groß), rotate 90 -----
  async function buildSingle(srcPage, crop, rotate, margin) {
    const { PDFDocument, degrees } = PDFLib;
    const cw = crop.x1 - crop.x0, ch = crop.y1 - crop.y0;
    const lw_pt = mm2pt(QL_W), lh_pt = mm2pt(QL_H);
    const sw_pt = mm2pt(QL_W - 2 * margin), sh_pt = mm2pt(QL_H - 2 * margin);
    const ox = mm2pt(margin), oy = mm2pt(margin);
    const effW = (rotate === 90 || rotate === 270) ? ch : cw;
    const effH = (rotate === 90 || rotate === 270) ? cw : ch;
    const sc = Math.min(sw_pt / effW, sh_pt / effH);

    const doc = await PDFDocument.create();
    const emb = await doc.embedPage(srcPage, { left: crop.x0, bottom: crop.y0, right: crop.x1, top: crop.y1 });
    const pg = doc.addPage([lw_pt, lh_pt]);

    if (rotate === 90) {
      const cx = ox + (sw_pt - ch * sc) / 2;
      const cy = oy + (sh_pt - cw * sc) / 2;
      pg.drawPage(emb, { x: cx + ch * sc, y: cy, xScale: sc, yScale: sc, rotate: degrees(90) });
    } else if (rotate === 270) {
      const cx = ox + (sw_pt - ch * sc) / 2;
      const cy = oy + (sh_pt - cw * sc) / 2;
      pg.drawPage(emb, { x: cx, y: cy + cw * sc, xScale: sc, yScale: sc, rotate: degrees(270) });
    } else {
      const cx = ox + (sw_pt - cw * sc) / 2;
      const cy = oy + (sh_pt - ch * sc) / 2;
      pg.drawPage(emb, { x: cx, y: cy, xScale: sc, yScale: sc });
    }
    return [{ name: `${fileName}_Brief.pdf`, bytes: await doc.save() }];
  }

  // ----- Hauptablauf -----
  async function process() {
    if (!fileBytes) return;
    if (!window.PDFLib) { status('PDF-Bibliothek lädt noch – kurz warten und erneut klicken.', 'err'); return; }
    const preset = PRESETS[activePreset];
    status('Wird verarbeitet …');
    $('lblProcess').disabled = true;
    try {
      const srcDoc = await PDFLib.PDFDocument.load(fileBytes.slice(), { ignoreEncryption: true });
      const srcPage = srcDoc.getPage(0);
      let outputs;
      if (preset.mode === 'split3') {
        outputs = await buildSplit3(srcPage, detectCrop(srcPage));
      } else {
        let crop = { ...BRIEF_CROP };
        if (preset.autofit) crop = await autofitCrop(crop);
        outputs = await buildSingle(srcPage, crop, preset.rotate, preset.margin);
      }
      await renderResults(outputs);
      status(`Fertig — ${outputs.length} Etikett${outputs.length > 1 ? 'en' : ''} erstellt.`, 'ok');
    } catch (e) {
      console.error(e);
      status('Fehler beim Verarbeiten: ' + (e.message || e), 'err');
    } finally {
      $('lblProcess').disabled = false;
    }
  }

  // ----- Ergebnis-Karten + Vorschau -----
  async function renderResults(outputs) {
    const wrap = $('lblResults');
    wrap.innerHTML = '';
    if (outputs.length > 1) {
      const bar = document.createElement('div');
      bar.className = 'lbl-allbar';
      bar.innerHTML = `<button class="btn-add" id="lblPrintAll">Alle drucken</button>
                       <button class="btn btn-secondary" id="lblDlAll">Alle herunterladen</button>`;
      wrap.appendChild(bar);
      bar.querySelector('#lblPrintAll').addEventListener('click', () => printAll(outputs));
      bar.querySelector('#lblDlAll').addEventListener('click', () => outputs.forEach((o) => download(o)));
    }
    const grid = document.createElement('div');
    grid.className = 'lbl-grid';
    wrap.appendChild(grid);

    for (const o of outputs) {
      const card = document.createElement('div');
      card.className = 'lbl-card';
      card.innerHTML = `
        <div class="lbl-prev"><canvas></canvas></div>
        <div class="lbl-name">${o.name}</div>
        <div class="lbl-actions">
          <button class="btn-add lbl-print">Drucken</button>
          <button class="btn btn-secondary lbl-dl">Download</button>
        </div>`;
      grid.appendChild(card);
      card.querySelector('.lbl-print').addEventListener('click', () => printPdf(o.bytes));
      card.querySelector('.lbl-dl').addEventListener('click', () => download(o));
      renderPreview(o.bytes, card.querySelector('canvas'));
    }
  }

  async function renderPreview(bytes, canvas) {
    try {
      ensurePdfJs();
      if (!window.pdfjsLib) return;
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = 190 / base.width;
      const vp = page.getViewport({ scale });
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    } catch (e) { /* preview optional */ }
  }

  // ----- Download / Drucken -----
  function download(o) {
    const url = URL.createObjectURL(new Blob([o.bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = o.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function printPdf(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    iframe.src = url;
    iframe.onload = () => { try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) {} };
    document.body.appendChild(iframe);
    setTimeout(() => { iframe.remove(); URL.revokeObjectURL(url); }, 60000);
  }

  async function printAll(outputs) {
    for (const o of outputs) { printPdf(o.bytes); await new Promise((r) => setTimeout(r, 1200)); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
