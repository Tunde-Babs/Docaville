import type { Workbook, Worksheet } from './sheet';
import { colName } from './sheet';

type Address = { col: string; row: number; colAbs: string; rowAbs: string };
const address = (s: string): Address => {
  const m = /^(\$?)([A-Z]+)(\$?)(\d+)$/i.exec(s)!;
  return { colAbs: m[1], col: m[2], rowAbs: m[3], row: +m[4] };
};
const column = (s: string) => [...s.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const render = (a: Address) => `${a.colAbs}${a.col}${a.rowAbs}${a.row}`;
const unquote = (s: string) => s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s;
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Transform A1 references without touching strings, function names or parts of named ranges. */
function references(formula: string, fn: (sheet: string | undefined, first: string, last?: string) => string): string {
  const tokens = /"(?:[^"]|"")*"|(?<![\w.\]!])(?:(('(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_.]*)!))?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?(?![\w.(])/giu;
  return formula.replace(tokens, (all, _prefix: string | undefined, sheet: string | undefined, first: string | undefined, last: string | undefined) => {
    if (!first) return all; // Excel double-quoted string literal
    if ([first, ...(last ? [last] : [])].some(s => { const a = address(s); return a.row < 1 || a.row > 1048576 || column(a.col) > 16384; })) return all;
    return fn(sheet, first, last);
  });
}

function rewrite(wb: Workbook, fn: (formula: string, ws: Worksheet) => string) {
  // Materialize shared formulas before moving any cells (their relative master may move too).
  const formulas: { cell: ReturnType<Worksheet['getCell']>; formula: string }[] = [];
  for (const ws of wb.worksheets) ws.eachRow(row => row.eachCell(cell => {
    const v = cell.value;
    if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) formulas.push({ cell, formula: fn(cell.formula ?? '', ws) });
  }));
  for (const { cell, formula } of formulas) cell.value = { formula }; // discard stale caches after a structural edit
}

export function nextSheetName(wb: Workbook): string {
  const names = new Set(wb.worksheets.map(ws => ws.name.toLowerCase()));
  let n = 1; while (names.has(`sheet${n}`)) n++;
  return `Sheet${n}`;
}

export function renameWorksheet(ws: Worksheet, newName: string) {
  const old = ws.name;
  // Let ExcelJS validate BEFORE changing other cells.
  ws.name = newName;
  rewrite(ws.workbook, f => references(f, (sheet, a, b) => {
    const prefix = sheet && unquote(sheet).toLowerCase() === old.toLowerCase() ? `${quote(newName)}!` : sheet ? `${sheet}!` : '';
    return prefix + a + (b ? ':' + b : '');
  }));
}

/** Insert/delete rows or columns and update workbook-wide absolute, mixed and range references. */
export function spliceWorksheet(ws: Worksheet, axis: 'row' | 'column', start: number, remove: number, insert = 0) {
  if (start < 1 || remove < 0 || insert < 0 || !Number.isInteger(start)) throw new Error('Invalid sheet edit');
  const delta = insert - remove, end = start + remove;
  const coordinate = (n: number) => n < start ? n : n >= end ? n + delta : null;
  rewrite(ws.workbook, (f, owner) => references(f, (sheet, a, b) => {
    const prefix = sheet ? `${sheet}!` : '';
    const target = sheet ? unquote(sheet).toLowerCase() === ws.name.toLowerCase() : owner.id === ws.id;
    if (!target) return prefix + a + (b ? ':' + b : '');
    const first = address(a), last = b ? address(b) : null;
    const get = (v: Address) => axis === 'row' ? v.row : column(v.col);
    const put = (v: Address, n: number) => { if (axis === 'row') v.row = n; else v.col = colName(n); };
    if (!last) {
      const n = coordinate(get(first));
      if (n === null || n < 1) return '#REF!';
      put(first, n); return prefix + render(first);
    }
    const x = get(first), y = get(last), lo = Math.min(x, y), hi = Math.max(x, y);
    // A partially deleted range shrinks to its surviving cells. An entirely deleted range is invalid.
    const lowSurvivor = lo >= start && lo < end ? end : lo;
    const highSurvivor = hi >= start && hi < end ? start - 1 : hi;
    if (lowSurvivor > highSurvivor) return '#REF!';
    const low = coordinate(lowSurvivor)!, high = coordinate(highSurvivor)!;
    put(first, x <= y ? low : high); put(last, x <= y ? high : low);
    return prefix + render(first) + ':' + render(last);
  }));
  // ExcelJS doesn't move merges reliably through splice; restore them with the same coordinate rules.
  const ranges = [...ws.model.merges ?? []];
  ranges.forEach(r => ws.unMergeCells(r));
  if (axis === 'row') ws.spliceRows(start, remove, ...Array.from({ length: insert }, () => []));
  else ws.spliceColumns(start, remove, ...Array.from({ length: insert }, () => []));
  for (const range of ranges) {
    const [a, b = a] = range.split(':'), first = address(a), last = address(b);
    const get = (v: Address) => axis === 'row' ? v.row : column(v.col);
    let lo = get(first), hi = get(last);
    if (lo >= start && lo < end) lo = end;
    if (hi >= start && hi < end) hi = start - 1;
    if (lo > hi) continue;
    lo = coordinate(lo)!; hi = coordinate(hi)!;
    if (axis === 'row') { first.row = lo; last.row = hi; } else { first.col = colName(lo); last.col = colName(hi); }
    if (render(first) !== render(last)) ws.mergeCells(`${render(first)}:${render(last)}`);
  }
}
