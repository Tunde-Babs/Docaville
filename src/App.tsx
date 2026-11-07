import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { type OpenFile, readFile, newId, detectKind, type DocKind } from './lib/formats';
import { StatusLayer, toast } from './components/ui';
import type { NativeFile, WritableHandle } from './lib/fileio';
import { isNativeMobile } from './lib/fileio';
import { saveRegistry, flushPendingInputs } from './components/useSave';
import Home from './components/Home';
import { type ProductivityTool } from './components/ProductivityHub';
import { versions, type LocalVersion } from './lib/localStore';
import { releaseEdition } from './lib/edition';
import ProDialog from './components/ProDialog';
const ProductivityHub = lazy(() => import('./components/ProductivityHub'));
const FreeViewer = lazy(() => import('./components/FreeViewer'));
const RecoveryTools = lazy(() => import('./components/RecoveryTools'));
const EDITION = releaseEdition(import.meta.env.VITE_RELEASE_CHANNEL ?? 'beta');

// Each editor is code-split so the app starts fast on phones.
const PdfEditor = lazy(() => import('./editors/PdfEditor'));
const DocEditor = lazy(() => import('./editors/DocEditor'));
const SheetEditor = lazy(() => import('./editors/SheetEditor'));
const SlideEditor = lazy(() => import('./editors/SlideEditor'));
const ImageEditor = lazy(() => import('./editors/ImageEditor'));

const EDITORS = { pdf: PdfEditor, doc: DocEditor, sheet: SheetEditor, slides: SlideEditor, image: ImageEditor };
const ICON: Record<DocKind, string> = { pdf: '📕', doc: '📘', sheet: '📗', slides: '📙', image: '🖼️' };

async function askToSave(name: string): Promise<'save' | 'discard' | 'cancel'> {
  if (window.docHubNative) return window.docHubNative.confirmClose(name);
  if (confirm(`Save the changes you made to “${name}” before closing?`)) return 'save';
  return confirm(`Close “${name}” and discard your changes?`) ? 'discard' : 'cancel';
}

export default function App() {
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<string>('home');
  const [tool, setTool] = useState<ProductivityTool>('audio');
  const [toolsOpened, setToolsOpened] = useState(false);
  const [recoveryCount, setRecoveryCount] = useState(0);
  const [recoveryStatus, setRecoveryStatus] = useState<Record<string, { at?: number; error?: string }>>({});
  const [extraDirty, setExtraDirty] = useState<string[]>([]);
  const [showPro, setShowPro] = useState(false);
  const upgrade = useCallback(() => setShowPro(true), []);
  const closePro = useCallback(() => setShowPro(false), []);
  const openTool = (next: ProductivityTool) => { if (!EDITION.canEdit && next !== 'recovery') { upgrade(); return; } setTool(next); setToolsOpened(true); setActive('tools'); };
  useEffect(() => {
    const refresh = () => { void versions().then(items => setRecoveryCount(items.filter(item => item.source === 'autosave').length)).catch(() => undefined); };
    const status = (event: Event) => { const detail = (event as CustomEvent).detail; setRecoveryStatus(current => ({ ...current, [detail.id]: detail })); };
    refresh(); window.addEventListener('documenthub-archive', refresh); window.addEventListener('documenthub-recovery-status', status);
    return () => { window.removeEventListener('documenthub-archive', refresh); window.removeEventListener('documenthub-recovery-status', status); };
  }, []);
  useEffect(() => { window.dispatchEvent(new CustomEvent('documenthub-view', { detail: active === 'tools' ? tool : active })); }, [active, tool]);
  useEffect(() => { const changed = (event: Event) => { const { id, dirty } = (event as CustomEvent).detail; setExtraDirty(current => dirty ? [...new Set([...current, id])] : current.filter(key => key !== id)); }; window.addEventListener('documenthub-extra-dirty', changed); return () => window.removeEventListener('documenthub-extra-dirty', changed); }, []);
  const filesRef = useRef(files); filesRef.current = files;
  const activeRef = useRef(active); activeRef.current = active;

  /** Add a document — or switch to it if that same file is already open. */
  const addFile = useCallback((of: OpenFile) => {
    const dup = filesRef.current.find((f) => (f.path ? f.path === of.path : f.mobilePath ? f.mobilePath === of.mobilePath : !!f.handle && f.handle === of.handle));
    if (dup) { setActive(dup.id); toast(`${dup.name} is already open`); return; }
    filesRef.current = [...filesRef.current, of];
    setFiles((fs) => [...fs, of]);
    setActive(of.id);
  }, []);

  const open = useCallback(async (list: File[], handles: (WritableHandle | undefined)[] = []) => {
    for (const [i, f] of list.entries()) {
      const of = await readFile(f, handles[i]);
      if (!of) { toast(`Unsupported file: ${f.name}`, true); continue; }
      addFile(of);
    }
  }, [addFile]);

  const openNative = useCallback((list: NativeFile[]) => {
    for (const f of list) {
      const kind = detectKind(f.name);
      if (!kind) { toast(`Unsupported file: ${f.name}`, true); continue; }
      addFile({ id: newId(), name: f.name, kind, bytes: f.bytes, mime: '', path: f.path });
    }
  }, [addFile]);

  const create = useCallback((kind: DocKind, name: string, bytes: Uint8Array | null = null, template?: string) => {
    if (!EDITION.canEdit) { upgrade(); return; }
    const of: OpenFile = { id: newId(), name, kind, bytes, mime: '', template, dirty: !!bytes || (!!template && !template.endsWith('-blank')) };
    setFiles((fs) => [...fs, of]);
    setActive(of.id);
  }, [upgrade]);

  // Save / Save As / edits update a document's location, name and unsaved state.
  const change = useCallback((id: string, patch: Partial<OpenFile>) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f))), []);

  const removeTab = useCallback((id: string) => {
    setFiles((fs) => fs.filter((f) => f.id !== id));
    if (activeRef.current === id) setActive('home');
  }, []);

  /** Close a tab; unsaved changes → Save / Don't Save / Cancel. */
  const close = useCallback(async (id: string) => {
    if (!(await flushPendingInputs(id))) { toast('Finish or cancel dictation before closing this document.', true); return; }
    const f = filesRef.current.find((x) => x.id === id);
    if (f?.dirty) {
      setActive(id);
      const choice = await askToSave(f.name);
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await saveRegistry.get(id)?.save())) return;
      if (choice === 'discard') await saveRegistry.get(id)?.discardRecovery?.().catch(() => undefined);
    }
    removeTab(id);
  }, [removeTab]);
  const createDocument = (name: string, html: string) => { if (!EDITION.canEdit) { upgrade(); return; } addFile({ id: newId(), name: `${name.replace(/\.[^.]+$/, '')}.docx`, kind: 'doc', bytes: null, initialHtml: html, mime: '', dirty: true }); };
  const restoreVersion = (version: LocalVersion) => {
    addFile({ id: newId(), name: version.name.replace(/(\.[^.]+)$/, '-recovered$1'), kind: version.kind, bytes: version.bytes, mime: '', dirty: EDITION.canEdit, recoveryState: version.state });
  };

  // Window title + unsaved count for the desktop shell (macOS close-button dot, quit prompt).
  useEffect(() => {
    const cur = files.find((f) => f.id === active);
    const title = cur ? `${cur.dirty ? '• ' : ''}${cur.name} — Docaville` : 'Docaville';
    document.title = title;
    window.docHubNative?.setDirty(files.filter((f) => f.dirty).length + extraDirty.length, title);
  }, [files, active, extraDirty]);

  // Browser / mobile web: warn before leaving with unsaved work.
  useEffect(() => {
    if (window.docHubNative) return;
    const h = (e: BeforeUnloadEvent) => { if (filesRef.current.some((f) => f.dirty) || extraDirty.length) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [extraDirty]);

  // Desktop shell: files from Finder/Explorer, the native menu, and "Save All" on quit. Registered once.
  const handlers = useRef({ openNative, create, close });
  handlers.current = { openNative, create, close };
  useEffect(() => {
    const n = window.docHubNative;
    if (!n) return;
    n.takePendingFiles().then((f) => handlers.current.openNative(f));
    n.onOpenFiles((f) => handlers.current.openNative(f));
    n.onSaveAll(async () => {
      // Finish speech capture before saving editors so the last spoken passage is included.
      if (!(await flushPendingInputs())) return false;
      for (const f of filesRef.current.filter((x) => x.dirty)) {
        setActive(f.id);
        if (!(await saveRegistry.get(f.id)?.save())) return false;
      }
      for (const [id, entry] of saveRegistry) if (!filesRef.current.some(file => file.id === id) && !(await entry.save())) return false;
      return true;
    });
    n.onMenu(async (cmd) => {
      if (!EDITION.canEdit && ['save', 'save-as', 'print', 'undo', 'redo'].includes(cmd)) { upgrade(); return; }
      const id = activeRef.current, ed = saveRegistry.get(id), h = handlers.current;
      switch (cmd) {
        case 'open': h.openNative(await n.openDialog()); break;
        case 'new-doc': h.create('doc', 'Document.docx', null, 'doc-blank'); break;
        case 'new-sheet': h.create('sheet', 'Workbook.xlsx', null, 'sheet-blank'); break;
        case 'new-slides': h.create('slides', 'Presentation.pptx', null, 'slides-blank'); break;
        case 'save': ed?.save(); break;
        case 'save-as': ed?.save(true); break;
        case 'print': ed?.print(); break;
        case 'close-tab': if (id !== 'home' && id !== 'tools') h.close(id); break;
        case 'undo': case 'redo': {
          // Text fields use the native undo stack; editors (docs, sheets, slides, PDF) get their shortcut.
          const el = document.activeElement as HTMLElement | null;
          if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) document.execCommand(cmd);
          else (el ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, ctrlKey: true, shiftKey: cmd === 'redo', bubbles: true }));
          break;
        }
      }
    });
  }, []);

  useEffect(() => {
    if (EDITION.canEdit) return;
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && ['s', 'p'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); upgrade(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [upgrade]);

  // Drag & drop anywhere
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      const dropped = [...(e.dataTransfer?.files ?? [])];
      // Browsers with File System Access give a writable handle, so Save can overwrite the dropped file.
      type Item = DataTransferItem & { getAsFileSystemHandle?: () => Promise<WritableHandle & { kind: string }> };
      const items = [...(e.dataTransfer?.items ?? [])] as Item[];
      const handles = window.docHubNative ? [] : await Promise.all(items.filter((it) => it.kind === 'file').map((it) => it.getAsFileSystemHandle?.().catch(() => undefined)));
      open(dropped, handles.map((h) => (h && h.kind === 'file' ? h : undefined)));
    };
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [open]);

  return (
    <div className="app">
      <nav className="tabs">
        <button className={'tab home' + (active === 'home' ? ' on' : '')} onClick={() => setActive('home')}><img src="./logo.svg" alt="" width={20} height={20} /> Docaville</button>
        <button className={'tab' + (active === 'tools' ? ' on' : '')} onClick={() => openTool(tool)}>Productivity tools</button>
        {files.map((f) => (
          <div key={f.id} className={`tab kind-${f.kind}` + (active === f.id ? ' on' : '') + (f.dirty ? ' dirty' : '')} onClick={() => setActive(f.id)} title={f.path ?? f.name}>
            <span>{ICON[f.kind]} {f.name}</span>
            <button className="x" onClick={(e) => { e.stopPropagation(); close(f.id); }} aria-label={f.dirty ? 'Close (unsaved changes)' : 'Close'}>{f.dirty ? '●' : '×'}</button>
          </div>
        ))}
        <button className="tab plan-tab" onClick={upgrade}>{EDITION.label}</button>
      </nav>
      <main className="workspace">
        {active === 'home' && <Home onOpen={open} onOpenSaved={addFile} onCreate={create} onTool={openTool} recoveryCount={recoveryCount} proAccess={EDITION.canEdit} onUpgrade={upgrade} />}
        <Suspense fallback={<div className="loading">Loading editor…</div>}>
          {toolsOpened && <div className="editor-host" hidden={active !== 'tools'}>{EDITION.canEdit ? <ProductivityHub tool={tool} navigate={setTool} createDocument={createDocument} restore={restoreVersion} files={files} /> : <RecoveryTools files={files} restore={restoreVersion} />}</div>}
          {files.map((f) => {
            const E = EDITORS[f.kind];
            return <div key={f.id} className="editor-host" hidden={active !== f.id}>{EDITION.canEdit ? <E file={f} onChange={(p) => change(f.id, p)} onFail={() => removeTab(f.id)} /> : <FreeViewer file={f} upgrade={upgrade} />}</div>;
          })}
        </Suspense>
      </main>
      {files.some(f => f.id === active) && isNativeMobile() && EDITION.canEdit && <p className="mobile-storage-notice">Save keeps a copy in Docaville. Find it under Home → Saved on this device to open or share it.</p>}
      {files.some(f => f.id === active) && <div className="recovery-status" role="status">{!EDITION.canEdit ? 'Read-only view · Original file unchanged' : recoveryStatus[active]?.error ? `Local recovery unavailable: ${recoveryStatus[active].error}. Save your file to preserve changes.` : recoveryStatus[active]?.at ? `Recovery checkpoint ${new Date(recoveryStatus[active].at!).toLocaleTimeString()}` : 'Changes are checkpointed locally after a short pause.'}<button onClick={() => openTool('recovery')}>Version history</button></div>}
      {showPro && <ProDialog beta={EDITION.canEdit} close={closePro} />}
      <StatusLayer />
    </div>
  );
}
