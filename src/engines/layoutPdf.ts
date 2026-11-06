// Vector PDF layout for rich-text documents and spreadsheets. Text stays real text (crisp at any
// zoom, selectable, searchable, tiny files) and output is identical on desktop and mobile.
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, RGB } from 'pdf-lib';
import type { JSONContent } from '@tiptap/react';
import { fallbackFonts, fontRuns, pdfText, drawText, textWidth, wrapText } from './pdfFonts';
import type { DocDefaults } from './docx';
import { toEmbeddable } from '../lib/image';
import type { Worksheet } from './sheet';
import { displayValue, colName, peek, merges } from './sheet';
import { resolvePara, linePt, PARA_DEFAULTS, DEFAULT_PAGE, type ParaAttrs, type PageGeom } from '../lib/paraFormat';

const A4: [number, number] = [595.28, 841.89];
const M = 56.7; // 2 cm margins

type Face = Record<'r' | 'b' | 'i' | 'bi', PDFFont>;
type Fonts = Face & { mono: PDFFont; serif: Face; monoFace: Face; fallback: PDFFont[] };
async function loadFonts(doc: PDFDocument, text = ''): Promise<Fonts> {
  const e = (f: StandardFonts) => doc.embedFont(f);
  const serif: Face = { r: await e(StandardFonts.TimesRoman), b: await e(StandardFonts.TimesRomanBold), i: await e(StandardFonts.TimesRomanItalic), bi: await e(StandardFonts.TimesRomanBoldItalic) };
  const monoFace: Face = { r: await e(StandardFonts.Courier), b: await e(StandardFonts.CourierBold), i: await e(StandardFonts.CourierOblique), bi: await e(StandardFonts.CourierBoldOblique) };
  return {
    r: await e(StandardFonts.Helvetica), b: await e(StandardFonts.HelveticaBold),
    i: await e(StandardFonts.HelveticaOblique), bi: await e(StandardFonts.HelveticaBoldOblique),
    mono: monoFace.r, serif, monoFace, fallback: await fallbackFonts(doc, text),
  };
}
/** Map a CSS/Word font family onto the closest standard PDF face. */
const faceFor = (f: Fonts, family?: string): Face =>
  !family ? f : /courier|mono|consolas|menlo/i.test(family) ? f.monoFace : /times|georgia|garamond|cambria|serif|book|palatino|minion/i.test(family) && !/sans/i.test(family) ? f.serif : f;
const ptOf = (v?: string) => { const m = v?.match(/^([\d.]+)(pt|px)?$/); return m ? (m[2] === 'px' ? +m[1] * 0.75 : +m[1]) : undefined; };
const css = (c?: string): RGB | undefined => {
  if (!c) return undefined;
  if (c.startsWith('#')) { const v = parseInt(c.slice(1, 7), 16); return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255); }
  const m = c.match(/\d+/g); return m ? rgb(+m[0] / 255, +m[1] / 255, +m[2] / 255) : undefined;
};

interface Span { text: string; font: PDFFont; color: RGB; underline: boolean; strike: boolean; bg?: RGB; size?: number }

class Writer {
  page!: PDFPage;
  y = 0;
  sectionIndex = 0;
  constructor(public doc: PDFDocument, public f: Fonts, public baseSize = 11, public baseFont?: string, public pg: PageGeom = DEFAULT_PAGE, public defaults?: DocDefaults) { this.newPage(); }
  newPage() {
    const section = this.defaults?.sections?.[this.sectionIndex] ?? this.defaults;
    this.pg = { ...(section?.page ?? this.pg) };
    this.page = this.doc.addPage([this.pg.w, this.pg.h]); this.y = this.pg.h - this.pg.top;
    const width = this.pg.w - this.pg.left - this.pg.right;
    if (section?.header) {
      const lines = wrapText(section.header, width, 9, this.f.r, this.f.fallback);
      lines.forEach((line, i) => drawText(this.page, line, this.f.r, this.f.fallback, { x: this.pg.left, y: this.pg.h - 20 - i * 11, size: 9, color: rgb(0.3, 0.3, 0.3) }));
      this.y = Math.min(this.y, this.pg.h - 30 - lines.length * 11);
    }
    if (section?.footer) {
      const lines = wrapText(section.footer, width, 9, this.f.r, this.f.fallback);
      lines.forEach((line, i) => drawText(this.page, line, this.f.r, this.f.fallback, { x: this.pg.left, y: 18 + (lines.length - i - 1) * 11, size: 9, color: rgb(0.3, 0.3, 0.3) }));
      this.pg.bottom = Math.max(this.pg.bottom, 28 + lines.length * 11);
    }
    if (this.y - this.pg.bottom < 24) throw new Error('The header and footer leave no room for document content. Shorten them or increase the page size before PDF export.');
  }
  ensure(h: number) { if (this.y - h < this.pg.bottom) this.newPage(); }

  spans(nodes: JSONContent[] = [], base: Partial<{ bold: boolean; size: number }> = {}): Span[] {
    return nodes.flatMap((n): Span[] => {
      if (n.type === 'hardBreak') return [{ text: '\n', font: this.f.r, color: rgb(0, 0, 0), underline: false, strike: false }];
      if (n.type !== 'text') return [];
      const m = Object.fromEntries((n.marks ?? []).map((k) => [k.type, k.attrs ?? {}]));
      const bold = !!m.bold || !!base.bold, it = !!m.italic;
      const face = faceFor(this.f, m.textStyle?.fontFamily ?? this.baseFont);
      const preferred = m.code ? this.f.mono : bold && it ? face.bi : bold ? face.b : it ? face.i : face.r;
      return fontRuns(n.text ?? '', preferred, this.f.fallback).map(run => ({
        ...run,
        size: ptOf(m.textStyle?.fontSize),
        color: css(m.textStyle?.color) ?? rgb(0.07, 0.09, 0.15), underline: !!m.underline, strike: !!m.strike,
        bg: m.highlight ? css(m.highlight.color) ?? rgb(1, 0.95, 0.4) : undefined,
      }));
    });
  }

  /** Word-wrap a run of styled spans into a box; returns height used. */
  para(spans: Span[], size: number, x: number, width: number, align = 'left', dryRun = false, startY = this.y, line = PARA_DEFAULTS.body.line): number {
    type Word = Span & { w: number; sz: number };
    const lines: Word[][] = [[]];
    let lineW = 0;
    const push = (s: Span, tok: string, sz: number) => { const w = s.font.widthOfTextAtSize(tok, sz); lines[lines.length - 1].push({ ...s, text: tok, w, sz }); lineW += w; };
    for (const s of spans) {
      const sz = s.size ?? size;
      for (const tok of s.text.split(/(\s+|\n)/)) {
        if (!tok) continue;
        if (tok === '\n') { lines.push([]); lineW = 0; continue; }
        let w = s.font.widthOfTextAtSize(tok, sz);
        if (lineW + w > width && lineW > 0 && tok.trim()) { lines.push([]); lineW = 0; }
        if (!tok.trim() && lineW === 0) continue;
        if (w <= width) { push(s, tok, sz); continue; }
        // A single word wider than the column (long URL, hash…): break it across lines.
        let rest = tok;
        while (rest) {
          let n = rest.length;
          while (n > 1 && s.font.widthOfTextAtSize(rest.slice(0, n), sz) > width - lineW) n--;
          push(s, rest.slice(0, n), sz);
          rest = rest.slice(n);
          if (rest) { lines.push([]); lineW = 0; }
        }
        w = 0;
      }
    }
    const big = (l: Word[]) => Math.max(size, ...l.map((w) => w.sz));
    const lineH = (l: Word[]) => linePt(line, big(l));
    const total = lines.reduce((a, l) => a + lineH(l), 0);
    if (dryRun) return total;
    let y = startY;
    for (const ln of lines) {
      const lh = lineH(ln), sz = big(ln);
      if (y - lh < this.pg.bottom && !dryRun) { this.newPage(); y = this.y; }
      const lw = ln.reduce((a, w) => a + w.w, 0);
      let cx = align === 'center' ? x + (width - lw) / 2 : align === 'right' ? x + width - lw : x;
      const base = y - lh + sz * 0.28; // extra leading goes above the text, like Word
      for (const w of ln) {
        if (w.bg) this.page.drawRectangle({ x: cx, y: base - w.sz * 0.25, width: w.w, height: w.sz * 1.2, color: w.bg });
        this.page.drawText(w.text, { x: cx, y: base, size: w.sz, font: w.font, color: w.color });
        if (w.underline) this.page.drawLine({ start: { x: cx, y: base - 1.5 }, end: { x: cx + w.w, y: base - 1.5 }, thickness: 0.6, color: w.color });
        if (w.strike) this.page.drawLine({ start: { x: cx, y: base + w.sz * 0.3 }, end: { x: cx + w.w, y: base + w.sz * 0.3 }, thickness: 0.6, color: w.color });
        cx += w.w;
      }
      y -= lh;
    }
    this.y = y;
    return total;
  }

  async block(n: JSONContent, indent = 0, marker?: string, kind: 'body' | 'list' = 'body') {
    const W = this.pg.w - this.pg.left - this.pg.right - indent, X = this.pg.left + indent;
    const align = n.attrs?.textAlign ?? 'left';
    switch (n.type) {
      case 'heading': {
        const size = [24, 19, 16, 14, 12, 11][(n.attrs?.level ?? 1) - 1];
        const f = resolvePara(n.attrs as ParaAttrs, 'heading');
        this.y -= f.before; this.ensure(size * 2.2);
        this.para(this.spans(n.content, { bold: true }), size, X + f.indent, W - f.indent, align, false, this.y, f.line);
        this.y -= f.after; break;
      }
      case 'paragraph': {
        const size = this.baseSize;
        const f = resolvePara(n.attrs as ParaAttrs, kind);
        const ind = kind === 'list' ? 0 : f.indent;
        this.y -= f.before;
        if (marker) { this.ensure(size * 1.4); this.page.drawText(marker, { x: X - 16, y: this.y - linePt(f.line, size) + size * 0.28, size, font: this.f.r }); }
        this.para(this.spans(n.content), size, X + ind, W - ind, align, false, this.y, f.line);
        this.y -= f.after; break;
      }
      case 'bulletList': case 'orderedList': {
        let i = n.attrs?.start ?? 1;
        for (const li of n.content ?? []) {
          const mk = n.type === 'orderedList' ? `${i++}.` : '•';
          for (const [k, c] of (li.content ?? []).entries()) await this.block(c, indent + 20, k === 0 ? mk : undefined, 'list');
        }
        break;
      }
      case 'blockquote': {
        const top = this.y;
        for (const c of n.content ?? []) await this.block(c, indent + 18);
        this.page.drawLine({ start: { x: X + 6, y: top }, end: { x: X + 6, y: this.y + 5 }, thickness: 2, color: rgb(0.8, 0.84, 0.88) });
        break;
      }
      case 'codeBlock': {
        const sp: Span[] = fontRuns(n.content?.[0]?.text ?? '', this.f.mono, this.f.fallback).map(run => ({ ...run, color: rgb(0.1, 0.1, 0.1), underline: false, strike: false }));
        const h = this.para(sp, 9.5, X + 6, W - 12, 'left', true) + 8;
        this.ensure(h);
        this.page.drawRectangle({ x: X, y: this.y - h, width: W, height: h, color: rgb(0.95, 0.96, 0.97) });
        this.y -= 4; this.para(sp, 9.5, X + 6, W - 12); this.y -= 10; break;
      }
      case 'horizontalRule':
        this.ensure(12); this.y -= 6;
        this.page.drawLine({ start: { x: X, y: this.y }, end: { x: X + W, y: this.y }, thickness: 0.7, color: rgb(0.6, 0.6, 0.6) });
        this.y -= 8; break;
      case 'sectionBreak':
        this.sectionIndex = (n.attrs?.section ?? this.sectionIndex) + 1;
        this.newPage(); break;
      case 'image': {
        const m = (n.attrs?.src as string)?.match(/^data:([^;]+);base64,(.*)$/);
        if (!m) break;
        const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
        const e = await toEmbeddable(bytes, m[1]);
        const img = e.type === 'png' ? await this.doc.embedPng(e.bytes) : await this.doc.embedJpg(e.bytes);
        let w = Math.min(W, e.width * 0.75), h = (w / e.width) * e.height;
        const maxH = this.pg.h - this.pg.top - this.pg.bottom; if (h > maxH) { w *= maxH / h; h = maxH; }
        this.ensure(h + 6);
        this.page.drawImage(img, { x: X + (W - w) / 2, y: this.y - h, width: w, height: h });
        this.y -= h + 8; break;
      }
      case 'table': {
        const rows = n.content ?? [];
        const cols = Math.max(...rows.map((r) => (r.content ?? []).reduce((a, c) => a + (c.attrs?.colspan ?? 1), 0)), 1);
        const cw = W / cols, size = 10, pad = 4;
        for (const r of rows) {
          const cells = (r.content ?? []).map((c) => ({ c, spans: this.spans((c.content ?? []).flatMap((p) => [...(p.content ?? []), { type: 'hardBreak' }]).slice(0, -1), { bold: c.type === 'tableHeader' }) }));
          const h = Math.max(...cells.map(({ c, spans }) => this.para(spans, size, 0, cw * (c.attrs?.colspan ?? 1) - 2 * pad, 'left', true))) + 2 * pad;
          this.ensure(h);
          let cx = X; const top = this.y;
          for (const { c, spans } of cells) {
            const w = cw * (c.attrs?.colspan ?? 1);
            if (c.type === 'tableHeader') this.page.drawRectangle({ x: cx, y: top - h, width: w, height: h, color: rgb(0.945, 0.96, 0.976) });
            this.page.drawRectangle({ x: cx, y: top - h, width: w, height: h, borderColor: rgb(0.75, 0.78, 0.82), borderWidth: 0.6 });
            this.para(spans, size, cx + pad, w - 2 * pad, 'left', false, top - pad);
            cx += w;
          }
          this.y = top - h;
        }
        this.y -= 8; break;
      }
      default:
        for (const c of n.content ?? []) await this.block(c, indent);
    }
  }
}

export async function richTextToPdf(json: JSONContent, title = 'Document', defaults?: DocDefaults): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setCreator('DocumentHub');
  const content = JSON.stringify(json) + JSON.stringify(defaults ?? {});
  const w = new Writer(doc, await loadFonts(doc, content), defaults?.sizePt ?? 11, defaults?.font, defaults?.page ?? DEFAULT_PAGE, defaults);
  for (const n of json.content ?? []) await w.block(n);
  return doc.save();
}

/** Spreadsheet → paginated vector PDF (landscape when wide), with gridlines, bold and fills preserved. */
export async function sheetToPdf(ws: Worksheet): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const contents: string[] = [];
  ws.eachRow(row => row.eachCell(cell => contents.push(displayValue(ws, cell))));
  const f = await loadFonts(doc, contents.join('\n'));
  const rows = ws.rowCount, cols = ws.columnCount;
  const size = 9, pad = 3;
  const widths: number[] = [];
  for (let c = 1; c <= cols; c++) {
    let w = 30;
    for (let r = 1; r <= Math.min(rows, 500); r++) {
      const cell = peek(ws, r, c);
      if (cell) for (const line of pdfText(displayValue(ws, cell)).split('\n')) w = Math.max(w, textWidth(line, size, f.r, f.fallback) + 2 * pad);
    }
    widths.push(Math.min(w, 220));
  }
  const total = widths.reduce((a, b) => a + b, 0);
  const pageSize: [number, number] = total > A4[0] - 2 * M ? [A4[1], A4[0]] : A4;
  const usable = pageSize[0] - 2 * 36;
  const scale = Math.min(1, usable / total);
  // split columns into vertical bands if still too wide after modest scaling
  const s = Math.max(scale, 0.6);
  const bands: number[][] = [[]]; let bw = 0;
  widths.forEach((w, i) => { if (bw + w * s > usable && bands[bands.length - 1].length) { bands.push([]); bw = 0; } bands[bands.length - 1].push(i + 1); bw += w * s; });
  const merged = merges(ws);
  for (const band of bands) {
    let page = doc.addPage(pageSize), y = pageSize[1] - 36;
    const header = () => {
      let x = 36;
      for (const c of band) { page.drawText(colName(c), { x: x + pad, y: y + 3, size: 7, font: f.r, color: rgb(0.5, 0.5, 0.5) }); x += widths[c - 1] * s; }
    };
    header();
    for (let r = 1; r <= rows; r++) {
      let x = 36;
      const cells = band.flatMap(c => {
        const range = merged.find(m => r >= m.top && r <= m.bottom && c >= m.left && c <= m.right);
        const cellWidth = widths[c - 1] * s, at = x; x += cellWidth;
        if (range && (r !== range.top || c !== Math.max(range.left, band[0]))) return [];
        const cell = peek(ws, r, range ? range.left : c);
        const w = range ? band.filter(col => col >= c && col <= range.right).reduce((n, col) => n + widths[col - 1] * s, 0) : cellWidth;
        const font = cell?.font?.bold ? f.b : f.r;
        const lines = wrapText(cell ? displayValue(ws, cell) : '', Math.max(1, w - 2 * pad), size * s, font, f.fallback);
        return [{ cell, w, x: at, font, lines }];
      });
      const lineH = (size + 3) * s;
      const explicitHeight = (ws.findRow(r)?.height ?? 0) * s;
      const count = Math.max(1, Math.ceil((explicitHeight - 2 * pad) / lineH), ...cells.map(c => c.lines.length));
      let offset = 0;
      while (offset < count) {
        if (y - lineH - 2 * pad < 36) { page = doc.addPage(pageSize); y = pageSize[1] - 36; header(); }
        const take = Math.min(count - offset, Math.max(1, Math.floor((y - 36 - 2 * pad) / lineH)));
        const height = take * lineH + 2 * pad;
        for (const { cell, w, x: at, font, lines } of cells) {
          const fill = (cell?.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
          if (fill?.length === 8 && fill !== 'FFFFFFFF') page.drawRectangle({ x: at, y: y - height, width: w, height, color: css('#' + fill.slice(2))! });
          page.drawRectangle({ x: at, y: y - height, width: w, height, borderColor: rgb(0.82, 0.84, 0.87), borderWidth: 0.4 });
          const isNum = typeof cell?.value === 'number' || !!cell?.formula;
          const align = cell?.alignment?.horizontal ?? (isNum ? 'right' : 'left');
          const color = cell?.font?.color?.argb ? css('#' + cell.font.color.argb.slice(2)) : undefined;
          for (let i = 0; i < take; i++) {
            const line = lines[offset + i]; if (!line) continue;
            const tw = textWidth(line, size * s, font, f.fallback);
            const tx = align === 'right' ? at + w - pad - tw : align === 'center' ? at + (w - tw) / 2 : at + pad;
            drawText(page, line, font, f.fallback, { x: tx, y: y - pad - size * s - i * lineH, size: size * s, color: color ?? rgb(0.1, 0.1, 0.1) });
          }
        }
        offset += take; y -= height;
      }
    }
  }
  return doc.save();
}
