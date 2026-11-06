import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadPdfJs, renderPage, savePdf, imagesToPdf, extractLines, pdfToText, pdfPageToCanvas, pdfjs,
  type PdfJsDoc, type PageRef, type Overlay, type FontFamily, type FormValues,
} from '../engines/pdf';
import { saveFile, baseName } from '../lib/fileio';
import { canvasToBytes, normalizeImage, sampleBackground, sampleInk, rgbToHex, decodeImage } from '../lib/image';
import { Btn, Menu, Toolbar, Sep, FilePick, run, setBusy, toast } from '../components/ui';
import { ColorPicker } from '../components/ColorPicker';
import { OCR_LANGS } from '../lib/langs';
import SignaturePad from '../components/SignaturePad';
import { useSave, loadOrFail, type EditorProps } from '../components/useSave';


type Tool = 'select' | 'edit' | 'text' | 'highlight' | 'whiteout' | 'place-image' | 'field-text' | 'field-check' | 'field-drop';
const FIELD_KIND = { 'field-text': 'text', 'field-check': 'checkbox', 'field-drop': 'dropdown' } as const;
interface Src { bytes: Uint8Array; js: PdfJsDoc }
type Viewport = ReturnType<pdfjs.PDFPageProxy['getViewport']>;

const FAMILY_CSS: Record<FontFamily, string> = { sans: 'Helvetica, Arial, sans-serif', serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };
const nid = () => crypto.randomUUID();
type PdfTextDraft = (({ i: number; overlayId?: never } | { overlayId: string; i?: never }) & { value: string }) | null;

export default function PdfEditor({ file, onChange, onFail }: EditorProps) {
  const dirtyHandler = useRef<() => void>(() => {});
  const touch = useCallback(() => dirtyHandler.current(), []);
  const [showPages, setShowPages] = useState(false);
  const [srcs, setSrcs] = useState<Src[]>([]);
  const [pages, setPages] = useState<PageRef[]>([]);
  const [overlays, setOverlayState] = useState<Overlay[]>([]);
  const overlaysRef = useRef<Overlay[]>([]);
  const setOverlays = useCallback((change: React.SetStateAction<Overlay[]>) => {
    const next = typeof change === 'function' ? change(overlaysRef.current) : change;
    overlaysRef.current = next; setOverlayState(next);
  }, []);
  const pendingEdits = useRef(new Map<string, { commit: () => void; read: () => { page: number; overlays: Overlay[] } }>());
  const registerPendingEdit = useCallback((id: string, commit: () => void, read: () => { page: number; overlays: Overlay[] }) => {
    pendingEdits.current.set(id, { commit, read });
    return () => { pendingEdits.current.delete(id); };
  }, []);
  const commitPending = () => { for (const entry of pendingEdits.current.values()) entry.commit(); };
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(1.25);
  const [sel, setSel] = useState<string | null>(null);
  const textHistoryId = useRef<string | null>(null);
  const [lang, setLang] = useState('auto');
  const [history, setHistory] = useState<{ pages: PageRef[]; overlays: Overlay[] }[]>([]);
  const [future, setFuture] = useState<{ pages: PageRef[]; overlays: Overlay[] }[]>([]);
  const [values, setValues] = useState<FormValues>({});
  const [signing, setSigning] = useState(false);
  const setValue = useCallback((key: string, v: string | boolean) => { setValues((cur) => ({ ...cur, [key]: v })); touch(); }, [touch]);
  const pendingImage = useRef<{ bytes: Uint8Array; mime: string; w: number; h: number } | null>(null);

  useEffect(() => {
    loadOrFail('Opening PDF…', async () => {
      if (file.recoveryState) {
        const draft = file.recoveryState as { pdfSources: Uint8Array[]; pages: PageRef[]; overlays: Overlay[]; values: FormValues };
        if (!draft.pdfSources?.length || !draft.pages?.length) throw new Error('Invalid PDF recovery data');
        setSrcs(await Promise.all(draft.pdfSources.map(async bytes => ({ bytes, js: await loadPdfJs(bytes) }))));
        setPages(draft.pages); setOverlays(draft.overlays); setValues(draft.values); return;
      }
      const js = await loadPdfJs(file.bytes!);
      setSrcs([{ bytes: file.bytes!, js }]);
      setPages(Array.from({ length: js.numPages }, (_, i) => ({ src: 0, index: i, rotation: 0 })));
    }, onFail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const snapshot = useCallback(() => { setHistory((h) => [...h.slice(-49), { pages, overlays }]); setFuture([]); touch(); }, [pages, overlays, touch]);
  const undo = () => { const last = history[history.length - 1]; if (!last) return; setFuture(f => [...f, { pages, overlays }]); setPages(last.pages); setOverlays(last.overlays); setHistory((h) => h.slice(0, -1)); touch(); };
  const redo = () => { const next = future[future.length - 1]; if (!next) return; setHistory(h => [...h, { pages, overlays }]); setPages(next.pages); setOverlays(next.overlays); setFuture(f => f.slice(0, -1)); touch(); };
  const add = (...o: Overlay[]) => { snapshot(); setOverlays((cur) => [...cur, ...o]); };
  const update = (id: string, patch: Partial<Overlay>) => { setOverlays((cur) => cur.map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o))); touch(); };
  const usedColours = () => overlays.map((o) => ('color' in o ? (o as { color?: string }).color : undefined));
  const remove = (id: string) => { snapshot(); setOverlays((cur) => cur.filter((o) => o.id !== id)); setSel(null); };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!root.current?.offsetParent) return;
      if ((e.target as HTMLElement).closest('input,textarea,[contenteditable]')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) remove(sel);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // ---------- page operations ----------
  const pageOp = (fn: (p: PageRef[]) => PageRef[], remap: (page: number) => number | null) => {
    snapshot();
    setPages(fn);
    setOverlays((cur) => cur.flatMap((o) => { const p = remap(o.page); return p === null ? [] : [{ ...o, page: p }]; }));
  };
  const rotate = (i: number, d: number) => { snapshot(); setPages((p) => p.map((r, j) => (j === i ? { ...r, rotation: (r.rotation + d + 360) % 360 } : r))); };
  const del = (i: number) => pages.length > 1 && pageOp((p) => p.filter((_, j) => j !== i), (pg) => (pg === i ? null : pg > i ? pg - 1 : pg));
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= pages.length) return;
    pageOp((p) => { const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n; }, (pg) => (pg === i ? j : pg === j ? i : pg));
  };
  async function insertFiles(files: File[]) {
    await run('Inserting pages…', async () => {
      const added: Src[] = [];
      for (const f of files) {
        let bytes: Uint8Array = new Uint8Array(await f.arrayBuffer());
        if (!/\.pdf$/i.test(f.name)) bytes = await (await imagesToPdf(await normalizeImage(bytes, f.type), { pageSize: 'a4', dpi: 300, margin: 28 })).doc.save();
        added.push({ bytes, js: await loadPdfJs(bytes) });
      }
      snapshot();
      const base = srcs.length;
      setSrcs((s) => [...s, ...added]);
      setPages((p) => [...p, ...added.flatMap((a, k) => Array.from({ length: a.js.numPages }, (_, i) => ({ src: base + k, index: i, rotation: 0 })))]);
    });
  }
  async function addBlank() {
    const { PDFDocument } = await import('pdf-lib');
    const d = await PDFDocument.create(); d.addPage([595.28, 841.89]);
    const bytes = await d.save();
    const js = await loadPdfJs(bytes);
    snapshot();
    setSrcs((s) => [...s, { bytes, js }]);
    setPages((p) => [...p, { src: srcs.length, index: 0, rotation: 0 }]);
  }

  async function pickImage(files: File[]) {
    const [n] = await normalizeImage(new Uint8Array(await files[0].arrayBuffer()), files[0].type);
    const img = await decodeImage(n.bytes, n.mime);
    pendingImage.current = { ...n, w: img.naturalWidth, h: img.naturalHeight };
    setTool('place-image');
    toast('Click on a page to place the image');
  }

  // ---------- export ----------
  const edited = (flatten = false) => { commitPending(); return savePdf(srcs.map((s) => s.bytes), pages, overlaysRef.current, values, flatten); };
  const name = baseName(file.name);
  const hasCovers = overlays.some(o => o.type === 'rect' && o.opacity >= 1);
  const { root, save, print, markDirty } = useSave(file, onChange, () => 'pdf', async () => {
    const bytes = await edited();
    const covered = overlaysRef.current.some(o => o.type === 'rect' && o.opacity >= 1);
    return { bytes, ...(covered ? { copyName: `${name}-covered.pdf`, note: 'Covered content removed; pages and forms flattened.' } : {}) };
  }, () => edited(), commitPending, async () => {
    if (!srcs.length || !pages.length) throw new Error('PDF is still opening');
    let recovered = overlaysRef.current;
    for (const entry of pendingEdits.current.values()) { const preview = entry.read(); recovered = [...recovered.filter(overlay => overlay.page !== preview.page), ...preview.overlays]; }
    return { bytes: srcs[0].bytes, state: { pdfSources: srcs.map(s => s.bytes), pages, overlays: recovered, values } };
  });
  dirtyHandler.current = markDirty;

  const exportDocx = (mode: 'text' | 'layout') => run('Converting to Word…', async () => {
    const js = await loadPdfJs(await edited());
    const docx = await import('../engines/docx');
    if (mode === 'layout') {
      const pngs: Uint8Array[] = [];
      for (let p = 1; p <= js.numPages; p++) { setBusy(`Rendering page ${p}/${js.numPages}…`); pngs.push(await canvasToBytes(await pdfPageToCanvas(js, p, 200))); }
      return saveFile(`${name}.docx`, await docx.pageImagesToDocx(pngs));
    }
    const { analyzeLayout, pdfTextLayout } = await import('../engines/ocrLayout');
    const out = [];
    for (let p = 1; p <= js.numPages; p++) {
      setBusy(`Reading page ${p}/${js.numPages}…`);
      const page = await js.getPage(p);
      const lines = await extractLines(page);
      // Analyse the page unrotated so text coordinates and pixels line up on rotated pages.
      const canvas = document.createElement('canvas');
      await renderPage(page, canvas, 300 / 72, (360 - page.rotate) % 360);
      if (lines.length) {
        const vp = page.getViewport({ scale: 1, rotation: 0 });
        out.push(pdfTextLayout(lines, canvas, 300 / 72, vp.width, vp.height));
      } else { // scanned page → OCR with colour/layout analysis
        const { ocrCanvas } = await import('../engines/ocr');
        const ocr = await ocrCanvas(canvas, lang, (_, s) => setBusy(`OCR page ${p}: ${s}`));
        out.push(analyzeLayout(ocr, canvas));
      }
    }
    await saveFile(`${name}.docx`, await docx.layoutsToDocx(out));
  });

  const exportImages = (type: 'png' | 'jpg') => run('Rendering pages at 300 DPI…', async () => {
    const js = await loadPdfJs(await edited());
    const mime = type === 'png' ? 'image/png' : 'image/jpeg';
    if (js.numPages === 1) return saveFile(`${name}.${type}`, await canvasToBytes(await pdfPageToCanvas(js, 1, 300), mime, 0.95));
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (let p = 1; p <= js.numPages; p++) {
      setBusy(`Rendering page ${p}/${js.numPages}…`);
      zip.file(`${name}-${String(p).padStart(3, '0')}.${type}`, await canvasToBytes(await pdfPageToCanvas(js, p, 300), mime, 0.95));
    }
    await saveFile(`${name}-pages.zip`, await zip.generateAsync({ type: 'uint8array' }));
  });

  const exportSearchable = () => run('Running OCR…', async () => {
    const bytes = await edited();
    const js = await loadPdfJs(bytes);
    const { PDFDocument } = await import('pdf-lib');
    const { ocrCanvas, addTextLayer } = await import('../engines/ocr');
    const doc = await PDFDocument.load(bytes);
    let done = 0;
    for (let p = 1; p <= js.numPages; p++) {
      const page = await js.getPage(p);
      if ((await extractLines(page)).length) continue; // already has real text
      const ocr = await ocrCanvas(await pdfPageToCanvas(js, p, 300), lang, (_, s) => setBusy(`OCR page ${p}/${js.numPages}: ${s}`));
      const pg = doc.getPage(p - 1);
      await addTextLayer(doc, pg, ocr, { x: 0, y: 0, w: pg.getWidth(), h: pg.getHeight() });
      done++;
    }
    toast(done ? `Added OCR text to ${done} page(s)` : 'All pages already contain selectable text');
    await saveFile(`${name}-searchable.pdf`, await doc.save());
  });

  const selected = overlays.find((o) => o.id === sel);

  return (
    <div className="editor" ref={root}>
      <Toolbar>
        <Btn primary onClick={() => save()} title="Save (Ctrl/Cmd+S)">💾 Save</Btn>
        <Btn onClick={print} title="Print (Ctrl/Cmd+P)">🖨 Print</Btn>
        <Menu label="Export" options={[
          { label: 'Save As…', hint: 'Ctrl/Cmd+Shift+S', action: () => save(true) },
          { label: 'Word .docx (editable text)', hint: 'Keeps colours, sizes, indents; OCRs scanned pages', action: () => exportDocx('text') },
          { label: 'Word .docx (exact layout)', hint: 'Pages as 200 DPI images', action: () => exportDocx('layout') },
          { label: 'Searchable PDF (OCR)', hint: 'Adds a hidden text layer to scanned pages', action: exportSearchable },
          { label: 'PDF (flattened)', hint: 'Locks form values & annotations into the page', action: () => run('Flattening…', async () => saveFile(`${name}-flattened.pdf`, await edited(true))) },
          { label: 'PNG images (300 DPI)', action: () => exportImages('png') },
          { label: 'JPEG images (300 DPI)', action: () => exportImages('jpg') },
          { label: 'Plain text .txt', action: () => run('Extracting…', async () => saveFile(`${name}.txt`, await pdfToText(await loadPdfJs(await edited())))) },
        ]} />
        <Sep />
        <Btn active={tool === 'select'} onClick={() => setTool('select')} title="Select / move">↖ Select</Btn>
        <Btn active={tool === 'edit'} onClick={() => setTool('edit')} title="Click any existing text to change it">✎ Edit text</Btn>
        <Btn active={tool === 'text'} onClick={() => setTool('text')}>T Add text</Btn>
        <Btn active={tool === 'highlight'} onClick={() => setTool('highlight')}>▮ Highlight</Btn>
        <Btn active={tool === 'whiteout'} onClick={() => setTool('whiteout')} title="Remove covered content permanently; saves a flattened copy">▭ Cover</Btn>
        <FilePick accept="image/*,.heic,.tif,.tiff" onFiles={pickImage}>🖼 Image</FilePick>
        <Menu label="📝 Form" options={[
          { label: 'Text field', hint: 'Drag a box on the page', action: () => setTool('field-text') },
          { label: 'Checkbox', hint: 'Click where it goes', action: () => setTool('field-check') },
          { label: 'Dropdown', hint: 'Drag a box; set choices in the side panel', action: () => setTool('field-drop') },
          { label: 'Signature…', hint: 'Draw, then click to place', action: () => setSigning(true) },
        ]} />
        <Sep />
        <Btn onClick={undo} disabled={!history.length}>↶ Undo</Btn>
        <Btn onClick={redo} disabled={!future.length}>↷ Redo</Btn>
        <Btn className="pages-toggle" active={showPages} onClick={() => setShowPages(!showPages)} title="Insert, rotate, reorder and delete pages">📄 Pages</Btn>
        <Btn onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}>−</Btn>
        <span className="zoom">{Math.round(zoom * 100)}%</span>
        <Btn onClick={() => setZoom((z) => Math.min(4, z + 0.15))}>+</Btn>
        <Sep />
        <label className="inline">OCR
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {Object.entries(OCR_LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </Toolbar>
      {hasCovers && <div className="export-notice" role="status">Saving removes covered content and creates a flattened copy. Keep the original for editable forms and links. Uncovered text boxes remain searchable where supported.</div>}

      {signing && <SignaturePad onCancel={() => setSigning(false)} onDone={(png, w, h) => {
        pendingImage.current = { bytes: png, mime: 'image/png', w, h };
        setSigning(false); setTool('place-image'); toast('Click on the page to place your signature');
      }} />}
      <div className="editor-body">
        <aside className={'sidebar pages-drawer' + (showPages ? ' open' : '')}>
          <div className="row wrap">
            <FilePick accept=".pdf,image/*,.heic,.tif,.tiff" multiple onFiles={insertFiles}>➕ Insert</FilePick>
            <Btn onClick={addBlank}>Blank</Btn>
          </div>
          {pages.map((p, i) => srcs[p.src] && (
            <div key={`${p.src}-${p.index}-${i}`} className="thumb">
              <Thumb doc={srcs[p.src].js} index={p.index} rotation={p.rotation} onClick={() => document.getElementById(`${file.id}-p${i}`)?.scrollIntoView({ behavior: 'smooth' })} />
              <div className="thumb-ops">
                <span>{i + 1}</span>
                <button onClick={() => rotate(i, -90)} title="Rotate left">↺</button>
                <button onClick={() => rotate(i, 90)} title="Rotate right">↻</button>
                <button onClick={() => move(i, -1)} title="Move up">↑</button>
                <button onClick={() => move(i, 1)} title="Move down">↓</button>
                <button onClick={() => del(i)} title="Delete page">🗑</button>
              </div>
            </div>
          ))}
        </aside>

        <div className="canvas-area" onPointerDown={(e) => e.target === e.currentTarget && setSel(null)}>
          {pages.map((p, i) => srcs[p.src] && (
            <PageView key={`${p.src}-${p.index}-${i}`} id={`${file.id}-p${i}`} doc={srcs[p.src].js} pageRef={p} pageNo={i} zoom={zoom} tool={tool}
              overlays={overlays.filter((o) => o.page === i)} sel={sel} setSel={setSel} add={add} update={update} snapshot={snapshot}
              values={values} setValue={setValue}
              registerPendingEdit={registerPendingEdit} touch={touch}
              placeImage={(x, y) => {
                const im = pendingImage.current; if (!im) return;
                const w = Math.min(200, im.w * 0.75), h = (w / im.w) * im.h;
                const o: Overlay = { id: nid(), type: 'image', page: i, x, y: y - h, w, h, bytes: im.bytes, mime: im.mime };
                add(o); setSel(o.id); setTool('select'); pendingImage.current = null;
              }}
              afterAdd={() => setTool('select')} />
          ))}
        </div>

        {selected && (
          <aside className="props">
            <h3>{selected.type === 'text' ? 'Text' : selected.type === 'rect' ? 'Shape' : selected.type === 'field' ? 'Form field' : 'Image'}</h3>
            {selected.type === 'field' && (<>
              <label>Name <input type="text" value={selected.name} onChange={(e) => update(selected.id, { name: e.target.value })} /></label>
              {selected.kind === 'text' && <label><input type="checkbox" checked={!!selected.multiline} onChange={(e) => update(selected.id, { multiline: e.target.checked })} /> Multi-line</label>}
              {selected.kind === 'dropdown' && <label style={{ flexDirection: 'column', alignItems: 'stretch' }}>Choices (one per line)
                <textarea rows={5} value={(selected.options ?? []).join('\n')} onChange={(e) => update(selected.id, { options: e.target.value.split('\n') })} /></label>}
            </>)}
            {selected.type === 'text' && (<>
              <textarea aria-label="PDF text content" value={selected.text} rows={4}
                onBlur={() => { textHistoryId.current = null; }} onChange={(e) => {
                  if (textHistoryId.current !== selected.id) { snapshot(); textHistoryId.current = selected.id; }
                  update(selected.id, { text: e.target.value });
                }} />
              <label>Size <input type="number" min={4} max={200} step={0.5} value={selected.size} onChange={(e) => update(selected.id, { size: +e.target.value })} /></label>
              <label>Font <select value={selected.family} onChange={(e) => update(selected.id, { family: e.target.value as FontFamily })}>
                <option value="sans">Sans (Helvetica)</option><option value="serif">Serif (Times)</option><option value="mono">Mono (Courier)</option></select></label>
              <label><input type="checkbox" checked={!!selected.bold} onChange={(e) => update(selected.id, { bold: e.target.checked })} /> Bold</label>
              <label>Colour <ColorPicker icon="A" title="Colour" value={selected.color} used={usedColours} onChange={(c) => { snapshot(); update(selected.id, { color: c }); }} /></label>
            </>)}
            {selected.type === 'rect' && (<>
              <label>Colour <ColorPicker icon="▇" title="Colour" value={selected.color} used={usedColours} onChange={(c) => { snapshot(); update(selected.id, { color: c }); }} /></label>
              <label>Opacity <input type="range" min={0.1} max={1} step={0.05} value={selected.opacity} onChange={(e) => update(selected.id, { opacity: +e.target.value })} /></label>
            </>)}
            {(selected.type === 'image' || selected.type === 'rect' || selected.type === 'field') && (<>
              <label>Width <input type="number" value={Math.round(selected.w)} onChange={(e) => update(selected.id, selected.type === 'image' ? { w: +e.target.value, h: (+e.target.value / selected.w) * selected.h } : { w: +e.target.value })} /></label>
              <label>Height <input type="number" value={Math.round(selected.h)} onChange={(e) => update(selected.id, { h: +e.target.value })} /></label>
            </>)}
            <Btn onClick={() => remove(selected.id)}>🗑 Delete</Btn>
          </aside>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Thumb({ doc, index, rotation, onClick }: { doc: PdfJsDoc; index: number; rotation: number; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    doc.getPage(index + 1).then((page) => {
      if (cancelled || !ref.current) return;
      const vp = page.getViewport({ scale: 1 });
      renderPage(page, ref.current, 140 / Math.max(vp.width, vp.height) * 1.5, rotation);
    });
    return () => { cancelled = true; };
  }, [doc, index, rotation]);
  return <canvas ref={ref} onClick={onClick} />;
}

interface TextItem { str: string; transform: number[]; width: number; fontName: string }

interface PageViewProps {
  id: string; doc: PdfJsDoc; pageRef: PageRef; pageNo: number; zoom: number; tool: Tool; overlays: Overlay[]; sel: string | null;
  setSel: (id: string | null) => void; add: (...o: Overlay[]) => void; update: (id: string, p: Partial<Overlay>) => void;
  snapshot: () => void; placeImage: (x: number, y: number) => void; afterAdd: () => void;
  values: FormValues; setValue: (key: string, v: string | boolean) => void;
  registerPendingEdit: (id: string, commit: () => void, read: () => { page: number; overlays: Overlay[] }) => () => void;
  touch: () => void;
}

/** Interactive form widget as reported by pdf.js. */
interface Widget {
  fieldName: string; fieldType: 'Tx' | 'Btn' | 'Ch'; rect: number[]; fieldValue?: string | string[];
  checkBox?: boolean; radioButton?: boolean; pushButton?: boolean; buttonValue?: string; exportValue?: string;
  options?: { exportValue: string; displayValue: string }[]; multiLine?: boolean; readOnly?: boolean;
}

function PageView({ id, doc, pageRef, pageNo, zoom, tool, overlays, sel, setSel, add, update, snapshot, placeImage, afterAdd, values, setValue, registerPendingEdit, touch }: PageViewProps) {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [vp, setVp] = useState<Viewport | null>(null);
  const [page, setPage] = useState<pdfjs.PDFPageProxy | null>(null);
  const [items, setItems] = useState<TextItem[]>([]);
  const [editing, setEditingState] = useState<PdfTextDraft>(null);
  const editingRef = useRef(editing);
  const setEditing = (next: typeof editing) => { editingRef.current = next; setEditingState(next); };
  const commitRef = useRef<() => void>(() => {});
  const previewRef = useRef<() => Overlay[]>(() => overlays);
  useEffect(() => registerPendingEdit(id, () => commitRef.current(), () => ({ page: pageNo, overlays: previewRef.current() })), [id, registerPendingEdit, pageNo]);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; resize: boolean } | null>(null);
  const dpr = window.devicePixelRatio || 1;

  // Render at device resolution so text is razor-sharp on Retina / high-DPI phones.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pg = await doc.getPage(pageRef.index + 1);
      if (cancelled || !canvas.current) return;
      const rot = (pg.rotate + pageRef.rotation) % 360;
      setPage(pg);
      pg.getAnnotations().then((a) => !cancelled && setWidgets((a as (Widget & { subtype: string })[]).filter((w) => w.subtype === 'Widget' && w.fieldName && !w.pushButton)));
      setVp(pg.getViewport({ scale: zoom, rotation: rot }));
      await renderPage(pg, canvas.current, zoom * dpr, pageRef.rotation);
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [doc, pageRef, zoom, dpr]);

  useEffect(() => {
    if (tool !== 'edit' || !page) return;
    page.getTextContent().then((tc) => setItems((tc.items as TextItem[]).filter((i) => 'str' in i && i.str.trim())));
  }, [tool, page]);

  if (!vp) return <div id={id} className="page loading-page"><canvas ref={canvas} /></div>;

  const toPdf = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const [x, y] = vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
    return { x, y, cx: e.clientX - r.left, cy: e.clientY - r.top };
  };
  const box = (x: number, y: number, w: number, h: number) => {
    const [a, b] = vp.convertToViewportPoint(x, y + h), [c, d] = vp.convertToViewportPoint(x + w, y);
    return { left: Math.min(a, c), top: Math.min(b, d), width: Math.abs(c - a), height: Math.abs(d - b) };
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    const p = toPdf(e);
    if (tool === 'text') {
      const o: Overlay = { id: nid(), type: 'text', page: pageNo, x: p.x, y: p.y - 12, size: 12, text: 'New text', color: '#111111', family: 'sans' };
      add(o); setSel(o.id); afterAdd();
    } else if (tool === 'place-image') placeImage(p.x, p.y);
    else if (tool === 'field-check') {
      const o: Overlay = { id: nid(), type: 'field', kind: 'checkbox', name: 'checkbox', page: pageNo, x: p.x - 7, y: p.y - 7, w: 14, h: 14 };
      add(o); setSel(o.id); afterAdd();
    } else if (tool === 'highlight' || tool === 'whiteout' || tool === 'field-text' || tool === 'field-drop') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    } else setSel(null);
  };
  const onMove = (e: React.PointerEvent) => {
    if (draft) { const p = toPdf(e); setDraft({ ...draft, x1: p.x, y1: p.y }); return; }
    const d = drag.current; if (!d) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const [x0, y0] = vp.convertToPdfPoint(d.sx, d.sy), [x1, y1] = vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
    if (d.resize) update(d.id, { w: Math.max(5, d.ow + (x1 - x0)), h: Math.max(5, d.oh - (y1 - y0)), y: d.oy + (y1 - y0) } as Partial<Overlay>);
    else update(d.id, { x: d.ox + (x1 - x0), y: d.oy + (y1 - y0) });
  };
  const onUp = () => {
    drag.current = null;
    if (!draft) return;
    const x = Math.min(draft.x0, draft.x1), y = Math.min(draft.y0, draft.y1), w = Math.abs(draft.x1 - draft.x0), h = Math.abs(draft.y1 - draft.y0);
    setDraft(null);
    if (w < 3 || h < 3) return;
    if (tool === 'field-text' || tool === 'field-drop') {
      const kind = FIELD_KIND[tool];
      const o: Overlay = { id: nid(), type: 'field', kind, name: kind === 'text' ? 'text_field' : 'dropdown', page: pageNo, x, y, w, h: Math.max(h, 14), options: kind === 'dropdown' ? ['Option 1', 'Option 2', 'Option 3'] : undefined };
      add(o); setSel(o.id); afterAdd();
      return;
    }
    let color = tool === 'highlight' ? '#FFEB3B' : '#FFFFFF';
    if (tool === 'whiteout' && canvas.current) {
      const b = box(x, y, w, h);
      color = rgbToHex(sampleBackground(canvas.current.getContext('2d')!, b.left * dpr, b.top * dpr, b.width * dpr, b.height * dpr));
    }
    const o: Overlay = { id: nid(), type: 'rect', page: pageNo, x, y, w, h, color, opacity: tool === 'highlight' ? 0.4 : 1 };
    add(o); setSel(o.id);
  };
  const startDrag = (e: React.PointerEvent, o: Overlay, resize = false) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    setSel(o.id);
    snapshot();
    const host = (e.currentTarget as HTMLElement).closest('.page-layer') as HTMLElement;
    host.setPointerCapture(e.pointerId);
    const r = host.getBoundingClientRect();
    drag.current = { id: o.id, sx: e.clientX - r.left, sy: e.clientY - r.top, ox: o.x, oy: o.y, ow: 'w' in o ? o.w : 0, oh: 'h' in o ? o.h : 0, resize };
  };

  // Replace an existing text run: colour-matched cover patch + new text at the same baseline/size.
  const replacement = (pending: NonNullable<PdfTextDraft> & { i: number }): Overlay[] => {
    if (!page || !canvas.current) return [];
    const it = items[pending.i];
    if (!it || pending.value === it.str) return [];
    const size = Math.hypot(it.transform[2], it.transform[3]);
    const [x, y] = [it.transform[4], it.transform[5]];
    const b = box(x, y - size * 0.25, it.width, size * 1.2);
    const ctx = canvas.current.getContext('2d', { willReadFrequently: true })!;
    const bg = sampleBackground(ctx, b.left * dpr, b.top * dpr, b.width * dpr, b.height * dpr);
    const ink = sampleInk(ctx, b.left * dpr, b.top * dpr, b.width * dpr, b.height * dpr, bg);
    let fontName = '';
    try { fontName = (page.commonObjs.get(it.fontName) as { name?: string })?.name ?? ''; } catch { /* font not resolved */ }
    const family: FontFamily = /courier|mono/i.test(fontName) ? 'mono' : /times|serif|roman|georgia|garamond/i.test(fontName) && !/sans/i.test(fontName) ? 'serif' : 'sans';
    return [
      { id: nid(), type: 'rect', page: pageNo, x: x - 0.5, y: y - size * 0.25, w: it.width + 1, h: size * 1.2, color: rgbToHex(bg), opacity: 1 },
      { id: nid(), type: 'text', page: pageNo, x, y, size, text: pending.value, color: rgbToHex(ink), family, bold: /bold|black|heavy|semibold/i.test(fontName) },
    ];
  };
  const commitEdit = () => {
    const pending = editingRef.current;
    if (!pending || !page || !canvas.current) return;
    setEditing(null);
    if (pending.overlayId !== undefined) {
      const original = overlays.find(o => o.id === pending.overlayId);
      if (original?.type === 'text' && original.text !== pending.value) { snapshot(); update(original.id, { text: pending.value }); }
    } else { const additions = replacement(pending); if (additions.length) add(...additions); }
  };
  commitRef.current = commitEdit;
  previewRef.current = () => {
    const pending = editingRef.current;
    if (!pending) return overlays;
    if (pending.overlayId !== undefined) return overlays.map(overlay => overlay.id === pending.overlayId && overlay.type === 'text' ? { ...overlay, text: pending.value } : overlay);
    return [...overlays, ...replacement(pending)];
  };

  const covered = (it: TextItem) => overlays.some((o) => o.type === 'rect' && o.opacity === 1 && it.transform[4] >= o.x - 1 && it.transform[4] + it.width <= o.x + o.w + 1 && it.transform[5] >= o.y && it.transform[5] <= o.y + o.h);

  return (
    <div id={id} className="page" style={{ width: vp.width, height: vp.height }}>
      <canvas ref={canvas} style={{ width: vp.width, height: vp.height }} />
      <div className={`page-layer tool-${tool}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        {overlays.map((o) => {
          if (o.type === 'rect') return (
            <div key={o.id} className={'ov' + (sel === o.id ? ' sel' : '')} style={{ ...box(o.x, o.y, o.w, o.h), background: o.color, opacity: o.opacity }} onPointerDown={(e) => startDrag(e, o)}>
              {sel === o.id && <span className="handle" onPointerDown={(e) => startDrag(e, o, true)} />}
            </div>);
          if (o.type === 'field') return (
            <div key={o.id} className={'ov field-new' + (sel === o.id ? ' sel' : '')} style={box(o.x, o.y, o.w, o.h)} onPointerDown={(e) => startDrag(e, o)}>
              <span>{o.kind === 'checkbox' ? '☐' : o.kind === 'dropdown' ? `▾ ${o.name}` : o.name}</span>
              {sel === o.id && o.kind !== 'checkbox' && <span className="handle" onPointerDown={(e) => startDrag(e, o, true)} />}
            </div>);
          if (o.type === 'image') return (
            <div key={o.id} className={'ov' + (sel === o.id ? ' sel' : '')} style={box(o.x, o.y, o.w, o.h)} onPointerDown={(e) => startDrag(e, o)}>
              <ImgBytes bytes={o.bytes} mime={o.mime} />
              {sel === o.id && <span className="handle" onPointerDown={(e) => startDrag(e, o, true)} />}
            </div>);
          const [vx, vy] = vp.convertToViewportPoint(o.x, o.y);
          const textStyle = { left: vx, top: vy - o.size * zoom, fontSize: o.size * zoom, color: o.color, fontFamily: FAMILY_CSS[o.family], fontWeight: o.bold ? 700 : 400 };
          if (editing?.overlayId === o.id) return (
            <input key={o.id} autoFocus className="text-edit" aria-label={`Edit PDF text: ${o.text}`}
              style={{ ...textStyle, width: Math.max(120, Math.max(o.text.length, editing.value.length) * o.size * zoom * 0.65) }}
              value={editing.value} onChange={e => { setEditing({ overlayId: o.id, value: e.target.value }); touch(); }}
              onBlur={commitEdit} onPointerDown={e => e.stopPropagation()}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }} />
          );
          if (tool === 'edit') return (
            <button key={o.id} type="button" className="ov text text-hit-overlay" style={textStyle}
              aria-label={`Edit PDF text: ${o.text}`} onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); setEditing({ overlayId: o.id, value: o.text }); }}>{o.text}</button>
          );
          return (
            <div key={o.id} className={'ov text' + (sel === o.id ? ' sel' : '')} onPointerDown={(e) => startDrag(e, o)}
              style={textStyle}>
              {o.text}
            </div>);
        })}
        {tool !== 'edit' && widgets.map((w, i) => {
          const key = `${pageRef.src}:${w.fieldName}`;
          const b = box(Math.min(w.rect[0], w.rect[2]), Math.min(w.rect[1], w.rect[3]), Math.abs(w.rect[2] - w.rect[0]), Math.abs(w.rect[3] - w.rect[1]));
          const fs = Math.max(8, Math.min(b.height * 0.65, 14 * zoom));
          const raw = values[key] ?? (Array.isArray(w.fieldValue) ? w.fieldValue[0] : w.fieldValue) ?? '';
          const common = { className: 'form-input', style: { ...b, fontSize: fs }, disabled: w.readOnly, title: w.fieldName, onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };
          if (w.fieldType === 'Btn' && w.radioButton)
            return <input key={i} type="radio" {...common} name={`${id}-${key}`} checked={raw === w.buttonValue} onChange={() => setValue(key, w.buttonValue!)} />;
          if (w.fieldType === 'Btn')
            return <input key={i} type="checkbox" {...common} checked={values[key] !== undefined ? !!values[key] && values[key] !== 'Off' : !!raw && raw !== 'Off'} onChange={(e) => setValue(key, e.target.checked)} />;
          if (w.fieldType === 'Ch')
            return <select key={i} {...common} value={String(raw)} onChange={(e) => setValue(key, e.target.value)}>
              {(w.options ?? []).map((o) => <option key={o.exportValue} value={o.exportValue}>{o.displayValue}</option>)}</select>;
          return w.multiLine
            ? <textarea key={i} {...common} value={String(raw)} onChange={(e) => setValue(key, e.target.value)} />
            : <input key={i} type="text" {...common} value={String(raw)} onChange={(e) => setValue(key, e.target.value)} />;
        })}
        {draft && <div className="ov draft" style={box(Math.min(draft.x0, draft.x1), Math.min(draft.y0, draft.y1), Math.abs(draft.x1 - draft.x0), Math.abs(draft.y1 - draft.y0))} />}
        {tool === 'edit' && items.map((it, i) => {
          if (covered(it)) return null;
          const tx = pdfjs.Util.transform(vp.transform, it.transform);
          const fh = Math.hypot(tx[2], tx[3]);
          const style = { left: tx[4], top: tx[5] - fh, width: it.width * zoom, height: fh * 1.15, fontSize: fh };
          return editing?.i === i
            ? <input key={i} autoFocus className="text-edit" style={{ ...style, width: Math.max(style.width + 40, 80) }} value={editing.value}
                aria-label={`Edit PDF text: ${it.str}`} onChange={(e) => { setEditing({ i, value: e.target.value }); touch(); }} onBlur={commitEdit}
                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }} />
            : <button key={i} type="button" className="text-hit" style={style} title={it.str} aria-label={`Edit PDF text: ${it.str}`}
                onPointerDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setEditing({ i, value: it.str }); }} />;
        })}
      </div>
    </div>
  );
}

function ImgBytes({ bytes, mime }: { bytes: Uint8Array; mime: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })); setUrl(u); return () => URL.revokeObjectURL(u); }, [bytes, mime]);
  return <img src={url} draggable={false} alt="" />;
}
