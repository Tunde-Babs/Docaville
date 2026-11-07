import { lazy, Suspense, useState } from 'react';
import { ACCEPT, type DocKind, type OpenFile } from '../lib/formats';
import { FilePick, run, setBusy, toast } from './ui';
import { saveFile, isNativeMobile } from '../lib/fileio';
import { normalizeImage, decodeImage, imageToCanvas } from '../lib/image';
import { OCR_LANGS } from '../lib/langs';
import { TEMPLATES, type Template } from '../lib/templates';
import { PRODUCTIVITY_TOOLS, type ProductivityTool } from './ProductivityHub';
import AppInfo from './AppInfo';
import type { WordReviewPage } from './ImageWordReview';
const MobileDocuments = lazy(() => import('./MobileDocuments'));
const ImageWordReview = lazy(() => import('./ImageWordReview'));

const GROUPS: [DocKind, string][] = [['doc', 'Word'], ['sheet', 'Excel'], ['slides', 'PowerPoint'], ['pdf', 'PDF']];

interface Props { onOpen: (f: File[]) => void; onOpenSaved: (file: OpenFile) => void; onCreate: (kind: DocKind, name: string, bytes?: Uint8Array | null, template?: string) => void; onTool: (tool: ProductivityTool) => void; recoveryCount: number; proAccess: boolean; onUpgrade: () => void }

type Target = 'pdf' | 'pdf-ocr' | 'docx-images' | 'docx-ocr';

export default function Home({ onOpen, onOpenSaved, onCreate, onTool, recoveryCount, proAccess, onUpgrade }: Props) {
  const [images, setImages] = useState<File[]>([]);
  const [target, setTarget] = useState<Target>('pdf');
  const [pageSize, setPageSize] = useState<'fit' | 'a4' | 'letter'>('a4');
  const [lang, setLang] = useState('auto');
  const [wordReview, setWordReview] = useState<{ pages: WordReviewPage[]; name: string } | null>(null);

  async function createFrom(t: Template) {
    if (!proAccess) { onUpgrade(); return; }
    if (t.kind === 'pdf') {
      const bytes = await run('Creating PDF…', async () => (await import('../lib/templates')).pdfTemplate(t.id));
      if (bytes) onCreate('pdf', t.file, bytes, t.id);
    } else onCreate(t.kind, t.file, null, t.id);
  }

  async function convert() {
    if (!proAccess) { onUpgrade(); return; }
    await run('Converting…', async () => {
      const imgs: { bytes: Uint8Array; mime: string; sourceName: string }[] = [];
      // Decode one source at a time. Keep multi-page TIFF/HEIC frames next to their source
      // and avoid decoding an entire batch concurrently on memory-constrained devices.
      for (const file of images) {
        const frames = await normalizeImage(new Uint8Array(await file.arrayBuffer()), file.type);
        frames.forEach((frame, i) => imgs.push({ ...frame, sourceName: frames.length > 1 ? `${file.name} — frame ${i + 1}` : file.name }));
      }
      if (target === 'pdf' || target === 'pdf-ocr') {
        const { imagesToPdf } = await import('../engines/pdf');
        const pdf = await imagesToPdf(imgs, { pageSize, dpi: 300, margin: pageSize === 'fit' ? 0 : 28 });
        let bytes: Uint8Array;
        if (target === 'pdf-ocr') {
          const { makeSearchable } = await import('../engines/ocr');
          const canvases = await Promise.all(imgs.map(async (i) => imageToCanvas(await decodeImage(i.bytes, i.mime))));
          bytes = await makeSearchable(pdf, canvases, lang, setBusy);
        } else bytes = await pdf.doc.save();
        await saveFile(images.length === 1 ? images[0].name.replace(/\.[^.]+$/, '.pdf') : 'Converted.pdf', bytes);
      } else {
        const { imagesToDocx } = await import('../engines/docx');
        const pages: WordReviewPage[] = [];
        for (const [i, im] of imgs.entries()) {
          if (target === 'docx-ocr') {
            const { ocrCanvas } = await import('../engines/ocr');
            const canvas = imageToCanvas(await decodeImage(im.bytes, im.mime));
            const res = await ocrCanvas(canvas, lang, (p, s) => setBusy(`Image ${i + 1}/${imgs.length}: ${s} ${Math.round(p * 100)}%`));
            pages.push({ ...im, ocr: res, text: res.text });
          }
        }
        const name = images.length === 1 ? images[0].name.replace(/\.[^.]+$/, '.docx') : 'Converted.docx';
        if (target === 'docx-ocr') { setWordReview({ pages, name }); return; }
        await saveFile(name, await imagesToDocx(imgs));
      }
      toast('Conversion complete');
    });
  }

  async function mergePdfs(files: File[]) {
    if (!proAccess) { onUpgrade(); return; }
    await run('Merging PDFs…', async () => {
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      for (const f of files) {
        const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
      }
      await saveFile('Merged.pdf', await out.save());
    });
  }

  return (
    <div className="home-page">
      {wordReview && <Suspense fallback={<p>Opening conversion review…</p>}><ImageWordReview {...wordReview} close={() => setWordReview(null)} /></Suspense>}
      <section className="hero">
        <img className="hero-logo" src="./logo.svg" alt="" width={84} height={84} />
        <div className="hero-text">
          <h1>Docaville</h1>
          <p>Open, edit and convert PDF, Word, Excel, PowerPoint and images — on Windows, macOS, iOS and Android.</p>
          <div className="row wrap">
            <FilePick accept={ACCEPT} multiple onFiles={onOpen}>📂 Open files…</FilePick>
            <span className="hero-hint">or drop files anywhere</span>
          </div>
        </div>
        <div className="hero-chips" aria-hidden="true">
          <span className="chip kind-doc">DOCX</span><span className="chip kind-sheet">XLSX</span>
          <span className="chip kind-slides">PPTX</span><span className="chip kind-pdf">PDF</span><span className="chip kind-image">OCR</span>
        </div>
      </section>

      {!proAccess && <p className="panel">Viewing is free. Pro unlocks editing, creation, conversion, and productivity tools. Previously saved recovery data remains accessible.</p>}
      {isNativeMobile() && <Suspense fallback={<p>Opening saved copies…</p>}><MobileDocuments onOpen={onOpenSaved} /></Suspense>}

      <section><h2>Work smarter</h2>{recoveryCount > 0 && <button className="recovery-banner" onClick={() => onTool('recovery')}>{recoveryCount} local recovery draft{recoveryCount === 1 ? '' : 's'} available — review and restore</button>}<div className="cards">{PRODUCTIVITY_TOOLS.map(([id, icon, label, description]) => <button key={id} className="card" onClick={() => onTool(id)}><span className="card-icon">{icon}</span>{label}<small>{description}</small></button>)}</div></section>

      <section>
        <h2>Create new</h2>
        {GROUPS.map(([kind, label]) => (
          <div key={kind} className={`template-group kind-${kind}`}>
            <h3><i className="dot" />{label}</h3>
            <div className="cards">
              {TEMPLATES.filter((t) => t.kind === kind).map((t) => (
                <button key={t.id} className="card" onClick={() => createFrom(t)}>
                  <span className="card-icon">{t.icon}</span>{t.title}<small>{t.desc}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Convert images → PDF / Word</h2>
        <p className="muted">PNG, JPEG, WebP, GIF, BMP, AVIF, SVG, TIFF (multi-page) and HEIC. PNG/JPEG are embedded byte-for-byte — no recompression.</p>
        <div className="row wrap">
          <FilePick accept="image/*,.heic,.heif,.tif,.tiff" multiple onFiles={(f) => setImages((cur) => [...cur, ...f])}>➕ Add images</FilePick>
          {images.length > 0 && <button className="btn" onClick={() => setImages([])}>Clear ({images.length})</button>}
        </div>
        {images.length > 0 && (
          <ol className="filelist">
            {images.map((f, i) => (
              <li key={i}>{f.name}
                <span>
                  <button disabled={i === 0} onClick={() => setImages((a) => { const b = [...a]; [b[i - 1], b[i]] = [b[i], b[i - 1]]; return b; })}>↑</button>
                  <button onClick={() => setImages((a) => a.filter((_, j) => j !== i))}>✕</button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="row wrap">
          <label>Output
            <select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
              <option value="pdf">PDF (exact image quality)</option>
              <option value="pdf-ocr">Searchable PDF (image + OCR text layer)</option>
              <option value="docx-images">Word .docx (preserve appearance as images)</option>
              <option value="docx-ocr">Word .docx (worksheet answers / optional OCR)</option>
            </select>
          </label>
          {target.startsWith('pdf') && (
            <label>Page
              <select value={pageSize} onChange={(e) => setPageSize(e.target.value as typeof pageSize)}>
                <option value="a4">A4</option><option value="letter">US Letter</option><option value="fit">Fit to image (300 DPI)</option>
              </select>
            </label>
          )}
          {target.includes('ocr') && (
            <label>OCR language
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {Object.entries(OCR_LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                <option value="deu+eng">German + English</option>
                <option value="fra+eng">French + English</option>
              </select>
            </label>
          )}
          <button className="btn primary" disabled={!images.length} onClick={convert}>Convert{!proAccess && ' · Pro'}</button>
        </div>
        {target === 'docx-images' && <p className="muted">Preserves diagrams, tables and handwriting as images, one source page per Word page. Text inside the images is not editable.</p>}
        {target === 'docx-ocr' && <p className="muted">Review and correct recognized text beside each source before exporting. Original images are included by default. OCR does not reconstruct editable tables or illustrations and may misread handwriting and columns.</p>}
      </section>

      <section className="panel">
        <h2>More tools</h2>
        <div className="row wrap">
          {proAccess ? <FilePick accept=".pdf" multiple onFiles={mergePdfs}>🧩 Merge PDFs</FilePick> : <button className="btn" onClick={onUpgrade}>Merge PDFs · Pro</button>}
          <FilePick accept="image/*,.heic,.tif,.tiff" onFiles={onOpen}>{proAccess ? '🔍 OCR / edit an image' : 'View an image'}</FilePick>
          <FilePick accept=".pdf" onFiles={onOpen}>{proAccess ? '✏️ Edit a PDF' : 'View a PDF'}</FilePick>
        </div>
      </section>
      <AppInfo />
    </div>
  );
}
