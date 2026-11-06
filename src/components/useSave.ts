import { useCallback, useEffect, useRef } from 'react';
import type { OpenFile } from '../lib/formats';
import { saveDocument, baseName } from '../lib/fileio';
import { run, setBusy, toast } from './ui';
import { printPdf } from '../lib/print';
import { putVersion, removeVersion } from '../lib/localStore';

export type FileChange = (patch: Partial<OpenFile>) => void;
export interface EditorProps { file: OpenFile; onChange: FileChange; onFail: () => void }
type Produced = Uint8Array | { bytes: Uint8Array; note?: string; copyName?: string };

/** Save/print of open editors, so the app menu and close/quit prompts can reach any tab. */
export const saveRegistry = new Map<string, { save: (saveAs?: boolean) => Promise<boolean>; print: () => void; owner?: string; flush?: () => Promise<boolean>; checkpoint?: () => Promise<void>; discardRecovery?: () => Promise<void> }>();
export async function flushPendingInputs(owner?: string) {
  for (const entry of [...saveRegistry.values()]) if (entry.flush && (owner === undefined || entry.owner === owner) && !(await entry.flush())) return false;
  // Timers continue when a desktop window is minimized; animation frames may pause.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  return true;
}

/**
 * Office-style Save / Save As / Print for an editor.
 *  - save():      overwrite the opened file in place (asks only for new docs or a format change)
 *  - save(true):  Save As… — choose a new name/location; later saves go there
 *  - markDirty(): flag unsaved changes (tab dot, window title, close/quit prompts)
 *  - Cmd/Ctrl+S, Cmd/Ctrl+Shift+S and Cmd/Ctrl+P work in whichever editor tab is visible.
 */
export function useSave(
  file: OpenFile, onChange: FileChange, ext: () => string, produce: (ext: string) => Promise<Produced>,
  /** PDF rendition of the current document, used for printing. */
  makePdf?: () => Promise<Uint8Array>,
  /** Commit active editor inputs synchronously before serializing for save/print. */
  prepare?: () => void,
  recovery?: () => Promise<{ bytes: Uint8Array; state?: unknown }>,
) {
  const root = useRef<HTMLDivElement>(null);
  const fileRef = useRef(file);
  fileRef.current = file;
  const copySaved = useRef(false);
  const revision = useRef(0);
  const lastSavedRevision = useRef(-1);
  const archiveId = useRef(file.path ?? file.id);
  const mounted = useRef(true);
  const checkpointBusy = useRef(false);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef({ ext, produce, prepare, recovery });
  latest.current = { ext, produce, prepare, recovery };
  const checkpoint = async (source: 'autosave' | 'checkpoint' = 'checkpoint') => {
    if (source === 'autosave' && revision.current <= lastSavedRevision.current) return;
    if (checkpointBusy.current) { pending.current = true; return; }
    checkpointBusy.current = true;
    try {
      if (!latest.current.recovery) latest.current.prepare?.();
      // Active inputs may commit React state during prepare.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      const version = revision.current;
      const result = latest.current.recovery ? await latest.current.recovery() : await latest.current.produce(latest.current.ext());
      const data = result instanceof Uint8Array ? { bytes: result } : result;
      if (!mounted.current) return;
      if (source === 'autosave' && revision.current <= lastSavedRevision.current) return;
      if (revision.current !== version) { pending.current = true; return; }
      await putVersion({ id: source === 'autosave' ? `auto:${archiveId.current}` : crypto.randomUUID(), documentId: archiveId.current,
        name: `${baseName(fileRef.current.name)}.${latest.current.ext()}`, kind: fileRef.current.kind,
        bytes: data.bytes, state: 'state' in data ? data.state : undefined, at: Date.now(), source });
      window.dispatchEvent(new CustomEvent('documenthub-recovery-status', { detail: { id: fileRef.current.id, at: Date.now() } }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('documenthub-recovery-status', { detail: { id: fileRef.current.id, error: String((error as Error).message || error) } }));
      if (source !== 'autosave') throw error;
    } finally {
      checkpointBusy.current = false;
      if (pending.current && mounted.current) { pending.current = false; timer.current = setTimeout(() => checkpoint('autosave'), 2000); }
    }
  };
  const checkpointRef = useRef(checkpoint); checkpointRef.current = checkpoint;

  const save = (saveAs = false): Promise<boolean> => run(saveAs ? 'Saving as…' : 'Saving…', async () => {
    prepare?.();
    const savedRevision = revision.current;
    const e = ext();
    const out = await produce(e);
    const { bytes, note, copyName } = out instanceof Uint8Array ? { bytes: out, note: undefined, copyName: undefined } : out;
    const needsCopy = !!copyName && !copySaved.current;
    const target = needsCopy ? { ...fileRef.current, name: copyName! } : fileRef.current;
    const where = await saveDocument(target, e, bytes, saveAs || needsCopy);
    if (!where) return false; // cancelled
    if (needsCopy) copySaved.current = true;
    onChange({ ...where, dirty: revision.current !== savedRevision });
    if (revision.current === savedRevision) { lastSavedRevision.current = savedRevision; clearTimeout(timer.current); pending.current = false; }
    // A successful user save is a persistent version; local archive failure cannot undo a disk save.
    try {
      await putVersion({ id: crypto.randomUUID(), documentId: archiveId.current, name: where.name ?? `${baseName(fileRef.current.name)}.${e}`,
        kind: fileRef.current.kind, bytes, at: Date.now(), source: 'saved' });
      if (revision.current === savedRevision) await removeVersion(`auto:${archiveId.current}`);
    } catch { toast('File saved. Local version history could not be updated.', true); }
    const shown = where.name ?? fileRef.current.name;
    toast(note ? `Saved ${shown}. ${note}` : `Saved ${shown}`);
    return true;
  }).then((ok) => !!ok);

  const print = () => makePdf && run('Preparing to print…', async () => {
    prepare?.();
    await printPdf(await makePdf(), baseName(fileRef.current.name), setBusy);
  });

  const markDirty = useCallback(() => {
    revision.current++; if (!fileRef.current.dirty) onChange({ dirty: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void checkpointRef.current('autosave'), 2000);
  }, [onChange]);

  // Latest save function for the app's close/quit prompts.
  const saveRef = useRef(save);
  saveRef.current = save;
  const printRef = useRef(print);
  printRef.current = print;
  useEffect(() => {
    mounted.current = true;
    if (file.dirty) timer.current = setTimeout(() => void checkpointRef.current('autosave'), 2000);
    saveRegistry.set(file.id, { save: (as) => saveRef.current(!!as), print: () => printRef.current(), checkpoint: () => checkpointRef.current(),
      discardRecovery: async () => { clearTimeout(timer.current); mounted.current = false; await removeVersion(`auto:${archiveId.current}`); } });
    return () => { mounted.current = false; clearTimeout(timer.current); saveRegistry.delete(file.id); };
  }, [file.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 's' && k !== 'p') return;
      if (!root.current || root.current.offsetParent === null) return; // not the visible tab
      e.preventDefault();
      if (k === 's') save(e.shiftKey); else print();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return { root, save, print, markDirty };
}

/** Run an editor's loader; on failure close the tab so an empty document can never overwrite the file. */
export async function loadOrFail<T>(label: string, job: () => Promise<T>, onFail: () => void): Promise<T | undefined> {
  let failed = false;
  const res = await run(label, async () => { try { return await job(); } catch (e) { failed = true; throw e; } });
  if (failed) onFail();
  return res;
}
