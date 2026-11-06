/** Local-only structured storage. Document bytes never go to a service. */
let opening: Promise<IDBDatabase> | undefined;
function database() {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('documenthub-local', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('versions', { keyPath: 'id' });
      request.result.createObjectStore('data');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = undefined; reject(request.error); };
  });
}
export async function localRead<T>(key: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction('data').objectStore('data').get(key);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function localWrite(key: string, value: unknown) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction('data', 'readwrite'); t.objectStore('data').put(value, key);
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
}
export async function localRemove(key: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction('data', 'readwrite'); t.objectStore('data').delete(key);
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error);
  });
}
export interface LocalVersion {
  id: string; documentId: string; name: string; kind: import('./formats').DocKind;
  bytes: Uint8Array; state?: unknown; at: number; source: 'autosave' | 'saved' | 'checkpoint';
}
export async function versions(): Promise<LocalVersion[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction('versions').objectStore('versions').getAll();
    r.onsuccess = () => resolve((r.result as LocalVersion[]).sort((a, b) => b.at - a.at)); r.onerror = () => reject(r.error);
  });
}
export async function putVersion(version: LocalVersion) {
  const db = await database();
  const previous = (await versions()).filter(v => v.documentId === version.documentId && v.source !== 'autosave');
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('versions', 'readwrite'), store = t.objectStore('versions');
    store.put(version);
    previous.filter(v => v.id !== version.id).slice(version.source === 'autosave' ? 30 : 29).forEach(v => store.delete(v.id));
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
  window.dispatchEvent(new Event('documenthub-archive'));
}
export async function removeVersion(id: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('versions', 'readwrite'); t.objectStore('versions').delete(id);
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error);
  });
  window.dispatchEvent(new Event('documenthub-archive'));
}
