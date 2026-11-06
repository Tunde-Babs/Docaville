// High-fidelity .docx → editor HTML. Reads WordprocessingML directly so run formatting that
// generic converters drop (font size, colour, font family, highlight) survives editing.
//   • styles: docDefaults → paragraph style (basedOn chain) → character style → direct formatting
//   • paragraphs: headings / Title, alignment, nested bullet & numbered lists (numbering.xml)
//   • runs: bold, italic, underline, strike, colour, size, font, highlight / shading, tabs, breaks
//   • tables (gridSpan / vMerge), images (with their size), hyperlinks, content controls, tracked insertions
//   • paragraph spacing before/after, line spacing, left indent, contextual spacing; page size & margins
//   • headers / footers returned separately (shown read-only; preserved on save)
import JSZip from 'jszip';
import { lineCss, type PageGeom } from '../lib/paraFormat';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface DocxImport { html: string; defaults: import('./docx').DocDefaults; header: string; footer: string }

type ParaFmt = { before?: number; after?: number; line?: string; indent?: number; contextual?: boolean };
const twip = (v: string | null) => (v === null || v === '' || isNaN(+v) ? undefined : Math.round(+v / 2) / 10); // twentieths of a point → pt (0.1 pt precision)

type RunProps = { b?: boolean; i?: boolean; u?: boolean; s?: boolean; color?: string; sz?: number; font?: string; hl?: string };

const HIGHLIGHT: Record<string, string> = {
  yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF', blue: '#0000FF', red: '#FF0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000', white: '#FFFFFF',
};

const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el: Element, local: string) => [...el.children].filter((c) => c.localName === local);
const kid = (el: Element | null | undefined, local: string) => (el ? kids(el, local)[0] : undefined);
const attr = (el: Element | undefined, local: string) => el?.getAttributeNS(W, local) ?? el?.getAttribute(`w:${local}`) ?? null;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const onOff = (el: Element | undefined) => (el ? !['0', 'false', 'off'].includes(attr(el, 'val') ?? 'true') : undefined);

function readRPr(rPr: Element | undefined): RunProps {
  if (!rPr) return {};
  const p: RunProps = {};
  const b = onOff(kid(rPr, 'b')); if (b !== undefined) p.b = b;
  const i = onOff(kid(rPr, 'i')); if (i !== undefined) p.i = i;
  const u = kid(rPr, 'u'); if (u) p.u = (attr(u, 'val') ?? 'single') !== 'none';
  const s = onOff(kid(rPr, 'strike')) || onOff(kid(rPr, 'dstrike')); if (s !== undefined) p.s = s;
  const color = attr(kid(rPr, 'color'), 'val'); if (color && color !== 'auto') p.color = '#' + color.toUpperCase();
  const sz = attr(kid(rPr, 'sz'), 'val'); if (sz) p.sz = +sz / 2;
  const f = kid(rPr, 'rFonts'); const font = attr(f, 'ascii') ?? attr(f, 'hAnsi') ?? attr(f, 'cs'); if (font) p.font = font;
  const hl = attr(kid(rPr, 'highlight'), 'val'); if (hl && hl !== 'none') p.hl = HIGHLIGHT[hl] ?? '#FFFF00';
  const shd = attr(kid(rPr, 'shd'), 'fill'); if (!p.hl && shd && shd !== 'auto' && !/^(FFFFFF|auto)$/i.test(shd)) p.hl = '#' + shd;
  return p;
}

function readPPr(pPr: Element | undefined): ParaFmt {
  const f: ParaFmt = {};
  if (!pPr) return f;
  const sp = kid(pPr, 'spacing');
  if (sp) {
    const b = twip(attr(sp, 'before')), a = twip(attr(sp, 'after'));
    if (b !== undefined) f.before = b;
    if (a !== undefined) f.after = a;
    if (attr(sp, 'beforeAutospacing') === '1') f.before = 14;
    if (attr(sp, 'afterAutospacing') === '1') f.after = 14;
    const line = attr(sp, 'line'), rule = attr(sp, 'lineRule') ?? 'auto';
    if (line && !isNaN(+line)) f.line = rule === 'auto' ? String(Math.round((+line / 240) * 100) / 100) : `${Math.round(+line / 2) / 10}pt`;
  }
  const ind = kid(pPr, 'ind');
  const left = twip(attr(ind, 'left') ?? attr(ind, 'start'));
  if (left !== undefined) f.indent = left;
  const cs = onOff(kid(pPr, 'contextualSpacing'));
  if (cs !== undefined) f.contextual = cs;
  return f;
}

export async function importDocx(bytes: Uint8Array): Promise<DocxImport> {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (p: string) => (zip.file(p) ? parse(await zip.file(p)!.async('string')) : null);
  const doc = await read('word/document.xml');
  if (!doc) throw new Error('Not a Word document (word/document.xml missing).');
  const styles = await read('word/styles.xml'), numbering = await read('word/numbering.xml'), theme = await read('word/theme/theme1.xml');
  const relsDoc = await read('word/_rels/document.xml.rels');
  const rels = new Map<string, { target: string; type: string; external: boolean }>();
  for (const r of relsDoc ? [...relsDoc.getElementsByTagName('Relationship')] : [])
    rels.set(r.getAttribute('Id')!, { target: r.getAttribute('Target')!, type: r.getAttribute('Type') ?? '', external: r.getAttribute('TargetMode') === 'External' });

  // ---- defaults & styles ----
  const minorFont = theme?.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'minorFont')[0]?.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'latin')[0]?.getAttribute('typeface');
  const docDefRPr = styles?.getElementsByTagNameNS(W, 'rPrDefault')[0];
  const defRPr = readRPr(kid(docDefRPr, 'rPr'));
  const styleEls = new Map<string, Element>();
  for (const st of styles ? [...styles.getElementsByTagNameNS(W, 'style')] : []) styleEls.set(attr(st, 'styleId')!, st);
  const defaultParaStyle = [...styleEls.values()].find((s) => attr(s, 'type') === 'paragraph' && attr(s, 'default') === '1');
  const styleRPr = (id: string | null, depth = 0): RunProps => {
    const st = id ? styleEls.get(id) : undefined;
    if (!st || depth > 10) return {};
    return { ...styleRPr(attr(kid(st, 'basedOn'), 'val'), depth + 1), ...readRPr(kid(st, 'rPr')) };
  };
  const stylePPr = (id: string | null, depth = 0): ParaFmt => {
    const st = id ? styleEls.get(id) : undefined;
    if (!st || depth > 10) return {};
    return { ...stylePPr(attr(kid(st, 'basedOn'), 'val'), depth + 1), ...readPPr(kid(st, 'pPr')) };
  };
  const defPPr = readPPr(kid(styles?.getElementsByTagNameNS(W, 'pPrDefault')[0], 'pPr'));
  const styleName = (id: string | null) => (id ? attr(kid(styleEls.get(id)!, 'name'), 'val') ?? id : '');
  const baseStyleId = defaultParaStyle ? attr(defaultParaStyle, 'styleId') : null;
  const base: RunProps = { ...defRPr, ...styleRPr(baseStyleId) };
  const defaults = { font: base.font ?? minorFont ?? 'Calibri', sizePt: base.sz ?? 11 };

  // ---- numbering: numId → abstract levels → bullet or numbered ----
  const listKind = new Map<string, ('ul' | 'ol')[]>();
  if (numbering) {
    const abstract = new Map<string, ('ul' | 'ol')[]>();
    for (const a of [...numbering.getElementsByTagNameNS(W, 'abstractNum')])
      abstract.set(attr(a, 'abstractNumId')!, kids(a, 'lvl').map((l) => (attr(kid(l, 'numFmt'), 'val') === 'bullet' ? 'ul' : 'ol')));
    for (const n of [...numbering.getElementsByTagNameNS(W, 'num')])
      listKind.set(attr(n, 'numId')!, abstract.get(attr(kid(n, 'abstractNumId'), 'val')!) ?? []);
  }

  const media = async (rid: string | null) => {
    const r = rid ? rels.get(rid) : undefined;
    if (!r || r.external) return null;
    const path = r.target.startsWith('/') ? r.target.slice(1) : 'word/' + r.target.replace(/^\.\//, '');
    const f = zip.file(path); if (!f) return null;
    const ext = path.split('.').pop()!.toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
    return `data:${mime};base64,${await f.async('base64')}`;
  };

  // ---- runs ----
  const images: string[] = []; // images are block nodes in the editor: paragraphs are split around them
  const runHtml = async (r: Element, inherited: RunProps): Promise<string> => {
    const p: RunProps = { ...inherited, ...styleRPr(attr(kid(kid(r, 'rPr'), 'rStyle'), 'val')), ...readRPr(kid(r, 'rPr')) };
    let text = '';
    for (const c of [...r.children]) {
      if (c.localName === 't') text += esc(c.textContent ?? '');
      else if (c.localName === 'tab') text += '&emsp;';
      else if (c.localName === 'br' && attr(c, 'type') !== 'page') text += '<br>';
      else if (c.localName === 'sym') text += esc(String.fromCharCode(parseInt(attr(c, 'char') ?? '20', 16)));
      else if (c.localName === 'drawing' || c.localName === 'pict') {
        const blip = c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')[0];
        const rid = blip?.getAttributeNS(R, 'embed') ?? c.getElementsByTagNameNS('urn:schemas-microsoft-com:vml', 'imagedata')[0]?.getAttributeNS(R, 'id') ?? null;
        const src = await media(rid);
        const ext = c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0];
        const w = ext ? Math.round(+ext.getAttribute('cx')! / 9525) : undefined, h = ext ? Math.round(+ext.getAttribute('cy')! / 9525) : undefined;
        if (src) { images.push(`<img src="${src}"${w ? ` width="${w}" height="${h}"` : ''}>`); text += `\u0000${images.length - 1}\u0000`; }
      }
    }
    if (!text) return '';
    const css: string[] = [];
    if (p.color && p.color !== '#000000') css.push(`color:${p.color}`);
    if (p.sz && p.sz !== defaults.sizePt) css.push(`font-size:${p.sz}pt`);
    if (p.font && p.font !== defaults.font) css.push(`font-family:'${p.font.replace(/'/g, '')}'`);
    let out = css.length ? `<span style="${css.join(';')}">${text}</span>` : text;
    if (p.hl) out = `<mark data-color="${p.hl}" style="background-color:${p.hl}">${out}</mark>`;
    if (p.s) out = `<s>${out}</s>`;
    if (p.u) out = `<u>${out}</u>`;
    if (p.i) out = `<em>${out}</em>`;
    if (p.b) out = `<strong>${out}</strong>`;
    return out;
  };
  const inlineHtml = async (el: Element, inherited: RunProps): Promise<string> => {
    let out = '';
    for (const c of [...el.children]) {
      if (c.localName === 'r') out += await runHtml(c, inherited);
      else if (c.localName === 'bookmarkStart' && attr(c, 'name')) out += `<span data-bookmark-name="${esc(attr(c, 'name')!)}"></span>`;
      else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'customXml', 'sdt', 'sdtContent'].includes(c.localName)) {
        const link = c.localName === 'hyperlink';
        const inner = await inlineHtml(c.localName === 'sdt' ? kid(c, 'sdtContent') ?? c : c, link ? { ...inherited, u: true, color: inherited.color ?? '#0563C1' } : inherited);
        const rid = c.getAttributeNS(R, 'id');
        const href = link ? (rid ? rels.get(rid)?.target : attr(c, 'anchor') ? '#' + attr(c, 'anchor') : undefined) : undefined;
        out += href && /^(https?:|mailto:|tel:|#)/i.test(href) ? `<a href="${esc(href)}">${inner}</a>` : inner;
      }
      // w:del (tracked deletions), w:proofErr, bookmarks… are skipped
    }
    return out;
  };

  // ---- paragraphs & lists ----
  type Para = { html: string; list?: { kind: 'ul' | 'ol'; lvl: number; numId: string }; fmt: ParaFmt; styleId: string | null };
  /** Spacing / line / indent as editor attributes (data-* for an exact round trip + matching CSS). */
  const fmtAttrs = (f: ParaFmt, inList: boolean) => {
    const before = f.before ?? 0, after = f.after ?? 0, line = f.line ?? '1';
    const data = [`data-sb="${before}"`, `data-sa="${after}"`, `data-lh="${line}"`];
    const css = [`padding-top:${before}pt`, `padding-bottom:${after}pt`, `line-height:${lineCss(line)}`];
    if (f.indent && !inList) { data.push(`data-ind="${f.indent}"`); css.push(`margin-left:${f.indent}pt`); }
    return { data: data.join(' '), css: css.join(';') };
  };
  const paraHtml = async (p: Element): Promise<Para> => {
    const pPr = kid(p, 'pPr');
    const styleId = attr(kid(pPr, 'pStyle'), 'val') ?? baseStyleId;
    const sname = styleName(styleId).toLowerCase();
    const inherited: RunProps = { ...base, ...styleRPr(styleId), ...readRPr(kid(pPr, 'rPr')) };
    const head = sname === 'title' ? 1 : +(sname.match(/^heading (\d)/)?.[1] ?? 0);
    // headings get their size/colour from the editor's heading styles unless the document says otherwise
    const runProps = head ? { ...inherited, b: undefined, sz: inherited.sz && styleRPr(styleId).sz ? inherited.sz : undefined } : inherited;
    const jc = attr(kid(pPr, 'jc'), 'val');
    const align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : null;
    const tag = head ? `h${Math.min(6, head)}` : 'p';
    const body = (await inlineHtml(p, runProps)) || '';
    const numPr0 = kid(pPr, 'numPr'), inList = !!attr(kid(numPr0, 'numId'), 'val') && attr(kid(numPr0, 'numId'), 'val') !== '0';
    const fmt: ParaFmt = { ...defPPr, ...stylePPr(styleId), ...readPPr(pPr) };
    const fa = fmtAttrs(fmt, inList);
    const open = `<${tag} ${fa.data} style="${align ? `text-align:${align};` : ''}${fa.css}">`, close = `</${tag}>`;
    const parts = body.split(/\u0000(\d+)\u0000/);
    // even indexes = text segments, odd = image ids. A run's formatting tags around a token are closed/reopened by the HTML parser.
    let html = '';
    parts.forEach((seg, i) => { if (i % 2) html += images[+seg]; else if (seg.replace(/<[^>]+>/g, '').trim() || parts.length === 1) html += open + seg + close; });
    const numPr = kid(pPr, 'numPr');
    const numId = attr(kid(numPr, 'numId'), 'val');
    if (numId && numId !== '0') {
      const lvl = +(attr(kid(numPr, 'ilvl'), 'val') ?? 0);
      return { html, list: { kind: listKind.get(numId)?.[lvl] ?? 'ul', lvl, numId }, fmt, styleId };
    }
    return { html, fmt, styleId };
  };

  const blocksHtml = async (container: Element): Promise<string> => {
    let out = '';
    const stack: ('ul' | 'ol')[] = [];
    const closeTo = (n: number) => { while (stack.length > n) out += `</li></${stack.pop()}>`; };
    // Word's "don't add space between paragraphs of the same style" (lists, List Paragraph…)
    const kidsEls = [...container.children];
    const paras = new Map<Element, Para>();
    for (const el of kidsEls) if (el.localName === 'p') paras.set(el, await paraHtml(el));
    kidsEls.forEach((el, i) => {
      const p = paras.get(el); if (!p?.fmt.contextual) return;
      const prev = paras.get(kidsEls[i - 1]), next = paras.get(kidsEls[i + 1]);
      const fix = (attrName: string, css: string) => { p.html = p.html.replace(new RegExp(`${attrName}="[^"]*"`), `${attrName}="0"`).replace(new RegExp(`${css}:[^;"]*`), `${css}:0pt`); };
      if (prev && prev.styleId === p.styleId) fix('data-sb', 'padding-top');
      if (next && next.styleId === p.styleId) fix('data-sa', 'padding-bottom');
    });
    for (const el of kidsEls) {
      if (el.localName === 'p') {
        const p = paras.get(el)!;
        if (p.list) {
          const want = p.list.lvl + 1;
          if (stack.length === want) out += '</li><li>';
          else if (stack.length > want) { closeTo(want); out += '</li><li>'; }
          while (stack.length < want) { stack.push(p.list.kind); out += `<${p.list.kind}><li>`; }
          out += p.html;
        } else { closeTo(0); out += p.html; }
        const section = kid(kid(el, 'pPr'), 'sectPr');
        if (section) { closeTo(0); out += `<div data-section-break="${sectionElements.indexOf(section)}"></div>`; }
      } else if (el.localName === 'tbl') { closeTo(0); out += await tableHtml(el); }
      else if (el.localName === 'sdt') { closeTo(0); out += await blocksHtml(kid(el, 'sdtContent') ?? el); }
    }
    closeTo(0);
    return out;
  };

  const tableHtml = async (tbl: Element): Promise<string> => {
    const rows = kids(tbl, 'tr');
    // vMerge: a "restart" cell spans down over following "continue" cells in the same grid column.
    const grid = rows.map((tr) => { let col = 0; return kids(tr, 'tc').map((tc) => { const span = +(attr(kid(kid(tc, 'tcPr'), 'gridSpan'), 'val') ?? 1); const vm = kid(kid(tc, 'tcPr'), 'vMerge'); const c = { tc, col, span, vm: vm ? (attr(vm, 'val') ?? 'continue') : null, rowspan: 1 }; col += span; return c; }); });
    grid.forEach((row, r) => row.forEach((c) => {
      if (c.vm === 'restart') { let k = r + 1; while (k < grid.length && grid[k].some((x) => x.col === c.col && x.vm === 'continue')) { c.rowspan++; k++; } }
    }));
    let out = '<table><tbody>';
    for (const row of grid) {
      out += '<tr>';
      for (const c of row) {
        if (c.vm === 'continue') continue;
        const inner = (await blocksHtml(c.tc)) || '<p></p>';
        out += `<td${c.span > 1 ? ` colspan="${c.span}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}>${inner}</td>`;
      }
      out += '</tr>';
    }
    return out + '</tbody></table>';
  };

  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const sectionElements = [...body.getElementsByTagNameNS(W, 'sectPr')];
  const html = await blocksHtml(body);

  // ---- header / footer (default section) — shown read-only, preserved on save ----
  const hfText = async (sect: Element | undefined, kind: 'headerReference' | 'footerReference') => {
    const ref = sect ? kids(sect, kind).find((h) => (attr(h, 'type') ?? 'default') === 'default') ?? kids(sect, kind)[0] : undefined;
    const rid = ref?.getAttributeNS(R, 'id') ?? ref?.getAttribute('r:id');
    const target = rid ? rels.get(rid)?.target : undefined;
    const x = target ? await read('word/' + target) : null;
    return x ? [...x.getElementsByTagNameNS(W, 'p')].map((p) => [...p.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join('')).filter(Boolean).join(' · ') : '';
  };
  const geometry = (sect: Element | undefined) => {
  const pgSz = kid(sect, 'pgSz'), pgMar = kid(sect, 'pgMar');
  const pw = twip(attr(pgSz, 'w')), ph = twip(attr(pgSz, 'h'));
  const page: PageGeom | undefined = pw && ph ? {
    w: pw, h: ph, top: Math.abs(twip(attr(pgMar, 'top')) ?? 72), bottom: Math.abs(twip(attr(pgMar, 'bottom')) ?? 72),
    left: twip(attr(pgMar, 'left') ?? attr(pgMar, 'start')) ?? 72, right: twip(attr(pgMar, 'right') ?? attr(pgMar, 'end')) ?? 72,
  } : undefined;
  return page;
  };
  let header = '', footer = '';
  const sections = [];
  for (const sect of sectionElements) {
    if (kids(sect, 'headerReference').length) header = await hfText(sect, 'headerReference');
    if (kids(sect, 'footerReference').length) footer = await hfText(sect, 'footerReference');
    sections.push({ page: geometry(sect), header, footer });
  }
  const first = sections[0];
  return { html, defaults: { ...defaults, ...first, sections }, header: first?.header ?? '', footer: first?.footer ?? '' };
}
