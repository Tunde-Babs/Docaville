// Word engine: .docx → editor HTML (mammoth), editor JSON → native .docx (docx).
import mammoth from 'mammoth';
import {
  Document, Packer, Paragraph, TextRun, Bookmark, ExternalHyperlink, InternalHyperlink, HeadingLevel, AlignmentType, ImageRun, Table, TableRow, TableCell,
  WidthType, LevelFormat, ShadingType, BorderStyle, PageBreak, Tab, TabStopType, LineRuleType, SectionType, PageOrientation, Textbox, type ParagraphChild, type IParagraphOptions,
} from 'docx';
import type { JSONContent } from '@tiptap/react';
import { toEmbeddable } from '../lib/image';
import type { OcrLayout } from './ocrLayout';
import { resolvePara, type ParaAttrs, type PageGeom } from '../lib/paraFormat';
import { fitWorksheetAnnotation, worksheetHeight, worksheetLines, type WorksheetAnnotation } from './worksheet';
import { attachWorksheetProject, readWorksheetDocument, WORKSHEET_MARKER } from './worksheetDocument';

export async function docxToHtml(bytes: Uint8Array): Promise<{ html: string; warnings: string[] }> {
  const res = await mammoth.convertToHtml(
    { arrayBuffer: bytes.slice().buffer },
    {
      styleMap: ['u => u', 'strike => s', "p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
      convertImage: mammoth.images.imgElement(async (img) => ({ src: `data:${img.contentType};base64,${await img.readAsBase64String()}` })),
    },
  );
  return { html: res.value, warnings: res.messages.map((m) => m.message) };
}

export function textToHtml(text: string) {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return text.split(/\n/).map((l) => `<p>${esc(l) || '<br>'}</p>`).join('');
}

// ---------------- export ----------------
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
};
const MAX_IMG_W = 600; // px @96dpi ≈ text width of A4/Letter with 1" margins
const cssHex = (c?: string) => {
  if (!c) return undefined;
  if (c.startsWith('#')) return c.slice(1).padEnd(6, '0').slice(0, 6).toUpperCase();
  const m = c.match(/\d+/g);
  return m ? m.slice(0, 3).map((v) => (+v).toString(16).padStart(2, '0')).join('').toUpperCase() : undefined;
};

function dataUrlBytes(src: string): { bytes: Uint8Array; mime: string } | null {
  const m = src.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1] };
}

async function imageRun(bytes: Uint8Array, mime: string, maxW = MAX_IMG_W, size?: { w?: number; h?: number }) {
  const e = await toEmbeddable(bytes, mime);
  // keep the size the image had in the document (px @96dpi), else natural size capped to the text width
  const w0 = size?.w ?? e.width, h0 = size?.h ?? (size?.w ? (size.w / e.width) * e.height : e.height);
  const s = Math.min(1, maxW / w0);
  return new ImageRun({ type: e.type, data: e.bytes, transformation: { width: Math.round(w0 * s), height: Math.round(h0 * s) } });
}

class Converter {
  listInstance = 0;

  runs(nodes: JSONContent[] = []): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    for (const n of nodes) {
      if (n.type === 'bookmark' && n.attrs?.name) { out.push(new Bookmark({ id: n.attrs.name, children: [] })); continue; }
      if (n.type === 'hardBreak') { out.push(new TextRun({ break: 1 })); continue; }
      if (n.type !== 'text') continue;
      const marks = Object.fromEntries((n.marks ?? []).map((m) => [m.type, m.attrs ?? {}]));
      const hl = cssHex(marks.highlight?.color) ?? (marks.highlight ? 'FFFF00' : undefined);
      const run = new TextRun({
        text: n.text ?? '',
        bold: !!marks.bold, italics: !!marks.italic, strike: !!marks.strike,
        underline: marks.underline ? {} : undefined,
        color: cssHex(marks.textStyle?.color),
        size: ptSize(marks.textStyle?.fontSize) ? Math.round(ptSize(marks.textStyle?.fontSize)! * 2) : undefined,
        font: marks.code ? 'Consolas' : firstFont(marks.textStyle?.fontFamily),
        shading: hl ? { type: ShadingType.CLEAR, fill: hl, color: 'auto' } : undefined,
      });
      const href = marks.link?.href as string | undefined;
      out.push(href?.startsWith('#') ? new InternalHyperlink({ anchor: href.slice(1), children: [run] }) : href && /^(https?:|mailto:|tel:)/i.test(href) ? new ExternalHyperlink({ link: href, children: [run] }) : run);
    }
    return out;
  }

  async block(n: JSONContent, ctx: { list?: { ordered: boolean; instance: number; level: number }; cell?: boolean } = {}): Promise<(Paragraph | Table)[]> {
    // Spacing exactly as the editor shows it (explicit values, or the editor's defaults for this kind of paragraph).
    const fmt = resolvePara(n.attrs as ParaAttrs | undefined, n.type === 'heading' ? 'heading' : ctx.list ? 'list' : ctx.cell ? 'cell' : 'body');
    const spacing = n.type === 'paragraph' || n.type === 'heading' ? {
      spacing: {
        before: Math.round(fmt.before * 20), after: Math.round(fmt.after * 20),
        ...(fmt.line.endsWith('pt') ? { line: Math.round(parseFloat(fmt.line) * 20), lineRule: LineRuleType.AT_LEAST } : { line: Math.round(+fmt.line * 240), lineRule: LineRuleType.AUTO }),
      },
      ...(fmt.indent && !ctx.list ? { indent: { left: Math.round(fmt.indent * 20) } } : {}),
    } : {};
    const base: Partial<IParagraphOptions> = {
      ...spacing,
      alignment: ALIGN[n.attrs?.textAlign as string],
      ...(ctx.list ? (ctx.list.ordered
        ? { numbering: { reference: 'ol', level: ctx.list.level, instance: ctx.list.instance } }
        : { bullet: { level: ctx.list.level } }) : {}),
    };
    switch (n.type) {
      case 'paragraph':
        return [new Paragraph({ ...base, children: this.runs(n.content) })];
      case 'heading':
        return [new Paragraph({ ...base, heading: HEADINGS[(n.attrs?.level ?? 1) - 1], children: this.runs(n.content) })];
      case 'blockquote':
        return (n.content ?? []).map((c) => new Paragraph({
          indent: { left: 567 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'CBD5E1', space: 8 } },
          children: [new TextRun({ italics: true, children: this.runs(c.content) as TextRun[] })],
        }));
      case 'codeBlock':
        return (n.content?.[0]?.text ?? '').split('\n').map((line) =>
          new Paragraph({ shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' }, children: [new TextRun({ text: line, font: 'Consolas', size: 20 })] }));
      case 'horizontalRule':
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } }, children: [] })];
      case 'pageBreak':
        return [new Paragraph({ children: [new PageBreak()] })];
      case 'sectionBreak':
        return [new Paragraph({ children: [new TextRun(`DOCUMENTHUB_SECTION_BOUNDARY_${n.attrs?.section ?? 0}`)] })];
      case 'bulletList':
      case 'orderedList': {
        const ordered = n.type === 'orderedList';
        const level = ctx.list ? ctx.list.level + 1 : 0;
        const instance = ordered && !ctx.list ? ++this.listInstance : ctx.list?.instance ?? 0;
        const out: (Paragraph | Table)[] = [];
        for (const li of n.content ?? [])
          for (const child of li.content ?? [])
            out.push(...await this.block(child, { cell: ctx.cell, list: child.type === 'paragraph' ? { ordered, instance, level } : { ordered, instance, level: level - 1 + ((child.type ?? "").endsWith('List') ? 1 : 0) } }));
        return out;
      }
      case 'image': {
        const d = dataUrlBytes(n.attrs?.src ?? '');
        if (!d) return [];
        const size = { w: +n.attrs?.width || undefined, h: +n.attrs?.height || undefined };
        return [new Paragraph({ ...base, alignment: AlignmentType.CENTER, children: [await imageRun(d.bytes, d.mime, MAX_IMG_W, size)] })];
      }
      case 'table': {
        const rows = await Promise.all((n.content ?? []).map(async (r) => new TableRow({
          children: await Promise.all((r.content ?? []).map(async (c) => new TableCell({
            columnSpan: c.attrs?.colspan ?? 1, rowSpan: c.attrs?.rowspan ?? 1,
            shading: c.type === 'tableHeader' ? { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' } : undefined,
            children: (await this.blocks(c.content, { cell: true })).filter((x): x is Paragraph => x instanceof Paragraph),
          }))),
        })));
        return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })];
      }
      default:
        return n.content ? this.blocks(n.content) : [];
    }
  }

  async blocks(nodes: JSONContent[] = [], ctx: { cell?: boolean } = {}) {
    const out: (Paragraph | Table)[] = [];
    for (const n of nodes) out.push(...await this.block(n, ctx));
    if (!out.length) out.push(new Paragraph({ children: [] }));
    return out;
  }
}

const numbering = {
  config: [{
    reference: 'ol',
    levels: [0, 1, 2, 3, 4, 5].map((level) => ({
      level, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
      text: `%${level + 1}.`, alignment: AlignmentType.START,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    })),
  }],
};

/** "28pt" | "18px" | "1.5em" → points */
function ptSize(v?: string): number | undefined {
  const m = v?.match(/^([\d.]+)(pt|px)?$/); if (!m) return undefined;
  return m[2] === 'px' ? +m[1] * 0.75 : +m[1];
}
const firstFont = (f?: string) => f?.split(',')[0].trim().replace(/^['"]|['"]$/g, '') || undefined;

export interface DocSection { page?: PageGeom; header?: string; footer?: string }
export interface DocDefaults extends DocSection { font: string; sizePt: number; sections?: DocSection[] }

export async function buildDocx(children: (Paragraph | Table)[], title = 'Document', background: string | null = null, defaults: DocDefaults = { font: 'Calibri', sizePt: 11 }): Promise<Uint8Array> {
  const styles = { default: { document: { run: { font: defaults.font, size: Math.round(defaults.sizePt * 2) } } } };
  const doc = new Document({
    title, creator: 'Docaville', styles, numbering, sections: [{ children }],
    ...(background ? { background: { color: background } } : {}),
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

/**
 * Editor JSON → .docx. When the document came from an existing .docx, its headers, footers and
 * section/page setup (paper size, margins, columns, title-page headers) are carried over unchanged.
 */
export async function jsonToDocx(json: JSONContent, title?: string, original?: { bytes: Uint8Array; defaults?: DocDefaults }) {
  if (original?.bytes.length && await readWorksheetDocument(original.bytes)) throw new Error('Use the worksheet tools to save this document without losing positioned answers.');
  const fresh = await buildDocx(await new Converter().blocks(json.content), title, null, original?.defaults);
  if (!original?.bytes.length) return fresh;
  // Preservation failure must fail the save; silently writing a simplified file damages the original.
  return transplantSections(original.bytes, fresh);
}

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

async function transplantSections(originalBytes: Uint8Array, freshBytes: Uint8Array): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip');
  const [orig, out] = await Promise.all([JSZip.loadAsync(originalBytes), JSZip.loadAsync(freshBytes)]);
  const xml = async (z: InstanceType<typeof JSZip>, p: string) => new DOMParser().parseFromString(await z.file(p)!.async('string'), 'application/xml');
  const ser = (d: Node) => new XMLSerializer().serializeToString(d);

  const oDoc = await xml(orig, 'word/document.xml');
  const sections = [...oDoc.getElementsByTagNameNS(W_NS, 'sectPr')];
  if (!sections.length) return freshBytes;
  const oRels = await xml(orig, 'word/_rels/document.xml.rels');
  const nRels = await xml(out, 'word/_rels/document.xml.rels');
  const nTypes = await xml(out, '[Content_Types].xml'), oTypes = await xml(orig, '[Content_Types].xml');
  const nDoc = await xml(out, 'word/document.xml');
  const relsRoot = nRels.documentElement;
  let next = 1; const used = new Set([...relsRoot.getElementsByTagName('Relationship')].map((r) => r.getAttribute('Id')));
  const newId = () => { while (used.has(`rIdDH${next}`)) next++; used.add(`rIdDH${next}`); return `rIdDH${next}`; };

  const nBody = nDoc.getElementsByTagNameNS(W_NS, 'body')[0];
  [...nBody.children].filter(c => c.localName === 'sectPr').forEach(c => c.remove());
  const markers = [...nBody.children].filter(c => c.localName === 'p' && /^DOCUMENTHUB_SECTION_BOUNDARY_\d+$/.test(c.textContent ?? ''));
  const sourceBody = oDoc.getElementsByTagNameNS(W_NS, 'body')[0];
  for (const [sectionIndex, oSect] of sections.entries()) {
  const sect = nDoc.importNode(oSect, true) as Element;
  for (const ref of [...sect.children].filter((c) => c.localName === 'headerReference' || c.localName === 'footerReference')) {
    const rid = ref.getAttributeNS(R_NS, 'id');
    const rel = [...oRels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (!rel || !target || !orig.file('word/' + target)) throw new Error('A document header or footer could not be preserved. The original has not been overwritten.');
    // copy the part under a non-colliding name, plus its own relationships (e.g. a logo image)
    const base = target.split('/').pop()!;
    let newTarget = base, suffix = 0;
    while (out.file('word/' + newTarget)) newTarget = `dh_${++suffix}_${base}`;
    out.file('word/' + newTarget, await orig.file('word/' + target)!.async('uint8array'));
    const partRels = orig.file(`word/_rels/${base}.rels`);
    if (partRels) {
      const pr = new DOMParser().parseFromString(await partRels.async('string'), 'application/xml');
      for (const r of [...pr.getElementsByTagName('Relationship')]) {
        const t = r.getAttribute('Target')!;
        if (r.getAttribute('TargetMode') === 'External' || !orig.file('word/' + t)) continue;
        const dest = `media/dh_${t.split('/').pop()}`;
        out.file('word/' + dest, await orig.file('word/' + t)!.async('uint8array'));
        r.setAttribute('Target', dest);
      }
      out.file(`word/_rels/${newTarget}.rels`, ser(pr));
    }
    const id = newId(), nr = nRels.createElementNS(REL_NS, 'Relationship');
    nr.setAttribute('Id', id); nr.setAttribute('Type', rel.getAttribute('Type')!); nr.setAttribute('Target', newTarget);
    relsRoot.appendChild(nr);
    ref.setAttributeNS(R_NS, 'r:id', id);
    // content-type override for the copied part
    const ct = [...oTypes.getElementsByTagName('Override')].find((o) => o.getAttribute('PartName') === '/word/' + target)?.getAttribute('ContentType');
    if (ct) { const o = nTypes.createElementNS(nTypes.documentElement.namespaceURI, 'Override'); o.setAttribute('PartName', '/word/' + newTarget); o.setAttribute('ContentType', ct); nTypes.documentElement.appendChild(o); }
  }
  if (sectionIndex === sections.length - 1 && oSect.parentElement?.localName === 'body') nBody.appendChild(sect);
  else {
    const marker = markers.find(m => m.textContent === `DOCUMENTHUB_SECTION_BOUNDARY_${sectionIndex}`);
    // Legacy/API callers without editor markers may retain a boundary only if block positions are unambiguous.
    const sourceParagraph = oSect.parentElement?.parentElement;
    const at = [...sourceBody.children].indexOf(sourceParagraph!);
    const originalBlocks = [...sourceBody.children].filter(c => c.localName !== 'sectPr');
    const newBlocks = [...nBody.children].filter(c => c.localName !== 'sectPr' && !markers.includes(c));
    const paragraph = marker?.previousElementSibling ?? (markers.length === 0 && originalBlocks.length === newBlocks.length ? newBlocks[at] : null);
    if (!paragraph || paragraph.localName !== 'p') throw new Error('Section boundaries could not be preserved. Reopen the original document before saving.');
    let pPr = [...paragraph.children].find(c => c.localName === 'pPr');
    if (!pPr) { pPr = nDoc.createElementNS(W_NS, 'w:pPr'); paragraph.prepend(pPr); }
    pPr.appendChild(sect); marker?.remove();
  }
  }
  // media extensions used by copied parts
  for (const d of [...oTypes.getElementsByTagName('Default')]) {
    const ext = d.getAttribute('Extension');
    if (![...nTypes.getElementsByTagName('Default')].some((x) => x.getAttribute('Extension') === ext)) nTypes.documentElement.appendChild(nTypes.importNode(d, true));
  }
  // swap the generated section properties for the original ones
  out.file('word/document.xml', ser(nDoc));
  out.file('word/_rels/document.xml.rels', ser(nRels));
  out.file('[Content_Types].xml', ser(nTypes));
  return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const ALIGN_L = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };

/** Best-effort text paragraphs; this does not reconstruct figures, tables or mixed columns. */
export function layoutParagraphs(layout: OcrLayout, font = 'Arial'): Paragraph[] {
  return layout.paras.map((p) => new Paragraph({
    alignment: ALIGN_L[p.align],
    indent: p.indentPt ? { left: Math.round(p.indentPt * 20) } : undefined,
    spacing: { before: Math.round(p.spaceBeforePt * 20), after: 0, line: 240 },
    tabStops: p.tabs?.map((t) => ({ type: t.type === 'right' ? TabStopType.RIGHT : TabStopType.LEFT, position: Math.round(t.pos * 20) })),
    children: p.runs.map((r) => new TextRun({
      color: r.color, bold: r.bold, size: Math.round((r.sizePt ?? p.sizePt) * 2), font,
      children: r.text.split('\t').flatMap((seg, i) => (i ? [new Tab(), seg] : [seg])).filter((x) => x !== ''),
    })),
  }));
}

export type DocxImageItem = { bytes: Uint8Array; mime: string; layout?: OcrLayout; paragraphs?: { text: string; heightPx: number }[]; text?: string; sourceName?: string; annotations?: WorksheetAnnotation[] };

/**
 * Images → .docx.
 *  - `text`: reviewed OCR at a readable size, labeled by source page.
 *  - `includeOriginals`: retain the source on a separate fitted image page before its text.
 *  - `layout`: legacy approximate text styling; does not reproduce figures/tables.
 *  - `paragraphs`: plain text (used when the user hand-edited the OCR text).
 *  - neither: each image on its own page at full resolution.
 */
export async function imagesToDocx(items: DocxImageItem[], options: { includeOriginals?: boolean; includeOcrText?: boolean } = {}) {
  if (!items.length) throw new Error('Add at least one image before converting to Word.');
  if (options.includeOriginals === false && options.includeOcrText === false) throw new Error('Choose worksheet pages, OCR text, or both before exporting.');
  const hasAnswers = items.some(item => item.annotations?.some(note => note.kind === 'cross' || note.text.trim()));
  if (hasAnswers && options.includeOcrText !== false && !options.includeOriginals && items.some(item => item.text !== undefined || item.layout || item.paragraphs)) throw new Error('Include the original pages to preserve your worksheet answers.');
  const sections: ConstructorParameters<typeof Document>[0]['sections'][number][] = [];
  const page = (landscape = false) => ({
    size: { width: 11906, height: 16838, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
    margin: { top: 560, bottom: 560, left: 560, right: 560, header: 0, footer: 0, gutter: 0 },
  });
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const editable = options.includeOcrText !== false && (it.text !== undefined || !!it.layout || !!it.paragraphs);
    if (editable && !options.includeOriginals && it.annotations?.some(note => note.kind === 'cross' || note.text.trim())) throw new Error('Include the original pages to preserve your worksheet answers.');
    if (!editable || options.includeOriginals) {
      const image = await toEmbeddable(it.bytes, it.mime);
      const landscape = image.width > image.height;
      // Word's inline image must fit BOTH axes, including its paragraph's baseline space.
      // A width-only cap made portrait scans taller than the page; separate break paragraphs
      // then produced overflow/blank pages between sources.
      const widthPx = ((landscape ? 16838 : 11906) - 1120) / 15;
      const heightPx = ((landscape ? 11906 : 16838) - 1120 - 80) / 15;
      const scale = Math.min(widthPx / image.width, heightPx / image.height);
      const renderedWidth = Math.floor(image.width * scale), renderedHeight = Math.floor(image.height * scale);
      const answers = (it.annotations ?? []).filter(note => note.kind === 'cross' || note.text.trim()).map(input => {
        const note = fitWorksheetAnnotation(input, image.width / image.height);
        const sizePt = note.size * renderedWidth * 0.75;
        return new Textbox({ style: {
          position: 'absolute', positionHorizontalRelative: 'page', positionVerticalRelative: 'page',
          positionHorizontal: 'absolute', positionVertical: 'absolute', wrapStyle: 'none', zIndex: 10,
          marginLeft: `${28 + (widthPx - renderedWidth) * 0.375 + note.x * renderedWidth * 0.75}pt`,
          marginTop: `${28 + note.y * renderedHeight * 0.75}pt`,
          width: `${note.width * renderedWidth * 0.75}pt`, height: `${worksheetHeight(note, image.width / image.height) * renderedHeight * 0.75 + 1}pt`,
        }, children: worksheetLines(note).map(text => new Paragraph({
          spacing: { before: 0, after: 0, line: Math.round(sizePt * 1.3 * 20), lineRule: LineRuleType.EXACT },
          children: [new TextRun({ text, font: 'Arial', size: Math.round(sizePt * 2), color: note.color.slice(1) })],
        })) });
      });
      sections.push({ properties: { type: SectionType.NEXT_PAGE, page: page(landscape) }, children: [new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.AT_LEAST },
        children: [new ImageRun({ type: image.type, data: image.bytes,
          transformation: { width: renderedWidth, height: renderedHeight },
          altText: { name: it.sourceName ?? `Source page ${i + 1}`, title: `Source page ${i + 1}`, description: 'Original image, including illustrations and handwriting. Text in this image is not editable.' },
        }), ...answers],
      })] });
    }
    if (editable) {
      const children: Paragraph[] = [];
      if (it.text !== undefined) {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `Recognized text — source page ${i + 1}`, bold: true, color: '000000', size: 28 })] }));
        if (it.sourceName) children.push(new Paragraph({ children: [new TextRun({ text: it.sourceName, color: '000000' })] }));
        children.push(new Paragraph({ children: [new TextRun({ text: 'Review against the original. OCR may misread handwriting, checkboxes and columns; tables and illustrations are not reconstructed.', italics: true, color: '000000' })] }));
        for (const text of (it.text || 'No text was recognized on this page.').split(/\r?\n/)) children.push(new Paragraph({
          spacing: { before: 0, after: 80 }, children: [new TextRun({ text, size: 22, color: '000000', font: 'Arial' })],
        }));
      } else if (it.layout) children.push(...layoutParagraphs(it.layout));
      else for (const p of it.paragraphs ?? []) children.push(new Paragraph({ children: [new TextRun({ text: p.text, font: 'Arial', size: 22 })] }));
      if (!children.length) children.push(new Paragraph({ children: [] }));
      sections.push({ properties: { type: SectionType.NEXT_PAGE, page: page() }, children });
    }
  }
  const doc = new Document({ title: 'Converted images', creator: 'Docaville',
    ...(hasAnswers ? { keywords: WORKSHEET_MARKER } : {}),
    styles: { default: { document: { run: { font: 'Arial', size: 22, color: '000000' } } } },
    sections,
    ...(items.find(it => it.layout?.background)?.layout?.background ? { background: { color: items.find(it => it.layout?.background)!.layout!.background! } } : {}),
  });
  const bytes = new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
  if (!items.some(item => item.annotations?.length)) return bytes;
  // The library's generic VML textboxes use default fill, stroke and padding.
  // Answers need transparent, borderless boxes with the same origin as the on-page editor.
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'text/xml');
  for (const shape of [...xml.getElementsByTagNameNS('urn:schemas-microsoft-com:vml', 'shape')]) {
    shape.setAttribute('filled', 'f'); shape.setAttribute('stroked', 'f');
  }
  for (const box of [...xml.getElementsByTagNameNS('urn:schemas-microsoft-com:vml', 'textbox')]) {
    box.setAttribute('inset', '0,0,0,0'); box.setAttribute('style', 'mso-fit-shape-to-text:f;');
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
  if (hasAnswers) await attachWorksheetProject(zip, items.map(item => ({ sourceName: item.sourceName ?? 'Worksheet page', text: options.includeOcrText === false ? '' : item.text ?? '', annotations: item.annotations ?? [] })));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** PDF pages (each analysed into a layout) → .docx with page breaks. */
export async function layoutsToDocx(pages: OcrLayout[]) {
  const children: Paragraph[] = [];
  pages.forEach((l, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(...layoutParagraphs(l));
  });
  return buildDocx(children, 'Document', pages.find((p) => p.background)?.background ?? null);
}

export async function pageImagesToDocx(pngs: Uint8Array[]) {
  return imagesToDocx(pngs.map((bytes) => ({ bytes, mime: 'image/png' })));
}
