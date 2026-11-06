import { useEffect, useRef, useState } from 'react';
import { DEFAULT_BATCH, processBatchFile, uniqueFilename, type BatchOptions } from '../engines/batch';
import { localRead, localWrite } from '../lib/localStore';
import { ACCEPT } from '../lib/formats';
import { saveFile } from '../lib/fileio';
import { Btn, FilePick, run } from './ui';
interface Result { name: string; status: string; output?: { name: string; bytes: Uint8Array } }
export default function BatchTools() {
  const [files, setFiles] = useState<File[]>([]), [options, setOptions] = useState<BatchOptions>(DEFAULT_BATCH), [results, setResults] = useState<Result[]>([]), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [presets, setPresets] = useState<{ name: string; options: BatchOptions }[]>([]), [presetName, setPresetName] = useState('');
  const controller = useRef<AbortController>();
  useEffect(() => { localRead<typeof presets>('batch-presets').then(value => setPresets(value ?? [])).catch(() => undefined); localRead<Result[]>('batch-results').then(value => { if (value) setResults(value); }).catch(() => undefined); return () => controller.current?.abort(); }, []);
  const set = (patch: Partial<BatchOptions>) => setOptions(current => ({ ...current, ...patch }));
  async function start() {
    const abort = new AbortController(); controller.current = abort; setBusy(true); setResults([]);
    const completed: Result[] = [], used = new Set<string>();
    for (const [i, file] of files.entries()) {
      if (abort.signal.aborted) break;
      setStatus(`${i + 1}/${files.length}: ${file.name}`);
      try {
        const output = await processBatchFile(file, options, abort.signal, detail => setStatus(`${i + 1}/${files.length}: ${file.name} — ${detail}`));
        abort.signal.throwIfAborted(); output.name = uniqueFilename(output.name, used); completed.push({ name: file.name, status: 'Completed', output });
      } catch (error) { completed.push({ name: file.name, status: abort.signal.aborted ? 'Cancelled' : String((error as Error).message) }); }
      setResults([...completed]);
    }
    setBusy(false); setStatus(abort.signal.aborted ? 'Cancelled. Completed files are available to export.' : 'Batch complete. Review the results and export the completed files.');
    try { await localWrite('batch-results', completed); } catch { setStatus('Results are ready, but local storage is full. Export the completed files before closing.'); }
  }
  return <div className="tool-content"><h2>Batch workflows</h2><p>Process copies of your files and export the results together. Originals stay in place.</p>
    <div className="row wrap"><FilePick multiple accept={ACCEPT} onFiles={next => { if (!busy) setFiles(current => [...current, ...next]); }}>Add files</FilePick><Btn disabled={busy || !files.length} onClick={() => { setFiles([]); setResults([]); }}>Clear queue</Btn><span>{files.length} files</span></div>
    <ol className="filelist">{files.map((file, i) => <li key={i}>{file.name}<Btn disabled={busy} onClick={() => setFiles(current => current.filter((_, j) => i !== j))}>Remove</Btn></li>)}</ol>
    <fieldset disabled={busy}><legend>Workflow</legend><div className="row wrap">
      <label>Operation <select value={options.operation} onChange={e => set({ operation: e.target.value as BatchOptions['operation'] })}>
        <option value="pdf">Convert to PDF</option><option value="ocr">Searchable PDF (OCR)</option><option value="compress">Smaller PDF (flattened)</option><option value="extract">Extract PDF pages</option><option value="watermark">Add watermark</option><option value="number">Add page numbers</option><option value="rename">Rename copies</option></select></label>
      <label>Filename prefix <input value={options.prefix} onChange={e => set({ prefix: e.target.value })} /></label><label>Suffix <input value={options.suffix} onChange={e => set({ suffix: e.target.value })} /></label>
      {options.operation === 'extract' && <label>Pages <input value={options.pages} placeholder="1,3-5" onChange={e => set({ pages: e.target.value })} /></label>}
      {options.operation === 'watermark' && <label>Watermark <input value={options.watermark} onChange={e => set({ watermark: e.target.value })} /></label>}
    </div></fieldset>
    {options.operation === 'compress' && <p className="notice">Compression creates image-based pages at 144 DPI. Text selection, forms, and links are flattened; file size may increase for some source PDFs.</p>}
    <div className="row wrap"><input aria-label="Preset name" placeholder="Workflow name" value={presetName} onChange={e => setPresetName(e.target.value)} /><Btn disabled={!presetName.trim() || busy} onClick={() => run('Saving workflow…', async () => { const next = [...presets.filter(p => p.name !== presetName.trim()), { name: presetName.trim(), options }]; await localWrite('batch-presets', next); setPresets(next); })}>Save workflow</Btn>
      {presets.map(preset => <span key={preset.name} className="preset-chip"><Btn disabled={busy} onClick={() => setOptions(preset.options)}>{preset.name}</Btn><Btn aria-label={`Delete workflow ${preset.name}`} disabled={busy} onClick={() => run('Removing workflow…', async () => { const next = presets.filter(p => p.name !== preset.name); await localWrite('batch-presets', next); setPresets(next); })}>×</Btn></span>)}</div>
    <div className="row wrap"><Btn primary disabled={!files.length || busy} onClick={start}>Run workflow</Btn>{busy && <Btn onClick={() => controller.current?.abort()}>Cancel after current step</Btn>}
      <Btn disabled={busy || !results.some(r => r.output)} onClick={() => run('Creating archive…', async () => { const JSZip = (await import('jszip')).default; const zip = new JSZip(); results.forEach(r => { if (r.output) zip.file(r.output.name, r.output.bytes); }); zip.file('results.txt', results.map(r => `${r.name}: ${r.status}`).join('\n')); await saveFile('DocumentHub-batch.zip', await zip.generateAsync({ type: 'uint8array' })); })}>Export completed files .zip</Btn></div>
    <p role="status">{status}</p><ul>{results.map((result, i) => <li key={i}><strong>{result.name}</strong>: {result.status}{result.output ? ` → ${result.output.name}` : ''}</li>)}</ul>
  </div>;
}
