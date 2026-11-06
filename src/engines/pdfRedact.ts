// Low-level text-stream editing helper. NOT a secure document-redaction API: unused objects,
// images, nested forms and annotations may retain content. Use savePdf's clean covered-copy path.
// Glyphs inside the given rectangles are removed from the page's
// content stream (not just painted over), so they can't be selected, searched or copied.
//
// We tokenise the content stream, track the graphics/text state (CTM, Tm, font, size, spacing,
// horizontal scaling, rise) and compute each glyph's position from the font's width tables.
// Every text-showing operator that has glyphs inside a rectangle is rewritten as a TJ array in
// which removed glyphs become equal-width kerning gaps — all other text keeps its exact position.
//
// Limitations: text inside Form XObjects and Type 3 fonts is left untouched.
import { PDFDocument, PDFPage, PDFName, PDFArray, PDFDict, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, StandardFonts, StandardFontEmbedder } from 'pdf-lib';

type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const apply = (m: M, x: number, y: number) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

export interface Rect { x: number; y: number; w: number; h: number }
interface FontInfo { twoByte: boolean; width: (code: number) => number }

function fontInfo(doc: PDFDocument, dict: PDFDict | undefined): FontInfo {
  const fallback: FontInfo = { twoByte: false, width: () => 500 };
  if (!dict) return fallback;
  const sub = dict.lookup(PDFName.of('Subtype'))?.toString();
  const num = (o: unknown) => (o instanceof PDFNumber ? o.asNumber() : 0);
  if (sub === '/Type0') {
    const desc = (dict.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookup(0) as PDFDict | undefined);
    const dw = desc?.lookup(PDFName.of('DW')) ? num(desc.lookup(PDFName.of('DW'))) : 1000;
    const widths = new Map<number, number>();
    const W = desc?.lookupMaybe(PDFName.of('W'), PDFArray);
    if (W) for (let i = 0; i < W.size(); ) {
      const first = num(W.lookup(i)), next = W.lookup(i + 1);
      if (next instanceof PDFArray) { for (let k = 0; k < next.size(); k++) widths.set(first + k, num(next.lookup(k))); i += 2; }
      else { const last = num(next), w = num(W.lookup(i + 2)); for (let c = first; c <= last; c++) widths.set(c, w); i += 3; }
    }
    return { twoByte: true, width: (c) => widths.get(c) ?? dw };
  }
  const first = num(dict.lookup(PDFName.of('FirstChar')));
  const widths = dict.lookupMaybe(PDFName.of('Widths'), PDFArray);
  const fd = dict.lookup(PDFName.of('FontDescriptor')) as PDFDict | undefined;
  const missing = fd?.lookup(PDFName.of('MissingWidth')) ? num(fd.lookup(PDFName.of('MissingWidth'))) : 0;
  const base = (dict.lookup(PDFName.of('BaseFont'))?.toString() ?? '').replace(/^\/([A-Z]{6}\+)?/, '');
  // Standard-14 fonts carry no width table: use the real AFM metrics that ship with pdf-lib.
  const stdName = (Object.values(StandardFonts) as string[]).find((n) => n === base);
  const std = stdName ? StandardFontEmbedder.for(stdName as unknown as Parameters<typeof StandardFontEmbedder.for>[0]) : null;
  const stdWidth = (c: number) => { try { return std!.widthOfTextAtSize(String.fromCharCode(c), 1000); } catch { return 500; } };
  void doc;
  return { twoByte: false, width: (c) => (widths && c >= first && c - first < widths.size() ? num(widths.lookup(c - first)) : std ? stdWidth(c) : missing || (/Courier/i.test(base) ? 600 : 500)) };
}

// ---------- tokenizer (latin1 string: 1 char = 1 byte) ----------
type Tok = { k: 'num' | 'name' | 'str' | 'arr' | 'dict' | 'op' | 'bool' | 'null'; v: unknown; s: number; e: number };
const WS = /[\0\t\n\f\r ]/, DELIM = /[()<>[\]{}/%]/;

function readString(src: string, i: number): [string, number] { // src[i] === '('
  let depth = 1, out = ''; i++;
  while (i < src.length && depth) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
      if (n in map) { out += map[n]; i += 2; }
      else if (/[0-7]/.test(n)) { const m = src.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)![0]; out += String.fromCharCode(parseInt(m, 8) & 255); i += 1 + m.length; }
      else if (n === '\r' || n === '\n') { i += 2; if (n === '\r' && src[i] === '\n') i++; }
      else { out += n ?? ''; i += 2; }
    } else { if (c === '(') depth++; else if (c === ')') { depth--; if (!depth) break; } out += c; i++; }
  }
  return [out, i + 1];
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const stack: { k: 'arr' | 'dict'; items: Tok[]; s: number }[] = [];
  const push = (t: Tok) => (stack.length ? stack[stack.length - 1].items.push(t) : toks.push(t));
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (WS.test(c)) { i++; continue; }
    if (c === '%') { while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++; continue; }
    const s = i;
    if (c === '(') { const [v, e] = readString(src, i); push({ k: 'str', v, s, e }); i = e; continue; }
    if (c === '<' && src[i + 1] === '<') { stack.push({ k: 'dict', items: [], s }); i += 2; continue; }
    if (c === '>' && src[i + 1] === '>') { const d = stack.pop(); i += 2; if (d) push({ k: 'dict', v: d.items, s: d.s, e: i }); continue; }
    if (c === '<') {
      const e = src.indexOf('>', i); const hex = src.slice(i + 1, e).replace(/\s/g, '');
      let v = ''; for (let k = 0; k < hex.length; k += 2) v += String.fromCharCode(parseInt((hex[k] + (hex[k + 1] ?? '0')), 16));
      push({ k: 'str', v, s, e: e + 1 }); i = e + 1; continue;
    }
    if (c === '[') { stack.push({ k: 'arr', items: [], s }); i++; continue; }
    if (c === ']') { const a = stack.pop(); i++; if (a) push({ k: 'arr', v: a.items, s: a.s, e: i }); continue; }
    if (c === '/') { let e = i + 1; while (e < src.length && !WS.test(src[e]) && !DELIM.test(src[e])) e++; push({ k: 'name', v: src.slice(i + 1, e), s, e }); i = e; continue; }
    let e = i; while (e < src.length && !WS.test(src[e]) && !DELIM.test(src[e])) e++;
    if (e === i) { i++; continue; }
    const word = src.slice(i, e);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) push({ k: 'num', v: parseFloat(word), s, e });
    else if (word === 'true' || word === 'false') push({ k: 'bool', v: word === 'true', s, e });
    else if (word === 'null') push({ k: 'null', v: null, s, e });
    else {
      push({ k: 'op', v: word, s, e });
      if (word === 'ID') { // inline image: skip binary data up to whitespace + EI + whitespace
        let j = e + 1;
        while (j < src.length && !(WS.test(src[j - 1]) && src.startsWith('EI', j) && (j + 2 >= src.length || WS.test(src[j + 2])))) j++;
        toks.push({ k: 'op', v: 'EI', s: j, e: j + 2 }); e = j + 2;
      }
    }
    i = e;
  }
  return toks;
}

const hexOf = (bytes: string) => '<' + [...bytes].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('') + '>';

/** Remove text glyphs inside `rects` (PDF user space). Returns the number of glyphs removed. */
export function redactPage(doc: PDFDocument, page: PDFPage, rects: Rect[]): number {
  if (!rects.length) return 0;
  const contents = page.node.Contents();
  if (!contents) return 0;
  const streams: PDFStream[] = contents instanceof PDFArray
    ? contents.asArray().map((r) => doc.context.lookup(r) as PDFStream)
    : [contents as PDFStream];
  // pdf-lib content streams (created in this session) carry an operator list; everything read from a file is a
  // raw (usually Flate-compressed) stream that must be decoded. Duck-typed: instanceof breaks across pdf-lib copies.
  const decode = (st: PDFStream) => ('operators' in (st as object)
    ? (st as unknown as { getContents(): Uint8Array }).getContents()
    : decodePDFRawStream(st as PDFRawStream).decode());
  const raw = streams.map(decode);
  const bytes = new Uint8Array(raw.reduce((a, b) => a + b.length + 1, 0));
  let o = 0; for (const b of raw) { bytes.set(b, o); o += b.length; bytes[o++] = 10; }
  let src = ''; for (let k = 0; k < bytes.length; k += 0x8000) src += String.fromCharCode(...bytes.subarray(k, k + 0x8000));

  const fontsDict = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const fontCache = new Map<string, FontInfo>();
  const getFont = (name: string) => {
    if (!fontCache.has(name)) fontCache.set(name, fontInfo(doc, fontsDict?.lookup(PDFName.of(name)) as PDFDict | undefined));
    return fontCache.get(name)!;
  };

  const toks = tokenize(src);
  const gs: M[] = []; let ctm: M = [...I] as M;
  let Tm: M = [...I] as M, Tlm: M = [...I] as M;
  let Tc = 0, Tw = 0, Th = 1, TL = 0, Tfs = 0, Trise = 0, font: FontInfo = { twoByte: false, width: () => 500 };
  const edits: { s: number; e: number; text: string }[] = [];
  let removed = 0, operands: Tok[] = [];

  const inside = (x: number, y: number, size: number) => rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y - size * 0.25 && y <= r.y + r.h);

  // Walk the glyphs of one string, advancing Tm. Returns TJ parts (kept bytes / gap numbers) and whether anything was removed.
  const show = (str: string, parts: (string | number)[]) => {
    let any = false, kept = '';
    const step = font.twoByte ? 2 : 1;
    for (let i = 0; i < str.length; i += step) {
      const bytesOf = str.slice(i, i + step);
      const code = font.twoByte ? (str.charCodeAt(i) << 8) | (str.charCodeAt(i + 1) || 0) : str.charCodeAt(i);
      const w0 = font.width(code) / 1000;
      const adv = (w0 * Tfs + Tc + (!font.twoByte && code === 32 ? Tw : 0)) * Th;
      const trm = mul([Tfs * Th, 0, 0, Tfs, 0, Trise], mul(Tm, ctm));
      const [x0, y0] = apply(trm, 0, 0), [x1] = apply(mul(Tm, ctm), adv, Trise);
      const size = Math.abs(trm[3]) || Math.abs(trm[1]) || Tfs;
      if (inside((x0 + x1) / 2, y0, size)) {
        any = true; removed++;
        if (kept) { parts.push(kept); kept = ''; }
        // TJ number n moves by -n/1000 * Tfs * Th → gap equal to the removed glyph's advance
        const gap = Tfs ? -(adv / Th / Tfs) * 1000 : 0;
        if (typeof parts[parts.length - 1] === 'number') (parts[parts.length - 1] as number) += gap; else parts.push(gap);
      } else kept += bytesOf;
      Tm = mul([1, 0, 0, 1, adv, 0], Tm);
    }
    if (kept) parts.push(kept);
    return any;
  };
  const emitTJ = (parts: (string | number)[]) => '[' + parts.map((p) => (typeof p === 'number' ? (+p.toFixed(3)).toString() : hexOf(p))).join(' ') + '] TJ';

  for (const t of toks) {
    if (t.k !== 'op') { operands.push(t); continue; }
    const op = t.v as string, a = operands, n = (i: number) => (a[i]?.v as number) ?? 0;
    const start = a[0]?.s ?? t.s;
    switch (op) {
      case 'q': gs.push(ctm); break;
      case 'Q': ctm = gs.pop() ?? ([...I] as M); break;
      case 'cm': ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], ctm); break;
      case 'BT': Tm = [...I] as M; Tlm = [...I] as M; break;
      case 'Tc': Tc = n(0); break;
      case 'Tw': Tw = n(0); break;
      case 'Tz': Th = n(0) / 100; break;
      case 'TL': TL = n(0); break;
      case 'Ts': Trise = n(0); break;
      case 'Tf': font = getFont(a[0]?.v as string); Tfs = n(1); break;
      case 'Td': Tlm = mul([1, 0, 0, 1, n(0), n(1)], Tlm); Tm = Tlm; break;
      case 'TD': TL = -n(1); Tlm = mul([1, 0, 0, 1, n(0), n(1)], Tlm); Tm = Tlm; break;
      case 'Tm': Tlm = [n(0), n(1), n(2), n(3), n(4), n(5)]; Tm = Tlm; break;
      case 'T*': Tlm = mul([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm; break;
      case 'Tj': case "'": case '"': {
        let prefix = '';
        if (op !== 'Tj') {
          if (op === '"') { Tw = n(0); Tc = n(1); prefix = `${n(0)} Tw ${n(1)} Tc `; }
          Tlm = mul([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm; prefix += 'T* ';
        }
        const strTok = a[a.length - 1];
        const parts: (string | number)[] = [];
        if (strTok?.k === 'str' && show(strTok.v as string, parts)) edits.push({ s: start, e: t.e, text: prefix + emitTJ(parts) });
        break;
      }
      case 'TJ': {
        const arr = a[0]?.k === 'arr' ? (a[0].v as Tok[]) : [];
        const parts: (string | number)[] = [];
        let any = false;
        for (const el of arr) {
          if (el.k === 'num') { const k = el.v as number; Tm = mul([1, 0, 0, 1, (-k / 1000) * Tfs * Th, 0], Tm); if (typeof parts[parts.length - 1] === 'number') (parts[parts.length - 1] as number) += k; else parts.push(k); }
          else if (el.k === 'str') any = show(el.v as string, parts) || any;
        }
        if (any) edits.push({ s: start, e: t.e, text: emitTJ(parts) });
        break;
      }
    }
    operands = [];
  }
  if (!edits.length) return 0;

  let out = '', last = 0;
  for (const e of edits) { out += src.slice(last, e.s) + e.text; last = e.e; }
  out += src.slice(last);
  const outBytes = new Uint8Array(out.length);
  for (let k = 0; k < out.length; k++) outBytes[k] = out.charCodeAt(k) & 255;
  const ref: PDFRef = doc.context.register(doc.context.flateStream(outBytes));
  page.node.set(PDFName.of('Contents'), ref);
  return removed;
}
