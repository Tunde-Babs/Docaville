// OCR via Tesseract (WASM) — runs fully on-device on desktop and mobile.
import { createWorker, type Worker } from 'tesseract.js';
import { PDFDocument, StandardFonts, PDFPage } from 'pdf-lib';
import { fallbackFonts, textWidth, drawText, pdfText } from './pdfFonts';

export { OCR_LANGS } from '../lib/langs';

export interface OcrWord { text: string; conf: number; reviewed?: boolean; x0: number; y0: number; x1: number; y1: number }
export interface OcrLine { text: string; words: OcrWord[]; x0: number; y0: number; x1: number; y1: number }
export interface OcrResult { text: string; lines: OcrLine[]; width: number; height: number; langs?: string }

let worker: Worker | null = null;
let workerLangs = '';

async function getWorker(langs: string, onProgress?: (p: number, status: string) => void) {
  if (worker && workerLangs === langs) return worker;
  await worker?.terminate();
  worker = await createWorker(langs.split('+'), 1, {
    workerPath: new URL('./ocr-runtime/worker.min.js', document.baseURI).href,
    corePath: new URL('./ocr-runtime/', document.baseURI).href,
    workerBlobURL: false,
    logger: (m: { progress: number; status: string }) => onProgress?.(m.progress, m.status),
  });
  workerLangs = langs;
  return worker;
}

/**
 * Pre-process for Tesseract: upscale small images (screenshots, phone crops) so body text reaches
 * the ~30px cap-height LSTM models are trained on, and convert to contrast-stretched greyscale so
 * coloured / light-grey text on tinted backgrounds is read reliably. Returns the scale used.
 */
function preprocess(src: HTMLCanvasElement): { canvas: HTMLCanvasElement; scale: number } {
  const long = Math.max(src.width, src.height);
  const scale = Math.min(4, Math.max(1, 3200 / long));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  // luminance histogram → stretch 1st..99th percentile to full range
  const hist = new Uint32Array(256), lum = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; lum[j] = l; hist[lum[j]]++; }
  const total = lum.length; let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.01) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.01) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = ((lum[j] - lo) * 255) / range; d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, scale };
}

// ---- automatic language detection (stop-word scoring) ----
const STOP: Record<string, string[]> = {
  eng: 'the and is of to in that it you for with on are this be was have not'.split(' '),
  deu: 'der die das und ist nicht ich du wir ihr sie mit auf für von dem den ein eine zu im noch heute auch sich'.split(' '),
  fra: 'le la les et est je tu nous vous des une dans pour pas que qui sur avec'.split(' '),
  spa: 'el la los las y es que en un una por para con no se del al'.split(' '),
  ita: 'il lo la gli le e che di un una per con non sono del della'.split(' '),
  por: 'o a os as e que de um uma para com não em do da se'.split(' '),
  nld: 'de het een en is niet ik je wij zijn van op met voor dat'.split(' '),
  tur: 've bir bu da de için ile ne çok gibi'.split(' '),
  pol: 'i w nie na się z jest to że do'.split(' '),
};
export function detectLang(text: string): string {
  const toks = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  if (toks.length < 5) return 'eng';
  let best = 'eng', bestScore = 0;
  for (const [lang, words] of Object.entries(STOP)) {
    const set = new Set(words);
    const score = toks.filter((t) => set.has(t)).length / toks.length + (lang === 'deu' && /[äöüß]/.test(text) ? 0.05 : 0);
    if (score > bestScore) { best = lang; bestScore = score; }
  }
  return best;
}
function localeLangs(): string {
  const map: Record<string, string> = { de: 'deu', fr: 'fra', es: 'spa', it: 'ita', pt: 'por', nl: 'nld', tr: 'tur', pl: 'pol', ru: 'rus' };
  const extra = [...new Set((navigator.languages ?? []).map((l) => map[l.slice(0, 2)]).filter(Boolean))].slice(0, 1);
  return ['eng', ...extra].join('+');
}

async function recognize(pre: { canvas: HTMLCanvasElement; scale: number }, langs: string, srcW: number, srcH: number, onProgress?: (p: number, status: string) => void): Promise<OcrResult> {
  const w = await getWorker(langs, onProgress);
  await w.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
  const { data } = await w.recognize(pre.canvas, {}, { text: true, blocks: true });
  const k = 1 / pre.scale;
  // German: Tesseract's classic small-text confusion is ü → "ii" (müssen → miissen). Native German
  // words essentially never contain "ii", so this correction is safe when German is the primary model.
  const fix = langs.startsWith('deu') ? (t: string) => t.replace(/(?<=\p{L})ii(?=\p{L})/gu, 'ü') : (t: string) => t;
  const sc = <T extends { x0: number; y0: number; x1: number; y1: number }>(b: T) => ({ x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines) {
        const words = line.words
          .filter((wd) => wd.text.trim() && !(wd.confidence < 25 && !/[\p{L}\d]/u.test(wd.text))) // drop speckle noise
          .map((wd) => ({ text: fix(wd.text), conf: wd.confidence, ...sc(wd.bbox) }));
        if (words.length) lines.push({ text: words.map((x) => x.text).join(' '), words, ...sc(line.bbox) });
      }
  return { text: lines.map((l) => l.text).join('\n'), lines, width: srcW, height: srcH, langs };
}

/**
 * OCR a canvas. Coordinates in the result are in the ORIGINAL canvas pixel space.
 * `langs` may be 'auto': OCR with English + system language, detect the document language from
 * the text, and re-run with the right model if it differs (umlauts, accents, ß…).
 */
export async function ocrCanvas(canvas: HTMLCanvasElement, langs = 'auto', onProgress?: (p: number, status: string) => void): Promise<OcrResult> {
  const pre = preprocess(canvas);
  if (langs !== 'auto') return recognize(pre, langs, canvas.width, canvas.height, onProgress);
  const first = localeLangs();
  const res = await recognize(pre, first, canvas.width, canvas.height, onProgress);
  const detected = detectLang(res.text);
  // Re-read with the detected language as the PRIMARY model (umlauts/accents improve markedly).
  if (first.split('+')[0] === detected) return res;
  onProgress?.(0, `detected ${detected}, re-reading`);
  return recognize(pre, detected === 'eng' ? 'eng' : `${detected}+eng`, canvas.width, canvas.height, onProgress);
}

/**
 * Add an invisible, selectable/searchable text layer on top of a page image.
 * `box` = where the image sits on the page (PDF points); OCR coords are image pixels.
 */
export async function addTextLayer(doc: PDFDocument, page: PDFPage, ocr: OcrResult, box: { x: number; y: number; w: number; h: number }) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fallback = await fallbackFonts(doc, ocr.text);
  const sx = box.w / ocr.width, sy = box.h / ocr.height;
  for (const line of ocr.lines)
    for (const wd of line.words) {
      const text = pdfText(wd.text);
      const hPt = (wd.y1 - wd.y0) * sy, wPt = (wd.x1 - wd.x0) * sx;
      const natural = textWidth(text, hPt, font, fallback) || 1;
      const size = Math.max(1, Math.min(hPt * 1.1, (hPt * wPt) / natural));
      drawText(page, text, font, fallback, {
        x: box.x + wd.x0 * sx,
        y: box.y + box.h - line.y1 * sy + (line.y1 - line.y0) * sy * 0.2,
        size, opacity: 0,
      });
    }
}

/** Image(s) → searchable PDF: pixel-perfect image + hidden OCR text. */
export async function makeSearchable(pdf: { doc: PDFDocument; pages: { page: PDFPage; box: { x: number; y: number; w: number; h: number } }[] }, canvases: HTMLCanvasElement[], langs: string, onProgress?: (msg: string) => void) {
  for (let i = 0; i < pdf.pages.length; i++) {
    onProgress?.(`OCR page ${i + 1}/${pdf.pages.length}…`);
    const ocr = await ocrCanvas(canvases[i], langs);
    await addTextLayer(pdf.doc, pdf.pages[i].page, ocr, pdf.pages[i].box);
  }
  return pdf.doc.save();
}

/** Plain paragraphs from OCR (used when the user hand-edits the recognised text). */
export function ocrToParagraphs(ocr: OcrResult): { text: string; heightPx: number }[] {
  return ocr.lines.map((l) => ({ text: l.text, heightPx: l.y1 - l.y0 }));
}
