import { useEffect, useRef, useState } from 'react';
import { cancelLocalML, translateLocally } from '../engines/localML';
import { localRead, localWrite } from '../lib/localStore';
import { textHtml } from '../engines/documentTools';
import { saveFile } from '../lib/fileio';
import { Btn } from './ui';
export default function TranslationTool({ text, createDocument }: { text: string; createDocument?: (name: string, html: string) => void }) {
  const [source, setSource] = useState('en'), [target, setTarget] = useState('de'), [result, setResult] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const generation = useRef(0), ownWork = useRef(false);
  const languages = [['en', 'English'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish']];
  useEffect(() => {
    const id = ++generation.current; if (ownWork.current) cancelLocalML(); setResult(''); setBusy(false);
    localRead<{ text: string; result: string; source: string; target: string }>('translation-project').then(saved => { if (saved?.text === text && id === generation.current) { setResult(saved.result); setSource(saved.source); setTarget(saved.target); } }).catch(() => undefined);
    return () => { generation.current++; if (ownWork.current) cancelLocalML(); };
  }, [text]);
  useEffect(() => { if (!result) return; const timer = setTimeout(() => void localWrite('translation-project', { text, result, source, target }).catch(() => setStatus('Translation is ready, but local draft storage failed. Export it to preserve edits.')), 500); return () => clearTimeout(timer); }, [text, result, source, target]);
  async function translate() {
    const id = ++generation.current; setBusy(true); ownWork.current = true;
    try { const translated = await translateLocally(text, source, target, setStatus); if (id === generation.current) { setResult(translated); setStatus('Translation ready. Review terminology and meaning before sharing. The original text is unchanged.'); } }
    catch (error) { if (id === generation.current) setStatus(String((error as Error).message)); }
    finally { ownWork.current = false; if (id === generation.current) setBusy(false); }
  }
  return <section className="translation-tool"><h3>Translate on this device</h3><p>English, German, French, and Spanish. Models download on first use. Translation between two non-English languages passes through English.</p><div className="row wrap">
    <label>Source language <select disabled={busy} value={source} onChange={e => setSource(e.target.value)}>{languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><label>Translation language <select disabled={busy} value={target} onChange={e => setTarget(e.target.value)}>{languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
    <Btn disabled={!text.trim() || busy || source === target} onClick={translate}>Translate locally</Btn>{busy && <Btn onClick={cancelLocalML}>Cancel translation</Btn>}</div><p role="status">{status}</p>
    {result && <><textarea className="large-input" aria-label="Editable translation" value={result} onChange={e => setResult(e.target.value)} /><div className="row wrap"><Btn onClick={() => saveFile('Translation.txt', result)}>Export translation .txt</Btn>{createDocument && <Btn primary onClick={() => createDocument('Translated document', textHtml(result))}>Open translation in Word</Btn>}</div></>}
  </section>;
}
