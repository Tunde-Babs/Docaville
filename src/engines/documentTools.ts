import { detectKind } from '../lib/formats';
export interface Passage { id: string; label: string; text: string }
export interface TextDocument { name: string; passages: Passage[] }
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function textHtml(text: string) { return text.split(/\n/).map(line => `<p>${escapeHtml(line) || '<br>'}</p>`).join(''); }
export async function readDocument(file: File, progress?: (text: string) => void): Promise<TextDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer()), kind = detectKind(file.name, file.type);
  const parts: { label: string; text: string }[] = [];
  if (kind === 'pdf') {
    const { loadPdfJs, pdfPageToCanvas, extractLines } = await import('./pdf');
    const pdf = await loadPdfJs(bytes);
    for (let p = 1; p <= pdf.numPages; p++) {
      progress?.(`Reading page ${p}/${pdf.numPages}`);
      const lines = await extractLines(await pdf.getPage(p));
      const text = lines.length ? lines.map(l => l.text).join('\n') : (await (await import('./ocr')).ocrCanvas(await pdfPageToCanvas(pdf, p, 180), 'auto')).text;
      parts.push({ label: `Page ${p}`, text });
    }
    await pdf.destroy();
  } else if (kind === 'sheet') {
    const { loadWorkbook, toCsv } = await import('./sheet'); const wb = await loadWorkbook(bytes, file.name);
    wb.worksheets.forEach(ws => parts.push({ label: `Sheet: ${ws.name}`, text: toCsv(ws) }));
  } else if (kind === 'slides') {
    const { loadPptx } = await import('./slides'); const deck = await loadPptx(bytes);
    deck.slides.forEach((slide, i) => parts.push({ label: `Slide ${i + 1}`, text: slide.els.flatMap(el => el.kind === 'text' ? [el.text ?? ''] : []).join('\n') }));
  } else if (kind === 'image') {
    const { normalizeImage, decodeImage, imageToCanvas } = await import('../lib/image');
    for (const [i, image] of (await normalizeImage(bytes, file.type)).entries()) {
      parts.push({ label: `Image ${i + 1}`, text: (await (await import('./ocr')).ocrCanvas(imageToCanvas(await decodeImage(image.bytes, image.mime)), 'auto')).text });
    }
  } else if (/\.docx$/i.test(file.name)) {
    const { importDocx } = await import('./docxImport');
    const imported = await importDocx(bytes);
    if (imported.header) parts.push({ label: 'Header', text: imported.header });
    const html = new DOMParser().parseFromString(imported.html, 'text/html');
    [...html.body.children].forEach((p, i) => parts.push({ label: `Paragraph ${i + 1}`, text: p.textContent ?? '' }));
    if (imported.footer) parts.push({ label: 'Footer', text: imported.footer });
  } else if (/\.(txt|md|csv|html?|rtf)$/i.test(file.name)) {
    const text = new TextDecoder().decode(bytes);
    if (/\.rtf$/i.test(file.name)) throw new Error('Convert RTF to DOCX or text before analysis.');
    const plain = /\.html?$/i.test(file.name) ? new DOMParser().parseFromString(text, 'text/html').body.textContent ?? '' : text;
    plain.split(/\n\s*\n/).forEach((text, i) => parts.push({ label: `Section ${i + 1}`, text }));
  } else throw new Error('Choose a PDF, DOCX, spreadsheet, presentation, image, or text document.');
  // Bound passages while retaining a verifiable source location.
  const passages = parts.flatMap(part => {
    const chunks = part.text.match(/[\s\S]{1,1800}(?:\s|$)|[\s\S]{1,1800}/g) ?? [];
    return chunks.map(text => ({ id: '', label: part.label, text: text.trim() }));
  }).filter(p => p.text);
  passages.forEach((p, i) => { p.id = `S${i + 1}`; });
  return { name: file.name, passages };
}
const STOP = new Set('a an and are as at be by for from how i in is it of on or that the this to was what when where which who will with would you'.split(' '));
export function tokens(text: string) { return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(t => !STOP.has(t)); }
export function retrieve(passages: Passage[], question: string, limit = 5): Passage[] {
  const terms = [...new Set(tokens(question))];
  if (!terms.length) return [];
  return passages.map(p => {
    const words = tokens(p.text), counts = new Map<string, number>(); words.forEach(w => counts.set(w, (counts.get(w) ?? 0) + 1));
    const score = terms.reduce((sum, term) => sum + (counts.has(term) ? 1 + Math.log(counts.get(term)!) : 0), 0) / Math.sqrt(Math.max(1, words.length) / 80);
    return { p, score };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(r => r.p);
}
export function extractiveSummary(passages: Passage[], limit = 6): { text: string; source: Passage }[] {
  const frequency = new Map<string, number>(); passages.forEach(p => tokens(p.text).forEach(t => frequency.set(t, (frequency.get(t) ?? 0) + 1)));
  const candidates = passages.flatMap(source => (source.text.match(/[^.!?\n]+[.!?]?/g) ?? []).filter(t => t.trim().length > 25).map(text => ({ text: text.trim(), source })));
  const unique = [...new Map(candidates.map(c => [c.text, c])).values()];
  return unique.map((c, order) => ({ ...c, order, score: tokens(c.text).reduce((sum, t) => sum + Math.log(1 + (frequency.get(t) ?? 0)), 0) / Math.sqrt(Math.max(1, tokens(c.text).length)) }))
    .sort((a, b) => b.score - a.score).slice(0, limit).sort((a, b) => a.order - b.order).map(({ text, source }) => ({ text, source }));
}
export function extractActions(passages: Passage[]) {
  return passages.flatMap(source => source.text.split(/\n|(?<=[.!?])\s+/).filter(text => /\b(todo|action|must|need to|will|follow up|please|deadline)\b/i.test(text)).map(text => ({ text: text.trim(), source })));
}
export function delimitedRows(text: string): string[][] {
  // Accept copied tabular data, Markdown tables, and comma-separated rows with quoted values.
  if (text.includes('\t')) return text.trim().split(/\r?\n/).map(line => line.split('\t'));
  if (/^\s*\|/m.test(text)) return text.trim().split(/\r?\n/).filter(line => !/^\s*\|?[\s:|-]+\|?\s*$/.test(line)).map(line => line.replace(/^\s*\||\|\s*$/g, '').split('|').map(s => s.trim()));
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && ch === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (quoted) throw new Error('A quoted table cell is incomplete.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
