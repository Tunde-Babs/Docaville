// Platform-neutral save layer.
//  - Desktop (Electron): native Save-As dialog via preload bridge.
//  - Mobile (Capacitor iOS/Android): write to Documents, then open the OS share sheet.
//  - Web: File System Access API when available, otherwise a download.
import { Capacitor } from '@capacitor/core';
import { mobileTarget } from './mobileFiles';

/** Minimal File System Access handle (Chromium browsers). */
export interface WritableHandle {
  name: string;
  createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }>;
}

/** A file read from disk by the desktop shell (Open dialog, Finder/Explorer double-click). */
export interface NativeFile { name: string; path: string; bytes: Uint8Array }

/** Where a document lives, so "Save" can overwrite it in place. */
export interface SaveTarget { name: string; path?: string; handle?: WritableHandle; mobilePath?: string }

declare global {
  interface Window {
    docHubNative?: {
      speechVoices(): Promise<{ id: string; name: string; language: string }[]>;
      speak(text: string, voice: string, rate: number): Promise<void>;
      speechControl(action: 'pause' | 'resume' | 'stop'): Promise<void>;
      pathForFile(file: File): string | null;
      saveFile(name: string, bytes: Uint8Array): Promise<string | null>;
      writeFile(path: string, bytes: Uint8Array): Promise<string>;
      printToPDF(landscape: boolean): Promise<Uint8Array>;
      openDialog(): Promise<NativeFile[]>;
      takePendingFiles(): Promise<NativeFile[]>;
      confirmClose(name: string): Promise<'save' | 'discard' | 'cancel'>;
      setDirty(count: number, title: string): void;
      onOpenFiles(cb: (files: NativeFile[]) => void): void;
      onMenu(cb: (cmd: string) => void): void;
      onSaveAll(handler: () => Promise<boolean>): void;
    };
    showSaveFilePicker?: (opts: unknown) => Promise<WritableHandle>;
  }
}

export const isDesktop = () => !!window.docHubNative;
export const isNativeMobile = () => Capacitor.isNativePlatform();

export const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  md: 'text/markdown',
  zip: 'application/zip',
};

export async function toBytes(data: Blob | Uint8Array | ArrayBuffer | string): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** "Save As" / export: always asks where to save (desktop/web) and returns where it went. */
export async function saveFile(name: string, data: Blob | Uint8Array | ArrayBuffer | string): Promise<SaveTarget | null> {
  const bytes = await toBytes(data);
  const ext = name.split('.').pop()!.toLowerCase();

  if (window.docHubNative) {
    const path = await window.docHubNative.saveFile(name, bytes);
    return path ? { name: path.split(/[\\/]/).pop()!, path } : null;
  }

  if (isNativeMobile()) {
    const mobilePath = await writeMobile(name, bytes, true);
    return { name, mobilePath };
  }

  const blob = new Blob([bytes as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' });
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: name });
      await writeHandle(handle, blob);
      return { name: handle.name, handle };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return { name };
}

async function writeHandle(handle: WritableHandle, blob: Blob) {
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}

async function writeMobile(name: string, bytes: Uint8Array, share: boolean, existing?: string) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const target = mobileTarget(name, existing);
  const data = toBase64(bytes);
  await Filesystem.writeFile({ path: target.path, data, directory: target.privateFile ? Directory.Data : Directory.Documents, recursive: true });
  if (share) {
    const { Share } = await import('@capacitor/share');
    // Share a disposable copy from a narrowly scoped FileProvider cache directory.
    const filename = name.split(/[\\/]/).pop()!;
    const res = await Filesystem.writeFile({ path: `exports/${Date.now()}-${filename}`, data, directory: Directory.Cache, recursive: true });
    // Canceling the share sheet leaves the saved local document intact.
    await Share.share({ title: name, url: res.uri }).catch(error => {
      const message = String(error?.message ?? error);
      if (!/cancel|dismiss|abort/i.test(message)) throw new Error(`Document saved locally, but sharing failed: ${message}`);
    });
  }
  return target.identity;
}

/**
 * Office-style save for an open document.
 *  - "Save": same format as the opened file → overwrite it in place (no dialog).
 *  - "Save As", a new document, or a different format → ask where; later saves go there.
 * Returns the document's new location (empty object = saved in place), or null if cancelled.
 */
export async function saveDocument(
  doc: { name: string } & Omit<SaveTarget, 'name'>, ext: string, data: Uint8Array, saveAs = false,
): Promise<Partial<SaveTarget> | null> {
  const sameFormat = doc.name.split('.').pop()!.toLowerCase() === ext.toLowerCase();
  if (!saveAs && sameFormat) {
    if (doc.path && window.docHubNative) { await window.docHubNative.writeFile(doc.path, data); return {}; }
    if (doc.handle) { await writeHandle(doc.handle, new Blob([data as BlobPart], { type: MIME[ext] ?? '' })); return {}; }
    if (isNativeMobile()) { const mobilePath = await writeMobile(doc.name, data, false, doc.mobilePath); return { mobilePath }; }
  }
  const target = await saveFile(`${baseName(doc.name)}.${ext}`, data);
  if (!target) return null;
  return { name: target.name, path: target.path, handle: target.handle, mobilePath: target.mobilePath };
}

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
