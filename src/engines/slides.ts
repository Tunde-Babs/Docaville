// Presentation engine.
//  - Opening .pptx: parse slide XML into an editable model while keeping a live reference to each
//    XML node. Saving writes text/position changes back into the ORIGINAL XML, so themes, layouts,
//    masters, transitions, animations and notes are preserved exactly.
//    Structural edits (add / duplicate / delete / reorder slides, backgrounds, new shapes and
//    pictures) are ALSO written into the original package, so nothing the editor doesn't model is lost.
//  - Brand-new decks: generated with pptxgenjs.
//  - PDF export: true vector output (text stays text) via pdf-lib.
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fallbackFonts, drawText, textWidth, wrapText } from './pdfFonts';
import { toEmbeddable } from '../lib/image';

const EMU_PER_PT = 12700;
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

export interface SlideEl {
  id: string;
  kind: 'text' | 'image' | 'shape';
  x: number; y: number; w: number; h: number; // points
  text?: string;
  fontSize?: number; color?: string; bold?: boolean; align?: 'left' | 'center' | 'right';
  fill?: string;
  image?: { bytes: Uint8Array; mime: string; url: string };
  /** Circular crop — profile/team photos. */
  rounded?: boolean;
  /** 0–1: picture transparency / fill transparency (1 = opaque). */
  opacity?: number;
  node?: Element; // original <p:sp>/<p:pic> (imported decks only)
  dirty?: boolean;
  /** Which properties changed since load — only these are written back into the original XML. */
  changed?: Set<string>;
}
export interface SlideImage { bytes: Uint8Array; mime: string; url: string }
export interface Slide {
  id: string; bg: string; bgImage?: SlideImage; els: SlideEl[];
  xml?: XMLDocument; path?: string; deleted?: Element[];
  /** <p:sldId> id + relationship id in presentation.xml (imported slides). */
  sldId?: string; rid?: string; rels?: XMLDocument;
  bgChanged?: boolean; notes?: string;
  /** 0–1. With a picture: how strongly the picture covers the background colour. Without: colour transparency (over white). */
  bgOpacity?: number;
  /** Hidden in the slide show / PDF export (PowerPoint "Hide Slide"). */
  hidden?: boolean;
  /** Elements were re-stacked (bring to front / send to back). */
  orderChanged?: boolean;
}
export interface Deck { width: number; height: number; slides: Slide[]; zip?: JSZip; structureChanged?: boolean; removed?: Slide[]; pres?: XMLDocument; presRels?: XMLDocument; layoutTarget?: string }

/** Record a property change on an element (used by the editor and themes). */
export function setProps(e: SlideEl, patch: Partial<SlideEl>) {
  Object.assign(e, patch);
  e.dirty = true;
  e.changed = new Set([...(e.changed ?? []), ...Object.keys(patch)]);
}

let seq = 0;
export const uid = () => `e${++seq}`;

export function newDeck(): Deck {
  return {
    width: 960, height: 540, structureChanged: true,
    slides: [titleSlide('Click to add title', 'Click to add subtitle')],
  };
}
export function titleSlide(title: string, sub: string): Slide {
  return {
    id: uid(), bg: '#FFFFFF', els: [
      { id: uid(), kind: 'text', x: 80, y: 170, w: 800, h: 110, text: title, fontSize: 44, bold: true, color: '#1F2937', align: 'center' },
      { id: uid(), kind: 'text', x: 80, y: 300, w: 800, h: 60, text: sub, fontSize: 24, color: '#6B7280', align: 'center' },
    ],
  };
}

// ---------------- import ----------------
const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const first = (el: Element | Document, tag: string) => el.getElementsByTagName(tag)[0] as Element | undefined;
const kids = (el: Element, tag: string) => [...el.children].filter((c) => c.tagName === tag);

async function rels(zip: JSZip, path: string): Promise<Record<string, string>> {
  const relPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
  const f = zip.file(relPath);
  if (!f) return {};
  const dir = path.replace(/[^/]+$/, '');
  const out: Record<string, string> = {};
  for (const r of [...parse(await f.async('string')).getElementsByTagName('Relationship')]) {
    const t = r.getAttribute('Target')!;
    out[r.getAttribute('Id')!] = t.startsWith('/') ? t.slice(1) : normalize(dir + t);
  }
  return out;
}
const normalize = (p: string) => p.split('/').reduce<string[]>((a, s) => (s === '..' ? a.slice(0, -1) : s === '.' ? a : [...a, s]), []).join('/');

function xfrm(el: Element) {
  const off = first(el, 'a:off'), ext = first(el, 'a:ext');
  if (!off || !ext) return null;
  return { x: +off.getAttribute('x')! / EMU_PER_PT, y: +off.getAttribute('y')! / EMU_PER_PT, w: +ext.getAttribute('cx')! / EMU_PER_PT, h: +ext.getAttribute('cy')! / EMU_PER_PT };
}
const phKey = (sp: Element) => { const ph = first(sp, 'p:ph'); return ph ? `${ph.getAttribute('type') ?? 'body'}|${ph.getAttribute('idx') ?? ''}` : null; };
const srgb = (el?: Element) => { const c = el && first(el, 'a:srgbClr'); return c ? '#' + c.getAttribute('val') : undefined; };
/** <a:alpha val="60000"/> inside a colour → 0.6 */
const alphaOf = (el?: Element) => { const a = el && first(el, 'a:alpha'); return a ? Math.max(0, Math.min(1, +(a.getAttribute('val') ?? 100000) / 100000)) : undefined; };

export async function loadPptx(bytes: Uint8Array): Promise<Deck> {
  const zip = await JSZip.loadAsync(bytes);
  const pres = parse(await zip.file('ppt/presentation.xml')!.async('string'));
  const sz = first(pres, 'p:sldSz');
  const deck: Deck = { width: +(sz?.getAttribute('cx') ?? 12192000) / EMU_PER_PT, height: +(sz?.getAttribute('cy') ?? 6858000) / EMU_PER_PT, slides: [], zip };
  const presRels = await rels(zip, 'ppt/presentation.xml');
  deck.pres = pres;
  deck.presRels = parse(await zip.file('ppt/_rels/presentation.xml.rels')!.async('string'));

  for (const sid of [...pres.getElementsByTagName('p:sldId')]) {
    const path = presRels[sid.getAttribute('r:id')!];
    const xml = parse(await zip.file(path)!.async('string'));
    const sRels = await rels(zip, path);
    // placeholder geometry inherited from layout → master
    const inherited = new Map<string, ReturnType<typeof xfrm>>();
    const layoutPath = Object.values(sRels).find((t) => t.includes('slideLayouts/'));
    for (const lp of layoutPath ? [layoutPath, ...Object.values(await rels(zip, layoutPath)).filter((t) => t.includes('slideMasters/'))] : []) {
      const lx = parse(await zip.file(lp)!.async('string'));
      for (const sp of [...lx.getElementsByTagName('p:sp')]) {
        const k = phKey(sp), g = xfrm(sp);
        if (k && g) { if (!inherited.has(k)) inherited.set(k, g); const t = k.split('|')[0]; if (!inherited.has(t + '|')) inherited.set(t + '|', g); }
      }
    }
    const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    const notesPath = Object.values(sRels).find((t) => t.includes('notesSlides/'));
    const notesXml = notesPath && zip.file(notesPath) ? parse(await zip.file(notesPath)!.async('string')) : null;
    const notes = notesXml ? [...notesXml.getElementsByTagName('p:sp')].filter((sp) => first(sp, 'p:ph')?.getAttribute('type') === 'body')
      .map((sp) => kids(first(sp, 'p:txBody')!, 'a:p').map((pp) => [...pp.getElementsByTagName('a:t')].map((t) => t.textContent).join('')).join('\n')).join('\n') : undefined;
    deck.layoutTarget ??= Object.values(sRels).find((t) => t.includes('slideLayouts/'));
    const slide: Slide = {
      id: uid(), bg: srgb(first(xml, 'p:bg')) ?? '#FFFFFF', bgOpacity: alphaOf(first(xml, 'p:bg')), els: [], xml, path,
      hidden: xml.documentElement.getAttribute('show') === '0',
      sldId: sid.getAttribute('id')!, rid: sid.getAttribute('r:id')!, notes,
      rels: zip.file(relsPath) ? parse(await zip.file(relsPath)!.async('string')) : undefined,
    };
    // background picture (<p:bg><p:bgPr><a:blipFill><a:blip r:embed=…>)
    const bgBlip = first(xml, 'p:bg') && first(first(xml, 'p:bg')!, 'a:blip');
    const bgTarget = bgBlip && sRels[bgBlip.getAttribute('r:embed') ?? ''];
    if (bgTarget && zip.file(bgTarget)) {
      const ib = await zip.file(bgTarget)!.async('uint8array');
      const ext = bgTarget.split('.').pop()!.toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      if (/^image\/(png|jpeg|gif|webp|bmp)$/.test(mime)) {
        slide.bgImage = { bytes: ib, mime, url: URL.createObjectURL(new Blob([ib as BlobPart], { type: mime })) };
        const amt = first(bgBlip!, 'a:alphaModFix')?.getAttribute('amt');
        if (amt) slide.bgOpacity = +amt / 100000;
      }
    }
    const inGroup = (el: Element) => { for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'p:grpSp') return true; return false; };
    for (const sp of [...xml.getElementsByTagName('p:sp')]) {
      if (inGroup(sp)) continue; // group children use group-local coordinates; leave them untouched
      const k = phKey(sp);
      const g = xfrm(sp) ?? (k ? inherited.get(k) ?? inherited.get(k.split('|')[0] + '|') : null);
      if (!g) continue;
      const body = first(sp, 'p:txBody');
      const paras = body ? kids(body, 'a:p') : [];
      const text = paras.map((p) => [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join('')).join('\n');
      const rPr = first(sp, 'a:rPr') ?? first(sp, 'a:defRPr');
      const ptype = first(sp, 'p:ph')?.getAttribute('type');
      const spPr = first(sp, 'p:spPr');
      const algn = first(sp, 'a:pPr')?.getAttribute('algn');
      slide.els.push({
        id: uid(), kind: body ? 'text' : 'shape', ...g, node: sp,
        text, fontSize: rPr?.getAttribute('sz') ? +rPr.getAttribute('sz')! / 100 : ptype === 'title' || ptype === 'ctrTitle' ? 40 : 20,
        bold: rPr?.getAttribute('b') === '1' || ptype === 'title' || ptype === 'ctrTitle',
        color: srgb(rPr ?? undefined) ?? '#111827',
        align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : ptype === 'ctrTitle' || ptype === 'subTitle' ? 'center' : 'left',
        fill: spPr ? srgb(kids(spPr, 'a:solidFill')[0]) : undefined,
        opacity: spPr ? alphaOf(kids(spPr, 'a:solidFill')[0]) : undefined,
      });
    }
    for (const pic of [...xml.getElementsByTagName('p:pic')]) {
      if (inGroup(pic)) continue;
      const g = xfrm(pic), rid = first(pic, 'a:blip')?.getAttribute('r:embed');
      const target = rid && sRels[rid];
      if (!g || !target || !zip.file(target)) continue;
      const ib = await zip.file(target)!.async('uint8array');
      const ext = target.split('.').pop()!.toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      const amt = first(pic, 'a:alphaModFix')?.getAttribute('amt');
      slide.els.push({ id: uid(), kind: 'image', ...g, node: pic, opacity: amt ? +amt / 100000 : undefined, image: { bytes: ib, mime, url: URL.createObjectURL(new Blob([ib as BlobPart], { type: mime })) } });
    }
    deck.slides.push(slide);
  }
  return deck;
}

// ---------------- export: pptx (in place) ----------------
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const IMG_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const NS_DECL = `xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"`;
const emu = (pt: number) => String(Math.round(pt * EMU_PER_PT));
const xesc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const algnOf = (a?: string) => (a === 'center' ? 'ctr' : a === 'right' ? 'r' : 'l');
const alphaTag = (op?: number) => (op !== undefined && op < 1 ? `<a:alpha val="${Math.round(Math.max(0, op) * 100000)}"/>` : '');
const solid = (hex: string, op?: number) => `<a:solidFill><a:srgbClr val="${hex.replace('#', '').toUpperCase()}">${alphaTag(op)}</a:srgbClr></a:solidFill>`;
const alphaMod = (op?: number) => (op !== undefined && op < 1 ? `<a:alphaModFix amt="${Math.round(Math.max(0, op) * 100000)}"/>` : '');

/** Parse an XML fragment (with p/a/r namespaces) and import it into `doc`. */
function frag(doc: XMLDocument, xml: string): Element {
  const d = new DOMParser().parseFromString(`<w ${NS_DECL}>${xml}</w>`, 'application/xml');
  return doc.importNode(d.documentElement.firstElementChild!, true) as Element;
}

function runProps(e: SlideEl) {
  return `<a:rPr lang="en-US" sz="${Math.round((e.fontSize ?? 18) * 100)}" b="${e.bold ? 1 : 0}" dirty="0">${e.color ? solid(e.color) : ''}<a:latin typeface="+mn-lt"/></a:rPr>`;
}
function parasXml(e: SlideEl) {
  return (e.text ?? '').split('\n').map((line) =>
    `<a:p><a:pPr algn="${algnOf(e.align)}"/>${line ? `<a:r>${runProps(e)}<a:t>${xesc(line)}</a:t></a:r>` : ''}<a:endParaRPr lang="en-US" sz="${Math.round((e.fontSize ?? 18) * 100)}" dirty="0"/></a:p>`).join('');
}

class Package {
  constructor(public zip: JSZip, public types: XMLDocument) {}
  static async open(zip: JSZip) { return new Package(zip, parse(await zip.file('[Content_Types].xml')!.async('string'))); }
  ensureDefault(ext: string, ct: string) {
    if ([...this.types.getElementsByTagName('Default')].some((d) => d.getAttribute('Extension')?.toLowerCase() === ext)) return;
    const d = this.types.createElementNS(this.types.documentElement.namespaceURI, 'Default');
    d.setAttribute('Extension', ext); d.setAttribute('ContentType', ct); this.types.documentElement.insertBefore(d, this.types.documentElement.firstChild);
  }
  override(part: string, ct: string | null) {
    const name = '/' + part;
    [...this.types.getElementsByTagName('Override')].filter((o) => o.getAttribute('PartName') === name).forEach((o) => o.remove());
    if (!ct) return;
    const o = this.types.createElementNS(this.types.documentElement.namespaceURI, 'Override');
    o.setAttribute('PartName', name); o.setAttribute('ContentType', ct); this.types.documentElement.appendChild(o);
  }
  uniqueName(dir: string, base: string, ext: string) { let i = 1; while (this.zip.file(`${dir}/${base}${i}.${ext}`)) i++; return `${dir}/${base}${i}.${ext}`; }
  save() { this.zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(this.types)); }
}

function addRel(rels: XMLDocument, type: string, target: string): string {
  const root = rels.documentElement, used = new Set([...root.getElementsByTagName('Relationship')].map((r) => r.getAttribute('Id')));
  let n = used.size + 1; while (used.has(`rId${n}`)) n++;
  const r = rels.createElementNS(REL_NS, 'Relationship');
  r.setAttribute('Id', `rId${n}`); r.setAttribute('Type', type); r.setAttribute('Target', target); root.appendChild(r);
  return `rId${n}`;
}
const emptyRels = () => parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"/>`);

async function addMedia(pkg: Package, slide: Slide, data: { bytes: Uint8Array; type: 'png' | 'jpg' }): Promise<string> {
  const ext = data.type === 'jpg' ? 'jpeg' : 'png';
  pkg.ensureDefault(ext, `image/${ext}`);
  const path = pkg.uniqueName('ppt/media', 'dh_image', ext);
  pkg.zip.file(path, data.bytes);
  slide.rels ??= emptyRels();
  return addRel(slide.rels, IMG_REL, '../media/' + path.split('/').pop());
}

function nextShapeId(doc: XMLDocument) {
  return Math.max(1, ...[...doc.getElementsByTagName('p:cNvPr')].map((c) => +(c.getAttribute('id') ?? 0))) + 1;
}

async function createNode(pkg: Package, s: Slide, e: SlideEl): Promise<Element> {
  const doc = s.xml!, id = nextShapeId(doc), xfrm = `<a:xfrm><a:off x="${emu(e.x)}" y="${emu(e.y)}"/><a:ext cx="${emu(e.w)}" cy="${emu(e.h)}"/></a:xfrm>`;
  if (e.kind === 'image' && e.image) {
    const img = e.rounded ? await circleCrop(e.image) : await toEmbeddable(e.image.bytes, e.image.mime);
    const rid = await addMedia(pkg, s, img);
    return frag(doc, `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}">${alphaMod(e.opacity)}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
  }
  const fill = e.fill ? solid(e.fill, e.opacity) : '<a:noFill/>';
  return frag(doc, `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${e.kind === 'shape' ? 'Rectangle' : 'TextBox'} ${id}"/><p:cNvSpPr${e.kind === 'text' ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${e.kind === 'shape' ? 'ctr' : 't'}"/><a:lstStyle/>${parasXml(e)}</p:txBody></p:sp>`);
}

/** Write only the properties that changed into an existing <p:sp>/<p:pic>, keeping all other formatting. */
async function writeBack(pkg: Package, s: Slide, el: SlideEl) {
  const doc = s.xml!, sp = el.node!, ch = el.changed ?? new Set(['x', 'y', 'w', 'h', 'text']);
  if (!sp.parentNode) first(doc, 'p:spTree')!.appendChild(sp); // restored by undo after a save
  if (['x', 'y', 'w', 'h'].some((k) => ch.has(k))) {
    let spPr = first(sp, 'p:spPr');
    if (!spPr) { spPr = doc.createElementNS(P_NS, 'p:spPr'); sp.insertBefore(spPr, sp.children[1] ?? null); }
    let x = kids(spPr, 'a:xfrm')[0];
    if (!x) { x = frag(doc, '<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>'); spPr.insertBefore(x, spPr.firstChild); }
    const off = first(x, 'a:off')!, ext = first(x, 'a:ext')!;
    off.setAttribute('x', emu(el.x)); off.setAttribute('y', emu(el.y)); ext.setAttribute('cx', emu(el.w)); ext.setAttribute('cy', emu(el.h));
  }
  if (el.kind !== 'image' && (ch.has('fill') || (ch.has('opacity') && el.fill))) {
    const spPr = first(sp, 'p:spPr');
    if (spPr) {
      kids(spPr, 'a:solidFill').concat(kids(spPr, 'a:noFill'), kids(spPr, 'a:gradFill'), kids(spPr, 'a:blipFill'), kids(spPr, 'a:pattFill')).forEach((n) => n.remove());
      const after = kids(spPr, 'a:prstGeom')[0] ?? kids(spPr, 'a:custGeom')[0] ?? kids(spPr, 'a:xfrm')[0];
      spPr.insertBefore(frag(doc, el.fill ? solid(el.fill, el.opacity) : '<a:noFill/>'), after ? after.nextSibling : spPr.firstChild);
    }
  }
  if (ch.has('opacity') && el.kind === 'image') {
    const blip = first(sp, 'a:blip');
    if (blip) { kids(blip, 'a:alphaModFix').forEach((n) => n.remove()); if (alphaMod(el.opacity)) blip.insertBefore(frag(doc, alphaMod(el.opacity)), blip.firstChild); }
  }
  if (ch.has('rounded') && el.kind === 'image' && el.image) {
    const blip = first(sp, 'a:blip');
    const img = el.rounded ? await circleCrop(el.image) : await toEmbeddable(el.image.bytes, el.image.mime);
    if (blip) blip.setAttributeNS(R_NS, 'r:embed', await addMedia(pkg, s, img));
  }
  const body = first(sp, 'p:txBody');
  if (!body) return;
  if (ch.has('text') && el.text !== undefined) {
    const paras = kids(body, 'a:p'), lines = el.text.split('\n'), template = paras[0];
    lines.forEach((line, i) => {
      let p = paras[i];
      if (!p) { p = template.cloneNode(true) as Element; body.appendChild(p); }
      const runs = kids(p, 'a:r');
      if (runs.length === 0) {
        const r = doc.createElementNS(A_NS, 'a:r'), t = doc.createElementNS(A_NS, 'a:t');
        r.appendChild(t); p.insertBefore(r, kids(p, 'a:endParaRPr')[0] ?? null); runs.push(r);
      }
      first(runs[0], 'a:t')!.textContent = line; // keep first run's formatting, drop the rest
      runs.slice(1).forEach((r) => r.remove());
      kids(p, 'a:fld').forEach((f) => f.remove());
    });
    paras.slice(lines.length).forEach((p) => p.remove());
  }
  const runs = [...body.getElementsByTagName('a:r')];
  const rPrOf = (r: Element) => { let rp = kids(r, 'a:rPr')[0]; if (!rp) { rp = doc.createElementNS(A_NS, 'a:rPr'); rp.setAttribute('lang', 'en-US'); r.insertBefore(rp, r.firstChild); } return rp; };
  for (const r of runs) {
    const rp = rPrOf(r);
    if (ch.has('fontSize') && el.fontSize) rp.setAttribute('sz', String(Math.round(el.fontSize * 100)));
    if (ch.has('bold')) rp.setAttribute('b', el.bold ? '1' : '0');
    if (ch.has('color') && el.color) {
      [...rp.children].filter((c) => /Fill$/.test(c.localName)).forEach((c) => c.remove());
      const ln = kids(rp, 'a:ln')[0];
      rp.insertBefore(frag(doc, solid(el.color)), ln ? ln.nextSibling : rp.firstChild);
    }
  }
  if (ch.has('align')) for (const p of kids(body, 'a:p')) {
    let pPr = kids(p, 'a:pPr')[0];
    if (!pPr) { pPr = doc.createElementNS(A_NS, 'a:pPr'); p.insertBefore(pPr, p.firstChild); }
    pPr.setAttribute('algn', algnOf(el.align));
  }
}

async function writeBackground(pkg: Package, s: Slide, aspect: number) {
  const doc = s.xml!, cSld = first(doc, 'p:cSld')!;
  kids(cSld, 'p:bg').forEach((b) => b.remove());
  let inner: string;
  if (s.bgImage) inner = `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${await addMedia(pkg, s, await backgroundPicture(s, aspect))}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`;
  else inner = solid(s.bg, s.bgOpacity);
  cSld.insertBefore(frag(doc, `<p:bg><p:bgPr>${inner}<a:effectLst/></p:bgPr></p:bg>`), cSld.firstChild);
}

async function saveInPlace(deck: Deck): Promise<Uint8Array> {
  const zip = deck.zip!, pkg = await Package.open(zip);
  const pres = deck.pres!, presRels = deck.presRels!;
  const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
  const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';

  // 1. removed slides: drop the part, its rels, its notes and the presentation relationship
  for (const s of deck.removed ?? []) {
    if (!s.path) continue;
    const notes = s.rels ? [...s.rels.getElementsByTagName('Relationship')].find((r) => /notesSlide$/.test(r.getAttribute('Type') ?? '')) : undefined;
    if (notes) { const np = 'ppt/' + notes.getAttribute('Target')!.replace(/^\.\.\//, ''); zip.remove(np); zip.remove(np.replace(/([^/]+)$/, '_rels/$1.rels')); pkg.override(np, null); }
    zip.remove(s.path); zip.remove(s.path.replace(/([^/]+)$/, '_rels/$1.rels')); pkg.override(s.path, null);
    [...presRels.getElementsByTagName('Relationship')].filter((r) => r.getAttribute('Id') === s.rid).forEach((r) => r.remove());
  }
  deck.removed = [];

  // 2. new slides (added / duplicated): create parts using the deck's layout
  for (const s of deck.slides) {
    if (s.path) continue;
    s.path = pkg.uniqueName('ppt/slides', 'slide', 'xml');
    s.xml = parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS_DECL}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    s.rels = emptyRels();
    if (deck.layoutTarget) addRel(s.rels, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', '../' + deck.layoutTarget.replace(/^ppt\//, ''));
    s.rid = addRel(presRels, SLIDE_REL, s.path.replace(/^ppt\//, ''));
    pkg.override(s.path, SLIDE_CT);
    s.bgChanged = true;
    s.els.forEach((e) => { e.node = undefined; });
  }

  // 3. slide contents
  for (const s of deck.slides) {
    const doc = s.xml!, tree = first(doc, 'p:spTree')!;
    for (const n of s.deleted ?? []) n.remove();
    s.deleted = [];
    if (s.bgChanged) { await writeBackground(pkg, s, deck.width / deck.height); s.bgChanged = false; }
    if (s.hidden) doc.documentElement.setAttribute('show', '0'); else doc.documentElement.removeAttribute('show');
    for (const e of s.els) {
      if (!e.node) { e.node = await createNode(pkg, s, e); tree.appendChild(e.node); e.changed = new Set(); continue; }
      if (e.dirty) await writeBack(pkg, s, e);
    }
    // Stacking order (bring to front / send to back): re-append the edited elements in the editor's order.
    if (s.orderChanged) { for (const e of s.els) if (e.node) tree.appendChild(e.node); s.orderChanged = false; }
    zip.file(s.path!, new XMLSerializer().serializeToString(doc));
    if (s.rels) zip.file(s.path!.replace(/([^/]+)$/, '_rels/$1.rels'), new XMLSerializer().serializeToString(s.rels));
  }

  // 4. slide order: rebuild <p:sldIdLst> from the editor's order
  const list = pres.getElementsByTagName('p:sldIdLst')[0];
  let nextId = Math.max(255, ...deck.slides.map((s) => +(s.sldId ?? 0))) + 1;
  while (list.firstChild) list.removeChild(list.firstChild);
  for (const s of deck.slides) {
    s.sldId ??= String(nextId++);
    const el = pres.createElementNS(P_NS, 'p:sldId');
    el.setAttribute('id', s.sldId); el.setAttributeNS(R_NS, 'r:id', s.rid!);
    list.appendChild(el);
  }
  zip.file('ppt/presentation.xml', new XMLSerializer().serializeToString(pres));
  zip.file('ppt/_rels/presentation.xml.rels', new XMLSerializer().serializeToString(presRels));
  pkg.save();
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ---------------- export: pptx (new decks) ----------------
export async function savePptx(deck: Deck): Promise<{ bytes: Uint8Array; rebuilt: boolean }> {
  if (deck.zip) return { bytes: await saveInPlace(deck), rebuilt: false };
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'DH', width: deck.width / 72, height: deck.height / 72 });
  pptx.layout = 'DH';
  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    if (s.hidden) (slide as unknown as { hidden: boolean }).hidden = true;
    if (s.bgImage) {
      const bg = await backgroundPicture(s, deck.width / deck.height);
      slide.background = { data: dataUrl(bg) };
    } else slide.background = { color: s.bg.replace('#', ''), transparency: transp(s.bgOpacity) };
    for (const e of s.els) {
      const pos = { x: e.x / 72, y: e.y / 72, w: e.w / 72, h: e.h / 72 };
      if (e.kind === 'image' && e.image) {
        const em = e.rounded ? await circleCrop(e.image) : await toEmbeddable(e.image.bytes, e.image.mime);
        slide.addImage({ ...pos, data: dataUrl(em), transparency: transp(e.opacity) });
      } else {
        slide.addText(e.text ?? '', {
          ...pos, fontSize: e.fontSize, bold: e.bold, color: e.color?.replace('#', ''), align: e.align, valign: 'top',
          fill: e.fill ? { color: e.fill.replace('#', ''), transparency: transp(e.opacity) } : undefined, fontFace: 'Calibri',
        });
      }
    }
  }
  deck.slides.forEach((s, i) => s.notes && (pptx as unknown as { slides: { addNotes(t: string): void }[] }).slides?.[i]?.addNotes(s.notes));
  const out = (await pptx.write({ outputType: 'uint8array' })) as Uint8Array;
  return { bytes: out, rebuilt: false };
}

const transp = (op?: number) => (op !== undefined && op < 1 ? Math.round((1 - op) * 100) : undefined);
const dataUrl = (e: { bytes: Uint8Array; type: 'png' | 'jpg' }) => `data:image/${e.type === 'jpg' ? 'jpeg' : 'png'};base64,${b64(e.bytes)}`;

async function canvasOf(img: SlideImage) {
  const { decodeImage } = await import('../lib/image');
  return decodeImage(img.bytes, img.mime);
}
const encode = (c: HTMLCanvasElement, type: 'png' | 'jpg') =>
  new Promise<{ bytes: Uint8Array; type: 'png' | 'jpg' }>((res) => c.toBlob(async (b) => res({ bytes: new Uint8Array(await b!.arrayBuffer()), type }), type === 'png' ? 'image/png' : 'image/jpeg', 0.95));

/** Crop an image to the slide's aspect ratio ("cover"), at up to 2560px wide. */
export async function coverCrop(img: SlideImage, aspect: number) {
  const el = await canvasOf(img);
  const w = el.naturalWidth, h = el.naturalHeight;
  const sw = Math.min(w, h * aspect), sh = sw / aspect;
  const outW = Math.min(2560, Math.round(sw));
  const c = document.createElement('canvas'); c.width = outW; c.height = Math.round(outW / aspect);
  const x = c.getContext('2d')!; x.imageSmoothingQuality = 'high';
  x.drawImage(el, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, c.width, c.height);
  return encode(c, /jpe?g/.test(img.mime) ? 'jpg' : 'png');
}

/** The slide's background picture as stored in the file: cropped to the slide and, when its opacity is below 100 %,
 *  blended over the background colour (so PowerPoint, PDF and the editor all show the same thing). */
export async function backgroundPicture(s: Slide, aspect: number) {
  const pic = await coverCrop(s.bgImage!, aspect);
  const op = s.bgOpacity ?? 1;
  if (op >= 1) return pic;
  const { decodeImage } = await import('../lib/image');
  const im = await decodeImage(pic.bytes, pic.type === 'jpg' ? 'image/jpeg' : 'image/png');
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext('2d')!;
  x.fillStyle = s.bg; x.fillRect(0, 0, c.width, c.height);
  x.globalAlpha = Math.max(0, op); x.drawImage(im, 0, 0);
  return encode(c, 'jpg');
}

/** Square-centre crop with a transparent circular mask (profile photos). */
export async function circleCrop(img: SlideImage) {
  const el = await canvasOf(img);
  const side = Math.min(el.naturalWidth, el.naturalHeight), out = Math.min(1200, side);
  const c = document.createElement('canvas'); c.width = c.height = out;
  const x = c.getContext('2d')!; x.imageSmoothingQuality = 'high';
  x.beginPath(); x.arc(out / 2, out / 2, out / 2, 0, Math.PI * 2); x.clip();
  x.drawImage(el, (el.naturalWidth - side) / 2, (el.naturalHeight - side) / 2, side, side, 0, 0, out, out);
  return encode(c, 'png');
}

const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

// ---------------- export: PDF (vector) ----------------
const hex = (h = '#000000') => { const v = parseInt(h.slice(1, 7), 16); return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255); };

export async function deckToPdf(deck: Deck): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fallback = await fallbackFonts(pdf, deck.slides.flatMap(s => s.els.map(e => e.text ?? '')).join('\n'));
  // Hidden slides are left out, like PowerPoint's PDF export (unless every slide is hidden).
  const shown = deck.slides.some((s) => !s.hidden) ? deck.slides.filter((s) => !s.hidden) : deck.slides;
  for (const s of shown) {
    const page = pdf.addPage([deck.width, deck.height]);
    const bgOp = s.bgOpacity ?? 1;
    if (!s.bgImage && bgOp < 1) page.drawRectangle({ x: 0, y: 0, width: deck.width, height: deck.height, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: 0, width: deck.width, height: deck.height, color: hex(s.bg), opacity: s.bgImage ? 1 : bgOp });
    if (s.bgImage) {
      const bg = await coverCrop(s.bgImage, deck.width / deck.height);
      const im = bg.type === 'png' ? await pdf.embedPng(bg.bytes) : await pdf.embedJpg(bg.bytes);
      page.drawImage(im, { x: 0, y: 0, width: deck.width, height: deck.height, opacity: bgOp });
    }
    for (const e of s.els) {
      const top = deck.height - e.y;
      if (e.fill && e.kind !== 'image') page.drawRectangle({ x: e.x, y: top - e.h, width: e.w, height: e.h, color: hex(e.fill), opacity: e.opacity ?? 1 });
      if (e.kind === 'image' && e.image) {
        const em = e.rounded ? await circleCrop(e.image) : await toEmbeddable(e.image.bytes, e.image.mime);
        const img = em.type === 'png' ? await pdf.embedPng(em.bytes) : await pdf.embedJpg(em.bytes);
        page.drawImage(img, { x: e.x, y: top - e.h, width: e.w, height: e.h, opacity: e.opacity ?? 1 });
      } else if (e.text) {
        const font = e.bold ? bold : reg, size = e.fontSize ?? 18, pad = 7;
        let y = top - pad - size;
        for (const para of e.text.split('\n'))
          for (const line of wrapText(para, Math.max(1, e.w - 2 * pad), size, font, fallback)) {
            const lw = textWidth(line, size, font, fallback);
            const x = e.align === 'center' ? e.x + (e.w - lw) / 2 : e.align === 'right' ? e.x + e.w - pad - lw : e.x + pad;
            drawText(page, line, font, fallback, { x, y, size, color: hex(e.color) });
            y -= size * 1.2;
          }
      }
    }
  }
  return pdf.save();
}


// ---------------- themes ----------------
export interface Theme { id: string; name: string; bg: string; gradient?: [string, string, string?]; title: string; body: string; accent: string }
export const THEMES: Theme[] = [
  { id: 'classic', name: 'Classic', bg: '#FFFFFF', title: '#111827', body: '#374151', accent: '#2563EB' },
  { id: 'midnight', name: 'Midnight', bg: '#0F172A', title: '#F8FAFC', body: '#CBD5E1', accent: '#38BDF8' },
  { id: 'brand', name: 'Aurora', bg: '#4F46E5', gradient: ['#0EA5E9', '#4F46E5', '#7C3AED'], title: '#FFFFFF', body: '#E0E7FF', accent: '#FDE68A' },
  { id: 'ocean', name: 'Ocean', bg: '#0E7490', gradient: ['#0891B2', '#1E3A8A'], title: '#FFFFFF', body: '#CFFAFE', accent: '#FDE047' },
  { id: 'sunset', name: 'Sunset', bg: '#EA580C', gradient: ['#F97316', '#DB2777', '#7C3AED'], title: '#FFFFFF', body: '#FFE4E6', accent: '#FEF08A' },
  { id: 'forest', name: 'Forest', bg: '#14532D', gradient: ['#166534', '#064E3B'], title: '#F0FDF4', body: '#BBF7D0', accent: '#FACC15' },
  { id: 'paper', name: 'Paper', bg: '#FAF7F0', title: '#3F2D20', body: '#5B4636', accent: '#B45309' },
];

/** Render a theme's gradient as a 1920px background image (pptx backgrounds can't hold CSS gradients). */
export async function themeBackground(t: Theme, aspect: number): Promise<SlideImage | undefined> {
  if (!t.gradient) return undefined;
  const c = document.createElement('canvas'); c.width = 1920; c.height = Math.round(1920 / aspect);
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, c.width, c.height);
  t.gradient.forEach((col, i, a) => col && g.addColorStop(i / Math.max(1, a.filter(Boolean).length - 1), col));
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  const glow = x.createRadialGradient(c.width * 0.15, c.height * 0.1, 0, c.width * 0.15, c.height * 0.1, c.width * 0.6);
  glow.addColorStop(0, 'rgba(255,255,255,0.22)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = glow; x.fillRect(0, 0, c.width, c.height);
  const bytes = await new Promise<Uint8Array>((res) => c.toBlob(async (b) => res(new Uint8Array(await b!.arrayBuffer())), 'image/png'));
  return { bytes, mime: 'image/png', url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })) };
}

/** Apply a theme to every slide: background + title/body colours + accent shapes. */
export async function applyTheme(deck: Deck, t: Theme) {
  const bgImage = await themeBackground(t, deck.width / deck.height);
  for (const s of deck.slides) {
    s.bg = t.bg; s.bgImage = bgImage; s.bgOpacity = undefined; s.bgChanged = true;
    const texts = s.els.filter((e) => e.kind === 'text');
    const biggest = Math.max(0, ...texts.map((e) => e.fontSize ?? 0));
    for (const e of s.els) {
      if (e.kind === 'text') setProps(e, { color: (e.fontSize ?? 0) >= biggest && biggest >= 28 ? t.title : t.body });
      else if (e.kind === 'shape' && !e.text && e.h <= 12) setProps(e, { fill: t.accent }); // thin accent bars
    }
  }
  deck.structureChanged = true;
}
