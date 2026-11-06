// Paragraph spacing & page geometry shared by the Word editor, the .docx importer/writer and PDF export,
// so a document looks the same in Docaville, in Microsoft Word and in the exported PDF.
//
// Paragraph attributes (all optional; missing = the defaults below):
//   spaceBefore / spaceAfter  points
//   lineHeight                "1" | "1.15" | "1.5" | "2" (multiple of single spacing) or "14pt" (at least)
//   indentLeft                points

/** CSS line-height of Word's "single" line spacing for typical body fonts (Calibri/Arial/Times ≈ 1.15 em). */
export const SINGLE = 1.15;

export type ParaKind = 'body' | 'list' | 'cell' | 'heading';
/** What a paragraph without explicit spacing looks like (editor CSS mirrors these exactly). */
export const PARA_DEFAULTS: Record<ParaKind, { before: number; after: number; line: string }> = {
  body: { before: 0, after: 8, line: '1.15' },
  list: { before: 0, after: 0, line: '1.15' },
  cell: { before: 0, after: 0, line: '1.15' },
  heading: { before: 12, after: 6, line: '1' },
};

export const lineCss = (l: string) => (l.endsWith('pt') ? l : String(+(+l * SINGLE).toFixed(4)));
/** Line height in points for a font size (used by PDF layout). */
export const linePt = (l: string, sizePt: number) => (l.endsWith('pt') ? Math.max(parseFloat(l), sizePt) : sizePt * +l * SINGLE);

export interface ParaAttrs { spaceBefore?: number | null; spaceAfter?: number | null; lineHeight?: string | null; indentLeft?: number | null }
export function resolvePara(a: ParaAttrs | undefined, kind: ParaKind) {
  const d = PARA_DEFAULTS[kind];
  return { before: a?.spaceBefore ?? d.before, after: a?.spaceAfter ?? d.after, line: a?.lineHeight ?? d.line, indent: a?.indentLeft ?? 0 };
}

/** Page size and margins in points. */
export interface PageGeom { w: number; h: number; top: number; right: number; bottom: number; left: number }
/** What the .docx writer produces when there is no original document: A4 with 1-inch margins. */
export const DEFAULT_PAGE: PageGeom = { w: 595.3, h: 841.9, top: 72, right: 72, bottom: 72, left: 72 };
