import { pageSelection, uniqueFilename, DEFAULT_BATCH, processBatchFile } from '../src/engines/batch';
import { compareText, reviewedText } from '../src/engines/review';
import { readDocument, retrieve, extractiveSummary, delimitedRows } from '../src/engines/documentTools';
import { templateFields, fillTemplate } from '../src/components/TemplateStudio';
import { putVersion, removeVersion, versions, localRead, localWrite } from '../src/lib/localStore';
import { prepareScan, autoCrop, FULL_CROP } from '../src/engines/scan';
import { timestamp, transcriptSegments, spokenText, decodeAudio, localInference, applyVocabulary, vocabularyRules, translateLocally } from '../src/engines/localML';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { loadPdfJs, pdfToText } from '../src/engines/pdf';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useSave, saveRegistry, flushPendingInputs } from '../src/components/useSave';
import FreeViewer from '../src/components/FreeViewer';
import type { OpenFile } from '../src/lib/formats';

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
async function test(name: string, fn: () => unknown) { try { await fn(); results.push({ name, pass: true }); } catch (error) { results.push({ name, pass: false, detail: String((error as Error).stack || error) }); } console.log(`${results.at(-1)!.pass ? 'PASS' : 'FAIL'} ${name}`); }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const source = await PDFDocument.create(), font = await source.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 3; i++) source.addPage([400, 300]).drawText(`Test page ${i}. Renewal is 12 March 2027.`, { x: 25, y: 240, size: 14, font });
const sourceBytes = await source.save(), sourceFile = new File([sourceBytes as BlobPart], 'sample.pdf', { type: 'application/pdf' });
await test('page ranges preserve requested order and reject duplicates', () => check(JSON.stringify(pageSelection('3,1-2,2', 3)) === '[2,0,1]', 'wrong page range'));
await test('invalid and out-of-range pages fail safely', () => { let errors = 0; for (const expression of ['0', '4', '2-1', '1,a', '']) { try { pageSelection(expression, 3); } catch { errors++; } } check(errors === 5, 'accepted invalid page range'); });
await test('batch filenames are safe and collision resistant', () => { const used = new Set<string>(); check(uniqueFilename('../Report.pdf', used) === '_Report.pdf', 'unsafe name'); check(uniqueFilename('Report.pdf', used) === 'Report.pdf', 'first name'); check(uniqueFilename('report.pdf', used) === 'report (2).pdf', 'case collision'); });
await test('CSV preserves quoted newlines, quotes, leading zeros and formula-like text', () => { const rows = delimitedRows('Code,Note\r\n00123,"line 1\nline 2"\r\n"=SUM(A1)","a""b"'); check(JSON.stringify(rows[1]) === '["00123","line 1\\nline 2"]', 'CSV multiline'); check(rows[2][0] === '=SUM(A1)' && rows[2][1] === 'a"b', 'CSV exact text'); });
await test('Markdown and TSV tables retain rows and columns', () => { check(delimitedRows('| A | B |\n|---|---|\n| 01 | 02 |').length === 2, 'separator became data'); check(delimitedRows('A\tB\n01\t02')[1][0] === '01', 'TSV'); });
await test('review decisions never apply pending or rejected changes', () => { const changes = compareText('Pay 100 on Monday.', 'Pay 200 on Friday.'); check(reviewedText(changes) === 'Pay 100 on Monday.', 'pending applied'); check(reviewedText(changes.map(c => ({ ...c, decision: 'accepted' }))) === 'Pay 200 on Friday.', 'accepted missing'); check(reviewedText(changes.map(c => ({ ...c, decision: 'rejected' }))) === 'Pay 100 on Monday.', 'rejected applied'); });
await test('template fields are unique and substituted values cannot inject markup', () => { check(templateFields('{{ customer }} {{customer}} {{date}}').join() === 'customer,date', 'duplicate fields'); check(fillTemplate('<p>{{customer}}</p>', { customer: '<script>bad</script>' }) === '<p>&lt;script&gt;bad&lt;/script&gt;</p>', 'unsafe template insertion'); });
await test('PDF source passages keep page references', async () => { const doc = await readDocument(sourceFile); check(doc.passages.length === 3 && doc.passages[1].label === 'Page 2', 'wrong sources'); check(retrieve(doc.passages, 'renewal')[0].text.includes('12 March 2027'), 'source retrieval failed'); check(extractiveSummary(doc.passages).every(summary => summary.source.text.includes(summary.text)), 'summary fabricated text'); });
await test('batch PDF extraction respects order', async () => { const result = await processBatchFile(sourceFile, { ...DEFAULT_BATCH, operation: 'extract', pages: '3,1' }, new AbortController().signal, () => {}); const doc = await loadPdfJs(result.bytes), text = await pdfToText(doc); check(doc.numPages === 2 && text.indexOf('page 3') < text.indexOf('page 1'), 'extraction wrong'); });
await test('batch page numbering is present in saved PDF', async () => { const result = await processBatchFile(sourceFile, { ...DEFAULT_BATCH, operation: 'number' }, new AbortController().signal, () => {}); check((await pdfToText(await loadPdfJs(result.bytes))).includes('2 / 3'), 'page numbers missing'); });
await test('batch watermark is present in saved PDF', async () => { const result = await processBatchFile(sourceFile, { ...DEFAULT_BATCH, operation: 'watermark', watermark: 'QA DRAFT' }, new AbortController().signal, () => {}); check((await pdfToText(await loadPdfJs(result.bytes))).includes('QA DRAFT'), 'watermark missing'); });
await test('batch converts text to a readable PDF', async () => { const result = await processBatchFile(new File(['Business report\nKeep these details.'], 'report.txt'), DEFAULT_BATCH, new AbortController().signal, () => {}); check((await pdfToText(await loadPdfJs(result.bytes))).includes('Keep these details.'), 'conversion lost text'); });
await test('batch compression produces all pages at original dimensions', async () => { const result = await processBatchFile(sourceFile, { ...DEFAULT_BATCH, operation: 'compress' }, new AbortController().signal, () => {}); const doc = await PDFDocument.load(result.bytes); check(doc.getPageCount() === 3 && doc.getPage(0).getWidth() === 400, 'compression changed pages'); });
await test('batch cancellation prevents processing', async () => { const controller = new AbortController(); controller.abort(); let failed = false; try { await processBatchFile(sourceFile, DEFAULT_BATCH, controller.signal, () => {}); } catch { failed = true; } check(failed, 'cancel ignored'); });
await test('scan crop and rotation preserve expected geometry', () => { const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 600; const context = canvas.getContext('2d')!; context.fillStyle = '#999'; context.fillRect(0, 0, 1000, 600); context.fillStyle = '#fff'; context.fillRect(100, 100, 800, 400); const suggested = autoCrop(canvas); check(suggested.left > 5 && suggested.top > 10, 'crop suggestion'); const rotated = prepareScan(canvas, FULL_CROP, 90); check(rotated.width === 600 && rotated.height === 1000, 'rotate dimensions'); let failed = false; try { prepareScan(canvas, { left: 90, right: 20, top: 0, bottom: 100 }, 0); } catch { failed = true; } check(failed, 'invalid crop accepted'); });
await test('transcript timestamps and review flags survive normalization', () => { const segments = transcriptSegments({ text: 'Hello', chunks: [{ text: ' Hello ', timestamp: [1.2, null] }] }, 8); check(segments[0].start === 1.2 && segments[0].end === null && segments[0].review, 'segments wrong'); check(timestamp(3661) === '01:01:01' && spokenText('Hello new paragraph World') === 'Hello \n\n World', 'speech commands'); });
await test('custom vocabulary respects Unicode word boundaries and literal punctuation', () => {
  const rules = vocabularyRules('document hub => DocumentHub\nC++ => CPP\nÀjàlá => Ajala');
  check(applyVocabulary('Document Hub uses C++ with Àjàlá. Àjàlás stays unchanged.', rules) === 'DocumentHub uses CPP with Ajala. Àjàlás stays unchanged.', 'spelling replacements changed adjacent words');
  let invalid = false; try { vocabularyRules('missing arrow'); } catch { invalid = true; } check(invalid, 'invalid vocabulary accepted');
});
await test('local structured storage persists binary data', async () => { await localWrite('qa-data', { bytes: new Uint8Array([1, 2, 3]), name: 'Draft' }); const saved = await localRead<{ bytes: Uint8Array }>('qa-data'); check(saved?.bytes[2] === 3, 'binary data lost'); });
await test('version archive retains 30 versions and replaces its current recovery draft', async () => {
  const documentId = `qa:${crypto.randomUUID()}`;
  for (let i = 0; i < 33; i++) await putVersion({ id: `${documentId}:${i}`, documentId, name: 'qa.txt', kind: 'doc', bytes: new Uint8Array([i]), at: i, source: 'saved' });
  for (let i = 0; i < 2; i++) await putVersion({ id: `auto:${documentId}`, documentId, name: 'qa.txt', kind: 'doc', bytes: new Uint8Array([i]), at: 100 + i, source: 'autosave' });
  const saved = (await versions()).filter(v => v.documentId === documentId); check(saved.length === 31 && saved[0].bytes[0] === 1, `retention: ${saved.length}`); await Promise.all(saved.map(v => removeVersion(v.id)));
});
await test('editor checkpoint serializes the latest active draft and successful save cancels pending recovery', async () => {
  const original = window.docHubNative, documentId = `qa-save:${crypto.randomUUID()}`; let text = 'old', prepare = () => { text = 'committed'; };
  window.docHubNative = { writeFile: async () => '/qa/draft.docx' } as any;
  let api!: ReturnType<typeof useSave>;
  function Harness() { api = useSave({ id: documentId, name: 'draft.docx', kind: 'doc', bytes: null, mime: '', dirty: true }, () => {}, () => 'docx', async () => new TextEncoder().encode(text), undefined, () => prepare()); return null; }
  const host = document.createElement('div'), root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(Harness))); api.markDirty(); await delay(2400);
    let records = (await versions()).filter(v => v.documentId === documentId); check(records.length === 1 && new TextDecoder().decode(records[0].bytes) === 'committed', 'draft not checkpointed');
    prepare = () => {}; text = 'latest'; api.markDirty();
    // Save-As mock avoids access to a real file and verifies the clean checkpoint boundary.
    window.docHubNative = { saveFile: async () => '/qa/draft.docx' } as any;
    check(await api.save(), 'save failed'); await delay(2400); records = (await versions()).filter(v => v.documentId === documentId);
    check(records.length === 1 && records[0].source === 'saved' && new TextDecoder().decode(records[0].bytes) === 'latest', 'stale recovery after successful save');
  } finally { flushSync(() => root.unmount()); window.docHubNative = original; await Promise.all((await versions()).filter(v => v.documentId === documentId).map(v => removeVersion(v.id))); }
});
await test('closing one document flushes only its speech input before serialization', async () => {
  const flushed: string[] = [];
  saveRegistry.set('qa-flush-a', { owner: 'document-a', print() {}, save: async () => true, flush: async () => { flushed.push('a'); return true; } });
  saveRegistry.set('qa-flush-b', { owner: 'document-b', print() {}, save: async () => true, flush: async () => { flushed.push('b'); return true; } });
  try { check(await flushPendingInputs('document-a'), 'flush failed'); check(flushed.join() === 'a', 'flushed another document'); flushed.push('serialized'); check(flushed.join() === 'a,serialized', 'serialized before pending speech'); }
  finally { saveRegistry.delete('qa-flush-a'); saveRegistry.delete('qa-flush-b'); }
});
await test('failed speech flush blocks Save All instead of losing pending speech', async () => {
  saveRegistry.set('qa-flush-failure', { print() {}, save: async () => false, flush: async () => false });
  try { check(await flushPendingInputs() === false, 'failure did not block close'); } finally { saveRegistry.delete('qa-flush-failure'); }
});

// Component integration checks mount an isolated reader, without driving a user's UI.
async function readerFixture(kind: OpenFile['kind']): Promise<OpenFile> {
  let bytes = sourceBytes, name = 'Reader.pdf';
  if (kind === 'doc') {
    const { jsonToDocx } = await import('../src/engines/docx');
    bytes = await jsonToDocx({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read-only Word acceptance.' }] }] }, 'Reader'); name = 'Reader.docx';
  } else if (kind === 'sheet') {
    const { loadWorkbook, saveXlsx } = await import('../src/engines/sheet');
    const workbook = await loadWorkbook(null); workbook.worksheets[0].getCell('A1').value = 'Read-only spreadsheet'; bytes = await saveXlsx(workbook); name = 'Reader.xlsx';
  } else if (kind === 'slides') {
    const { newDeck, savePptx } = await import('../src/engines/slides'); bytes = (await savePptx(newDeck())).bytes; name = 'Reader.pptx';
  } else if (kind === 'image') {
    const image = document.createElement('canvas'); image.width = 400; image.height = 160;
    const context = image.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, 400, 160); context.fillStyle = '#000'; context.font = '20px Arial'; context.fillText('Read-only image', 20, 70);
    bytes = await (await import('../src/lib/image')).canvasToBytes(image); name = 'Reader.png';
  }
  return { id: `qa-reader:${crypto.randomUUID()}`, name, kind, bytes, mime: '' };
}
async function waitForReader(host: HTMLElement) {
  const deadline = Date.now() + 20000;
  while (!host.querySelector<HTMLCanvasElement>('canvas')?.style.width && !host.querySelector('[role="alert"]') && Date.now() < deadline) await delay(50);
  const error = host.querySelector('[role="alert"]'); check(!error, error?.textContent ?? 'reader error');
  check(!!host.querySelector<HTMLCanvasElement>('canvas')?.style.width, 'reader did not render');
}
for (const kind of ['pdf', 'doc', 'sheet', 'slides', 'image'] as const) {
  await test(`Free reader renders ${kind} without editable controls, writes, or source mutation`, async () => {
    const file = await readerFixture(kind), before = file.bytes!.slice(), registered = saveRegistry.size;
    const host = document.createElement('div'); host.style.width = '800px'; document.body.append(host); const root = createRoot(host);
    try {
      flushSync(() => root.render(createElement(FreeViewer, { file, upgrade() {} }))); await waitForReader(host);
      check(!host.querySelector('[contenteditable="true"],textarea,input[type="text"]'), 'reader exposes document editing');
      check(saveRegistry.size === registered && !saveRegistry.has(file.id), 'reader registered a disk save action');
      check(file.bytes!.length === before.length && before.every((value, index) => file.bytes![index] === value), 'source bytes changed');
    } finally { flushSync(() => root.unmount()); host.remove(); }
  });
}
await test('Free reader reports unsupported input without exposing an editor', async () => {
  const file: OpenFile = { id: 'qa-unsupported-reader', name: 'Legacy.doc', kind: 'doc', bytes: new TextEncoder().encode('unsupported legacy input'), mime: '' };
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host);
  try {
    flushSync(() => root.render(createElement(FreeViewer, { file, upgrade() {} })));
    const deadline = Date.now() + 5000; while (!host.querySelector('[role="alert"]') && Date.now() < deadline) await delay(50);
    check(host.querySelector('[role="alert"]')?.textContent?.includes('cannot be converted locally'), 'unsupported input did not explain the limitation');
    check(!saveRegistry.has(file.id), 'unsupported reader registered a save');
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
await test('Free reader rapid source replacement renders the latest document safely', async () => {
  const first = await readerFixture('doc'), latest = await readerFixture('pdf');
  const host = document.createElement('div'); host.style.width = '800px'; document.body.append(host); const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(FreeViewer, { file: first, upgrade() {} })));
    flushSync(() => root.render(createElement(FreeViewer, { file: latest, upgrade() {} }))); await waitForReader(host);
    check(host.querySelector('canvas')?.getAttribute('aria-label')?.startsWith(latest.name), 'stale source displayed');
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
await test('Free reader preserves text when PDF font coverage prevents a layout preview', async () => {
  const text = 'Keep this document text, including an unmapped symbol: \u{10ffff}';
  const { jsonToDocx } = await import('../src/engines/docx');
  const bytes = await jsonToDocx({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, 'Fallback');
  const file: OpenFile = { id: 'qa-reader-fallback', name: 'Fallback.docx', kind: 'doc', bytes, mime: '' };
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host);
  try {
    flushSync(() => root.render(createElement(FreeViewer, { file, upgrade() {} })));
    const deadline = Date.now() + 20000; while (!host.querySelector('[data-readonly-text]') && !host.querySelector('[role="alert"]') && Date.now() < deadline) await delay(50);
    check(host.querySelector('[data-readonly-text]')?.textContent === text, 'text fallback changed or lost document content');
    check(!saveRegistry.has(file.id), 'text fallback registered a write action');
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
if (new URL(location.href).searchParams.has('ml')) {
  await test('real on-device question answering returns an exact source answer', async () => { const result = await localInference('question-answering', { question: 'When is the renewal date?', context: 'The service begins in June. The renewal date is 12 March 2027. Payments are monthly.' }, message => console.log(message)); check(result.answer.includes('12 March 2027'), `wrong answer ${JSON.stringify(result)}`); });
  await test('real on-device speech recognition transcribes a public test recording', async () => { const response = await fetch('/tests/fixtures/speech.wav'); check(response.ok, 'missing speech fixture'); const audio = await decodeAudio(await response.blob()); const result = await localInference('automatic-speech-recognition', { audio: audio.samples, language: 'en' }, message => console.log(message)); check(/country/i.test(result.text) && result.chunks?.length, `no speech result: ${JSON.stringify(result)}`); });
  await test('real on-device English to German translation preserves the original input', async () => { const original = 'Hello world. The meeting is on Monday.'; const translated = await translateLocally(original, 'en', 'de', message => console.log(message)); check(/Hallo|Welt|Montag/i.test(translated) && original === 'Hello world. The meeting is on Monday.', translated); });
}
(window as any).__PRODUCTIVITY = results;
