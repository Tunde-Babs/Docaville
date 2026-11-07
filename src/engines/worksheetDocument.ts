import JSZip from 'jszip';
import { fitWorksheetAnnotation, type WorksheetAnnotation } from './worksheet';

export const WORKSHEET_MARKER = 'DocavilleWorksheetV1';
const PART = 'word/docaville-worksheet.xml';
const NS = 'urn:docaville:worksheet:1';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export interface SavedWorksheetPage { bytes: Uint8Array; mime: string; sourceName: string; text: string; annotations: WorksheetAnnotation[] }
type RecordPage = { image: string; sourceName: string; text: string; annotations: WorksheetAnnotation[] };
async function fingerprint(text: string) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(data)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The project references existing embedded source pixels; it never duplicates the images. */
export async function attachWorksheetProject(zip: JSZip, pages: Omit<SavedWorksheetPage, 'bytes' | 'mime'>[]) {
  const source = await zip.file('word/document.xml')!.async('string');
  const doc = new DOMParser().parseFromString(source, 'text/xml');
  const rels = new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels')!.async('string'), 'text/xml');
  const images = [...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')].map(blip => {
    const id = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
    return [...rels.documentElement.children].find(rel => rel.getAttribute('Id') === id)?.getAttribute('Target');
  });
  if (images.length !== pages.length || images.some(image => !image)) throw new Error('Worksheet source pages could not be retained.');
  const project = document.implementation.createDocument(NS, 'worksheet');
  project.documentElement.textContent = JSON.stringify({ version: 1, fingerprint: await fingerprint(source), pages: pages.map((page, i) => ({ ...page, image: `word/${images[i]}` })) });
  zip.file(PART, new XMLSerializer().serializeToString(project));
  const relation = rels.createElementNS('http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship');
  relation.setAttribute('Id', 'rIdDocavilleWorksheet');
  relation.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml');
  relation.setAttribute('Target', 'docaville-worksheet.xml'); rels.documentElement.appendChild(relation);
  zip.file('word/_rels/document.xml.rels', new XMLSerializer().serializeToString(rels));
}

/** Only restore a project when it still matches the visible Word document. */
export async function readWorksheetDocument(bytes: Uint8Array): Promise<SavedWorksheetPage[] | null> {
  const zip = await JSZip.loadAsync(bytes);
  const core = zip.file('docProps/core.xml');
  if (!core || !(await core.async('string')).includes(WORKSHEET_MARKER)) return null;
  const part = zip.file(PART);
  if (!part) throw new Error('This worksheet no longer contains its Docaville editing data. Open it in Word to preserve the positioned answers.');
  const xml = new DOMParser().parseFromString(await part.async('string'), 'text/xml');
  const data = JSON.parse(xml.documentElement.textContent ?? '') as { version: number; fingerprint: string; pages: RecordPage[] };
  if (xml.documentElement.namespaceURI !== NS || data.version !== 1 || !Array.isArray(data.pages) || !data.pages.length) throw new Error('Unsupported worksheet editing data.');
  if (await fingerprint(await zip.file('word/document.xml')!.async('string')) !== data.fingerprint) throw new Error('This worksheet was changed outside Docaville. Open it in Word to retain those changes; the older worksheet editing data will not be restored over them.');
  const result: SavedWorksheetPage[] = [];
  for (const page of data.pages) {
    if (typeof page.image !== 'string' || !/^word\/media\/[^/]+$/.test(page.image) || typeof page.text !== 'string' || typeof page.sourceName !== 'string' || !Array.isArray(page.annotations)) throw new Error('Invalid worksheet page data.');
    const image = zip.file(page.image); if (!image) throw new Error('A worksheet source image is missing.');
    const source = await image.async('uint8array');
    const mime = /\.jpe?g$/i.test(page.image) ? 'image/jpeg' : 'image/png';
    const { decodeImage } = await import('../lib/image'); const decoded = await decodeImage(source, mime);
    const annotations = page.annotations.map(note => {
      if (typeof note.id !== 'string' || !['text', 'cross'].includes(note.kind) || typeof note.text !== 'string' || note.text.length > 1000) throw new Error('Invalid worksheet answer data.');
      return fitWorksheetAnnotation(note, decoded.naturalWidth / decoded.naturalHeight);
    });
    result.push({ bytes: source, mime, sourceName: page.sourceName, text: page.text, annotations });
  }
  // Ensure a corrupt marker cannot route a non-document into the worksheet editor.
  const doc = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'text/xml');
  if (!doc.getElementsByTagNameNS(W, 'body').length) throw new Error('Invalid worksheet document.');
  return result;
}
