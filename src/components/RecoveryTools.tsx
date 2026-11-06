import { useEffect, useState } from 'react';
import { versions, removeVersion, type LocalVersion } from '../lib/localStore';
import { saveRegistry } from './useSave';
import { saveFile } from '../lib/fileio';
import { Btn, run } from './ui';
import type { OpenFile } from '../lib/formats';
async function exportable(version: LocalVersion) {
  if (!version.state) return version.bytes;
  if (version.kind === 'sheet') {
    const { loadWorkbook, saveXlsx, setInput } = await import('../engines/sheet');
    const workbook = await loadWorkbook(version.bytes, version.name);
    const draft = (version.state as { sheetDraft: { sheetIdx: number; cur: { r: number; c: number }; editing: string | null; renaming: string | null } }).sheetDraft;
    if (draft.editing !== null) setInput(workbook.worksheets[draft.sheetIdx].getCell(draft.cur.r, draft.cur.c), draft.editing);
    return saveXlsx(workbook);
  }
  const state = version.state as { pdfSources: Uint8Array[]; pages: import('../engines/pdf').PageRef[]; overlays: import('../engines/pdf').Overlay[]; values: import('../engines/pdf').FormValues };
  return (await import('../engines/pdf')).savePdf(state.pdfSources, state.pages, state.overlays, state.values);
}
export default function RecoveryTools({ files, restore }: { files: OpenFile[]; restore: (version: LocalVersion) => void }) {
  const [items, setItems] = useState<LocalVersion[]>([]), [filter, setFilter] = useState(''), [status, setStatus] = useState('');
  useEffect(() => { const refresh = () => versions().then(setItems).catch(error => setStatus(String(error))); void refresh(); window.addEventListener('documenthub-archive', refresh); return () => window.removeEventListener('documenthub-archive', refresh); }, []);
  return <div className="tool-content"><h2>Recovery and version history</h2><p>Changes are checkpointed locally after two seconds of inactivity. Disk Save remains under your control. Keep up to 30 saved versions per document and one current recovery draft. Restoring opens a separate copy.</p>
    <p>Recovery protects completed checkpoints. Edits made immediately before a crash may not have reached local storage. Clearing application data or browser storage removes this archive.</p>
    <div className="row wrap"><input aria-label="Find archived document" placeholder="Filter by document name" value={filter} onChange={e => setFilter(e.target.value)} /><Btn onClick={() => run('Creating checkpoints…', async () => { for (const file of files) await saveRegistry.get(file.id)?.checkpoint?.(); setStatus('Current documents checkpointed.'); })}>Checkpoint open documents now</Btn></div>
    <p role="status">{status}</p>
    {!items.length && <p>No local versions yet. Edit or save a document to create one.</p>}
    <div className="version-list">{items.filter(item => item.name.toLowerCase().includes(filter.toLowerCase())).map(item => <article key={item.id} className="source-card"><strong>{item.name}</strong><p>{item.source === 'autosave' ? 'Recovery draft' : item.source === 'saved' ? 'Saved version' : 'Manual checkpoint'} · {new Date(item.at).toLocaleString()} · {(item.bytes.byteLength / 1024).toFixed(1)} KB</p><div className="row wrap"><Btn primary onClick={() => restore(item)}>Restore as copy</Btn><Btn onClick={() => run('Exporting version…', async () => saveFile(item.name, await exportable(item)))}>Export version</Btn><Btn onClick={() => run('Removing local version…', async () => { await removeVersion(item.id); })}>Remove local version</Btn></div></article>)}</div>
  </div>;
}
