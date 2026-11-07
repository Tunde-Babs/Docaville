import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { WordReviewPage } from '../components/ImageWordReview';
import { normalizeImage, decodeImage, imageToCanvas, canvasToBytes, sampleBackground, sampleInk, rgbCss } from '../lib/image';
import { renderEdited, DEFAULT_ADJUST, DEFAULT_TRANSFORM, SCAN_PRESET, type Adjust, type Transform } from '../engines/imageEdit';
import type { OcrResult, OcrWord } from '../engines/ocr';
import { OCR_LANGS } from '../lib/langs';
import { saveFile, baseName } from '../lib/fileio';
import { Btn, Menu, Toolbar, Sep, run, setBusy, toast } from '../components/ui';
import { useSave, loadOrFail, type EditorProps } from '../components/useSave';
const ImageWordReview = lazy(() => import('../components/ImageWordReview'));


const cloneCanvas = (c: HTMLCanvasElement) => { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d')!.drawImage(c, 0, 0); return n; };
type ImageSnap = { base: HTMLCanvasElement; adjust: Adjust; ocr: OcrResult | null; text: string };

export default function ImageEditor({ file, onChange, onFail }: EditorProps) {
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [history, setHistory] = useState<ImageSnap[]>([]);
  const [future, setFuture] = useState<ImageSnap[]>([]);
  const [adjust, setAdjustState] = useState<Adjust>(DEFAULT_ADJUST);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [text, setText] = useState('');
  const [wordReview, setWordReview] = useState<WordReviewPage[] | null>(null);
  const [lang, setLang] = useState('auto');
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [editWord, setEditWord] = useState<{ li: number; wi: number; value: string } | null>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const original = useRef<HTMLCanvasElement | null>(null);
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  const lastAdjustment = useRef(0);

  useEffect(() => {
    loadOrFail('Opening image…', async () => {
      const [n] = await normalizeImage(file.bytes!, file.mime);
      const c = imageToCanvas(await decodeImage(n.bytes, n.mime));
      original.current = cloneCanvas(c);
      setBase(c);
    }, onFail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const output = () => renderEdited(base!, DEFAULT_TRANSFORM, adjust);
  // Save keeps the image's own format (PNG/JPEG/WebP); other formats (HEIC, TIFF, GIF…) Save As PNG.
  const ENC: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  const origExt = file.name.split('.').pop()!.toLowerCase();
  const { root, save, print, markDirty } = useSave(file, onChange, () => (ENC[origExt] ? origExt : 'png'), (ext) => canvasToBytes(output(), ENC[ext], 0.95), async () => {
    const { imagesToPdf } = await import('../engines/pdf');
    return (await imagesToPdf([{ bytes: await canvasToBytes(output()), mime: 'image/png' }], { pageSize: 'a4', dpi: 300, margin: 28 })).doc.save();
  });

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (root.current?.offsetParent) keyHandler.current(e); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [root]);

  useEffect(() => {
    if (!base || !view.current) return;
    const out = renderEdited(base, DEFAULT_TRANSFORM, adjust);
    view.current.width = out.width; view.current.height = out.height;
    view.current.getContext('2d')!.drawImage(out, 0, 0);
  }, [base, adjust]);

  // Adjustment sliders are edits too (skip the initial render).
  const adjustSeen = useRef(adjust);
  useEffect(() => { if (adjust !== adjustSeen.current) { adjustSeen.current = adjust; markDirty(); } }, [adjust, markDirty]);

  if (!base) return null;
  const name = baseName(file.name);
  const snapshot = (): ImageSnap => ({ base, adjust: { ...adjust }, ocr, text });
  const record = () => { setHistory(h => [...h.slice(-9), snapshot()]); setFuture([]); lastAdjustment.current = 0; markDirty(); };
  const restore = (s: ImageSnap) => { setBase(s.base); setAdjustState(s.adjust); setOcr(s.ocr); setText(s.text); setCrop(null); setEditWord(null); markDirty(); };
  const undo = () => { const prev = history[history.length - 1]; if (!prev) return; setFuture(f => [...f, snapshot()]); setHistory(h => h.slice(0, -1)); restore(prev); lastAdjustment.current = 0; };
  const redo = () => { const next = future[future.length - 1]; if (!next) return; setHistory(h => [...h, snapshot()]); setFuture(f => f.slice(0, -1)); restore(next); lastAdjustment.current = 0; };
  const setAdjust = (a: Adjust) => {
    const now = Date.now();
    if (now - lastAdjustment.current > 500) record();
    else { setFuture([]); markDirty(); }
    lastAdjustment.current = now; setAdjustState(a); setOcr(null);
  };
  keyHandler.current = e => {
    if ((e.target as HTMLElement).closest('input,textarea,[contenteditable]')) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  };

  /** Geometry ops are baked into the base at full resolution (90° rotations/flips/crops are lossless). */
  const bake = (t: Partial<Transform>) => {
    record();
    setBase(renderEdited(base, { ...DEFAULT_TRANSFORM, ...t }, DEFAULT_ADJUST));
    setOcr(null);
  };

  const runOcr = () => run('Recognising text…', async () => {
    const { ocrCanvas } = await import('../engines/ocr');
    const res = await ocrCanvas(output(), lang, (p, s) => setBusy(`${s} ${Math.round(p * 100)}%`));
    setOcr(res); setText(res.text);
    toast(`Found ${res.lines.reduce((a, l) => a + l.words.length, 0)} words — click any word on the image to retype it`);
  });

  /** Retype a word in the image: paint background-matched patch + new text in the sampled ink colour. */
  const replaceWord = (li: number, wi: number, value: string) => {
    const w: OcrWord = ocr!.lines[li].words[wi];
    setEditWord(null);
    if (value === w.text) return;
    record();
    const next = cloneCanvas(base);
    const ctx = next.getContext('2d', { willReadFrequently: true })!;
    const pad = 2, x = w.x0 - pad, y = w.y0 - pad, bw = w.x1 - w.x0 + 2 * pad, bh = w.y1 - w.y0 + 2 * pad;
    const bg = sampleBackground(ctx, x, y, bw, bh), ink = sampleInk(ctx, x, y, bw, bh, bg);
    ctx.fillStyle = rgbCss(bg);
    ctx.fillRect(x, y, bw, bh);
    const lineH = ocr!.lines[li].y1 - ocr!.lines[li].y0;
    ctx.font = `${Math.round(lineH * 0.95)}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = rgbCss(ink);
    ctx.textBaseline = 'alphabetic';
    const natural = ctx.measureText(value).width;
    const sx = natural > 0 ? Math.min(1.15, Math.max(0.6, (w.x1 - w.x0) / natural)) : 1;
    ctx.save(); ctx.translate(w.x0, ocr!.lines[li].y1 - lineH * 0.2); ctx.scale(sx, 1); ctx.fillText(value, 0, 0); ctx.restore();
    setBase(next);
    const lines = ocr!.lines.map((l, i) => (i !== li ? l : { ...l, words: l.words.map((ww, j) => (j === wi ? { ...ww, text: value } : ww)) }));
    lines[li] = { ...lines[li], text: lines[li].words.map((x) => x.text).join(' ') };
    setOcr({ ...ocr!, lines });
    setText(lines.map((l) => l.text).join('\n'));
  };

  // crop by dragging on the displayed image
  const toImg = (e: React.PointerEvent) => {
    const r = view.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * base.width, y: ((e.clientY - r.top) / r.height) * base.height };
  };
  const applyCrop = () => {
    if (!crop) return;
    const x = Math.round(Math.min(crop.x0, crop.x1)), y = Math.round(Math.min(crop.y0, crop.y1));
    const w = Math.round(Math.abs(crop.x1 - crop.x0)), h = Math.round(Math.abs(crop.y1 - crop.y0));
    if (w > 4 && h > 4) bake({ crop: { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(w, base.width - x), h: Math.min(h, base.height - y) } });
    setCrop(null); setCropMode(false);
  };

  const exp = (label: string, fn: () => Promise<unknown>) => ({ label, action: () => run('Exporting…', async () => { await fn(); }) });
  const ensureOcr = async () => {
    if (ocr) return { ocr, text };
    const { ocrCanvas } = await import('../engines/ocr');
    const res = await ocrCanvas(output(), lang, (p, s) => setBusy(`OCR: ${s} ${Math.round(p * 100)}%`));
    setOcr(res); setText(res.text);
    return { ocr: res, text: res.text };
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div className="editor" ref={root}>
      {wordReview && <Suspense fallback={<p>Opening conversion review…</p>}><ImageWordReview pages={wordReview} name={`${name}.docx`} close={() => setWordReview(null)} /></Suspense>}
      <Toolbar>
        <Btn primary onClick={() => save()} title="Save (Ctrl/Cmd+S)">💾 Save</Btn>
        <Btn onClick={print} title="Print (Ctrl/Cmd+P)">🖨 Print</Btn>
        <Menu label="Export" options={[
          { label: 'Save As…', hint: 'Ctrl/Cmd+Shift+S', action: () => save(true) },
          exp('PNG (lossless)', async () => saveFile(`${name}.png`, await canvasToBytes(output()))),
          exp('JPEG (95%)', async () => saveFile(`${name}.jpg`, await canvasToBytes(output(), 'image/jpeg', 0.95))),
          exp('WebP (95%)', async () => saveFile(`${name}.webp`, await canvasToBytes(output(), 'image/webp', 0.95))),
          exp('PDF (full resolution)', async () => {
            const { imagesToPdf } = await import('../engines/pdf');
            const pdf = await imagesToPdf([{ bytes: await canvasToBytes(output()), mime: 'image/png' }], { pageSize: 'a4', dpi: 300, margin: 0 });
            await saveFile(`${name}.pdf`, await pdf.doc.save());
          }),
          exp('Searchable PDF (OCR)', async () => {
            const { imagesToPdf } = await import('../engines/pdf');
            const { addTextLayer } = await import('../engines/ocr');
            const { ocr: o } = await ensureOcr();
            const pdf = await imagesToPdf([{ bytes: await canvasToBytes(output()), mime: 'image/png' }], { pageSize: 'a4', dpi: 300, margin: 0 });
            await addTextLayer(pdf.doc, pdf.pages[0].page, o, pdf.pages[0].box);
            await saveFile(`${name}.pdf`, await pdf.doc.save());
          }),
          exp('Word .docx (worksheet answers / optional OCR)', async () => {
            const result = await ensureOcr();
            setWordReview([{ bytes: await canvasToBytes(output()), mime: 'image/png', sourceName: file.name, ocr: result.ocr, text: result.text }]);
          }),
          exp('Word .docx (preserve appearance as image)', async () => {
            const { imagesToDocx } = await import('../engines/docx');
            await saveFile(`${name}.docx`, await imagesToDocx([{ bytes: await canvasToBytes(output()), mime: 'image/png' }]));
          }),
          exp('Text .txt (OCR)', async () => saveFile(`${name}.txt`, (await ensureOcr()).text)),
        ]} />
        <Sep />
        <Btn onClick={undo} disabled={!history.length} title="Undo (Ctrl/Cmd+Z)">↶ Undo</Btn>
        <Btn onClick={redo} disabled={!future.length} title="Redo (Ctrl/Cmd+Shift+Z)">↷ Redo</Btn>
        <Btn onClick={() => bake({ rotate: 270 })} title="Rotate left">↺</Btn>
        <Btn onClick={() => bake({ rotate: 90 })} title="Rotate right">↻</Btn>
        <Btn onClick={() => bake({ flipH: true })}>⇋</Btn>
        <Btn onClick={() => bake({ flipV: true })}>⇵</Btn>
        <Btn active={cropMode} onClick={() => { setCropMode(!cropMode); setCrop(null); }}>✂ Crop</Btn>
        {crop && <Btn primary onClick={applyCrop}>Apply crop</Btn>}
        <Menu label="Resize" options={[50, 75, 150, 200].map((p) => ({ label: `${p}%  →  ${Math.round(base.width * p / 100)}×${Math.round(base.height * p / 100)}`, action: () => bake({ scale: p / 100 }) }))} />
        <Btn onClick={() => { record(); setBase(cloneCanvas(original.current!)); setAdjustState(DEFAULT_ADJUST); setOcr(null); }}>Revert</Btn>
        <Sep />
        <label className="inline">OCR <select value={lang} onChange={(e) => setLang(e.target.value)}>
          {Object.entries(OCR_LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          <option value="deu+eng">German + English</option></select></label>
        <Btn primary onClick={runOcr}>🔍 Run OCR</Btn>
      </Toolbar>

      <div className="editor-body">
        <aside className="sidebar adjust">
          <h3>Adjust</h3>
          {(['brightness', 'contrast', 'saturation'] as const).map((k) => (
            <label key={k}>{k} <input type="range" min={-100} max={100} value={adjust[k]} onChange={(e) => setAdjust({ ...adjust, [k]: +e.target.value })} /><span>{adjust[k]}</span></label>
          ))}
          <label><input type="checkbox" checked={adjust.grayscale} onChange={(e) => setAdjust({ ...adjust, grayscale: e.target.checked })} /> Grayscale</label>
          <label><input type="checkbox" checked={adjust.invert} onChange={(e) => setAdjust({ ...adjust, invert: e.target.checked })} /> Invert</label>
          <label><input type="checkbox" checked={adjust.threshold !== null} onChange={(e) => setAdjust({ ...adjust, threshold: e.target.checked ? 160 : null })} /> Black &amp; white</label>
          {adjust.threshold !== null && <input type="range" min={40} max={230} value={adjust.threshold} onChange={(e) => setAdjust({ ...adjust, threshold: +e.target.value })} />}
          <div className="row wrap">
            <Btn onClick={() => setAdjust(SCAN_PRESET)}>📄 Document scan</Btn>
            <Btn onClick={() => setAdjust(DEFAULT_ADJUST)}>Reset</Btn>
          </div>
          <p className="muted">{base.width} × {base.height}px</p>
          {ocr && (<>
            <h3>Recognised text</h3>
            <textarea className="ocr-text" value={text} onChange={(e) => setText(e.target.value)} />
            <Btn onClick={() => navigator.clipboard.writeText(text).then(() => toast('Copied'))}>Copy text</Btn>
          </>)}
        </aside>

        <div className="image-stage">
          <div className="image-wrap"
            onPointerDown={(e) => { if (!cropMode) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); const p = toImg(e); setCrop({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
            onPointerMove={(e) => { if (cropMode && crop && e.buttons) { const p = toImg(e); setCrop({ ...crop, x1: p.x, y1: p.y }); } }}>
            <canvas ref={view} />
            {crop && <div className="crop-box" style={{ left: pct(Math.min(crop.x0, crop.x1), base.width), top: pct(Math.min(crop.y0, crop.y1), base.height), width: pct(Math.abs(crop.x1 - crop.x0), base.width), height: pct(Math.abs(crop.y1 - crop.y0), base.height) }} />}
            {ocr && !cropMode && ocr.lines.map((l, li) => l.words.map((w, wi) => (
              editWord?.li === li && editWord.wi === wi
                ? <input key={`${li}-${wi}`} autoFocus className="word-edit" value={editWord.value}
                    style={{ left: pct(w.x0, base.width), top: pct(w.y0, base.height), minWidth: pct(w.x1 - w.x0, base.width) }}
                    onChange={(e) => setEditWord({ li, wi, value: e.target.value })}
                    onBlur={() => replaceWord(li, wi, editWord.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') replaceWord(li, wi, editWord.value); if (e.key === 'Escape') setEditWord(null); }} />
                : <span key={`${li}-${wi}`} className={'word' + (w.conf < 60 ? ' low' : '')} title={`${w.text} (${Math.round(w.conf)}%)`}
                    style={{ left: pct(w.x0, base.width), top: pct(w.y0, base.height), width: pct(w.x1 - w.x0, base.width), height: pct(w.y1 - w.y0, base.height) }}
                    onClick={() => setEditWord({ li, wi, value: w.text })} />
            )))}
          </div>
        </div>
      </div>
    </div>
  );
}
