// Spreadsheet engine. We edit the ExcelJS workbook *in place*, so styles, merges, column widths,
// number formats, charts' source data etc. of everything the user didn't touch round-trip intact.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export type Workbook = ExcelJS.Workbook;
export type Worksheet = ExcelJS.Worksheet;
const macroSources = new WeakMap<Workbook, JSZip>();
export const workbookExtension = (wb: Workbook | null) => wb && macroSources.has(wb) ? 'xlsm' : 'xlsx';

export async function loadWorkbook(bytes: Uint8Array | null, name = 'Book.xlsx'): Promise<Workbook> {
  const wb = new ExcelJS.Workbook();
  if (!bytes) { wb.addWorksheet('Sheet1'); return wb; }
  if (/\.(csv|tsv)$/i.test(name)) {
    const ws = wb.addWorksheet(name.replace(/\.[^.]+$/, '').slice(0, 31) || 'Sheet1');
    const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '');
    const delim = /\.tsv$/i.test(name) ? '\t' : sniffDelimiter(text);
    // ';'-separated files come from locales that write decimals with a comma (1.234,50).
    const commaDecimal = delim === ';';
    parseCsv(text, delim).forEach((row, r) => row.forEach((v, c) => {
      const cell = ws.getCell(r + 1, c + 1);
      const parsed = parseCsvValue(v, commaDecimal);
      cell.value = parsed.value;
      if (parsed.numFmt) cell.numFmt = parsed.numFmt;
    }));
    return wb;
  }
  await wb.xlsx.load(bytes.slice().buffer);
  if (/\.xlsm$/i.test(name)) {
    const zip = await JSZip.loadAsync(bytes);
    if (zip.file('xl/vbaProject.bin')) macroSources.set(wb, zip);
  }
  return wb;
}

export async function saveXlsx(wb: Workbook): Promise<Uint8Array> {
  wb.calcProperties.fullCalcOnLoad = true; // Excel/Numbers/LibreOffice recompute formulas on open
  // Persist supported live results too: readers without a calculation engine must not see stale caches.
  for (const ws of wb.worksheets) ws.eachRow(row => row.eachCell(cell => {
    const v = cell.value;
    if (!v || typeof v !== 'object' || !('formula' in v || 'sharedFormula' in v)) return;
    const result = evaluate(ws, cell.formula ?? '');
    if (isErr(result) && result.err === '#NAME?') return;
    cell.value = { ...v, result: isErr(result) ? { error: result.err === '#CIRC!' ? '#REF!' : result.err } : result ?? 0 } as ExcelJS.CellValue;
  }));
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const original = macroSources.get(wb);
  if (!original) return bytes;
  const out = await JSZip.loadAsync(bytes);
  const parts = Object.keys(original.files).filter(p => !original.files[p].dir && /vbaProject/i.test(p));
  for (const part of parts) out.file(part, await original.file(part)!.async('uint8array'));
  const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const types = parse(await out.file('[Content_Types].xml')!.async('string'));
  const sourceTypes = parse(await original.file('[Content_Types].xml')!.async('string'));
  const main = [...types.getElementsByTagName('Override')].find(e => e.getAttribute('PartName') === '/xl/workbook.xml');
  main?.setAttribute('ContentType', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml');
  for (const part of parts) {
    const source = [...sourceTypes.getElementsByTagName('Override')].find(e => e.getAttribute('PartName') === '/' + part);
    const node = source ? types.importNode(source, true) as Element : types.createElementNS(types.documentElement.namespaceURI, 'Override');
    if (!source) { node.setAttribute('PartName', '/' + part); node.setAttribute('ContentType', part.endsWith('.rels') ? 'application/vnd.openxmlformats-package.relationships+xml' : 'application/vnd.ms-office.vbaProject'); }
    types.documentElement.appendChild(node);
  }
  const relsPath = 'xl/_rels/workbook.xml.rels';
  const rels = parse(await out.file(relsPath)!.async('string'));
  const sourceRels = original.file(relsPath) ? parse(await original.file(relsPath)!.async('string')) : null;
  const project = sourceRels && [...sourceRels.getElementsByTagName('Relationship')].find(e => e.getAttribute('Type')?.endsWith('/vbaProject'));
  const relation = project ? rels.importNode(project, true) as Element : rels.createElementNS(rels.documentElement.namespaceURI, 'Relationship');
  const ids = new Set([...rels.getElementsByTagName('Relationship')].map(e => e.getAttribute('Id')));
  let n = 1; while (ids.has(`rIdMacro${n}`)) n++;
  relation.setAttribute('Id', `rIdMacro${n}`);
  if (!project) { relation.setAttribute('Target', 'vbaProject.bin'); relation.setAttribute('Type', 'http://schemas.microsoft.com/office/2006/relationships/vbaProject'); }
  rels.documentElement.appendChild(relation);
  const ser = new XMLSerializer();
  out.file('[Content_Types].xml', ser.serializeToString(types));
  out.file(relsPath, ser.serializeToString(rels));
  return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ---------- CSV ----------
function sniffDelimiter(text: string) {
  const first = text.split('\n', 1)[0];
  return [',', ';', '\t', '|'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
}

export function parseCsv(text: string, d = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function parseCsvValue(v: string, commaDecimal: boolean): { value: ExcelJS.CellValue; numFmt?: string } {
  if (v === '') return { value: null };
  const num = commaDecimal ? v.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.') : v.replace(/,(?=\d{3}(\D|$))/g, '');
  if (/^-?\d+(\.\d+)?$/.test(num) && !/^-?0\d/.test(num)) {
    const dec = num.split('.')[1]?.length ?? 0;
    return { value: +num, numFmt: /[.,]\d{3}/.test(v) || dec === 2 ? `#,##0${dec ? '.' + '0'.repeat(dec) : ''}` : undefined };
  }
  let m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); // 31.12.2026
  if (m) return { value: new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])), numFmt: 'dd.mm.yyyy' };
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { value: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), numFmt: 'yyyy-mm-dd' };
  if (/^(true|false)$/i.test(v)) return { value: v.toLowerCase() === 'true' };
  return { value: v };
}

/** Read a cell WITHOUT creating it (ExcelJS getCell() creates cells and grows the sheet). */
export const peek = (ws: Worksheet, r: number, c: number) => ws.findRow(r)?.findCell(c);

export function sheetToMatrix(ws: Worksheet): string[][] {
  const out: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) { const cell = peek(ws, r, c); row.push(cell ? displayValue(ws, cell) : ''); }
    out.push(row);
  }
  return out;
}

/** Merged ranges as {top,left,bottom,right} (1-based). */
export function merges(ws: Worksheet): { top: number; left: number; bottom: number; right: number }[] {
  return Object.values((ws as unknown as { _merges: Record<string, { model: { top: number; left: number; bottom: number; right: number } }> })._merges ?? {}).map((m) => m.model);
}

export function toCsv(ws: Worksheet, d = ','): string {
  const rows: string[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = peek(ws, r, c), v = cell?.value;
      const formula = v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v);
      const value = formula ? evaluate(ws, cell!.formula ?? '') : v;
      // CSV is a data interchange format: number/date display formats must not round or localize values.
      const s = isErr(value) ? value.err : value instanceof Date ? value.toISOString() : typeof value === 'number' ? String(value) : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : displayValueOf(value as ExcelJS.CellValue);
      row.push(/["\n\r;\t,]/.test(s) || s.includes(d) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    }
    rows.push(row.join(d));
  }
  return rows.join('\r\n');
}

export function toHtmlTable(ws: Worksheet): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return `<table>${sheetToMatrix(ws).map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`;
}

// ---------- cell values & formulas ----------
export const colName = (c: number) => { let s = ''; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
const colNum = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

export function rawInput(cell: ExcelJS.Cell | undefined): string {
  const v = cell?.value as ExcelJS.CellValue;
  if (!cell || v == null) return '';
  if (typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) return '=' + (cell.formula ?? '');
  if (v instanceof Date) return formatDate(v, isDateFormat(cell.numFmt) ? cell.numFmt! : 'yyyy-mm-dd');
  return displayValueOf(v);
}

function displayValueOf(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return v.result == null ? '' : displayValueOf(v.result as ExcelJS.CellValue);
    if ('error' in v) return String(v.error);
  }
  return String(v);
}

/** What the grid / PDF / CSV shows for a cell: live formula result, formatted with its number format. */
export function displayValue(ws: Worksheet, cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) {
    const res = evaluate(ws, cell.formula ?? '');
    const cached = (v as { result?: unknown }).result;
    // Only an unsupported function may display a labelled cache. Real errors must never be hidden.
    if (isErr(res) && res.err === '#NAME?' && cached !== undefined && cached !== null) return `${formatValue(cached, cell.numFmt)} (cached)`;
    return isErr(res) ? res.err : formatValue(res, cell.numFmt);
  }
  if (typeof v === 'number' || v instanceof Date) return formatValue(v, cell.numFmt);
  return displayValueOf(v);
}

export function setInput(cell: ExcelJS.Cell, input: string) {
  const t = input.trim();
  if (input.startsWith('=')) cell.value = { formula: input.slice(1) } as ExcelJS.CellFormulaValue;
  else if (t === '') cell.value = null;
  else if (/^-?[\d,]*\.?\d+%$/.test(t)) { cell.value = parseFloat(t.replace(/,/g, '')) / 100; if (!cell.numFmt || cell.numFmt === 'General') cell.numFmt = '0%'; }
  else if (!isNaN(+t) && !/^0\d/.test(t)) cell.value = +t;
  else if (/^(true|false)$/i.test(t)) cell.value = t.toLowerCase() === 'true';
  else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { cell.value = new Date(t + 'T00:00:00Z'); if (!isDateFormat(cell.numFmt)) cell.numFmt = 'yyyy-mm-dd'; }
  else cell.value = input;
}

// ---------- number formats ----------
const isDateFormat = (f?: string) => !!f && /(^|[^\\"])(y{2,4}|d{1,4}|m{1,5}|h{1,2}|s{1,2})/i.test(f.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/^[#0.,%\s]*$/.test(f);
const locale = () => (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const serialToDate = (n: number) => new Date(EXCEL_EPOCH + n * 86400000);
const dateToSerial = (d: Date) => (d.getTime() - EXCEL_EPOCH) / 86400000;

function formatDate(d: Date, fmt: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const months = (style: 'short' | 'long') => new Intl.DateTimeFormat(locale(), { month: style, timeZone: 'UTC' }).format(d);
  const f = fmt.replace(/\[[^\]]*\]/g, '').replace(/\\(.)/g, '$1').replace(/"([^"]*)"/g, '$1');
  const toks = f.match(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|am\/pm|./gi) ?? [];
  return toks.map((t, i) => {
    const lt = t.toLowerCase();
    const minuteCtx = (lt === 'mm' || lt === 'm') && (/h/i.test(toks.slice(Math.max(0, i - 2), i).join('')) || /^s/i.test(toks.slice(i + 1, i + 3).join('').replace(/[^a-z]/gi, '')));
    switch (lt) {
      case 'yyyy': return String(d.getUTCFullYear());
      case 'yy': return pad(d.getUTCFullYear() % 100);
      case 'mmmm': return months('long');
      case 'mmm': return months('short');
      case 'mm': return minuteCtx ? pad(d.getUTCMinutes()) : pad(d.getUTCMonth() + 1);
      case 'm': return minuteCtx ? String(d.getUTCMinutes()) : String(d.getUTCMonth() + 1);
      case 'dddd': return new Intl.DateTimeFormat(locale(), { weekday: 'long', timeZone: 'UTC' }).format(d);
      case 'ddd': return new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(d);
      case 'dd': return pad(d.getUTCDate());
      case 'd': return String(d.getUTCDate());
      case 'hh': return pad(/am\/pm/i.test(f) ? ((d.getUTCHours() + 11) % 12) + 1 : d.getUTCHours());
      case 'h': return String(/am\/pm/i.test(f) ? ((d.getUTCHours() + 11) % 12) + 1 : d.getUTCHours());
      case 'ss': return pad(d.getUTCSeconds());
      case 's': return String(d.getUTCSeconds());
      case 'am/pm': return d.getUTCHours() < 12 ? 'AM' : 'PM';
      default: return t;
    }
  }).join('');
}

/** Format a value with an Excel number format (common subset: grouping, decimals, %, currency, dates). */
export function formatValue(v: unknown, fmt?: string): string {
  if (v instanceof Date) return formatDate(v, isDateFormat(fmt) ? fmt! : 'yyyy-mm-dd');
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') return v == null ? '' : String(v);
  if (!fmt || fmt === 'General' || fmt === '@') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(12));
  if (isDateFormat(fmt)) return formatDate(serialToDate(v), fmt);
  const sections = fmt.split(';');
  let f = v < 0 && sections[1] ? sections[1] : sections[0];
  const neg = v < 0 && !sections[1];
  f = f.replace(/\[\$([^-\]]*)[^\]]*\]/g, '"$1"').replace(/\[[^\]]*\]/g, '').replace(/_./g, '').replace(/\*./g, '');
  const core = f.replace(/"[^"]*"/g, (m) => ' '.repeat(m.length)).match(/[#0?][#0?,]*(\.[#0?]+)?%?|\.[#0?]+%?/);
  if (!core) return String(v);
  const pct = core[0].endsWith('%') || f.includes('%');
  const decimals = (core[0].split('.')[1] ?? '').replace('%', '').length;
  const group = core[0].split('.')[0].includes(',');
  const n = Math.abs(v) * (pct ? 100 : 1);
  const body = new Intl.NumberFormat(locale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: group }).format(n) + (pct ? '%' : '');
  const at = f.indexOf(core[0].replace(/%$/, ''));
  const strip = (s: string) => s.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1').replace(/[()]/g, (p) => (sections[1] && v < 0 ? p : ''));
  const prefix = strip(f.slice(0, Math.max(0, at))), suffix = strip(f.slice(at + core[0].length)).replace('%', '');
  return (neg ? '-' : '') + prefix + body + suffix;
}

// ---------- formula engine (safe recursive-descent parser; no eval) ----------
type Err = { err: string };
type Val = number | string | boolean | null | Err | Val[];
const isErr = (v: unknown): v is Err => typeof v === 'object' && v !== null && !Array.isArray(v) && 'err' in v;
const E = (err: string): Err => ({ err });

type Tok = { t: 'num' | 'str' | 'ref' | 'fn' | 'op' | 'bool' | 'err'; v: string; sheet?: string; r1?: number; c1?: number; r2?: number; c2?: number };
function tokenize(src: string): Tok[] | Err {
  const out: Tok[] = [];
  let i = 0;
  const ref = /^(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))?(!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?/;
  while (i < src.length) {
    const rest = src.slice(i);
    if (/^\s/.test(rest)) { i++; continue; }
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/))) { out.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
    if ((m = rest.match(/^"((?:[^"]|"")*)"/))) { out.push({ t: 'str', v: m[1].replace(/""/g, '"') }); i += m[0].length; continue; }
    if ((m = rest.match(/^#(N\/A|NAME\?|REF!|VALUE!|DIV\/0!|NUM!|NULL!)/))) { out.push({ t: 'err', v: m[0] }); i += m[0].length; continue; }
    m = rest.match(ref);
    if (m && (m[3] || !(m[1] || m[2])) && !/^[\w(]/.test(rest.slice(m[0].length))) {
      const sheet = m[1]?.replace(/''/g, "'") ?? m[2];
      out.push({ t: 'ref', v: m[0], sheet: m[3] ? sheet : undefined, c1: colNum(m[4]), r1: +m[5], c2: m[6] ? colNum(m[6]) : undefined, r2: m[7] ? +m[7] : undefined });
      i += m[0].length; continue;
    }
    if ((m = rest.match(/^[A-Za-z_][\w.]*/))) {
      const after = rest.slice(m[0].length).trimStart();
      if (after.startsWith('(')) out.push({ t: 'fn', v: m[0].toUpperCase().replace(/^_XLFN\./, '') });
      else if (/^(TRUE|FALSE)$/i.test(m[0])) out.push({ t: 'bool', v: m[0].toUpperCase() });
      else return E('#NAME?');
      i += m[0].length; continue;
    }
    if ((m = rest.match(/^(<>|<=|>=|[-+*/^&%=<>(),;:])/))) { out.push({ t: 'op', v: m[0] === ';' ? ',' : m[0] }); i += m[0].length; continue; }
    return E('#NAME?');
  }
  return out;
}

const num = (v: Val): number | Err => {
  if (isErr(v)) return v;
  if (Array.isArray(v)) return v.length ? num(v[0]) : 0;
  if (v === null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return isNaN(n) ? E('#VALUE!') : n;
};
const str = (v: Val): string => (Array.isArray(v) ? str(v[0] ?? '') : v === null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : isErr(v) ? v.err : String(v));
const flatV = (a: Val[]): Val[] => a.flatMap((x) => (Array.isArray(x) ? flatV(x) : [x]));
const numsOf = (a: Val[], strict = false) => flatV(a).filter((x) => typeof x === 'number' || (!strict && typeof x === 'boolean')).map((x) => +x!);

function criteria(crit: Val): (v: Val) => boolean {
  const c = str(crit), m = c.match(/^(<>|<=|>=|=|<|>)?(.*)$/)!;
  const op = m[1] ?? '=', rhs = m[2], rn = Number(rhs), numeric = rhs !== '' && !isNaN(rn);
  const re = new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  return (v) => {
    if (numeric && typeof v === 'number') return op === '=' ? v === rn : op === '<>' ? v !== rn : op === '<' ? v < rn : op === '>' ? v > rn : op === '<=' ? v <= rn : v >= rn;
    const s = str(v);
    return op === '<>' ? !re.test(s) : op === '=' ? re.test(s) : false;
  };
}

const FUNCS: Record<string, (args: Val[]) => Val> = {
  SUM: (a) => numsOf(a).reduce((s, x) => s + x, 0),
  AVERAGE: (a) => { const n = numsOf(a); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : E('#DIV/0!'); },
  MIN: (a) => { const n = numsOf(a); return n.length ? Math.min(...n) : 0; },
  MAX: (a) => { const n = numsOf(a); return n.length ? Math.max(...n) : 0; },
  PRODUCT: (a) => numsOf(a).reduce((s, x) => s * x, 1),
  COUNT: (a) => flatV(a).filter((x) => typeof x === 'number').length,
  COUNTA: (a) => flatV(a).filter((x) => x !== '' && x !== null).length,
  COUNTBLANK: (a) => flatV(a).filter((x) => x === '' || x === null).length,
  ROUND: ([x, d]) => {
    const n = num(x), k = num(d ?? 0); if (isErr(n)) return n; if (isErr(k)) return k;
    const digits = Math.trunc(k), magnitude = Math.abs(n);
    if (!Number.isFinite(n) || !Number.isFinite(k)) return E('#NUM!');
    if (digits > 308) return n; if (digits < -308) return 0;
    // Shift the decimal exponent as a string, avoiding 1.005 * 100 === 100.499999… .
    const shift = (v: number, places: number) => { const [m, e = '0'] = String(v).split('e'); return Number(`${m}e${+e + places}`); };
    const shifted = shift(magnitude, digits);
    if (!Number.isFinite(shifted)) return n;
    return Math.sign(n) * shift(Math.round(shifted), -digits);
  },
  ROUNDUP: ([x, d]) => { const n = num(x), k = num(d ?? 0); if (isErr(n) || isErr(k)) return E('#VALUE!'); const f = 10 ** k; return Math.sign(n) * Math.ceil(Math.abs(n) * f) / f; },
  ROUNDDOWN: ([x, d]) => { const n = num(x), k = num(d ?? 0); if (isErr(n) || isErr(k)) return E('#VALUE!'); const f = 10 ** k; return Math.sign(n) * Math.floor(Math.abs(n) * f) / f; },
  INT: ([x]) => { const n = num(x); return isErr(n) ? n : Math.floor(n); },
  ABS: ([x]) => { const n = num(x); return isErr(n) ? n : Math.abs(n); },
  SQRT: ([x]) => { const n = num(x); return isErr(n) ? n : n < 0 ? E('#NUM!') : Math.sqrt(n); },
  POWER: ([x, y]) => { const a = num(x), b = num(y); return isErr(a) ? a : isErr(b) ? b : a ** b; },
  MOD: ([x, y]) => { const a = num(x), b = num(y); if (isErr(a)) return a; if (isErr(b)) return b; return b === 0 ? E('#DIV/0!') : a - b * Math.floor(a / b); },
  IF: ([c, a, b]) => (isErr(c) ? c : (num(c) as number) ? (a ?? true) : (b ?? false)),
  IFERROR: ([v, alt]) => (isErr(v) ? alt : v),
  AND: (a) => flatV(a).every((x) => !!num(x)),
  OR: (a) => flatV(a).some((x) => !!num(x)),
  NOT: ([x]) => !num(x),
  CONCAT: (a) => flatV(a).map(str).join(''), CONCATENATE: (a) => flatV(a).map(str).join(''),
  TEXTJOIN: ([d, skip, ...a]) => flatV(a).map(str).filter((s) => !(num(skip) && s === '')).join(str(d)),
  LEN: ([s]) => str(s).length, UPPER: ([s]) => str(s).toUpperCase(), LOWER: ([s]) => str(s).toLowerCase(), TRIM: ([s]) => str(s).trim().replace(/\s+/g, ' '),
  LEFT: ([s, n]) => str(s).slice(0, n === undefined ? 1 : +num(n)), RIGHT: ([s, n]) => { const k = n === undefined ? 1 : +num(n); return k ? str(s).slice(-k) : ''; },
  MID: ([s, a, n]) => str(s).substr(+num(a) - 1, +num(n)),
  TODAY: () => Math.floor(dateToSerial(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())))),
  NOW: () => dateToSerial(new Date()),
  SUMIF: ([range, crit, sumRange]) => { const r = flatV([range]), s = sumRange ? flatV([sumRange]) : r, ok = criteria(crit); return r.reduce<number>((acc, v, i) => acc + (ok(v) && typeof s[i] === 'number' ? (s[i] as number) : 0), 0); },
  COUNTIF: ([range, crit]) => { const ok = criteria(crit); return flatV([range]).filter(ok).length; },
  AVERAGEIF: ([range, crit, avgRange]) => { const r = flatV([range]), s = avgRange ? flatV([avgRange]) : r, ok = criteria(crit); const n = r.map((v, i) => (ok(v) && typeof s[i] === 'number' ? (s[i] as number) : null)).filter((x): x is number => x !== null); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : E('#DIV/0!'); },
};
// Ranges are passed to lookup functions as 2-D arrays (rows of values).
const RANGE_FUNCS: Record<string, (args: Val[]) => Val> = {
  VLOOKUP: ([key, table, col, approx]) => {
    const rows = table as Val[][], ci = +num(col) - 1, exact = approx !== undefined && !num(approx);
    if (!Array.isArray(rows)) return E('#REF!');
    if (exact || approx === undefined) {
      const hit = rows.find((r) => (typeof key === 'number' ? r[0] === key : str(r[0]).toLowerCase() === str(key).toLowerCase()));
      if (hit || exact) return hit ? hit[ci] ?? E('#REF!') : E('#N/A');
    }
    let best: Val[] | undefined; for (const r of rows) { if ((num(r[0]) as number) <= (num(key) as number)) best = r; else break; }
    return best ? best[ci] ?? E('#REF!') : E('#N/A');
  },
  INDEX: ([table, r, c]) => { const rows = table as Val[][]; const row = rows[+num(r) - 1]; return row ? row[(c === undefined ? 1 : +num(c)) - 1] ?? E('#REF!') : E('#REF!'); },
  MATCH: ([key, range]) => { const i = flatV([range]).findIndex((v) => str(v).toLowerCase() === str(key).toLowerCase()); return i < 0 ? E('#N/A') : i + 1; },
};

/** Evaluate a formula (without the leading "="). Returns a value or { err }. */
export function evaluate(ws: Worksheet, formula: string, seen = new Set<string>()): Val {
  const toks = tokenize(formula);
  if (isErr(toks)) return toks;
  let p = 0;
  const peekT = () => toks[p], eat = (v?: string) => { const t = toks[p]; if (v && (!t || t.v !== v)) throw E('#VALUE!'); p++; return t; };
  const wb = ws.workbook;

  const cellValue = (sheet: Worksheet, r: number, c: number): Val => {
    const key = `${sheet.name}!${r}:${c}`;
    if (seen.has(key)) return E('#CIRC!');
    const cell = peek(sheet, r, c);
    const v = cell?.value;
    if (v == null) return null;
    if (typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) {
      const inner = evaluate(sheet, cell!.formula ?? '', new Set([...seen, key]));
      // Dependencies use live results only. A cached value cannot establish the correctness of a calculation.
      return inner;
    }
    if (v instanceof Date) return dateToSerial(v);
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'object' && 'result' in v) return (v as { result: Val }).result;
    if (typeof v === 'object' && 'error' in v) return E(String((v as { error: string }).error));
    return displayValueOf(v);
  };

  const refValue = (t: Tok, asTable = false): Val => {
    const sheet = t.sheet ? wb.worksheets.find((w) => w.name.toLowerCase() === t.sheet!.toLowerCase()) : ws;
    if (!sheet) return E('#REF!');
    if (t.c2 === undefined) return cellValue(sheet, t.r1!, t.c1!);
    const rows: Val[][] = [];
    for (let r = Math.min(t.r1!, t.r2!); r <= Math.max(t.r1!, t.r2!); r++) {
      const row: Val[] = [];
      for (let c = Math.min(t.c1!, t.c2!); c <= Math.max(t.c1!, t.c2!); c++) row.push(cellValue(sheet, r, c));
      rows.push(row);
    }
    return asTable ? rows : rows.flat();
  };

  const primary = (asTable = false): Val => {
    const t = eat();
    if (!t) throw E('#VALUE!');
    if (t.t === 'num') return parseFloat(t.v);
    if (t.t === 'str') return t.v;
    if (t.t === 'bool') return t.v === 'TRUE';
    if (t.t === 'err') return E(t.v);
    if (t.t === 'ref') return refValue(t, asTable);
    if (t.t === 'fn') {
      eat('(');
      const isRange = !!RANGE_FUNCS[t.v];
      const args: Val[] = [];
      if (peekT()?.v !== ')') { do { args.push(compare(isRange)); } while (peekT()?.v === ',' && eat()); }
      eat(')');
      const fn = RANGE_FUNCS[t.v] ?? FUNCS[t.v];
      if (!fn) return E('#NAME?');
      if (!['IFERROR', 'IF', 'ISERROR'].includes(t.v)) { const e = flatV(args).find(isErr); if (e) return e; }
      return fn(args);
    }
    if (t.v === '(') { const v = compare(); eat(')'); return v; }
    if (t.v === '-') { const v = num(postfix()); return isErr(v) ? v : -v; }
    if (t.v === '+') return postfix();
    throw E('#VALUE!');
  };
  const postfix = (asTable = false): Val => { let v = primary(asTable); while (peekT()?.v === '%') { eat(); const n = num(v); v = isErr(n) ? n : n / 100; } return v; };
  const power = (asTable = false): Val => { let a = postfix(asTable); while (peekT()?.v === '^') { eat(); const b = num(postfix()), x = num(a); a = isErr(x) ? x : isErr(b) ? b : x ** b; } return a; };
  const mul = (asTable = false): Val => {
    let a = power(asTable);
    while (peekT()?.v === '*' || peekT()?.v === '/') {
      const op = eat().v, x = num(a), y = num(power());
      a = isErr(x) ? x : isErr(y) ? y : op === '*' ? x * y : y === 0 ? E('#DIV/0!') : x / y;
    }
    return a;
  };
  const add = (asTable = false): Val => {
    let a = mul(asTable);
    while (peekT()?.v === '+' || peekT()?.v === '-') { const op = eat().v, x = num(a), y = num(mul()); a = isErr(x) ? x : isErr(y) ? y : op === '+' ? x + y : x - y; }
    return a;
  };
  const concat = (asTable = false): Val => {
    let a = add(asTable);
    while (peekT()?.v === '&') { eat(); const b = add(); a = isErr(a) ? a : isErr(b) ? b : str(a) + str(b); }
    return a;
  };
  const compare = (asTable = false): Val => {
    let a = concat(asTable);
    while (['=', '<>', '<', '>', '<=', '>='].includes(peekT()?.v ?? '')) {
      const op = eat().v, b = concat();
      if (isErr(a)) return a; if (isErr(b)) return b;
      const both = typeof a === 'number' && typeof b === 'number';
      const x = both ? (a as number) : str(a).toLowerCase(), y = both ? (b as number) : str(b).toLowerCase();
      a = op === '=' ? x === y : op === '<>' ? x !== y : op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
    }
    return a;
  };
  try {
    const v = compare();
    if (p < toks.length) return E('#VALUE!');
    return Array.isArray(v) ? (v.length === 1 ? v[0] : E('#VALUE!')) : v;
  } catch (e) {
    return isErr(e) ? e : E('#VALUE!');
  }
}
