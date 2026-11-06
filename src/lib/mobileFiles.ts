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
