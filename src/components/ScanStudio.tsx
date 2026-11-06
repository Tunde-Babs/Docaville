import { useEffect, useState } from 'react';
import { autoCrop, prepareScan, ocrTable, FULL_CROP, type CropBox } from '../engines/scan';
import type { OcrResult } from '../engines/ocr';
import { normalizeImage, decodeImage, imageToCanvas, canvasToBytes } from '../lib/image';
import { renderEdited, DEFAULT_TRANSFORM, SCAN_PRESET } from '../engines/imageEdit';
import { OCR_LANGS } from '../lib/langs';
import { textHtml, delimitedRows } from '../engines/documentTools';
import { saveFile } from '../lib/fileio';
import { Btn, FilePick, run } from './ui';
export default function ScanStudio({ createDocument }: { createDocument: (name: string, html: string) => void }) {
  const [source, setSource] = useState<HTMLCanvasElement>(), [prepared, setPrepared] = useState<HTMLCanvasElement>(), [preview, setPreview] = useState(''), [crop, setCrop] = useState<CropBox>(FULL_CROP), [angle, setAngle] = useState(0), [enhance, setEnhance] = useState(false), [language, setLanguage] = useState('auto');
  const [ocr, setOcr] = useState<OcrResult>(), [table, setTable] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  async function load(files: File[]) {
    await run('Opening scan…', async () => { const image = (await normalizeImage(new Uint8Array(await files[0].arrayBuffer()), files[0].type))[0]; setSource(imageToCanvas(await decodeImage(image.bytes, image.mime))); setCrop(FULL_CROP); setAngle(0); setOcr(undefined); setTable(''); setStatus('Adjust the crop and rotation, then recognize text.'); });
  }
  useEffect(() => {
    if (!source) return;
    try { let canvas = prepareScan(source, crop, angle); if (enhance) canvas = renderEdited(canvas, DEFAULT_TRANSFORM, SCAN_PRESET); setPrepared(canvas); setPreview(canvas.toDataURL('image/jpeg', 0.75)); setOcr(undefined); setTable(''); }
    catch (error) { setStatus(String((error as Error).message)); setPrepared(undefined); }
  }, [source, crop, angle, enhance]);
  async function recognize() {
    if (!prepared) return; setBusy(true);
    try { const result = await (await import('../engines/ocr')).ocrCanvas(prepared, language, (progress, message) => setStatus(`${message} ${Math.round(progress * 100)}%`)); setOcr(result); setTable(ocrTable(result)); setStatus('Review highlighted words and correct the text before export. Table columns are an initial estimate.'); }
    catch (error) { setStatus(String((error as Error).message)); } finally { setBusy(false); }
  }
  const text = ocr?.lines.map(line => line.words.map(word => word.text).join(' ')).join('\n') ?? '';
  function updateWord(lineIndex: number, wordIndex: number, value: string) {
    setOcr(current => current ? { ...current, lines: current.lines.map((line, i) => i !== lineIndex ? line : { ...line, text: line.words.map((word, j) => j === wordIndex ? value : word.text).join(' '), words: line.words.map((word, j) => j === wordIndex ? { ...word, text: value, reviewed: true } : word) }) } : current);
  }
  return <div className="tool-content"><h2>Scan, correct, and extract</h2><p>Crop and straighten a photographed page, review OCR uncertainty, and turn it into searchable PDFs, editable text, or spreadsheet data.</p>
    <div className="row wrap"><FilePick accept="image/*,.heic,.tif,.tiff" onFiles={load}>Choose page image</FilePick><label className="btn">Take a photo<input className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={e => { if (e.target.files?.length) void load([...e.target.files]); e.target.value = ''; }} /></label></div>
    {source && <><fieldset disabled={busy}><legend>Prepare page</legend><div className="row wrap"><Btn onClick={() => setCrop(autoCrop(source))}>Suggest crop</Btn><Btn onClick={() => setCrop(FULL_CROP)}>Reset crop</Btn><Btn onClick={() => setAngle(a => (a + 90) % 360)}>Rotate 90°</Btn><label>Straighten / rotate <input type="number" min={-360} max={360} step={0.5} value={angle} onChange={e => setAngle(+e.target.value)} />°</label><label className="inline"><input type="checkbox" checked={enhance} onChange={e => setEnhance(e.target.checked)} /> Enhance for reading</label></div>
      <div className="row wrap">{(['left', 'top', 'right', 'bottom'] as const).map(edge => <label key={edge}>Crop {edge} % <input type="number" min={0} max={100} value={Math.round(crop[edge] * 10) / 10} onChange={e => setCrop(current => ({ ...current, [edge]: Math.max(0, Math.min(100, +e.target.value)) }))} /></label>)}</div></fieldset>
      {prepared && <img className="scan-preview" src={preview} alt="Prepared scan preview" />}
      <div className="row wrap"><label>OCR language <select disabled={busy} value={language} onChange={e => setLanguage(e.target.value)}>{Object.entries(OCR_LANGS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><Btn primary disabled={busy || !prepared} onClick={recognize}>Recognize text</Btn><Btn disabled={!prepared || busy} onClick={() => run('Exporting scan…', async () => saveFile('Prepared-scan.png', await canvasToBytes(prepared!)))}>Export prepared image</Btn></div>
    </>}
    <p role="status">{status}</p>
    {ocr && <><h3>Correct recognized words</h3><p>Amber fields have recognition confidence below 70%. Confidence is an estimate, so check names and amounts throughout.</p><div className="ocr-corrections">{ocr.lines.map((line, i) => <div key={i} className="ocr-line">{line.words.map((word, j) => <input key={j} className={!word.reviewed && word.conf < 70 ? 'uncertain-word' : ''} aria-label={`Line ${i + 1} word ${j + 1}: ${word.reviewed ? 'reviewed by you' : `${Math.round(word.conf)}% confidence`}`} title={word.reviewed ? 'Reviewed by you' : `${Math.round(word.conf)}% confidence`} value={word.text} style={{ width: `${Math.max(4, Math.min(24, word.text.length + 2))}ch` }} onChange={e => updateWord(i, j, e.target.value)} />)}</div>)}</div>
      <div className="row wrap"><Btn onClick={() => createDocument('Recognized document', textHtml(text))}>Open corrected text in Word</Btn><Btn onClick={() => run('Exporting searchable PDF…', async () => { const { imagesToPdf } = await import('../engines/pdf'), { addTextLayer } = await import('../engines/ocr'); const bytes = await canvasToBytes(prepared!); const result = await imagesToPdf([{ bytes, mime: 'image/png' }], { pageSize: 'fit', dpi: 200, margin: 0 }); const item = result.pages[0]; await addTextLayer(result.doc, item.page, { ...ocr, text }, item.box); await saveFile('Searchable-scan.pdf', await result.doc.save()); })}>Export searchable PDF</Btn></div>
      <h3>Table extraction</h3><Btn onClick={() => setTable(ocrTable(ocr))}>Rebuild table from corrected words</Btn><p>Correct the tab-separated rows below before exporting. Text is kept as text in Excel to preserve identifiers and leading zeros.</p><textarea className="large-input" aria-label="Extracted scan table" value={table} onChange={e => setTable(e.target.value)} /><Btn disabled={!table.trim()} onClick={() => run('Exporting spreadsheet…', async () => { const { loadWorkbook, saveXlsx } = await import('../engines/sheet'); const wb = await loadWorkbook(null); delimitedRows(table).forEach((row, i) => row.forEach((value, j) => { wb.worksheets[0].getCell(i + 1, j + 1).value = value; })); await saveFile('Scan-table.xlsx', await saveXlsx(wb)); })}>Export table .xlsx</Btn>
    </>}
  </div>;
}
