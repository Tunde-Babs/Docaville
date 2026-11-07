/** New exports use app-private storage; existing public-Documents targets stay writable. */
export function mobileTarget(name: string, existing?: string) {
  if (existing) {
    const privateFile = existing.startsWith('data:');
    const path = privateFile ? existing.slice(5) : existing;
    if (!path || path.startsWith('/') || path.split(/[\\/]/).some(part => part === '..')) throw new Error('Invalid saved document path.');
    return { privateFile, path, identity: existing };
  }
  const filename = name.split(/[\\/]/).pop()?.trim();
  if (!filename || filename === '.' || filename === '..') throw new Error('Choose a document filename.');
  const path = `documents/${filename}`;
  return { privateFile: true, path, identity: `data:${path}` };
}

export function mobileDocumentPath(name: string) {
  if (!name || name !== name.trim() || /[\\/\x00]/.test(name) || name === '.' || name === '..') throw new Error('Invalid saved document name.');
  return `documents/${name}`;
}

export async function decodeMobileData(data: string | Blob) {
  if (typeof data !== 'string') return new Uint8Array(await data.arrayBuffer());
  const encoded = data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
  return Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
}

export function missingMobileFile(error: unknown) {
  const value = error as { code?: string; message?: string };
  if (value?.code) return ['OS-PLUG-FILE-0008', 'ENOENT', 'NOT_FOUND'].includes(value.code);
  return /does not exist|not found|no such file/i.test(String(value?.message ?? error));
}

/** A new Save As/export must never silently replace another app-local document. */
export function unusedMobileTarget(name: string, existingNames: readonly string[]) {
  const filename = mobileTarget(name).path.split('/').pop()!;
  const dot = filename.lastIndexOf('.'), extension = dot >= 0 ? filename.slice(dot) : '';
  const stem = (dot >= 0 ? filename.slice(0, dot) : filename) || 'Document';
  const used = new Set(existingNames.map(value => value.toLowerCase()));
  const encoder = new TextEncoder();
  for (let number = 1; number <= used.size + 2; number++) {
    const tail = `${number === 1 ? '' : ` (${number})`}${extension}`;
    if (encoder.encode(tail).length > 100) throw new Error('Choose a shorter filename extension.');
    const characters = [...stem];
    while (encoder.encode(characters.join('') + tail).length > 240) characters.pop();
    const candidate = characters.join('') + tail;
    if (!used.has(candidate.toLowerCase())) return mobileTarget(candidate);
  }
  throw new Error('Choose a different document filename.');
}
