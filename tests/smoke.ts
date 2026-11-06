// In-browser smoke test: exercises every engine through real pdf.js / canvas / DOMParser / WASM.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { loadPdfJs, savePdf, extractLines, imagesToPdf, pdfToText, pdfPageToCanvas } from '../src/engines/pdf';
import { jsonToDocx, docxToHtml, imagesToDocx } from '../src/engines/docx';
import { loadWorkbook, saveXlsx, setInput, displayValue, toCsv } from '../src/engines/sheet';
import { newDeck, savePptx, loadPptx, deckToPdf } from '../src/engines/slides';
import { richTextToPdf, sheetToPdf } from '../src/engines/layoutPdf';
import { normalizeImage, canvasToBytes, sampleBackground } from '../src/lib/image';
import { renderEdited, DEFAULT_TRANSFORM, SCAN_PRESET } from '../src/engines/imageEdit';
import UTIF from 'utif';

const results: { name: string; ok: boolean; info: string }[] = [];
async function t(name: string, fn: () => Promise<string | void>) {
  try { results.push({ name, ok: true, info: (await fn()) ?? '' }); }
  catch (e) { results.push({ name, ok: false, info: (e as Error).stack ?? String(e) }); }
}
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };

function textCanvas(lines: string[], bg = '#cfe0fb') {
  const c = document.createElement('canvas'); c.width = 1400; c.height = 140 + lines.length * 90;
  const x = c.getContext('2d')!; x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#111'; x.font = '56px Arial';
  lines.forEach((l, i) => x.fillText(l, 60, 120 + i * 90));
  return c;
}

(async () => {
  // A worksheet-like PDF on a light blue background (like the user's screenshot)
  const src = await (async () => {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    for (let p = 0; p < 2; p++) {
      const pg = d.addPage([595, 842]);
      pg.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: { type: 'RGB', red: 0.8, green: 0.87, blue: 0.98 } as never });
      pg.drawText(`Modalverben im Präsens – Seite ${p + 1}`, { x: 50, y: 780, size: 20, font: f });
      pg.drawText('1. Du ________ vor der Arbeit noch einkaufen. (müssen)', { x: 50, y: 740, size: 11, font: f });
    }
    return d.save();
  })();

  await t('pdf: extract lines keeps numbering & umlauts', async () => {
    const js = await loadPdfJs(src);
    const lines = await extractLines(await js.getPage(1));
    assert(lines[0].text.includes('Präsens') && lines[1].text.startsWith('1. Du'), JSON.stringify(lines.map((l) => l.text)));
    return lines.map((l) => `${l.size}pt ${l.text}`).join(' | ');
  });

  await t('pdf: overlay edit + reorder + rotate, original text preserved', async () => {
    const out = await savePdf([src], [{ src: 0, index: 1, rotation: 0 }, { src: 0, index: 0, rotation: 90 }], [
      { id: 'a', type: 'rect', page: 1, x: 49, y: 737, w: 30, h: 13, color: '#CCDDFA', opacity: 1 },
      { id: 'b', type: 'text', page: 1, x: 50, y: 740, size: 11, text: 'Ich muss Straße', color: '#111111', family: 'sans' },
    ]);
    const js = await loadPdfJs(out);
    const txt = await pdfToText(js);
    assert(js.numPages === 2, 'pages');
    assert(txt.indexOf('Seite 2') < txt.indexOf('Seite 1'), 'reorder');
    assert(txt.includes('Ich muss Straße'), 'new text: ' + txt);
    assert((await js.getPage(2)).rotate === 90, 'rotation');
    return `${out.length} bytes`;
  });

  await t('pdf: in-place save keeps original bytes structure', async () => {
    const out = await savePdf([src], [{ src: 0, index: 0, rotation: 0 }, { src: 0, index: 1, rotation: 0 }], []);
    const js = await loadPdfJs(out); assert(js.numPages === 2, 'pages'); return `${out.length} bytes`;
  });

  const png = await canvasToBytes(textCanvas(['Hallo Welt 123', 'Ich kann heute schwimmen']));
  const jpg = await canvasToBytes(textCanvas(['JPEG page']), 'image/jpeg', 0.95);

  await t('images → PDF embeds PNG/JPEG losslessly at 300 DPI', async () => {
    const { doc } = await imagesToPdf([{ bytes: png, mime: 'image/png' }, { bytes: jpg, mime: 'image/jpeg' }], { pageSize: 'fit', dpi: 300, margin: 0 });
    const bytes = await doc.save();
    const p = doc.getPage(0);
    assert(Math.abs(p.getWidth() - 1400 / 300 * 72) < 0.01, 'page width ' + p.getWidth());
    // original JPEG stream must be present byte-for-byte
    const needle = jpg.subarray(0, 64); const hay = bytes;
    let found = false; for (let i = 0; i < hay.length - 64 && !found; i++) if (hay[i] === needle[0] && needle.every((b, j) => hay[i + j] === b)) found = true;
    assert(found, 'JPEG passthrough');
    return `${bytes.length} bytes, page ${p.getWidth().toFixed(1)}×${p.getHeight().toFixed(1)}pt`;
  });

  await t('TIFF (multi-page) → PNG', async () => {
    const rgba = new Uint8Array(20 * 10 * 4).fill(200);
    const tif = new Uint8Array(UTIF.encodeImage(rgba, 20, 10) as unknown as ArrayBuffer);
    const out = await normalizeImage(tif, 'image/tiff');
    assert(out.length === 1 && out[0].mime === 'image/png', 'decode');
    return `${out[0].bytes.length} byte PNG`;
  });

  await t('colour sampling matches tinted page background', async () => {
    const c = textCanvas(['abc'], '#cfe0fb');
    const bg = sampleBackground(c.getContext('2d')!, 60, 70, 120, 60);
    assert(Math.abs(bg[0] - 0xcf) < 10 && Math.abs(bg[2] - 0xfb) < 10, String(bg));
    return String(bg);
  });

  await t('image edit: rotate 90 + scan preset', async () => {
    const c = textCanvas(['x']);
    const r = renderEdited(c, { ...DEFAULT_TRANSFORM, rotate: 90 }, SCAN_PRESET);
    assert(r.width === c.height && r.height === c.width, 'dims');
  });

  const json = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: 'Bericht Übersicht' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'red', marks: [{ type: 'textStyle', attrs: { color: '#ff0000' } }] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First item' }] }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet item' }] }] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H1' }] }] },
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] }] }] },
    { type: 'image', attrs: { src: 'data:image/png;base64,' + btoa(String.fromCharCode(...png)) } },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] }] },
  ] };

  await t('docx: export → re-import round trip', async () => {
    const bytes = await jsonToDocx(json, 'Test');
    const { html } = await docxToHtml(bytes);
    for (const s of ['Bericht Übersicht', '<strong>Bold', 'First item', 'Bullet item', '<table', 'Cell', '<img', 'Quote']) assert(html.includes(s), 'missing ' + s + ' in ' + html.slice(0, 400));
    return `${bytes.length} bytes`;
  });

  await t('doc → vector PDF', async () => {
    const js = await loadPdfJs(await richTextToPdf(json));
    const txt = await pdfToText(js);
    assert(txt.includes('Bericht') && txt.includes('First item') && txt.includes('Cell'), txt);
    return txt.replace(/\s+/g, ' ').slice(0, 80);
  });

  await t('images → docx (image + OCR text modes)', async () => {
    const a = await imagesToDocx([{ bytes: png, mime: 'image/png' }]);
    const b = await imagesToDocx([{ bytes: png, mime: 'image/png', paragraphs: [{ text: 'Hallo Welt', heightPx: 56 }] }]);
    assert((await docxToHtml(b)).html.includes('Hallo Welt'), 'ocr text');
    return `${a.length} / ${b.length} bytes`;
  });

  await t('xlsx: formulas, styles round trip, csv', async () => {
    const wb = await loadWorkbook(null);
    const ws = wb.worksheets[0];
    setInput(ws.getCell('A1'), '10'); setInput(ws.getCell('A2'), '20'); setInput(ws.getCell('A3'), '12.5');
    setInput(ws.getCell('A4'), '=SUM(A1:A3)'); setInput(ws.getCell('B1'), '=IF(A4>40,"big","small")'); setInput(ws.getCell('B2'), '=A1*2+AVERAGE(A1:A2)');
    ws.getCell('A1').font = { bold: true };
    assert(displayValue(ws, ws.getCell('A4')) === '42.5', 'sum ' + displayValue(ws, ws.getCell('A4')));
    assert(displayValue(ws, ws.getCell('B1')) === 'big', 'if ' + displayValue(ws, ws.getCell('B1')));
    assert(displayValue(ws, ws.getCell('B2')) === '35', 'arith ' + displayValue(ws, ws.getCell('B2')));
    const bytes = await saveXlsx(wb);
    const wb2 = await loadWorkbook(bytes, 'x.xlsx');
    const ws2 = wb2.worksheets[0];
    assert(ws2.getCell('A4').formula === 'SUM(A1:A3)' && ws2.getCell('A1').font?.bold, 'roundtrip');
    assert(displayValue(ws2, ws2.getCell('B1')) === 'big', 'eval after reload');
    const csv = toCsv(ws2);
    const pdf = await loadPdfJs(await sheetToPdf(ws2));
    assert((await pdfToText(pdf)).includes('42.5'), 'pdf');
    // injection attempt must not execute
    setInput(ws.getCell('C1'), '=alert(1)');
    assert(String(displayValue(ws, ws.getCell('C1'))).startsWith('#'), 'sandbox');
    return csv.split('\r\n')[0];
  });

  await t('pptx: new deck → save → open → edit in place → save', async () => {
    const deck = newDeck();
    deck.slides[0].els[0].text = 'Quarterly Review';
    const { bytes } = await savePptx(deck);
    const d2 = await loadPptx(bytes);
    const title = d2.slides[0].els.find((e) => e.text?.includes('Quarterly'));
    assert(title, 'title parsed: ' + JSON.stringify(d2.slides[0].els.map((e) => e.text)));
    Object.assign(title!, { text: 'Q3 Review\nSecond line', x: 100, dirty: true });
    const { bytes: b3, rebuilt } = await savePptx(d2);
    assert(!rebuilt, 'should be in-place');
    const d3 = await loadPptx(b3);
    const t3 = d3.slides[0].els.find((e) => e.text?.startsWith('Q3'));
    assert(t3 && t3.text === 'Q3 Review\nSecond line' && Math.round(t3.x) === 100, JSON.stringify(t3 && { text: t3.text, x: t3.x }));
    const pdf = await loadPdfJs(await deckToPdf(d3));
    assert((await pdfToText(pdf)).includes('Q3 Review'), 'pdf');
    return `${d3.slides.length} slide(s), ${d3.width}×${d3.height}pt`;
  });

  await t('OCR (Tesseract WASM, German) → searchable PDF', async () => {
    const { ocrCanvas, makeSearchable } = await import('../src/engines/ocr');
    const c = textCanvas(['Hallo Welt 123', 'Ich kann heute schwimmen']);
    const r = await ocrCanvas(c, 'deu');
    assert(/Hallo/.test(r.text) && /schwimmen/.test(r.text), 'ocr: ' + r.text);
    const pdf = await imagesToPdf([{ bytes: png, mime: 'image/png' }], { pageSize: 'a4', dpi: 300, margin: 28 });
    const out = await makeSearchable(pdf, [c], 'deu');
    const txt = await pdfToText(await loadPdfJs(out));
    assert(/Hallo/.test(txt) && /schwimmen/.test(txt), 'searchable: ' + txt);
    return r.text.trim().replace(/\n/g, ' | ');
  });

  await t('image → Word keeps German umlauts (auto language), colours and blanks', async () => {
    const { ocrCanvas } = await import('../src/engines/ocr');
    const { analyzeLayout } = await import('../src/engines/ocrLayout');
    // small, tinted, multi-colour worksheet like a real screenshot
    const c = document.createElement('canvas'); c.width = 900; c.height = 330;
    const x = c.getContext('2d')!; x.fillStyle = '#d6e4fa'; x.fillRect(0, 0, 900, 330);
    x.fillStyle = '#2f7f8f'; x.font = '40px Arial'; x.fillText('Modalverben im Präsens', 40, 70);
    x.fillStyle = '#111111'; x.font = '22px Arial'; x.fillText('1. Du', 40, 150);
    x.fillRect(110, 152, 120, 2); x.fillText('vor der Arbeit noch einkaufen. (müssen)', 240, 150);
    x.fillStyle = '#8a8a8a'; x.fillText('2. Wir dürfen heute früh nach Hause gehen.', 40, 210);
    x.fillStyle = '#111111'; x.fillText('3. Die Gäste können draußen sitzen und üben.', 40, 270);
    const ocr = await ocrCanvas(c, 'auto');
    const L = analyzeLayout(ocr, c);
    const all = L.paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
    assert(ocr.langs?.startsWith('deu'), 'language ' + ocr.langs);
    for (const w of ['Präsens', 'müssen', 'dürfen', 'früh', 'Gäste', 'können']) assert(all.includes(w), `missing ${w} in:\n${all}`);
    assert(/_{5,}/.test(all), 'blank not detected:\n' + all);
    const title = L.paras[0].runs[0].color, body = L.paras[1].runs[0].color, grey = L.paras[2].runs[0].color;
    assert(title !== body && grey !== body, `colours not distinguished: ${title} ${body} ${grey}`);
    assert(L.paras[0].sizePt > L.paras[1].sizePt * 1.5, 'title size');
    assert(L.background, 'page colour');
    return `${ocr.langs}; colours ${title}/${body}/${grey}; bg ${L.background}`;
  });

  await t('PDF forms: fill existing fields, add new fields, flatten', async () => {
    const { pdfTemplate } = await import('../src/lib/templates');
    const form = await pdfTemplate('pdf-form');
    const filled = await savePdf([form], [{ src: 0, index: 0, rotation: 0 }], [
      { id: 'f1', type: 'field', kind: 'text', name: 'student_id', page: 0, x: 50, y: 60, w: 150, h: 20 },
      { id: 'f2', type: 'field', kind: 'dropdown', name: 'level', page: 0, x: 220, y: 60, w: 100, h: 20, options: ['A1', 'B1'] },
    ], { '0:full_name': 'Jürgen Müller', '0:course': 'German B1', '0:agree': true, '0:time_evening': true });
    const d = await PDFDocument.load(filled); const f = d.getForm();
    assert(f.getTextField('full_name').getText() === 'Jürgen Müller', 'text value');
    assert(f.getDropdown('course').getSelected()[0] === 'German B1', 'dropdown');
    assert(f.getCheckBox('agree').isChecked() && f.getCheckBox('time_evening').isChecked() && !f.getCheckBox('time_morning').isChecked(), 'checkboxes');
    assert(f.getTextField('student_id') && f.getDropdown('level').getOptions().join() === 'A1,B1', 'new fields');
    const flat = await savePdf([form], [{ src: 0, index: 0, rotation: 0 }], [], { '0:full_name': 'Flat Name' }, true);
    const fd = await PDFDocument.load(flat);
    assert(fd.getForm().getFields().length === 0, 'flattened');
    // reordered pages → values kept by flattening
    const reo = await savePdf([form, src], [{ src: 1, index: 0, rotation: 0 }, { src: 0, index: 0, rotation: 0 }], [], { '0:email': 'a@b.de' });
    assert((await PDFDocument.load(reo)).getPageCount() === 2, 'merge with form');
    return `${f.getFields().length} fields`;
  });

  await t('templates: Word, Excel (formulas), PowerPoint, PDF', async () => {
    const T = await import('../src/lib/templates');
    const html = T.docTemplate('doc-meeting');
    assert(html.includes('Action items') && html.includes('<table'), 'doc');
    const wb = await loadWorkbook(null); T.sheetTemplate(wb, 'sheet-invoice');
    const ws = wb.worksheets[0];
    const total = [...Array(30).keys()].map((r) => ws.getCell(`D${r + 1}`)).find((c) => (ws.getCell(`C${c.row}`).value as string) === 'TOTAL');
    assert(total && displayValue(ws, total).replace(/[^0-9.]/g, '') === '1354.50', 'invoice total ' + (total && displayValue(ws, total)));
    const wb2 = await loadWorkbook(null); T.sheetTemplate(wb2, 'sheet-timesheet');
    assert(displayValue(wb2.worksheets[0], wb2.worksheets[0].getCell('E12')) === '40', 'timesheet');
    const deck = T.deckTemplate('slides-pitch')!;
    const { bytes } = await savePptx(deck);
    assert((await loadPptx(bytes)).slides.length === 8, 'pitch slides');
    for (const id of ['doc-letter', 'doc-resume', 'doc-report']) assert(T.docTemplate(id).length > 200, id);
    return 'invoice total 1354.50, 40h timesheet, 8-slide deck';
  });

  // ---------------- regression tests for the QA report (2026-11-05) ----------------
  await t('QA#9/#11 formulas: cross-sheet, VLOOKUP, cached fallback, number/date formats', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); const a = wb.addWorksheet('Summary'), d = wb.addWorksheet('My Data');
    [10, 20, 30].forEach((v, i) => { d.getCell(`A${i + 1}`).value = v; d.getCell(`B${i + 1}`).value = ['x', 'y', 'z'][i]; });
    a.getCell('A1').value = { formula: "SUM('My Data'!A1:A3)" } as never;
    a.getCell('A2').value = { formula: "VLOOKUP(20,'My Data'!A1:B3,2,FALSE)" } as never;
    a.getCell('A3').value = { formula: 'XIRR(B1:B3)', result: 0.123 } as never; a.getCell('A3').numFmt = '0.0%';
    a.getCell('A4').value = 1234.5; a.getCell('A4').numFmt = '#,##0.00';
    a.getCell('A5').value = new Date(Date.UTC(2026, 10, 5)); a.getCell('A5').numFmt = 'dd.mm.yyyy';
    a.getCell('A6').value = { formula: 'IF(A1>50,"big","small")&" "&TEXTJOIN("-",TRUE,\'My Data\'!B1:B3)' } as never;
    a.getCell('A7').value = { formula: '1/0' } as never;
    const v = (r: string) => displayValue(a, a.getCell(r));
    assert(v('A1') === '60', 'cross-sheet ' + v('A1'));
    assert(v('A2') === 'y', 'vlookup ' + v('A2'));
    assert(/12\.3%|12,3\s?%/.test(v('A3')), 'cached fallback ' + v('A3'));
    assert(/1[,.  ]?234[.,]50/.test(v('A4')), 'number format ' + v('A4'));
    assert(v('A5') === '05.11.2026', 'date format ' + v('A5'));
    assert(v('A6') === 'big x-y-z', 'strings ' + v('A6'));
    assert(v('A7') === '#DIV/0!', 'div0 ' + v('A7'));
    return [1, 2, 3, 4, 5, 6, 7].map((i) => v('A' + i)).join(' | ');
  });

  await t('QA#19 CSV: German decimals & dates become numbers/dates', async () => {
    const wb = await loadWorkbook(new TextEncoder().encode('﻿Name;Betrag;Datum\nMüller;1.234,50;01.02.2026\n'), 'x.csv');
    const ws = wb.worksheets[0];
    assert(ws.getCell('A1').value === 'Name', 'BOM');
    assert(ws.getCell('B2').value === 1234.5, 'decimal ' + ws.getCell('B2').value);
    assert(ws.getCell('C2').value instanceof Date, 'date');
  });

  await t('QA#1 Word: formatting, header/footer survive open → edit → save', async () => {
    const docxLib = await import('docx');
    const src = new docxLib.Document({ sections: [{
      headers: { default: new docxLib.Header({ children: [new docxLib.Paragraph('CONFIDENTIAL HEADER')] }) },
      footers: { default: new docxLib.Footer({ children: [new docxLib.Paragraph('Footer text')] }) },
      properties: { page: { size: { width: 16838, height: 11906, orientation: docxLib.PageOrientation.LANDSCAPE } } },
      children: [new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: 'Big red title', size: 56, color: 'C00000', font: 'Georgia', bold: true })] }), new docxLib.Paragraph('Body')] }] });
    const orig = new Uint8Array(await (await docxLib.Packer.toBlob(src)).arrayBuffer());
    const { importDocx } = await import('../src/engines/docxImport');
    const imp = await importDocx(orig);
    assert(/font-size:28pt/.test(imp.html) && /#C00000/.test(imp.html) && /Georgia/.test(imp.html) && /<strong>/.test(imp.html), 'import ' + imp.html.slice(0, 200));
    assert(imp.header.includes('CONFIDENTIAL') && imp.footer.includes('Footer'), 'header/footer');
    // round-trip through the real editor schema
    const { Editor } = await import('@tiptap/core');
    const StarterKit = (await import('@tiptap/starter-kit')).default, TextStyle = (await import('@tiptap/extension-text-style')).default;
    const Color = (await import('@tiptap/extension-color')).default, FontFamily = (await import('@tiptap/extension-font-family')).default;
    const { Extension } = await import('@tiptap/core');
    const FontSize = Extension.create({ name: 'fs', addGlobalAttributes: () => [{ types: ['textStyle'], attributes: { fontSize: { default: null, parseHTML: (el: HTMLElement) => el.style.fontSize || null } } }] });
    const ed = new Editor({ extensions: [StarterKit, TextStyle, Color, FontFamily, FontSize], content: imp.html + '<p>edited</p>' });
    const out = await jsonToDocx(ed.getJSON(), 'x', { bytes: orig, defaults: imp.defaults });
    const JSZip = (await import('jszip')).default; const z = await JSZip.loadAsync(out);
    const xml = await z.file('word/document.xml')!.async('string');
    const hdr = Object.keys(z.files).filter((f) => /word\/(dh_)?header\d*\.xml$/.test(f));
    assert(/w:color w:val="C00000"/.test(xml) && /w:sz w:val="56"/.test(xml) && /Georgia/.test(xml), 'run formatting lost');
    assert(hdr.length === 1 && (await z.file(hdr[0])!.async('string')).includes('CONFIDENTIAL'), 'header lost');
    assert(/w:orient="landscape"/.test(xml), 'page setup lost');
    const back = await importDocx(out);
    assert(back.header.includes('CONFIDENTIAL') && /edited/.test(back.html), 'reopen');
    return `header kept, landscape kept, 28pt red Georgia kept (${out.length} B)`;
  });

  await t('QA#13 Word → PDF wraps long words inside the margins', async () => {
    const long = 'https://example.com/' + 'verylongsegment/'.repeat(12);
    const pdf = await loadPdfJs(await richTextToPdf({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: long }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Big', marks: [{ type: 'textStyle', attrs: { fontSize: '28pt', fontFamily: 'Georgia' } }] }] }] }));
    const pg = await pdf.getPage(1), W = pg.getViewport({ scale: 1 }).width, tc = await pg.getTextContent();
    const maxX = Math.max(...(tc.items as { transform: number[]; width: number }[]).map((i) => i.transform[4] + i.width));
    const big = (tc.items as { str: string; transform: number[] }[]).find((i) => i.str === 'Big');
    assert(maxX <= W - 50, `overflow ${maxX} > ${W}`);
    assert(big && Math.abs(big.transform[0] - 28) < 0.5, 'font size in PDF');
    return `right edge ${Math.round(maxX)} of ${Math.round(W)}pt`;
  });

  await t('QA#5 PDF Cover / Edit-text truly removes the original text', async () => {
    const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), pg = d.addPage([595, 842]);
    pg.drawText('Account 12345678 belongs to Jane Doe', { x: 50, y: 700, size: 14, font: f });
    pg.drawText('Keep this line', { x: 50, y: 650, size: 14, font: f });
    const src0 = await d.save();
    // cover just the account number (x≈107..186) and replace "Keep" line untouched
    const w = f.widthOfTextAtSize('Account ', 14), w2 = f.widthOfTextAtSize('12345678', 14);
    const out = await savePdf([src0], [{ src: 0, index: 0, rotation: 0 }], [{ id: 'c', type: 'rect', page: 0, x: 50 + w - 1, y: 696, w: w2 + 2, h: 16, color: '#000000', opacity: 1 }]);
    const txt = await pdfToText(await loadPdfJs(out));
    assert(!txt.includes('12345678'), 'covered text still extractable: ' + txt);
    assert(txt.includes('Keep this line'), 'uncovered text box lost its search layer: ' + txt);
    // Secure exports rebuild pixels; partially covered text boxes deliberately have no hidden text.
    // Compare the ORIGINAL and SAVED visual pixels of the remaining words at their original positions.
    const before = await pdfPageToCanvas(await loadPdfJs(src0), 1, 300);
    const after = await pdfPageToCanvas(await loadPdfJs(out), 1, 300);
    const compare = (x: number, width: number) => {
      const scale = 300 / 72, top = Math.floor((842 - 716) * scale), left = Math.floor(x * scale);
      const bw = Math.floor(width * scale), bh = Math.ceil(22 * scale);
      const a = before.getContext('2d')!.getImageData(left, top, bw, bh).data;
      const b = after.getContext('2d')!.getImageData(left, top, bw, bh).data;
      let ink = 0, difference = 0;
      for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { ink += 255 - a[i + c]; difference += Math.abs(a[i + c] - b[i + c]); }
      return difference / Math.max(1, ink);
    };
    const accountDiff = compare(49, w - 1), belongsDiff = compare(50 + f.widthOfTextAtSize('Account 12345678 ', 14), 155);
    assert(accountDiff < 0.25 && belongsDiff < 0.25, `untouched words moved or disappeared: ${accountDiff.toFixed(3)}, ${belongsDiff.toFixed(3)}`);
    return `secret removed; uncovered visual text preserved (${accountDiff.toFixed(3)}, ${belongsDiff.toFixed(3)} normalized pixel difference)`;
  });

  await t('QA#4 PowerPoint: themes, backgrounds, new/duplicated/deleted/reordered slides keep speaker notes', async () => {
    const P = (await import('pptxgenjs')).default; const p = new P(); p.layout = 'LAYOUT_WIDE';
    ['One', 'Two', 'Three'].forEach((n) => { const s = p.addSlide(); s.addText(n, { x: 1, y: 1, w: 6, h: 1, fontSize: 32 }); s.addNotes(`notes ${n}`); });
    const bytes = (await p.write({ outputType: 'uint8array' })) as Uint8Array;
    const { applyTheme, THEMES, titleSlide } = await import('../src/engines/slides');
    const deck = await loadPptx(bytes);
    await applyTheme(deck, THEMES.find((t) => t.id === 'ocean')!);
    const [gone] = deck.slides.splice(1, 1); (deck.removed ??= []).push(gone);           // delete "Two"
    deck.slides.reverse();                                                             // reorder → Three, One
    deck.slides.push({ ...titleSlide('Brand new', 'sub'), bgChanged: true });          // add
    deck.slides[0].els.push({ id: 'pic', kind: 'image', x: 600, y: 200, w: 100, h: 100, rounded: true, image: { bytes: png, mime: 'image/png', url: '' } });
    const out = (await savePptx(deck)).bytes;
    const again = await loadPptx(out);
    const titles = again.slides.map((s) => s.els.find((e) => e.text)?.text);
    assert(JSON.stringify(titles) === JSON.stringify(['Three', 'One', 'Brand new']), 'order ' + JSON.stringify(titles));
    assert(again.slides[0].notes === 'notes Three' && again.slides[1].notes === 'notes One', 'notes ' + again.slides.map((s) => s.notes));
    assert(again.slides[0].els.some((e) => e.kind === 'image'), 'new picture');
    const JSZip = (await import('jszip')).default; const z = await JSZip.loadAsync(out);
    const s1 = await z.file(again.slides[0].path!)!.async('string');
    assert(/<p:bg>/.test(s1) && /blipFill/.test(s1), 'theme background');
    assert(!Object.keys(z.files).some((f) => f.endsWith('/' + gone.path!.split('/').pop())) || !(await z.file('ppt/presentation.xml')!.async('string')).includes(gone.rid!), 'deleted slide still listed');
    return `slides ${JSON.stringify(titles)}, notes kept`;
  });

  await t('QA#6 PDF → Word on a rotated page', async () => {
    const { pdfTextLayout } = await import('../src/engines/ocrLayout');
    const { renderPage } = await import('../src/engines/pdf');
    const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), pg = d.addPage([595, 842]);
    pg.drawText('Rotated page text', { x: 50, y: 700, size: 14, font: f }); pg.setRotation({ type: 'degrees', angle: 90 } as never);
    const js = await loadPdfJs(await d.save()), page = await js.getPage(1);
    const canvas = document.createElement('canvas'); await renderPage(page, canvas, 300 / 72, (360 - page.rotate) % 360);
    const vp = page.getViewport({ scale: 1, rotation: 0 });
    const L = pdfTextLayout(await extractLines(page), canvas, 300 / 72, vp.width, vp.height);
    assert(L.paras.every((p) => p.runs.every((r) => /^[0-9A-F]{6}$/.test(r.color))), 'colour ' + JSON.stringify(L.paras));
    const { layoutsToDocx } = await import('../src/engines/docx');
    assert((await layoutsToDocx([L])).length > 1000, 'docx');
  });

  await t('PowerPoint: background/picture/fill opacity, hidden slides, stacking order and "no fill" survive saving', async () => {
    const P = (await import('pptxgenjs')).default; const p = new P(); p.layout = 'LAYOUT_WIDE';
    const s1 = p.addSlide();
    s1.addShape('rect', { x: 1, y: 1, w: 3, h: 2, fill: { color: '3366FF' } });
    s1.addText('Boxed', { x: 5, y: 1, w: 3, h: 1, fill: { color: 'FFCC00' } });
    s1.addText('Top text', { x: 1, y: 4, w: 6, h: 1, fontSize: 28 });
    p.addSlide().addText('Second', { x: 1, y: 1, w: 6, h: 1 });
    const { setProps } = await import('../src/engines/slides');
    const deck = await loadPptx((await p.write({ outputType: 'uint8array' })) as Uint8Array);
    const [a, b] = deck.slides;
    Object.assign(a, { bg: '#000000', bgImage: { bytes: png, mime: 'image/png', url: '' }, bgOpacity: 0.4, bgChanged: true });
    Object.assign(b, { bg: '#FF0000', bgOpacity: 0.5, hidden: true, bgChanged: true });
    const shape = a.els.find((e) => e.fill === '#3366FF')!, boxed = a.els.find((e) => e.text === 'Boxed')!, top = a.els.find((e) => e.text === 'Top text')!;
    setProps(shape, { opacity: 0.3 });
    setProps(boxed, { fill: undefined });
    a.els.push({ id: 'pic', kind: 'image', x: 500, y: 300, w: 120, h: 80, opacity: 0.6, image: { bytes: png, mime: 'image/png', url: '' } });
    a.els.splice(a.els.indexOf(top), 1); a.els.unshift(top); a.orderChanged = true;     // send "Top text" to the back
    const out = (await savePptx(deck)).bytes;
    const again = await loadPptx(out);
    const [a2, b2] = again.slides;
    assert(b2.hidden && Math.abs((b2.bgOpacity ?? 1) - 0.5) < 0.01, `slide 2 hidden ${b2.hidden} opacity ${b2.bgOpacity}`);
    assert(!a2.hidden && a2.bgImage, 'background picture is read back');
    assert(Math.abs((a2.els.find((e) => e.fill === '#3366FF')?.opacity ?? 1) - 0.3) < 0.01, 'fill opacity');
    assert(Math.abs((a2.els.find((e) => e.kind === 'image')?.opacity ?? 1) - 0.6) < 0.01, 'picture opacity');
    assert(!a2.els.find((e) => e.text === 'Boxed')?.fill, 'no fill');
    const texts = a2.els.filter((e) => e.text).map((e) => e.text);
    assert(texts[0] === 'Top text', 'stacking order ' + JSON.stringify(texts));
    const pdf = await loadPdfJs(await deckToPdf(again));
    assert(pdf.numPages === 1, 'hidden slide left out of PDF: ' + pdf.numPages);
    // brand-new deck (pptxgenjs path)
    const fresh = newDeck(); Object.assign(fresh.slides[0], { bg: '#00AA00', bgOpacity: 0.5, hidden: true });
    fresh.slides[0].els.push({ id: 'f', kind: 'shape', x: 10, y: 10, w: 50, h: 50, fill: '#123456', opacity: 0.25, text: '' });
    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync((await savePptx(fresh)).bytes)).file('ppt/slides/slide1.xml')!.async('string');
    assert(/show="0"/.test(xml) && /<a:alpha val="(50000|25000|75000)"/.test(xml), 'new deck: hidden + transparency written');
    return `bg ${pdf.numPages} page, order ${JSON.stringify(texts)}`;
  });

  await t('Colour palette: every colour format used in documents is recognised', async () => {
    const { toHex, uniqueColours } = await import('../src/components/ColorPicker');
    const cases: [string, string | null][] = [['#c00000', '#C00000'], ['#abc', '#AABBCC'], ['rgb(255, 0, 128)', '#FF0080'], ['rgba(0,0,0,0)', null], ['FF336699', '#336699'], ['red', '#FF0000'], ['not-a-colour', null]];
    for (const [i, o] of cases) assert(toHex(i) === o, `${i} → ${toHex(i)}`);
    const u = uniqueColours(['#ff0000', 'red', 'rgb(255,0,0)', '#00ff00', undefined, null]);
    assert(JSON.stringify(u) === '["#FF0000","#00FF00"]', JSON.stringify(u));
  });

  await t('Word: paragraph spacing, line spacing, indent, contextual spacing and page margins are read and written back', async () => {
    const D = await import('docx');
    const P = (text: string, o: Record<string, unknown> = {}) => new D.Paragraph({ children: [new D.TextRun(text)], ...o });
    const src = new Uint8Array(await (await D.Packer.toBlob(new D.Document({ sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1000, bottom: 1000, left: 1800, right: 1800 } } },
      children: [
        P('Gap above', { spacing: { before: 320, after: 0, line: 240 } }),
        P('Double', { spacing: { line: 480 }, indent: { left: 720 } }),
        P('Exact', { spacing: { line: 300, lineRule: D.LineRuleType.EXACT } }),
        P('A', { style: 'ListParagraph', contextualSpacing: true, spacing: { after: 200 } }),
        P('B', { style: 'ListParagraph', contextualSpacing: true, spacing: { after: 200 } }),
      ] }] }))).arrayBuffer());
    const { importDocx } = await import('../src/engines/docxImport');
    const r = await importDocx(src);
    assert(/data-sb="16"[^>]*data-sa="0"[^>]*data-lh="1"[^>]*>Gap above/.test(r.html), 'before 16pt ' + r.html.slice(0, 300));
    assert(/data-lh="2" data-ind="36"[^>]*>Double/.test(r.html), 'double + indent');
    assert(/data-lh="15pt"[^>]*>Exact/.test(r.html), 'exact line');
    assert(/data-sa="0"[^>]*>A</.test(r.html) && /data-sa="10"[^>]*>B</.test(r.html), 'contextual spacing between A and B only');
    const pg = r.defaults.page!;
    assert(pg.w === 612 && pg.h === 792 && pg.left === 90 && pg.top === 50, 'page ' + JSON.stringify(pg));
    // write back (editor JSON shape) → same spacing in the new file
    const json = { type: 'doc', content: [
      { type: 'paragraph', attrs: { spaceBefore: 16, spaceAfter: 0, lineHeight: '1' }, content: [{ type: 'text', text: 'Gap above' }] },
      { type: 'paragraph', attrs: { lineHeight: '2', indentLeft: 36 }, content: [{ type: 'text', text: 'Double' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Default' }] },
    ] };
    const out = await jsonToDocx(json, 'T', { bytes: src, defaults: r.defaults });
    const JSZip = (await import('jszip')).default;
    const x = await (await JSZip.loadAsync(out)).file('word/document.xml')!.async('string');
    assert(/<w:spacing w:after="0" w:before="320" w:line="240"/.test(x), 'before 320 written');
    assert(/w:line="480"/.test(x) && /<w:ind w:left="720"/.test(x), 'double + indent written');
    assert(/<w:spacing w:after="160" w:before="0" w:line="276"/.test(x), 'defaults written');
    assert(/<w:pgMar[^>]*w:left="1800"/.test(x), 'original margins kept');
  });

  (window as unknown as { __SMOKE: unknown }).__SMOKE = results;
})();
