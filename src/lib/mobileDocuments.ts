import { Filesystem, Directory } from '@capacitor/filesystem';
import { mobileDocumentPath, decodeMobileData, missingMobileFile } from './mobileFiles';
import { detectKind, newId, type OpenFile } from './formats';
import { shareMobileCopy } from './fileio';

export interface SavedMobileDocument { name: string; size: number; modified: number; canOpen: boolean }

export async function savedMobileDocuments(): Promise<SavedMobileDocument[]> {
  try {
    const { files } = await Filesystem.readdir({ directory: Directory.Data, path: 'documents' });
    return files.filter(file => file.type === 'file').flatMap(file => {
      try { mobileDocumentPath(file.name); } catch { return []; }
      return [{ name: file.name, size: file.size, modified: file.mtime ?? 0, canOpen: !!detectKind(file.name) }];
    }).sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  } catch (error) {
    if (missingMobileFile(error)) return [];
    throw error;
  }
}

async function savedBytes(name: string) {
  const { data } = await Filesystem.readFile({ directory: Directory.Data, path: mobileDocumentPath(name) });
  return decodeMobileData(data);
}

export async function openSavedMobileDocument(name: string): Promise<OpenFile> {
  const kind = detectKind(name);
  if (!kind) throw new Error('This file can be shared with another app.');
  return { id: newId(), name, kind, bytes: await savedBytes(name), mime: '', mobilePath: `data:${mobileDocumentPath(name)}` };
}

export async function shareSavedMobileDocument(name: string) {
  await shareMobileCopy(name, await savedBytes(name));
}
