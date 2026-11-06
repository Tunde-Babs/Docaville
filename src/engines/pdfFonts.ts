import { PDFDocument, PDFFont, PDFPage, type PDFPageDrawTextOptions } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sansUrl from '../assets/fonts/NotoSans-Regular.ttf?url';
import arabicUrl from '../assets/fonts/NotoNaskhArabic-Regular.ttf?url';
import cjkUrl from '../assets/fonts/NotoSansCJKsc-Regular.otf?url';

const bytes = new Map<string, Promise<Uint8Array>>();
const embedded = new WeakMap<PDFDocument, Map<string, Promise<PDFFont>>>();
const glyphs = new WeakMap<PDFFont, Set<number>>();
const hasGlyphs = (font: PDFFont, text: string) => {
  let set = glyphs.get(font); if (!set) { set = new Set(font.getCharacterSet()); glyphs.set(font, set); }
  return [...text].every(c => /[\n\r\t]/.test(c) || set!.has(c.codePointAt(0)!));
};

const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export const isWinAnsi = (text: string) => [...text].every(ch => { const c = ch.codePointAt(0)!; return c === 10 || c === 13 || c === 9 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(ch); });
export const pdfText = (s: string) => s.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');

/** Offline, subset-embedded fallback fonts. Ordinary Latin PDFs keep their existing standard fonts. */
export async function fallbackFonts(doc: PDFDocument, text: string): Promise<PDFFont[]> {
  if (isWinAnsi(text)) return [];
  doc.registerFontkit(fontkit);
  let cache = embedded.get(doc); if (!cache) { cache = new Map(); embedded.set(doc, cache); }
  const urls = [sansUrl, ...(/[\u0600-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u.test(text) ? [arabicUrl] : []), ...(/[\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\u{20000}-\u{3134f}]/u.test(text) ? [cjkUrl] : [])];
  return Promise.all(urls.map(url => {
    let font = cache!.get(url);
    if (!font) {
      let data = bytes.get(url);
      if (!data) {
        data = fetch(url).then(async response => { if (!response.ok) throw new Error('A bundled PDF font could not be loaded. Try reopening DocumentHub.'); return new Uint8Array(await response.arrayBuffer()); });
        bytes.set(url, data); data.catch(() => bytes.delete(url));
      }
      font = data.then(b => doc.embedFont(b, { subset: true }));
      cache!.set(url, font); font.catch(() => cache!.delete(url));
    }
    return font;
  }));
}

export interface FontRun { text: string; font: PDFFont }
/** Keep combining sequences together; never replace unsupported characters with question marks. */
export function fontRuns(text: string, preferred: PDFFont, fallbacks: PDFFont[]): FontRun[] {
  const out: FontRun[] = [];
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(pdfText(text));
  for (const { segment } of segments) {
    const font = [preferred, ...fallbacks].find(f => hasGlyphs(f, segment));
    if (!font) throw new Error(`PDF export has no font for “${segment}” (U+${segment.codePointAt(0)!.toString(16).toUpperCase()}). Save as Word or another format to preserve this text.`);
    const prev = out[out.length - 1];
    if (prev?.font === font) prev.text += segment; else out.push({ text: segment, font });
  }
  return out;
}

export function textWidth(text: string, size: number, preferred: PDFFont, fallbacks: PDFFont[]) {
  return fontRuns(text, preferred, fallbacks).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);
}

export function wrapText(text: string, width: number, size: number, preferred: PDFFont, fallbacks: PDFFont[]): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfText(text).split('\n')) {
    let line = '';
    for (const token of paragraph.split(/(\s+)/)) {
      if (!token) continue;
      if (line && textWidth(line + token, size, preferred, fallbacks) > width) { lines.push(line.trimEnd()); line = ''; }
      if (!line && !token.trim()) continue;
      for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(token)) {
        if (line && textWidth(line + segment, size, preferred, fallbacks) > width) { lines.push(line.trimEnd()); line = ''; }
        line += segment;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function drawText(page: PDFPage, text: string, preferred: PDFFont, fallbacks: PDFFont[], options: PDFPageDrawTextOptions & { x: number; y: number; size: number }) {
  let x = options.x;
  for (const run of fontRuns(text, preferred, fallbacks)) {
    page.drawText(run.text, { ...options, x, font: run.font });
    x += run.font.widthOfTextAtSize(run.text, options.size);
  }
}

/** AcroForm appearance streams use a single font; fail safely when no one font covers the field. */
export async function fieldFont(doc: PDFDocument, text: string, preferred: PDFFont) {
  const fonts = [preferred, ...await fallbackFonts(doc, text)];
  const font = fonts.find(f => hasGlyphs(f, pdfText(text)));
  if (!font) throw new Error('This PDF form field combines scripts that cannot share one font. Save the text in Word to preserve it.');
  return font;
}
