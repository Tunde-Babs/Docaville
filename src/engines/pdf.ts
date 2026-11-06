// PDF engine: pdf.js for rendering/text extraction, pdf-lib for lossless writing.
//
// Design principle (avoids the "I c h" / lost-numbering breakage seen in many PDF editors):
// we NEVER re-flow or re-typeset the original page content. Original content streams are
// preserved byte-for-byte; edits are applied as an overlay (cover patch + new text, images,
// highlights). Untouched text stays pixel-identical, selectable and searchable.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  PDFDocument, StandardFonts, rgb, degrees, PDFFont, PDFPage,
  PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup,
} from 'pdf-lib';
import { toEmbeddable } from '../lib/image';
import { fallbackFonts, drawText, fieldFont, isWinAnsi, pdfText } from './pdfFonts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };
export type PdfJsDoc = pdfjs.PDFDocumentProxy;

export async function loadPdfJs(bytes: Uint8Array): Promise<PdfJsDoc> {
  // pdf.js transfers (detaches) the buffer to its worker, so always hand it a copy.
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
}

/** Render a page to a canvas. `scale` is CSS px per PDF point × devicePixelRatio handled by caller. */
export async function renderPage(page: pdfjs.PDFPageProxy, canvas: HTMLCanvasElement, scale: number, rotation = 0) {
  const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return viewport;
}

// ---------- overlay model (all coordinates in PDF user space, origin bottom-left) ----------
export type FontFamily = 'sans' | 'serif' | 'mono';
export type Overlay =
  | { id: string; type: 'text'; page: number; x: number; y: number; size: number; text: string; color: string; family: FontFamily; bold?: boolean }
  | { id: string; type: 'rect'; page: number; x: number; y: number; w: number; h: number; color: string; opacity: number }
  | { id: string; type: 'image'; page: number; x: number; y: number; w: number; h: number; bytes: Uint8Array; mime: string }
  | { id: string; type: 'field'; page: number; x: number; y: number; w: number; h: number; kind: 'text' | 'checkbox' | 'dropdown'; name: string; options?: string[]; multiline?: boolean };

/** Values typed into existing form fields, keyed `${sourceIndex}:${fieldName}`. */
export type FormValues = Record<string, string | boolean>;

/** A page in the working document: which source PDF + page index, plus extra rotation. */
export interface PageRef { src: number; index: number; rotation: number }

const hex = (h: string) => {
  const v = parseInt(h.replace('#', ''), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
};

// Kept for callers using standard fonts: fail before saving instead of silently corrupting text.
export const winAnsiSafe = (s: string) => { if (!isWinAnsi(s)) throw new Error('This PDF export requires an embedded Unicode font.'); return pdfText(s); };

async function fontsFor(doc: PDFDocument) {
  const cache = new Map<string, PDFFont>();
  const map: Record<string, StandardFonts> = {
    sans: StandardFonts.Helvetica, 'sans-b': StandardFonts.HelveticaBold,
    serif: StandardFonts.TimesRoman, 'serif-b': StandardFonts.TimesRomanBold,
    mono: StandardFonts.Courier, 'mono-b': StandardFonts.CourierBold,
  };
  return async (family: FontFamily, bold?: boolean) => {
    const key = family + (bold ? '-b' : '');
    if (!cache.has(key)) cache.set(key, await doc.embedFont(map[key]));
    return cache.get(key)!;
  };
}

async function drawOverlays(doc: PDFDocument, page: PDFPage, overlays: Overlay[], font: Awaited<ReturnType<typeof fontsFor>>) {
  for (const o of overlays) {
    if (o.type === 'rect') {
      page.drawRectangle({ x: o.x, y: o.y, width: o.w, height: o.h, color: hex(o.color), opacity: o.opacity });
    } else if (o.type === 'text') {
      const f = await font(o.family, o.bold);
      const fallback = await fallbackFonts(doc, o.text);
      o.text.split('\n').forEach((line, i) =>
        drawText(page, line, f, fallback, { x: o.x, y: o.y - i * o.size * 1.2, size: o.size, color: hex(o.color) }));
    } else if (o.type === 'image') {
      const e = await toEmbeddable(o.bytes, o.mime);
      const img = e.type === 'png' ? await doc.embedPng(e.bytes) : await doc.embedJpg(e.bytes);
      page.drawImage(img, { x: o.x, y: o.y, width: o.w, height: o.h });
    }
  }
}

/**
 * Write the edited document. When pages are untouched in order (common case) the original
 * file is modified in place so forms, bookmarks, links and metadata all survive.
 */
export async function savePdf(sources: Uint8Array[], pages: PageRef[], overlays: Overlay[], values: FormValues = {}, flatten = false): Promise<Uint8Array> {
  if (overlays.some(o => o.type === 'rect' && o.opacity >= 1)) {
    const { coveredCopy } = await import('./pdfCover');
    // Prepare current page order, rotations and form values, then exclude every original object.
    const prepared = await savePdf(sources, pages, [], values, true);
    const clean = await coveredCopy(prepared, overlays);
    return savePdf([clean.bytes], clean.pages, clean.overlays, {}, true);
  }
  const identity = sources.length === 1 && pages.every((p, i) => p.src === 0 && p.index === i);
  let out: PDFDocument;
  if (identity) {
    out = await PDFDocument.load(sources[0], { ignoreEncryption: true });
    const n = out.getPageCount();
    for (let i = n - 1; i >= pages.length; i--) out.removePage(i);
    await fillForm(out, values, 0);
  } else {
    out = await PDFDocument.create();
    const loaded = await Promise.all(sources.map((s) => PDFDocument.load(s, { ignoreEncryption: true })));
    // Pages are being re-assembled, which can't carry a live AcroForm across documents:
    // fill each source and flatten its fields so the entered values are kept visibly.
    for (const [i, d] of loaded.entries()) { await fillForm(d, values, i); flattenForm(d); }
    for (const p of pages) {
      const [copy] = await out.copyPages(loaded[p.src], [p.index]);
      out.addPage(copy);
    }
  }
  const font = await fontsFor(out);
  for (let i = 0; i < pages.length; i++) {
    const page = out.getPage(i);
    if (pages[i].rotation) page.setRotation(degrees((page.getRotation().angle + pages[i].rotation) % 360));
    await drawOverlays(out, page, overlays.filter((o) => o.page === i), font);
  }
  await addFields(out, overlays.filter((o): o is Extract<Overlay, { type: 'field' }> => o.type === 'field'));
  if (flatten) flattenForm(out);
  return out.save({ useObjectStreams: true });
}

async function fillForm(doc: PDFDocument, values: FormValues, src: number) {
  const prefix = `${src}:`;
  const entries = Object.entries(values).filter(([k]) => k.startsWith(prefix));
  if (!entries.length) return;
  const form = doc.getForm();
  for (const [key, v] of entries) {
    const f = form.getFieldMaybe(key.slice(prefix.length));
    if (!f) continue;
      if (f instanceof PDFTextField) {
        const font = await fieldFont(doc, String(v), await doc.embedFont(StandardFonts.Helvetica));
        f.setText(pdfText(String(v))); f.updateAppearances(font);
      }
      else if (f instanceof PDFCheckBox) (v && v !== 'Off' ? f.check() : f.uncheck());
      else if (f instanceof PDFRadioGroup) { if (typeof v === 'string' && f.getOptions().includes(v)) f.select(v); }
      else if (f instanceof PDFDropdown || f instanceof PDFOptionList) { if (typeof v === 'string' && v) f.select(v); }
  }
  // Each text field received the font appropriate to its script above.
  form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
}

function flattenForm(doc: PDFDocument) {
  const form = doc.getForm(); if (form.getFields().length) form.flatten();
}

async function addFields(doc: PDFDocument, fields: Extract<Overlay, { type: 'field' }>[]) {
  if (!fields.length) return;
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const unique = (n: string) => { let name = n.trim() || 'field', i = 2; while (form.getFieldMaybe(name)) name = `${n}_${i++}`; return name; };
  const style = { borderColor: rgb(0.6, 0.65, 0.72), borderWidth: 1, backgroundColor: rgb(1, 1, 1), font };
  for (const f of fields) {
    const page = doc.getPage(f.page), box = { x: f.x, y: f.y, width: f.w, height: f.h };
    if (f.kind === 'text') {
      const tf = form.createTextField(unique(f.name));
      if (f.multiline) tf.enableMultiline();
      tf.addToPage(page, { ...box, ...style });
    } else if (f.kind === 'checkbox') {
      form.createCheckBox(unique(f.name)).addToPage(page, { ...box, ...style });
    } else {
      const dd = form.createDropdown(unique(f.name));
      const options = (f.options ?? []).map(pdfText).filter(Boolean);
      dd.addOptions(options);
      dd.addToPage(page, { ...box, ...style, font: await fieldFont(doc, options.join(' '), font) });
    }
  }
  form.updateFieldAppearances(font);
}

// ---------- conversions ----------

export interface ImagesToPdfOptions {
  /** 'fit' = each page exactly the image size at `dpi`; 'a4' / 'letter' = fit inside paper with margin. */
  pageSize: 'fit' | 'a4' | 'letter';
  dpi: number;
  margin: number; // points
}

/** Images → PDF. PNG/JPEG are embedded byte-for-byte, so the PDF is exactly as sharp as the source. */
export async function imagesToPdf(images: { bytes: Uint8Array; mime: string }[], opts: ImagesToPdfOptions = { pageSize: 'fit', dpi: 300, margin: 0 }) {
  const doc = await PDFDocument.create();
  const pages: { page: PDFPage; box: { x: number; y: number; w: number; h: number }; px: { w: number; h: number } }[] = [];
  for (const im of images) {
    const e = await toEmbeddable(im.bytes, im.mime);
    const embedded = e.type === 'png' ? await doc.embedPng(e.bytes) : await doc.embedJpg(e.bytes);
    const natW = (e.width / opts.dpi) * 72, natH = (e.height / opts.dpi) * 72;
    let pw = natW, ph = natH;
    if (opts.pageSize !== 'fit') {
      [pw, ph] = opts.pageSize === 'a4' ? [595.28, 841.89] : [612, 792];
      if (natW > natH) [pw, ph] = [ph, pw]; // landscape images get landscape pages
    }
    const m = opts.pageSize === 'fit' ? 0 : opts.margin;
    const s = Math.min((pw - 2 * m) / natW, (ph - 2 * m) / natH, opts.pageSize === 'fit' ? 1 : Infinity);
    const w = natW * s, h = natH * s;
    const page = doc.addPage([pw, ph]);
    const box = { x: (pw - w) / 2, y: (ph - h) / 2, w, h };
    page.drawImage(embedded, { x: box.x, y: box.y, width: w, height: h });
    pages.push({ page, box, px: { w: e.width, h: e.height } });
  }
  return { doc, pages };
}

export async function pdfPageToCanvas(doc: PdfJsDoc, pageNo: number, dpi = 300) {
  const page = await doc.getPage(pageNo);
  const canvas = document.createElement('canvas');
  await renderPage(page, canvas, dpi / 72);
  return canvas;
}

export interface TextLine { text: string; size: number; x: number; y: number; w: number; bold: boolean; family: FontFamily }

/** Group pdf.js text items into visual lines (top-to-bottom, left-to-right). */
export async function extractLines(page: pdfjs.PDFPageProxy): Promise<TextLine[]> {
  const tc = await page.getTextContent();
  type Item = { str: string; transform: number[]; width: number; fontName: string };
  const items = (tc.items as Item[]).filter((i) => 'str' in i && i.str.trim() !== '');
  const rows: { y: number; items: Item[] }[] = [];
  for (const it of items) {
    const y = it.transform[5], size = Math.hypot(it.transform[2], it.transform[3]);
    const row = rows.find((r) => Math.abs(r.y - y) < size * 0.5);
    if (row) row.items.push(it); else rows.push({ y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let text = '', lastEnd = -Infinity;
    for (const it of r.items) {
      const size = Math.hypot(it.transform[2], it.transform[3]);
      if (text && it.transform[4] - lastEnd > size * 0.2 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      lastEnd = it.transform[4] + it.width;
    }
    const first = r.items[0];
    const fam = (tc.styles as Record<string, { fontFamily: string }>)[first.fontName]?.fontFamily ?? '';
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      size: Math.round(Math.hypot(first.transform[2], first.transform[3]) * 2) / 2,
      x: first.transform[4], y: r.y, w: lastEnd - first.transform[4],
      bold: /bold|black|heavy/i.test(first.fontName + fam),
      family: /mono|courier/i.test(fam) ? 'mono' : /serif/i.test(fam) && !/sans/i.test(fam) ? 'serif' : 'sans',
    };
  });
}

export async function pdfToText(doc: PdfJsDoc): Promise<string> {
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) out.push((await extractLines(await doc.getPage(p))).map((l) => l.text).join('\n'));
  return out.join('\n\n\f');
}
