export type DocKind = 'pdf' | 'doc' | 'sheet' | 'slides' | 'image';

import type { WritableHandle } from './fileio';

export interface OpenFile {
  id: string;
  name: string;
  kind: DocKind;
  bytes: Uint8Array | null; // null = new blank document
  mime: string;
  /** Where the document lives on disk, so Save overwrites it (desktop path / browser handle / mobile Documents). */
  path?: string;
  handle?: WritableHandle;
  mobilePath?: string;
  /** Unsaved changes. */
  dirty?: boolean;
  /** Template id for new documents (see lib/templates.ts). */
  template?: string;
  /** Editable state for recovery when a file rendition would flatten its structure. */
  recoveryState?: unknown;
  /** Unsaved content created by a local workflow before its first DOCX save. */
  initialHtml?: string;
}

const EXT: Record<string, DocKind> = {
  pdf: 'pdf',
  docx: 'doc', doc: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc', md: 'doc', html: 'doc', htm: 'doc',
  xlsx: 'sheet', xlsm: 'sheet', csv: 'sheet', tsv: 'sheet',
  pptx: 'slides',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image',
  avif: 'image', heic: 'image', heif: 'image', tif: 'image', tiff: 'image', svg: 'image',
};

export function detectKind(name: string, mime = ''): DocKind | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (EXT[ext]) return EXT[ext];
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return null;
}

export const ACCEPT = Object.keys(EXT).map((e) => '.' + e).join(',') + ',image/*';

let n = 0;
export const newId = () => `f${Date.now().toString(36)}${(n++).toString(36)}`;

export async function readFile(file: File, handle?: WritableHandle): Promise<OpenFile | null> {
  const kind = detectKind(file.name, file.type);
  if (!kind) return null;
  let path: string | undefined;
  try { path = window.docHubNative?.pathForFile(file) ?? undefined; } catch { /* not a disk file */ }
  return { id: newId(), name: file.name, kind, bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, path, handle };
}
