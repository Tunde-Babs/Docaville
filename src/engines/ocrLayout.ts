// Turns raw OCR word boxes + the source pixels into a faithful document layout:
// per-word text colour, font size, indentation, alignment, vertical spacing, page colour,
// and fill-in blanks ("________") that Tesseract discards as line-art.
import type { OcrResult, OcrWord } from './ocr';
import type { TextLine } from './pdf';

export interface LayoutRun { text: string; color: string; bold: boolean; sizePt?: number }
export interface LayoutTab { pos: number; type: 'left' | 'right' } // pos in pt from the left text margin
export interface LayoutPara { runs: LayoutRun[]; sizePt: number; indentPt: number; spaceBeforePt: number; align: 'left' | 'center' | 'right'; tabs?: LayoutTab[] }
export interface OcrLayout { paras: LayoutPara[]; background: string | null; pageWidthPt: number }

type RGB = [number, number, number];
const hex = (c: RGB) => c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const dist = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

class Pixels {
  d: Uint8ClampedArray; w: number; h: number;
  constructor(c: HTMLCanvasElement) {
    this.w = c.width; this.h = c.height;
    this.d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  }
  at(x: number, y: number): RGB {
    const i = (Math.min(this.h - 1, Math.max(0, y | 0)) * this.w + Math.min(this.w - 1, Math.max(0, x | 0))) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2]];
  }
  /** Most common colour in a set of points (bucketed). */
  dominant(points: [number, number][]): RGB {
    const m = new Map<number, { n: number; s: RGB }>();
    for (const [x, y] of points) {
      const c = this.at(x, y), k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
      const e = m.get(k) ?? { n: 0, s: [0, 0, 0] as RGB };
      e.n++; e.s = [e.s[0] + c[0], e.s[1] + c[1], e.s[2] + c[2]]; m.set(k, e);
    }
    const best = [...m.values()].sort((a, b) => b.n - a.n)[0];
    return [best.s[0] / best.n, best.s[1] / best.n, best.s[2] / best.n];
  }
  /** Background just around a box. */
  bgAround(x0: number, y0: number, x1: number, y1: number): RGB {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 16; i++) { const x = x0 + ((x1 - x0) * i) / 16; pts.push([x, y0 - 3], [x, y1 + 3]); }
    for (let i = 0; i <= 6; i++) { const y = y0 + ((y1 - y0) * i) / 6; pts.push([x0 - 4, y], [x1 + 4, y]); }
    return this.dominant(pts);
  }
  /**
   * Text colour = mean of the "core" glyph pixels (the 35% most different from the background).
   * Averaging the core avoids both anti-aliased edges (too light) and single noisy pixels.
   */
  ink(x0: number, y0: number, x1: number, y1: number, bg: RGB): { color: RGB; density: number } {
    const px: { c: RGB; d: number }[] = [];
    const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 24));
    for (let y = Math.floor(y0); y < y1; y += step) for (let x = Math.floor(x0); x < x1; x += step) { const c = this.at(x, y); px.push({ c, d: dist(c, bg) }); }
    if (!px.length) return { color: [0, 0, 0], density: 0 };
    const max = Math.max(...px.map((p) => p.d));
    const ink = px.filter((p) => p.d > max * 0.45);
    if (!ink.length || max < 8) return { color: [0, 0, 0], density: 0 }; // blank area: no ink to sample
    ink.sort((a, b) => b.d - a.d);
    const core = ink.slice(0, Math.max(1, Math.ceil(ink.length * 0.35)));
    const color = core.reduce<RGB>((a, p) => [a[0] + p.c[0], a[1] + p.c[1], a[2] + p.c[2]], [0, 0, 0]).map((v) => v / core.length) as RGB;
    return { color, density: ink.length / px.length };
  }
}

/** Snap near-black / near-grey ink so Word doesn't get 40 shades of "almost black". */
function cleanColor(c: RGB): RGB {
  const max = Math.max(...c), min = Math.min(...c), lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  if (max - min < 28 && lum < 70) return [0, 0, 0];
  return c.map((v) => Math.round(v / 8) * 8 > 255 ? 255 : Math.round(v / 8) * 8) as RGB;
}

/** Greedy weighted clustering: similar colours collapse to one consistent palette entry. */
function palette(samples: { c: RGB; w: number }[], threshold = 70): (c: RGB) => RGB {
  const clusters: { sum: RGB; w: number; mean: RGB }[] = [];
  for (const s of [...samples].sort((a, b) => b.w - a.w)) {
    const hit = clusters.find((k) => dist(k.mean, s.c) < threshold);
    if (hit) { hit.sum = [hit.sum[0] + s.c[0] * s.w, hit.sum[1] + s.c[1] * s.w, hit.sum[2] + s.c[2] * s.w]; hit.w += s.w; hit.mean = hit.sum.map((v) => v / hit.w) as RGB; }
    else clusters.push({ sum: [s.c[0] * s.w, s.c[1] * s.w, s.c[2] * s.w], w: s.w, mean: s.c });
  }
  return (c) => cleanColor(clusters.reduce((best, k) => (dist(k.mean, c) < dist(best.mean, c) ? k : best), clusters[0]).mean);
}

/** Snap line sizes to page-level clusters (±9%) so body text gets one consistent size. */
function sizeSnapper(sizes: number[]): (s: number) => number {
  const groups: number[][] = [];
  for (const v of [...sizes].sort((a, b) => a - b)) {
    const g = groups[groups.length - 1];
    if (g && v <= g[0] * 1.09) g.push(v); else groups.push([v]);
  }
  const reps = groups.map((g) => ({ lo: g[0], hi: g[g.length - 1], v: Math.round(g[Math.floor(g.length / 2)] * 2) / 2 }));
  return (v) => reps.find((r) => v >= r.lo && v <= r.hi)?.v ?? v;
}

/** Tesseract often glues blanks/numbers to words ("7.Wir____", "12.Ich___"): split them. */
function splitGlued(words: OcrWord[]): OcrWord[] {
  const out: OcrWord[] = [];
  for (const w of words) {
    const m = w.text.match(/^(\d{1,3}\.)?([^_]*?)(_{2,})?$/u);
    if (!m || (!m[1] && !m[3]) || (m[1] && !m[2] && !m[3])) { out.push(w); continue; }
    const parts = [m[1], m[2], m[3]].filter(Boolean) as string[];
    const total = parts.reduce((a, p) => a + p.length, 0);
    let x = w.x0;
    for (const p of parts) {
      const pw = ((w.x1 - w.x0) * p.length) / total;
      out.push({ ...w, text: p, x0: x, x1: x + pw });
      x += pw;
    }
  }
  return out;
}

export function analyzeLayout(ocr: OcrResult, src: HTMLCanvasElement): OcrLayout {
  const P = new Pixels(src);
  const pageWidthPt = 595.28; // A4 width — the image is treated as the full page
  const ptPerPx = pageWidthPt / src.width;

  // Page colour = dominant colour over a coarse grid
  const grid: [number, number][] = [];
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) grid.push([(x + 0.5) * src.width / 24, (y + 0.5) * src.height / 24]);
  const page = P.dominant(grid);
  const background = dist(page, [255, 255, 255]) > 24 ? hex(page) : null;

  const lines = ocr.lines.filter((l) => l.words.length).map((l) => ({ ...l, words: splitGlued([...l.words].sort((a, b) => a.x0 - b.x0)) }));
  if (!lines.length) return { paras: [], background, pageWidthPt };
  const minX = Math.min(...lines.map((l) => l.x0)), maxX = Math.max(...lines.map((l) => l.x1));
  const textW = Math.max(1, maxX - minX);

  // Stroke density per word → bold detection relative to the page's typical density
  const wordInfo = new Map<OcrWord, { color: RGB; density: number }>();
  for (const l of lines) for (const w of l.words) {
    const bg = P.bgAround(w.x0, w.y0, w.x1, w.y1);
    wordInfo.set(w, P.ink(w.x0, w.y0, w.x1, w.y1, bg));
  }
  const dens = [...wordInfo.entries()].filter(([w]) => w.text.length >= 3).map(([, i]) => i.density).sort((a, b) => a - b);
  const medianDensity = dens[Math.floor(dens.length / 2)] ?? 0.3;
  const snapColor = palette([...wordInfo.entries()].map(([w, i]) => ({ c: i.color, w: Math.max(1, w.text.length) })));
  // Font size from glyph geometry: a word's box spans (top extent + descent) em, where the top is
  // cap/ascender height (0.72), umlaut-capital height (0.9) or x-height (0.52), and descenders add 0.21.
  const emSpan = (t: string) => {
    const top = /[ÄÖÜ]/.test(t) ? 0.9 : /[A-Zbdfhklt0-9ßäöü(){}[\]/|!?]/.test(t) ? 0.72 : 0.52;
    return top + (/[gjpqyQ(),;{}[\]]/.test(t) ? 0.21 : 0);
  };
  const wordsSize = (ws: OcrWord[]) => {
    const est = ws.filter((w) => /[\p{L}\d]{2,}/u.test(w.text) && !/_/.test(w.text)).map((w) => (w.y1 - w.y0) / emSpan(w.text)).sort((a, b) => a - b);
    return est.length ? est[Math.floor(est.length / 2)] * ptPerPx : null;
  };
  // Two independent estimates; Tesseract inflates word boxes on tiny text and line boxes when a
  // rule/underline sits close by, so discard implausible word boxes and take the smaller estimate.
  const lineSize = (l: (typeof lines)[number]) => {
    const lh = l.y1 - l.y0;
    const fromLine = (lh / emSpan(l.text)) * ptPerPx;
    const fromWords = wordsSize(l.words.filter((w) => w.y1 - w.y0 <= lh * 1.05));
    return Math.max(6, Math.min(72, fromWords ? Math.min(fromLine, fromWords) : fromLine));
  };
  const snapSize = sizeSnapper(lines.map(lineSize));

  const paras: LayoutPara[] = [];
  let prevBottom = lines[0].y0;
  for (const l of lines) {
    const words = l.words;
    const lh = l.y1 - l.y0;
    // Font size: line box (ascender→descender) ≈ 0.95 em for typical Latin fonts, snapped page-wide.
    const sizePt = snapSize(lineSize(l));
    const tabs: LayoutTab[] = [];
    const charW = words.reduce((a, w) => a + (w.x1 - w.x0), 0) / Math.max(1, words.reduce((a, w) => a + w.text.length, 0));

    const runs: LayoutRun[] = [];
    let segSize: number | undefined; // own size for a tab-separated column (e.g. a small logo beside a title)
    const push = (text: string, color: RGB, bold: boolean) => {
      const last = runs[runs.length - 1];
      const hx = hex(snapColor(color));
      if (last && last.color === hx && last.bold === bold && last.sizePt === segSize) last.text += text;
      else runs.push({ text, color: hx, bold, sizePt: segSize });
    };

    words.forEach((w, i) => {
      const info = wordInfo.get(w)!;
      const isBlank = /^_{2,}$/.test(w.text);
      const bold = !isBlank && w.text.length >= 4 && info.density > medianDensity * 1.85;
      if (i > 0) {
        const prev = words[i - 1], gap = w.x0 - prev.x1;
        const blank = gap > lh * 0.9 ? detectBlank(P, prev.x1, w.x0, l.y0, l.y1) : null;
        if (!blank && gap > textW * 0.18) {
          // far-apart column (e.g. a logo at the right margin): use a real tab stop, not spaces
          const rest = words.slice(i), restEnd = Math.max(...rest.map((r) => r.x1));
          tabs.push(maxX - restEnd < textW * 0.04 ? { pos: Math.round((maxX - minX) * ptPerPx), type: 'right' } : { pos: Math.round((w.x0 - minX) * ptPerPx), type: 'left' });
          push('\t', info.color, false);
          const own = Math.round((wordsSize(rest) ?? sizePt) * 2) / 2;
          segSize = Math.abs(own - sizePt) / sizePt > 0.2 ? own : undefined;
        } else if (blank) {
          push(' ', info.color, false);
          push('_'.repeat(Math.max(3, Math.min(30, Math.round(gap / Math.max(1, charW))))), blank, false);
          push(' ', info.color, false);
        } else push(' ', info.color, false);
      }
      push(isBlank ? w.text.replace(/_+/, '_'.repeat(Math.max(3, Math.round((w.x1 - w.x0) / Math.max(1, charW))))) : w.text, info.color, bold);
    });

    // alignment & indentation
    const center = (l.x0 + l.x1) / 2, mid = (minX + maxX) / 2;
    let align: LayoutPara['align'] = 'left';
    if (l.x0 - minX > textW * 0.45 && maxX - l.x1 < textW * 0.04) align = 'right';
    else if (Math.abs(center - mid) < textW * 0.03 && l.x0 - minX > textW * 0.12) align = 'center';
    const indentPt = align === 'left' ? Math.round((l.x0 - minX) * ptPerPx) : 0;

    // vertical gap above, minus the normal single-line leading
    const spaceBeforePt = Math.max(0, Math.min(96, Math.round((l.y0 - prevBottom) * ptPerPx - sizePt * 0.2)));
    prevBottom = l.y1;
    paras.push({ runs, sizePt, indentPt: indentPt < 12 ? 0 : indentPt, spaceBeforePt, align, tabs: tabs.length ? tabs : undefined });
  }
  return { paras, background, pageWidthPt };
}

/**
 * A fill-in blank is a horizontal run of ink spanning most of a word gap, near the baseline.
 * Returns its colour, or null if the gap is just whitespace.
 */
function detectBlank(P: Pixels, gx0: number, gx1: number, ly0: number, ly1: number): RGB | null {
  const lh = ly1 - ly0;
  const x0 = Math.ceil(gx0 + lh * 0.15), x1 = Math.floor(gx1 - lh * 0.15);
  if (x1 - x0 < lh * 0.6) return null;
  const bg = P.bgAround(x0, ly0, x1, ly1);
  for (let y = Math.floor(ly1 - lh * 0.35); y <= Math.ceil(ly1 + lh * 0.2); y++) {
    let hits = 0, n = 0;
    for (let x = x0; x <= x1; x++, n++) if (dist(P.at(x, y), bg) > 70) hits++;
    if (hits / n > 0.7) {
      // colour of the line itself
      const pts: [number, number][] = [];
      for (let x = x0; x <= x1; x += Math.max(1, (x1 - x0) >> 4)) pts.push([x, y]);
      return P.dominant(pts);
    }
  }
  return null;
}

/**
 * Layout for a text-based PDF page: exact sizes/positions from the PDF, colours sampled from a
 * render of the page (`k` = canvas px per PDF point).
 */
export function pdfTextLayout(lines: TextLine[], canvas: HTMLCanvasElement, k: number, pageW: number, pageH: number): OcrLayout {
  const P = new Pixels(canvas);
  if (!lines.length) return { paras: [], background: null, pageWidthPt: pageW };
  const grid: [number, number][] = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) grid.push([(x + 0.5) * canvas.width / 20, (y + 0.5) * canvas.height / 20]);
  const pageBg = P.dominant(grid);
  const minX = Math.min(...lines.map((l) => l.x)), maxX = Math.max(...lines.map((l) => l.x + l.w)), textW = Math.max(1, maxX - minX);
  let prevBase: number | null = null, prevSize = 0;
  const paras = lines.map((l) => {
    const x0 = l.x * k, x1 = (l.x + l.w) * k, y0 = (pageH - l.y - l.size * 0.8) * k, y1 = (pageH - l.y + l.size * 0.2) * k;
    const bg = P.bgAround(x0, y0, x1, y1);
    const color = hex(cleanColor(P.ink(x0, y0, x1, y1, bg).color));
    let align: LayoutPara['align'] = 'left';
    if (l.x - minX > textW * 0.45 && maxX - (l.x + l.w) < textW * 0.04) align = 'right';
    else if (Math.abs(l.x + l.w / 2 - (minX + maxX) / 2) < textW * 0.03 && l.x - minX > textW * 0.12) align = 'center';
    const gap = prevBase === null ? 0 : prevBase - l.y - l.size * 1.15 - prevSize * 0.2;
    prevBase = l.y; prevSize = l.size;
    const indent = align === 'left' ? Math.round(l.x - minX) : 0;
    return { runs: [{ text: l.text, color, bold: l.bold }], sizePt: l.size, indentPt: indent < 4 ? 0 : indent, spaceBeforePt: Math.max(0, Math.min(96, Math.round(gap))), align };
  });
  return { paras, background: dist(pageBg, [255, 255, 255]) > 24 ? hex(pageBg) : null, pageWidthPt: pageW };
}
