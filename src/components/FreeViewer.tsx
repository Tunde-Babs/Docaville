import { useEffect, useRef, useState } from 'react';
import type { OpenFile } from '../lib/formats';
import type { PdfJsDoc } from '../engines/pdf';

/** A rendering-only reader: no editor, writable controls, save registration, or output action. */
export default function FreeViewer({ file, upgrade }: { file: OpenFile; upgrade: () => void }) {
  const [pdf, setPdf] = useState<PdfJsDoc | null>(null);
  const [page, setPage] = useState(1), [zoom, setZoom] = useState(1);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [pageText, setPageText] = useState('');
  const [textFallback, setTextFallback] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(200, entries[0].contentRect.width - 32)));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false, opened: PdfJsDoc | undefined;
    setLoading(true); setError(''); setPageText(''); setTextFallback(null); setPdf(null);
    void (async () => {
      if (!file.bytes) throw new Error('This document has no saved content to view.');
      const { loadPdfJs } = await import('../engines/pdf');
      let bytes = file.bytes;
      if (file.kind !== 'pdf') {
        const { processBatchFile, DEFAULT_BATCH } = await import('../engines/batch');
        const input = new File([bytes as BlobPart], file.name, { type: file.mime });
        try {
          bytes = (await processBatchFile(input, { ...DEFAULT_BATCH, operation: 'pdf' }, new AbortController().signal, () => undefined)).bytes;
        } catch (reason) {
          // Viewing text must not fail merely because a font/layout cannot be exported to PDF.
          // Restrict fallback to text-based formats: never invoke OCR as a Free reader side effect.
          if (/\.(docx|txt|md|html?|xlsx|xlsm|csv|tsv|pptx)$/i.test(file.name)) {
            const extracted = await (await import('../engines/documentTools')).readDocument(input);
            const text = extracted.passages.map(passage => passage.text).join('\n\n');
            if (text) { if (!disposed) { setTextFallback(text); setLoading(false); } return; }
          }
          throw reason;
        }
      }
      opened = await loadPdfJs(bytes);
      if (disposed) { await opened.destroy(); return; }
      setPdf(opened); setPage(1);
    })().catch(reason => { if (!disposed) { setError(String(reason?.message ?? reason)); setLoading(false); } });
    return () => { disposed = true; if (opened) void opened.destroy().catch(() => undefined); };
  }, [file.id, file.bytes, file.kind, file.mime, file.name]);
  useEffect(() => {
    if (!pdf || textFallback !== null) return;
    let disposed = false;
    setLoading(true); setError(''); setPageText('');
    void (async () => {
      const { renderPage, extractLines } = await import('../engines/pdf');
      const source = await pdf.getPage(page), base = source.getViewport({ scale: 1 });
      const scale = Math.min(1.4, width / base.width) * zoom, ratio = Math.min(2, devicePixelRatio || 1);
      // Independent canvases prevent rapid page/zoom changes sharing an in-flight render target.
      const rendered = document.createElement('canvas');
      await renderPage(source, rendered, scale * ratio);
      const text = (await extractLines(source)).map(line => line.text).join('\n');
      if (disposed || !canvas.current) return;
      const target = canvas.current;
      target.width = rendered.width; target.height = rendered.height;
      target.style.width = `${rendered.width / ratio}px`; target.style.height = `${rendered.height / ratio}px`;
      target.getContext('2d')!.drawImage(rendered, 0, 0); setPageText(text); setLoading(false);
    })().catch(reason => { if (!disposed) { setError(String(reason?.message ?? reason)); setLoading(false); } });
    return () => { disposed = true; };
  }, [pdf, page, zoom, width, textFallback]);
  return <div className="editor free-viewer">
    <div className="viewer-toolbar"><strong>Viewing · Free</strong><button className="btn primary" onClick={upgrade}>Edit with Pro</button>
      {textFallback === null && <>
      <button className="btn" disabled={!pdf || page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button>
      <label>Page <input aria-label="Page number" type="number" min={1} max={pdf?.numPages ?? 1} value={page} disabled={!pdf} onChange={event => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) setPage(Math.max(1, Math.min(pdf?.numPages ?? 1, value))); }} /> of {pdf?.numPages ?? '…'}</label>
      <button className="btn" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(value => value + 1)}>Next</button>
      <label>Zoom <select aria-label="Viewing zoom" disabled={!pdf} value={zoom} onChange={event => setZoom(+event.target.value)}>{[0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select></label>
      </>}
    </div>
    <p className="viewer-notice">Viewing preserves your original file. Office previews use the same supported layout engine as PDF exports; complex documents can look different from Microsoft Office.</p>
    {loading && <p role="status">Preparing document view…</p>}{error && <p role="alert" className="viewer-error">{error}</p>}
    {!loading && !error && textFallback === null && <details className="viewer-page-text"><summary>Read or select page text</summary><pre tabIndex={0}>{pageText || 'This page has no selectable text.'}</pre></details>}
    <div className="viewer-pages" ref={area}>{textFallback !== null ? <article><h2>Simplified text view</h2><p>The layout preview is unavailable. Your document text is shown below.</p><pre className="viewer-fallback-text" data-readonly-text tabIndex={0}>{textFallback}</pre></article> : <canvas ref={canvas} aria-label={`${file.name}, page ${page}`} hidden={!!error || !pdf || loading} />}</div>
  </div>;
}
