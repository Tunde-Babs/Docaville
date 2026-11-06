import { useEffect, useMemo, useRef, useState } from 'react';
import { loadWorkbook, saveXlsx, workbookExtension, toCsv, toHtmlTable, colName, rawInput, setInput, displayValue, peek, merges, type Workbook, type Worksheet } from '../engines/sheet';
import { sheetToPdf } from '../engines/layoutPdf';
import { nextSheetName, renameWorksheet, spliceWorksheet } from '../engines/sheetStructure';
import { saveFile, baseName } from '../lib/fileio';
import { Btn, Menu, Toolbar, Sep, run } from '../components/ui';
import { ColorPicker } from '../components/ColorPicker';
import { useSave, loadOrFail, type EditorProps } from '../components/useSave';

const PAGE_ROWS = 200;
const MAX_UNDO = 60;
type Snap = { sheet: number; model: Workbook['model'] };

export default function SheetEditor({ file, onChange, onFail }: EditorProps) {
  const [wb, setWb] = useState<Workbook | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [cur, setCur] = useState({ r: 1, c: 1 });
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [rowLimit, setRowLimit] = useState(PAGE_ROWS);
  const [ver, setVer] = useState(0); // bump to re-render after in-place mutations
  const undoStack = useRef<Snap[]>([]), redoStack = useRef<Snap[]>([]);
  const bump = () => setVer((v) => v + 1);
  const prepareRef = useRef<() => void>(() => {});

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadOrFail('Opening workbook…', async () => {
    const book = await loadWorkbook(file.bytes, file.name);
    if (!file.bytes && file.template) (await import('../lib/templates')).sheetTemplate(book, file.template);
    setWb(book);
    const draft = (file.recoveryState as { sheetDraft?: { sheetIdx: number; cur: { r: number; c: number }; editing: string | null; renaming: string | null } } | undefined)?.sheetDraft;
    if (draft) { setSheetIdx(draft.sheetIdx); setCur(draft.cur); setEditing(draft.editing); setRenaming(draft.renaming); }
  }, onFail); }, [file.id]);
  // .csv/.tsv opened → Save writes .xlsx via Save As (never overwrites a CSV with a workbook)
  const { root, save, print, markDirty } = useSave(file, onChange, () => workbookExtension(wb), async () => saveXlsx(wb!), () => sheetToPdf(wb!.worksheets[sheetIdx]), () => prepareRef.current(), async () => {
    if (!wb) throw new Error('Workbook is still opening');
    return { bytes: await saveXlsx(wb), state: { sheetDraft: { sheetIdx, cur, editing, renaming } } };
  });

  const ws = wb?.worksheets[sheetIdx];
  const rows = Math.max((ws?.rowCount ?? 0) + 20, 40);
  const cols = Math.max((ws?.columnCount ?? 0) + 5, 12);

  // Merged ranges: anchor cell gets row/colSpan, covered cells are skipped.
  const mergeMap = useMemo(() => {
    const anchor = new Map<string, { rs: number; cs: number }>(), covered = new Set<string>();
    if (ws) for (const m of merges(ws)) {
      anchor.set(`${m.top}:${m.left}`, { rs: m.bottom - m.top + 1, cs: m.right - m.left + 1 });
      for (let r = m.top; r <= m.bottom; r++) for (let c = m.left; c <= m.right; c++) if (r !== m.top || c !== m.left) covered.add(`${r}:${c}`);
    }
    return { anchor, covered };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, ver]);

  const grid = useMemo(() => {
    if (!ws) return [];
    const out: { v: string; style: React.CSSProperties }[][] = [];
    for (let r = 1; r <= Math.min(rows, rowLimit); r++) {
      const row = [];
      for (let c = 1; c <= cols; c++) {
        const cell = peek(ws, r, c); // non-creating lookup: rendering must not grow the sheet
        if (!cell) { row.push({ v: '', style: {} }); continue; }
        const fill = (cell.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
        const v = cell.value as unknown;
        const num = typeof v === 'number' || v instanceof Date || (typeof v === 'object' && v !== null && 'formula' in v);
        row.push({
          v: displayValue(ws, cell),
          style: {
            fontWeight: cell.font?.bold ? 700 : undefined, fontStyle: cell.font?.italic ? 'italic' : undefined,
            fontSize: cell.font?.size && cell.font.size !== 11 ? `${cell.font.size}pt` : undefined,
            color: cell.font?.color?.argb ? '#' + cell.font.color.argb.slice(2) : undefined,
            background: fill && fill.length === 8 ? '#' + fill.slice(2) : undefined,
            textAlign: (cell.alignment?.horizontal as React.CSSProperties['textAlign']) ?? (num ? 'right' : 'left'),
          },
        });
      }
      out.push(row);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, rows, cols, rowLimit, ver]);

  if (!wb || !ws) return null;
  const name = baseName(file.name);
  const cell = peek(ws, cur.r, cur.c);
  const addr = colName(cur.c) + cur.r;

  // Every change goes through edit(): undo snapshot → mutate → re-render → mark unsaved.
  const snapshot = (): Snap => ({ sheet: sheetIdx, model: structuredClone(wb.model) });
  const edit = (fn: (w: Worksheet) => void) => {
    undoStack.current.push(snapshot());
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
    fn(ws); bump(); markDirty();
  };
  const restore = (from: React.MutableRefObject<Snap[]>, to: React.MutableRefObject<Snap[]>) => {
    const s = from.current.pop(); if (!s) return;
    to.current.push(snapshot());
    wb.model = structuredClone(s.model);
    setSheetIdx(s.sheet); setEditing(null); bump(); markDirty();
  };
  const undo = () => restore(undoStack, redoStack), redo = () => restore(redoStack, undoStack);

  const commit = (value: string) => {
    setEditing(null);
    if (value === rawInput(peek(ws, cur.r, cur.c))) return; // unchanged — not an edit
    edit((w) => setInput(w.getCell(cur.r, cur.c), value));
  };
  prepareRef.current = () => { if (editing !== null) commit(editing); };
  const changeInput = (value: string) => { setEditing(value); markDirty(); };
  const exportCurrent = (job: () => unknown) => { prepareRef.current(); return job(); };
  const move = (dr: number, dc: number) => setCur((p) => ({ r: Math.max(1, p.r + dr), c: Math.max(1, p.c + dc) }));
  const styleCell = (fn: (c: ReturnType<Worksheet['getCell']>) => void) => edit((w) => fn(w.getCell(cur.r, cur.c)));
  const argb = (hex: string) => 'FF' + hex.slice(1).toUpperCase();
  /** Font and fill colours used anywhere in the workbook (explicit RGB colours only). */
  const usedColours = (kind: 'font' | 'fill') => () => {
    const out: string[] = [];
    for (const w of wb.worksheets) w.eachRow((row) => row.eachCell((c) => {
      const font = c.font?.color?.argb, fill = (c.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
      const [a, b] = kind === 'font' ? [font, fill] : [fill, font];
      if (a) out.unshift(a); if (b) out.push(b);
    }));
    return out;
  };
  const cellFill = (cell?.fill as { pattern?: string; fgColor?: { argb?: string } } | undefined);

  const onKey = (e: React.KeyboardEvent) => {
    if (editing !== null) {
      if (e.key === 'Enter') { commit(editing); move(1, 0); e.preventDefault(); }
      else if (e.key === 'Tab') { commit(editing); move(0, e.shiftKey ? -1 : 1); e.preventDefault(); }
      else if (e.key === 'Escape') setEditing(null);
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    const nav: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0], Tab: [0, 1] };
    if (nav[e.key]) { move(...nav[e.key]); e.preventDefault(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (cell?.value != null) commit(''); }
    else if (e.key === 'F2') setEditing(rawInput(cell));
    else if (e.key.length === 1 && !mod) { changeInput(e.key); e.preventDefault(); }
  };

  // ---- sheet tabs ----
  const sheets = wb.worksheets;
  const renameSheet = (newName: string) => {
    setRenaming(null);
    const n = newName.trim().replace(/[\\/?*[\]:]/g, '').slice(0, 31);
    if (!n || n === ws.name) return;
    if (sheets.some((s) => s !== ws && s.name.toLowerCase() === n.toLowerCase())) { alert(`A sheet named "${n}" already exists.`); return; }
    edit(w => renameWorksheet(w, n));
  };
  const moveSheet = (d: number) => {
    const j = sheetIdx + d; if (j < 0 || j >= sheets.length) return;
    const a = sheets[sheetIdx] as Worksheet & { orderNo: number }, b = sheets[j] as Worksheet & { orderNo: number };
    edit(() => { [a.orderNo, b.orderNo] = [b.orderNo, a.orderNo]; });
    setSheetIdx(j);
  };
  const deleteSheet = () => {
    if (sheets.length < 2) return;
    if (!confirm(`Delete sheet "${ws.name}"? You can restore it with Undo.`)) return;
    edit(() => wb.removeWorksheet(ws.id));
    setSheetIdx(Math.max(0, sheetIdx - 1));
  };

  return (
    <div className="editor" ref={root}>
      <Toolbar>
        <Btn primary onClick={() => save()} title="Save (Ctrl/Cmd+S)">💾 Save</Btn>
        <Btn onClick={print} title="Print (Ctrl/Cmd+P)">🖨 Print</Btn>
        <Menu label="Export" options={[
          { label: 'Save As…', hint: 'Ctrl/Cmd+Shift+S', action: () => save(true) },
          { label: `Excel .${workbookExtension(wb)}`, hint: 'Workbook with formatting', action: () => exportCurrent(() => run('Saving…', async () => saveFile(`${name}.${workbookExtension(wb)}`, await saveXlsx(wb)))) },
          { label: 'PDF (vector)', hint: 'Current sheet, auto-paginated', action: () => exportCurrent(() => run('Creating PDF…', async () => saveFile(`${name}-${ws.name}.pdf`, await sheetToPdf(ws)))) },
          { label: 'CSV (current sheet)', hint: 'Underlying values, full precision', action: () => exportCurrent(() => saveFile(`${name}-${ws.name}.csv`, '﻿' + toCsv(ws))) },
          { label: 'Web page .html', action: () => exportCurrent(() => saveFile(`${name}.html`, `<!doctype html><meta charset="utf-8"><style>td{border:1px solid #ccc;padding:4px}</style>${toHtmlTable(ws)}`)) },
        ]} />
        <Sep />
        <Btn onClick={undo} disabled={!undoStack.current.length} title="Undo (Ctrl/Cmd+Z)">↶</Btn>
        <Btn onClick={redo} disabled={!redoStack.current.length} title="Redo (Ctrl/Cmd+Shift+Z)">↷</Btn>
        <Sep />
        <Btn active={!!cell?.font?.bold} onClick={() => styleCell((c) => { c.font = { ...c.font, bold: !c.font?.bold }; })}><b>B</b></Btn>
        <Btn active={!!cell?.font?.italic} onClick={() => styleCell((c) => { c.font = { ...c.font, italic: !c.font?.italic }; })}><i>I</i></Btn>
        <ColorPicker icon="▇" title="Fill colour" value={cellFill?.pattern === 'solid' ? cellFill.fgColor?.argb : undefined} used={usedColours('fill')}
          onChange={(h) => styleCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(h) } }; })}
          none={{ label: 'No fill', action: () => styleCell((c) => { c.fill = { type: 'pattern', pattern: 'none' }; }) }} />
        <ColorPicker icon="A" title="Font colour" value={cell?.font?.color?.argb} used={usedColours('font')}
          onChange={(h) => styleCell((c) => { c.font = { ...c.font, color: { argb: argb(h) } }; })}
          none={{ label: 'Automatic', action: () => styleCell((c) => { const f = { ...c.font }; delete f.color; c.font = f; }) }} />
        {(['left', 'center', 'right'] as const).map((h) => <Btn key={h} onClick={() => styleCell((c) => { c.alignment = { ...c.alignment, horizontal: h }; })}>{{ left: '⇤', center: '↔', right: '⇥' }[h]}</Btn>)}
        <Menu label="123" options={[
          { label: 'General', action: () => styleCell((c) => { c.numFmt = 'General'; }) },
          { label: 'Number  1,234.50', action: () => styleCell((c) => { c.numFmt = '#,##0.00'; }) },
          { label: 'Currency  €1,234.50', action: () => styleCell((c) => { c.numFmt = '[$€-x-euro2] #,##0.00'; }) },
          { label: 'Currency  $1,234.50', action: () => styleCell((c) => { c.numFmt = '"$"#,##0.00'; }) },
          { label: 'Percent  12.5%', action: () => styleCell((c) => { c.numFmt = '0.0%'; }) },
          { label: 'Date  31.12.2026', action: () => styleCell((c) => { c.numFmt = 'dd.mm.yyyy'; }) },
          { label: 'Date  2026-12-31', action: () => styleCell((c) => { c.numFmt = 'yyyy-mm-dd'; }) },
        ]} />
        <Sep />
        <Btn onClick={() => edit((w) => spliceWorksheet(w, 'row', cur.r, 0, 1))}>+ Row</Btn>
        <Btn onClick={() => edit((w) => spliceWorksheet(w, 'row', cur.r, 1))}>− Row</Btn>
        <Btn onClick={() => edit((w) => spliceWorksheet(w, 'column', cur.c, 0, 1))}>+ Col</Btn>
        <Btn onClick={() => edit((w) => spliceWorksheet(w, 'column', cur.c, 1))}>− Col</Btn>
      </Toolbar>
      {workbookExtension(wb) === 'xlsm' && <div className="export-notice">Macros are preserved when saving as .xlsm. DocumentHub does not run macros.</div>}

      <div className="formula-bar">
        <span className="addr">{addr}</span>
        <span className="fx">ƒx</span>
        <input value={editing ?? rawInput(cell)} onFocus={() => editing === null && setEditing(rawInput(cell))}
          onChange={(e) => changeInput(e.target.value)} onKeyDown={onKey} placeholder="Value or =formula (SUM, IF, VLOOKUP, Sheet2!A1…)" />
      </div>

      <div className="sheet-scroll" tabIndex={0} onKeyDown={onKey}>
        <table className="sheet">
          <thead><tr><th />{Array.from({ length: cols }, (_, c) => <th key={c} style={{ width: (ws.getColumn(c + 1).width ?? 10) * 7.5 }}>{colName(c + 1)}</th>)}</tr></thead>
          <tbody>
            {grid.map((row, ri) => (
              <tr key={ri}>
                <th>{ri + 1}</th>
                {row.map((cl, ci) => {
                  const key = `${ri + 1}:${ci + 1}`;
                  if (mergeMap.covered.has(key)) return null;
                  const span = mergeMap.anchor.get(key);
                  const on = cur.r === ri + 1 && cur.c === ci + 1;
                  return (
                    <td key={ci} className={(on ? 'cur' : '') + (span ? ' merged' : '')} style={cl.style} colSpan={span?.cs} rowSpan={span?.rs}
                      onPointerDown={() => { if (editing !== null) commit(editing); setCur({ r: ri + 1, c: ci + 1 }); }}
                      onDoubleClick={() => setEditing(rawInput(peek(ws, ri + 1, ci + 1)))}>
                      {on && editing !== null
                        ? <input autoFocus className="cell-input" value={editing} onChange={(e) => changeInput(e.target.value)} onKeyDown={onKey} onBlur={() => commit(editing)} />
                        : cl.v}
                    </td>);
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows > rowLimit && <button className="btn more" onClick={() => setRowLimit((n) => n + PAGE_ROWS)}>Show more rows ({rows - rowLimit} hidden)</button>}
      </div>

      <div className="sheet-tabs">
        {sheets.map((s, i) => (i === sheetIdx && renaming !== null
          ? <input key={s.id} className="tab-rename" autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)}
              onBlur={() => renameSheet(renaming)} onKeyDown={(e) => { if (e.key === 'Enter') renameSheet(renaming); if (e.key === 'Escape') setRenaming(null); }} />
          : <button key={s.id} className={i === sheetIdx ? 'on' : ''} title="Double-click to rename"
              onClick={() => { prepareRef.current(); setSheetIdx(i); setCur({ r: 1, c: 1 }); }} onDoubleClick={() => { setSheetIdx(i); setRenaming(s.name); }}>{s.name}</button>))}
        <button onClick={() => { prepareRef.current(); edit(() => wb.addWorksheet(nextSheetName(wb))); setSheetIdx(wb.worksheets.length - 1); }} title="Add sheet">＋</button>
        <Menu label="⋯" options={[
          { label: 'Rename sheet', action: () => setRenaming(ws.name) },
          { label: 'Move left', action: () => moveSheet(-1) },
          { label: 'Move right', action: () => moveSheet(1) },
          ...(sheets.length > 1 ? [{ label: 'Delete sheet', action: deleteSheet }] : []),
        ]} />
      </div>
    </div>
  );
}
