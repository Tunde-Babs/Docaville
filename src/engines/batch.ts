import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { baseName } from '../lib/fileio';
export type BatchOperation = 'pdf' | 'ocr' | 'compress' | 'extract' | 'watermark' | 'number' | 'rename';
export interface BatchOptions { operation: BatchOperation; prefix: string; suffix: string; pages: string; watermark: string; language: string }
export const DEFAULT_BATCH: BatchOptions = { operation: 'pdf', prefix: '', suffix: '', pages: '1', watermark: 'DRAFT', language: 'auto' };
export function pageSelection(expression: string, count: number) {
  const result: number[] = [];
  if (!expression.trim()) throw new Error('Enter page numbers, for example 1,3-5.');
  for (const part of expression.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error(`Invalid page selection: ${part}`);
    const start = +match[1], end = +(match[2] ?? start);
    if (start < 1 || end < start || end > count) throw new Error(`Page selection must be between 1 and ${count}.`);
    for (let p = start; p <= end; p++) if (!result.includes(p - 1)) result.push(p - 1);
  }
  return result;
}
export function safeFilename(name: string) { return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 180) || 'Document'; }
export function uniqueFilename(name: string, used: Set<string>) {
  let result = safeFilename(name), n = 2;
  const ext = result.includes('.') ? '.' + result.split('.').pop() : '', base = ext ? result.slice(0, -ext.length) : result;
  while (used.has(result.toLowerCase())) result = `${base} (${n++})${ext}`;
  used.add(result.toLowerCase()); return result;
}
async function toPdf(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.pdf$/i.test(file.name)) return bytes;
  const { detectKind } = await import('../lib/formats'); const kind = detectKind(file.name, file.type);
  if (kind === 'image') {
    const { normalizeImage } = await import('../lib/image'), { imagesToPdf } = await import('./pdf');
    return (await imagesToPdf(await normalizeImage(bytes, file.type), { pageSize: 'a4', dpi: 300, margin: 28 })).doc.save();
  }
  if (kind === 'slides') { const { loadPptx, deckToPdf } = await import('./slides'); return deckToPdf(await loadPptx(bytes)); }
  if (kind === 'sheet') {
    const { loadWorkbook } = await import('./sheet'), { sheetToPdf } = await import('./layoutPdf'); const wb = await loadWorkbook(bytes, file.name), out = await PDFDocument.create();
    for (const sheet of wb.worksheets) { const pdf = await PDFDocument.load(await sheetToPdf(sheet)); (await out.copyPages(pdf, pdf.getPageIndices())).forEach(page => out.addPage(page)); }
    return out.save();
  }
  if (/\.(docx|txt|md|html?)$/i.test(file.name)) {
    const { Editor } = await import('@tiptap/core'), { documentExtensions } = await import('../editors/DocEditor'), { textHtml } = await import('./documentTools');
    const content = /\.docx$/i.test(file.name) ? await (await import('./docxImport')).importDocx(bytes) : { html: /\.html?$/i.test(file.name) ? new TextDecoder().decode(bytes) : textHtml(new TextDecoder().decode(bytes)) };
    const editor = new Editor({ extensions: documentExtensions, content: content.html });
    try { return await (await import('./layoutPdf')).richTextToPdf(editor.getJSON(), baseName(file.name), 'defaults' in content ? content.defaults : undefined); }
    finally { editor.destroy(); }
  }
  throw new Error('This format cannot be converted locally. Save it as DOCX, XLSX, PPTX, or an image first.');
}
export async function processBatchFile(file: File, options: BatchOptions, signal: AbortSignal, progress: (message: string) => void): Promise<{ name: string; bytes: Uint8Array }> {
  signal.throwIfAborted();
  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
  const name = safeFilename(`${options.prefix}${baseName(file.name)}${options.suffix}${options.operation === 'rename' ? ext : '.pdf'}`);
  if (options.operation === 'rename') return { name, bytes: new Uint8Array(await file.arrayBuffer()) };
  const bytes = await toPdf(file); signal.throwIfAborted();
  if (options.operation === 'pdf') return { name, bytes };
  const pdf = await PDFDocument.load(bytes);
  if (options.operation === 'extract') {
    const out = await PDFDocument.create(); (await out.copyPages(pdf, pageSelection(options.pages, pdf.getPageCount()))).forEach(page => out.addPage(page));
    return { name, bytes: await out.save() };
  }
  if (options.operation === 'number' || options.operation === 'watermark') {
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const [i, page] of pdf.getPages().entries()) {
      signal.throwIfAborted();
      if (options.operation === 'number') page.drawText(`${i + 1} / ${pdf.getPageCount()}`, { x: Math.max(10, page.getWidth() / 2 - 15), y: 14, size: 10, font, color: rgb(0.25, 0.25, 0.25) });
      else {
        if (!options.watermark.trim()) throw new Error('Enter watermark text.');
        const size = Math.min(52, page.getWidth() * 0.7 / Math.max(1, font.widthOfTextAtSize(options.watermark, 1)));
        page.drawText(options.watermark, { x: page.getWidth() * 0.15, y: page.getHeight() * 0.38, size, font, rotate: degrees(30), opacity: 0.2, color: rgb(0.4, 0.4, 0.4) });
      }
    }
    return { name, bytes: await pdf.save() };
  }
  const { loadPdfJs, pdfPageToCanvas, extractLines } = await import('./pdf'); const js = await loadPdfJs(bytes);
  try {
    if (options.operation === 'compress') {
      const out = await PDFDocument.create();
      for (let p = 1; p <= js.numPages; p++) {
        signal.throwIfAborted(); progress(`Compressing page ${p}/${js.numPages}`);
        const canvas = await pdfPageToCanvas(js, p, 144), viewport = (await js.getPage(p)).getViewport({ scale: 1 });
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image encoding failed')), 'image/jpeg', 0.75));
        const image = await out.embedJpg(await blob.arrayBuffer()), page = out.addPage([viewport.width, viewport.height]); page.drawImage(image, { x: 0, y: 0, width: viewport.width, height: viewport.height });
      }
      return { name, bytes: await out.save() };
    }
    const { ocrCanvas, addTextLayer } = await import('./ocr');
    for (let p = 1; p <= js.numPages; p++) {
      signal.throwIfAborted(); progress(`OCR page ${p}/${js.numPages}`);
      if ((await extractLines(await js.getPage(p))).length) continue;
      const ocr = await ocrCanvas(await pdfPageToCanvas(js, p, 200), options.language, (_, message) => progress(message)); signal.throwIfAborted();
      const page = pdf.getPage(p - 1); await addTextLayer(pdf, page, ocr, { x: 0, y: 0, w: page.getWidth(), h: page.getHeight() });
    }
    return { name, bytes: await pdf.save() };
  } finally { await js.destroy(); }
}
