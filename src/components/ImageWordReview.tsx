import { useEffect, useRef, useState } from 'react';
import { imagesToDocx } from '../engines/docx';
import type { OcrResult } from '../engines/ocr';
import { saveFile, type SaveTarget } from '../lib/fileio';
import { toast } from './ui';
import WorksheetEditor from './WorksheetEditor';
import type { WorksheetAnnotation } from '../engines/worksheet';

export interface WordReviewPage { bytes: Uint8Array; mime: string; sourceName: string; ocr: OcrResult; text: string; annotations?: WorksheetAnnotation[]; savedWorksheet?: boolean }

/** OCR is a draft. Keep the source visible and require a review step before exporting it. */
export default function ImageWordReview({ pages, name, close, onSaved }: { pages: WordReviewPage[]; name: string; close: () => void; onSaved?: (bytes: Uint8Array, target: SaveTarget) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [texts, setTexts] = useState(() => pages.map(page => page.text));
  const [answers, setAnswers] = useState(() => pages.map(page => ({ past: [] as WorksheetAnnotation[][], present: page.annotations ?? [], future: [] as WorksheetAnnotation[][] })));
  const [index, setIndex] = useState(0);
  const [includeOriginals, setIncludeOriginals] = useState(true);
  const [includeOcrText, setIncludeOcrText] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const page = pages[index];
  const hasAnswers = answers.some(value => value.present.some(note => note.kind === 'cross' || note.text.trim()));
  function updateAnswers(notes: WorksheetAnnotation[]) {
    setAnswers(current => current.map((value, i) => i === index ? { past: [...value.past.slice(-49), value.present], present: notes, future: [] } : value));
    setIncludeOriginals(true);
  }
  function undoAnswer(redo = false) {
    setAnswers(current => current.map((value, i) => {
      if (i !== index) return value;
      const source = redo ? value.future : value.past;
      if (!source.length) return value;
      return redo ? { past: [...value.past, value.present], present: source[0], future: source.slice(1) }
        : { past: value.past.slice(0, -1), present: source[source.length - 1], future: [value.present, ...value.future] };
    }));
  }
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const key = (event: KeyboardEvent) => {
      // Parent editors also listen on window. The review must not save/print the
      // underlying image or document while the user is correcting this draft.
      if (event.ctrlKey || event.metaKey) {
        if (['s', 'p', 'o', 'n', 'w'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopImmediatePropagation(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); if (before?.isConnected) before.focus(); };
  }, []);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([page.bytes as BlobPart], { type: page.mime }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [page]);
  const uncertain = page.ocr.lines.flatMap(line => line.words).filter(word => !word.reviewed && word.conf < 70).length;
  async function exportWord() {
    setSaving(true);
    setError('');
    try {
      const bytes = await imagesToDocx(
        pages.map((source, i) => ({ bytes: source.bytes, mime: source.mime, sourceName: source.sourceName, text: texts[i], annotations: answers[i].present })),
        { includeOriginals, includeOcrText },
      );
      const saved = await saveFile(name, bytes);
      if (saved) { onSaved?.(bytes, saved); toast('Word document exported'); close(); }
    } catch (failure) { setError((failure as Error).message || String(failure)); }
    finally { setSaving(false); }
  }
  return <dialog ref={dialog} className="image-word-review" aria-labelledby="image-word-review-title" onCancel={event => { event.preventDefault(); if (!saving) close(); }}>
    <h2 id="image-word-review-title">Review image to Word conversion</h2>
    <p><strong>Write directly on the worksheet:</strong> add answers and crosses on the left. They export over the original page as Word text boxes. The scan itself stays unchanged.</p>
    <p>OCR creates editable text, not an exact copy of the page. Check handwriting, checkboxes and reading order. Tables and illustrations are preserved in the original image, not rebuilt as editable objects.</p>
    <div className="row wrap"><button className="btn" disabled={index === 0 || saving} onClick={() => setIndex(index - 1)}>Previous</button>
      <span aria-live="polite">Source page {index + 1} of {pages.length}: {page.sourceName}</span>
      <button className="btn" disabled={index === pages.length - 1 || saving} onClick={() => setIndex(index + 1)}>Next</button></div>
    <p className="muted">{page.savedWorksheet ? (page.text ? 'Saved worksheet. Your answers and included OCR text have been restored; recognition confidence was not retained. Check against the original.' : 'Saved worksheet. Your answers have been restored. This file does not include extracted OCR text.') : <>Detected language: {page.ocr.langs ?? 'selected language'}. {uncertain} word{uncertain === 1 ? '' : 's'} below 70% recognition confidence. Check the whole page; confidence is only an estimate.</>}</p>
    <div className="image-word-review-columns"><div>{url && <WorksheetEditor key={index} url={url} pageNumber={index + 1} notes={answers[index].present} onChange={updateAnswers} disabled={saving}
      undo={() => undoAnswer()} redo={() => undoAnswer(true)} canUndo={!!answers[index].past.length} canRedo={!!answers[index].future.length} />}</div>
      <label>Extracted OCR text for source page {index + 1} · optional export<textarea aria-label={`OCR text for source page ${index + 1}`} value={texts[index]} disabled={saving} spellCheck
        onChange={event => setTexts(current => current.map((text, i) => i === index ? event.target.value : text))} /></label></div>
    <label className="row"><input type="checkbox" aria-label="Include worksheet pages" checked={includeOriginals} disabled={saving || hasAnswers} onChange={event => { setIncludeOriginals(event.target.checked); if (!event.target.checked) setIncludeOcrText(true); }} />Include worksheet pages and your positioned answers (recommended)</label>
    <label className="row"><input type="checkbox" aria-label="Include extracted OCR text" checked={includeOcrText} disabled={saving} onChange={event => { setIncludeOcrText(event.target.checked); if (!event.target.checked) setIncludeOriginals(true); }} />Include extracted OCR text as additional Word pages (optional)</label>
    {hasAnswers && <p className="muted">Original pages are required to include your positioned answers and crosses.</p>}
    <p className="muted">By default, Word contains only the worksheet pages with your answers and crosses. The OCR text on the right is included only when you select the optional OCR checkbox. To export text only, deselect worksheet pages.</p>
    {error && <p role="alert">Export failed: {error}. Your corrections are still here.</p>}
    {saving && <p role="status">Exporting reviewed Word document…</p>}
    <div className="row wrap"><button className="btn" disabled={saving} onClick={close}>Cancel</button><button className="btn primary" disabled={saving} onClick={exportWord}>Export reviewed Word document</button></div>
  </dialog>;
}
