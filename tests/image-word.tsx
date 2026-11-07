import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import JSZip from 'jszip';
import { imagesToDocx, type DocxImageItem } from '../src/engines/docx';
import { canvasToBytes, decodeImage, imageToCanvas } from '../src/lib/image';
import ImageWordReview, { type WordReviewPage } from '../src/components/ImageWordReview';
import { fitWorksheetAnnotation, worksheetHeight, type WorksheetAnnotation } from '../src/engines/worksheet';
import '../src/styles.css';
import { readWorksheetDocument } from '../src/engines/worksheetDocument';
import { jsonToDocx } from '../src/engines/docx';
import DocEditor from '../src/editors/DocEditor';
import type { OpenFile } from '../src/lib/formats';

const state = window as Window & { __SOURCES?: { name: string; b64: string }[]; __IMAGE_WORD?: unknown };
const checks: { name: string; pass: boolean; error?: string }[] = [];
const files: { name: string; b64: string }[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const delay = () => new Promise(resolve => setTimeout(resolve, 30));
const wait = async (fn: () => unknown) => { for (let i = 0; i < 150; i++) { if (fn()) return; await delay(); } throw new Error('Timed out'); };
async function test(name: string, fn: () => unknown) { try { await fn(); checks.push({ name, pass: true }); } catch (e) { checks.push({ name, pass: false, error: String(e) }); } }
function keep(name: string, bytes: Uint8Array) {
  let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  files.push({ name, b64: btoa(binary) });
}
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = async (bytes: Uint8Array) => {
  const zip = await JSZip.loadAsync(bytes);
  return { zip, doc: new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'text/xml') };
};
const items: DocxImageItem[] = [];
for (const [index, [width, height]] of [[600, 1200], [1200, 600], [400, 2400], [500, 500]].entries()) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = ['#fff7d6', '#def4ff', '#f1e5ff', '#e2ffe2'][index]; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#314665'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, width - 16, height - 16);
  ctx.fillStyle = '#152b42'; ctx.font = '32px Arial'; ctx.fillText(`SOURCE ${index + 1}`, 28, 60);
  ctx.strokeRect(30, 100, width - 60, 100); ctx.beginPath(); ctx.moveTo(30, 150); ctx.lineTo(width - 30, 150); ctx.stroke();
  ctx.fillText('BOTTOM MARKER', 28, height - 24);
  items.push({ bytes: await canvasToBytes(c), mime: 'image/png', sourceName: `Synthetic ${index + 1}.png` });
}
let appearance: Uint8Array;
await test('mixed portrait, landscape, tall and square image pages have explicit fit and no break-only paragraphs', async () => {
  appearance = await imagesToDocx(items); keep('synthetic-appearance.docx', appearance);
  const { doc } = await xml(appearance);
  const sections = [...doc.getElementsByTagNameNS(W, 'sectPr')];
  const extents = [...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')];
  assert(sections.length === items.length && extents.length === items.length, 'Wrong source/page count');
  assert(doc.getElementsByTagNameNS(W, 'br').length === 0, 'Break-only paragraph reintroduced');
  sections.forEach((section, i) => {
    const size = section.getElementsByTagNameNS(W, 'pgSz')[0];
    const width = Number(size.getAttributeNS(W, 'w')), height = Number(size.getAttributeNS(W, 'h'));
    assert(Number(extents[i].getAttribute('cx')) <= (width - 1120) * 635, 'Image too wide');
    assert(Number(extents[i].getAttribute('cy')) <= (height - 1200) * 635, 'Image too tall');
    assert((width > height) === (i === 1), 'Incorrect page orientation');
  });
});
await test('PNG source bytes and selected source ordering survive Word export', async () => {
  const { zip, doc } = await xml(appearance!);
  const rel = new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels')!.async('string'), 'text/xml');
  const blips = [...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')];
  for (const [i, blip] of blips.entries()) {
    const rid = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
    const target = [...rel.documentElement.children].find(node => node.getAttribute('Id') === rid)!.getAttribute('Target')!;
    const bytes = await zip.file(`word/${target}`)!.async('uint8array');
    assert(bytes.length === items[i].bytes.length && bytes.every((b, j) => b === items[i].bytes[j]), 'Recompressed, missing or reordered image');
  }
});
await test('OCR export retains originals and Unicode corrections, with separate labeled text pages', async () => {
  const bytes = await imagesToDocx(items.slice(0, 2).map((item, i) => ({ ...item, text: `Korrigiert ${i + 1}: Grüße, Möbel und Straße.\ncheckbox needs review` })), { includeOriginals: true });
  const { doc } = await xml(bytes);
  assert(doc.getElementsByTagNameNS(W, 'sectPr').length === 4, 'Original and text pages not separated');
  assert(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent').length === 2, 'Originals missing');
  assert(doc.documentElement.textContent!.includes('Grüße, Möbel und Straße.'), 'Unicode correction lost');
  assert(doc.documentElement.textContent!.includes('source page 2'), 'Source labels missing');
});
await test('explicit text-only OCR output contains no image and explains reconstruction limits', async () => {
  const { doc } = await xml(await imagesToDocx([{ ...items[0], text: '' }]));
  assert(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent').length === 0, 'Text-only ignored');
  assert(doc.documentElement.textContent!.includes('No text was recognized') && doc.documentElement.textContent!.includes('not reconstructed'), 'Empty OCR or limits hidden');
});
await test('empty conversion fails instead of producing a meaningless document', async () => {
  let rejected = false; try { await imagesToDocx([]); } catch { rejected = true; } assert(rejected, 'Empty source accepted');
});
await test('OCR review keeps per-page edits, defaults to originals, and preserves drafts after canceled save', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); let closed = false, canceled = true, saved: Uint8Array | undefined;
  const beforePicker = window.showSaveFilePicker, beforeNative = window.docHubNative;
  window.showSaveFilePicker = async () => { if (canceled) throw new DOMException('Canceled', 'AbortError'); return { name: 'reviewed.docx', async createWritable() { return { async write(blob) { saved = new Uint8Array(await blob.arrayBuffer()); }, async close() {} }; } }; };
  const pages: WordReviewPage[] = items.slice(0, 2).map((item, i) => ({ ...item, sourceName: item.sourceName!, text: `Draft ${i + 1}`, ocr: { text: `Draft ${i + 1}`, width: 600, height: 1200, lines: [], langs: 'deu+eng' } }));
  try {
    flushSync(() => root.render(<ImageWordReview pages={pages} name="reviewed.docx" close={() => { closed = true; }} />));
    await wait(() => host.querySelector('dialog')?.open);
    const saveKey = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    textarea().dispatchEvent(saveKey); assert(saveKey.defaultPrevented, 'Save shortcut escaped to underlying editor');
    assert(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked, 'Originals not default');
    const ocrOption = host.querySelector<HTMLInputElement>('input[aria-label="Include extracted OCR text"]')!;
    assert(!ocrOption.checked, 'OCR pages should require explicit opt-in');
    flushSync(() => ocrOption.click());
    function textarea() { return host.querySelector<HTMLTextAreaElement>('textarea[aria-label^="OCR text"]')!; }
    const change = (text: string) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), text); textarea().dispatchEvent(new Event('input', { bubbles: true })); };
    flushSync(() => change('Meine korrigierten Grüße'));
    const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name)!;
    flushSync(() => button('Next').click()); assert(textarea().value === 'Draft 2', 'Edits leaked to another source');
    flushSync(() => button('Previous').click()); assert(textarea().value === 'Meine korrigierten Grüße', 'Edit lost on navigation');
    button('Export reviewed Word document').click(); await wait(() => !button('Export reviewed Word document').disabled);
    assert(!closed && textarea().value === 'Meine korrigierten Grüße', 'Canceled save discarded review');
    window.docHubNative = { async saveFile() { throw new Error('Synthetic disk full'); } } as NonNullable<Window['docHubNative']>;
    button('Export reviewed Word document').click(); await wait(() => host.querySelector('[role=alert]'));
    assert(host.querySelector('[role=alert]')!.textContent!.includes('disk full') && textarea().value === 'Meine korrigierten Grüße', 'Export failure hidden or draft lost');
    window.docHubNative = beforeNative;
    canceled = false; button('Export reviewed Word document').click(); await wait(() => closed);
    const { doc } = await xml(saved!); assert(doc.documentElement.textContent!.includes('Meine korrigierten Grüße'), 'Saved file lost corrected text');
  } finally { flushSync(() => root.unmount()); host.remove(); window.showSaveFilePicker = beforePicker; window.docHubNative = beforeNative; }
});
await test('worksheet answers wrap, stay inside the image, and reject invalid coordinates', async () => {
  const note = fitWorksheetAnnotation({ id: 'fit', kind: 'text', x: 0.99, y: 0.99, width: 0.3, size: 0.022, color: '#d32f2f', text: 'Grüße aus dem Wohnzimmer, neben dem Schreibtisch.' }, 0.5);
  assert(note.x + note.width <= 1 && note.y + worksheetHeight(note, 0.5) <= 1, 'Answer outside image');
  let failed = false; try { fitWorksheetAnnotation({ ...note, x: NaN }, 0.5); } catch { failed = true; } assert(failed, 'Invalid coordinates accepted');
});
await test('worksheet DOCX retains original pixels and native editable answer boxes without fill or borders', async () => {
  const notes: WorksheetAnnotation[] = [
    { id: 'answer', kind: 'text', x: 0.24, y: 0.35, width: 0.3, size: 0.022, color: '#d32f2f', text: 'Grüße vom Schreibtisch' },
    { id: 'cross', kind: 'cross', x: 0.31, y: 0.12, width: 0.04, size: 0.032, color: '#008a18', text: '' },
  ];
  const bytes = await imagesToDocx([{ ...items[0], annotations: notes }, { ...items[1], annotations: notes }]); keep('synthetic-answers.docx', bytes);
  const { zip, doc } = await xml(bytes);
  const shapes = [...doc.getElementsByTagNameNS('urn:schemas-microsoft-com:vml', 'shape')];
  assert(shapes.length === 4 && doc.getElementsByTagNameNS(W, 'sectPr').length === 2, 'Missing editable answers or incorrect page count');
  assert(doc.documentElement.textContent!.includes('Grüße') && doc.documentElement.textContent!.includes('×'), 'Answer text flattened or lost');
  assert(shapes.every(shape => shape.getAttribute('filled') === 'f' && shape.getAttribute('stroked') === 'f'), 'Answer box hides original');
  const restored = await readWorksheetDocument(bytes);
  assert(restored?.length === 2 && restored[0].annotations[0].text === notes[0].text && restored[1].annotations[1].x === notes[1].x, 'Editable worksheet project did not reopen');
  const media = await Promise.all(Object.values(zip.files).filter(file => file.name.startsWith('word/media/') && !file.dir).map(file => file.async('uint8array')));
  assert(media.length === 2 && media.some(bytes => bytes.every((b, i) => b === items[0].bytes[i]) && bytes.length === items[0].bytes.length), 'Source pixels changed');
  let failed = false; try { await imagesToDocx([{ ...items[0], text: 'OCR', annotations: notes }], { includeOriginals: false }); } catch { failed = true; } assert(failed, 'Answers silently omitted by text-only export');
});
await test('exported worksheets reopen in worksheet tools, save corrected answers, and reject stale externally edited data', async () => {
  const bytes = await imagesToDocx([{ ...items[0], text: 'Reviewed OCR', annotations: [{ id: 'reopen', kind: 'text', x: 0.2, y: 0.4, width: 0.3, size: 0.022, color: '#d32f2f', text: 'Saved answer' }] }], { includeOriginals: true });
  const file: OpenFile = { id: crypto.randomUUID(), name: 'worksheet.docx', kind: 'doc', bytes, dirty: false };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const beforePicker = window.showSaveFilePicker;
  let updated: Partial<OpenFile> | undefined;
  window.showSaveFilePicker = async () => ({ name: 'worksheet-v2.docx', async createWritable() { return { async write() {}, async close() {} }; } });
  try {
    flushSync(() => root.render(<DocEditor file={file} onChange={value => { updated = value; }} onFail={() => { throw new Error('Worksheet open failed'); }} />));
    await wait(() => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Answer on source page 1"]'));
    const answer = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Answer on source page 1"]')!;
    assert(answer.value === 'Saved answer' && !host.querySelector('[contenteditable=true]'), 'General rich-text importer used instead of worksheet tools');
    flushSync(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(answer, 'Changed after reopening'); answer.dispatchEvent(new Event('input', { bubbles: true })); });
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Export reviewed Word document')!.click();
    await wait(() => updated?.bytes);
    const reopened = await readWorksheetDocument(updated!.bytes!);
    assert(reopened![0].annotations[0].text === 'Changed after reopening' && updated!.name === 'worksheet-v2.docx', 'Second export lost edited answer or save target');
    const zip = await JSZip.loadAsync(bytes);
    zip.file('word/document.xml', (await zip.file('word/document.xml')!.async('string')).replace('Saved answer', 'External answer'));
    let rejected = false; try { await readWorksheetDocument(await zip.generateAsync({ type: 'uint8array' })); } catch { rejected = true; }
    assert(rejected, 'Stale project overwrote external Word edits');
    rejected = false; try { await jsonToDocx({ type: 'doc', content: [{ type: 'paragraph' }] }, 'Do not flatten', { bytes }); } catch { rejected = true; }
    assert(rejected, 'General serializer silently removed positioned answers');
  } finally { flushSync(() => root.unmount()); host.remove(); window.showSaveFilePicker = beforePicker; }
});
await test('ordinary Word saves do not remount the editor or discard newer text when saved bytes update', async () => {
  const bytes = await jsonToDocx({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ordinary Word document' }] }] });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const file: OpenFile = { id: crypto.randomUUID(), name: 'ordinary.docx', kind: 'doc', bytes, dirty: false };
  try {
    flushSync(() => root.render(<DocEditor file={file} onChange={() => {}} onFail={() => {}} />));
    await wait(() => host.querySelector<HTMLElement>('[contenteditable=true]')?.textContent?.includes('Ordinary Word document'));
    const editor = host.querySelector<HTMLElement>('[contenteditable=true]')!;
    const updated = await jsonToDocx({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Earlier saved bytes' }] }] });
    flushSync(() => root.render(<DocEditor file={{ ...file, bytes: updated }} onChange={() => {}} onFail={() => {}} />));
    await delay();
    assert(host.querySelector('[contenteditable=true]') === editor && editor.textContent!.includes('Ordinary Word document'), 'Save replaced mounted editor with older saved content');
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
await test('direct worksheet editing supports placement, typed answers, cross movement, undo, deletion and page navigation through export', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const beforePicker = window.showSaveFilePicker;
  let saved: Uint8Array | undefined, closed = false;
  window.showSaveFilePicker = async () => ({ name: 'worksheet.docx', async createWritable() { return { async write(blob) { saved = new Uint8Array(await blob.arrayBuffer()); }, async close() {} }; } });
  try {
    const pages: WordReviewPage[] = items.slice(0, 2).map(item => ({ ...item, sourceName: item.sourceName!, text: 'OCR remains separate', ocr: { text: 'OCR remains separate', lines: [], width: 600, height: 1200 } }));
    flushSync(() => root.render(<ImageWordReview pages={pages} name="worksheet.docx" close={() => { closed = true; }} />));
    await wait(() => host.querySelector<HTMLImageElement>('.worksheet-surface img')?.complete);
    const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name)!;
    const place = (x: number, y: number) => { const surface = host.querySelector<HTMLElement>('.worksheet-surface')!, r = surface.getBoundingClientRect(); flushSync(() => surface.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * x, clientY: r.top + r.height * y }))); };
    place(0.22, 0.35);
    const answer = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Answer on source page 1"]')!;
    assert(answer, 'Click did not create answer');
    flushSync(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(answer, 'Das Buch steht im Regal.'); answer.dispatchEvent(new Event('input', { bubbles: true })); });
    assert(host.querySelector<HTMLTextAreaElement>('textarea[aria-label^="OCR text"]')!.value === 'OCR remains separate', 'Source answer overwrote OCR');
    flushSync(() => button('Add cross ×').click()); place(0.32, 0.15);
    const mark = host.querySelector<HTMLElement>('.worksheet-answer.selected')!, x = mark.style.left;
    const handle = host.querySelector<HTMLButtonElement>('[aria-label="Move selected answer"]')!;
    // Pointer capture requires a hardware pointer; isolate that browser primitive while
    // exercising the actual component's down/move/up and scaled coordinate handling.
    handle.setPointerCapture = () => {};
    flushSync(() => handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 71, clientX: 100, clientY: 100, bubbles: true })));
    flushSync(() => handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 71, clientX: 120, clientY: 125, bubbles: true })));
    flushSync(() => handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 71, clientX: 120, clientY: 125, bubbles: true })));
    assert(host.querySelector<HTMLElement>('.worksheet-answer.selected')!.style.left !== x, 'Pointer drag failed');
    flushSync(() => button('Undo answer').click()); assert(host.querySelector<HTMLElement>('.worksheet-answer.selected')!.style.left === x, 'Drag created multiple undo steps or failed to undo');
    flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Move selected answer"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    assert(host.querySelector<HTMLElement>('.worksheet-answer.selected')!.style.left !== x, 'Keyboard move failed');
    flushSync(() => button('Undo answer').click()); assert(host.querySelector<HTMLElement>('.worksheet-answer.selected')!.style.left === x, 'Move not undone');
    flushSync(() => button('Delete answer').click()); assert(!host.querySelector('.worksheet-cross'), 'Cross not deleted');
    flushSync(() => button('Undo answer').click()); assert(host.querySelector('.worksheet-cross'), 'Cross not restored');
    flushSync(() => button('Next').click()); assert(host.querySelectorAll('[data-worksheet-note]').length === 0, 'Answers leaked to another page');
    flushSync(() => button('Previous').click()); await wait(() => host.querySelector<HTMLImageElement>('.worksheet-surface img')?.complete);
    assert(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Answer on source page 1"]')!.value === 'Das Buch steht im Regal.', 'Answer lost on navigation');
    assert(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.disabled, 'Annotated image can be accidentally omitted');
    button('Export reviewed Word document').click(); await wait(() => closed);
    const { doc } = await xml(saved!);
    assert(doc.getElementsByTagNameNS('urn:schemas-microsoft-com:vml', 'shape').length === 2 && doc.documentElement.textContent!.includes('Das Buch steht im Regal.'), 'Saved Word lost direct page edits');
    assert(doc.getElementsByTagNameNS(W, 'sectPr').length === 2 && !doc.documentElement.textContent!.includes('OCR remains separate'), 'Default export appended raw OCR pages');
    const reopened = await readWorksheetDocument(saved!);
    assert(reopened!.every(page => page.text === '') && reopened![0].annotations.length === 2, 'Excluded OCR persisted in hidden project data or answers were lost');
  } finally { flushSync(() => root.unmount()); host.remove(); window.showSaveFilePicker = beforePicker; }
});
await test('excluding OCR removes both visible text and hidden raw text while retaining editable answers', async () => {
  const bytes = await imagesToDocx([{ ...items[0], text: 'RAW_OCR_SHOULD_NOT_BE_SAVED', annotations: [{ id: 'answer-only', kind: 'text', text: 'My answer', color: '#d32f2f', size: 0.022, width: 0.3, x: 0.2, y: 0.4 }] }], { includeOriginals: true, includeOcrText: false });
  const { doc, zip } = await xml(bytes);
  assert(doc.getElementsByTagNameNS(W, 'sectPr').length === 1 && doc.documentElement.textContent!.includes('My answer'), 'Worksheet or positioned answer missing');
  assert(!(await zip.file('word/document.xml')!.async('string')).includes('RAW_OCR_SHOULD_NOT_BE_SAVED'), 'Raw OCR saved as visible text');
  assert(!(await zip.file('word/docaville-worksheet.xml')!.async('string')).includes('RAW_OCR_SHOULD_NOT_BE_SAVED'), 'Raw OCR saved in project data');
  const restored = await readWorksheetDocument(bytes);
  assert(restored![0].annotations[0].text === 'My answer' && restored![0].text === '', 'Worksheet cannot reopen without OCR');
});
await wait(() => state.__SOURCES !== undefined);
if (state.__SOURCES!.length) await test('real multi-image input converts in order and reaches OCR review export', async () => {
  const { ocrCanvas } = await import('../src/engines/ocr');
  const real: DocxImageItem[] = [];
  for (const source of state.__SOURCES!) {
    const bytes = Uint8Array.from(atob(source.b64), c => c.charCodeAt(0));
    const result = await ocrCanvas(imageToCanvas(await decodeImage(bytes, 'image/png')), 'auto');
    real.push({ bytes, mime: 'image/png', sourceName: source.name, text: result.text });
    assert(result.lines.length > 0, 'No source text recognized');
  }
  keep('worksheet-appearance.docx', await imagesToDocx(real.map(({ text: _text, ...item }) => item)));
  keep('worksheet-ocr-review.docx', await imagesToDocx(real, { includeOriginals: true }));
  keep('worksheet-answers.docx', await imagesToDocx(real.map((item, i) => ({ ...item, annotations: i === 0 ? [
    { id: 'sample-answer', kind: 'text', x: 0.48, y: 0.39, width: 0.25, size: 0.018, color: '#d32f2f', text: 'Das Buch steht im Regal.' },
    { id: 'sample-mark', kind: 'cross', x: 0.36, y: 0.18, width: 0.04, size: 0.026, color: '#008a18', text: '' },
  ] : [] })), { includeOriginals: true }));
});
state.__IMAGE_WORD = { checks, files };
