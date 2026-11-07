import { useEffect, useState } from 'react';
import type { OpenFile } from '../lib/formats';
import { savedMobileDocuments, openSavedMobileDocument, shareSavedMobileDocument, type SavedMobileDocument } from '../lib/mobileDocuments';
import { run } from './ui';

export default function MobileDocuments({ onOpen }: { onOpen: (file: OpenFile) => void }) {
  const [files, setFiles] = useState<SavedMobileDocument[]>([]), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false; setLoading(true); setError('');
    void savedMobileDocuments().then(result => { if (!disposed) setFiles(result); }).catch(() => { if (!disposed) setError('Saved copies could not be loaded. Try Refresh.'); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [refresh]);
  return <section className="panel"><div className="row wrap"><h2>Saved on this device</h2><button className="btn" onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
    <p>Save keeps your latest copy in Docaville. Open it here, or share a copy with Files or another app. Sharing leaves the saved document unchanged.</p>
    {loading && <p role="status">Loading saved copies…</p>}{error && <p role="alert">{error}</p>}
    {!loading && !error && !files.length && <p>No saved copies yet.</p>}
    <ul className="filelist">{files.map(file => <li key={file.name}><span>{file.name}<small> · {Math.max(1, Math.round(file.size / 1024))} KB</small></span><span>
      {file.canOpen && <button className="btn" onClick={() => run('Opening saved copy…', async () => onOpen(await openSavedMobileDocument(file.name)))}>Open</button>}
      <button className="btn" onClick={() => run('Sharing saved copy…', async () => shareSavedMobileDocument(file.name))}>Share saved copy</button>
    </span></li>)}</ul>
  </section>;
}
