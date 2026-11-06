import { useRef, useState } from 'react';
import { readDocument, retrieve, extractiveSummary, extractActions, delimitedRows, type TextDocument, type Passage } from '../engines/documentTools';
import { localInference, cancelLocalML } from '../engines/localML';
import { ACCEPT } from '../lib/formats';
import { saveFile } from '../lib/fileio';
import { Btn, FilePick, run } from './ui';
import ReadAloud from './ReadAloud';
import TranslationTool from './TranslationTool';
export default function DocumentAssistant({ createDocument }: { createDocument: (name: string, html: string) => void }) {
  const [doc, setDoc] = useState<TextDocument>(), [question, setQuestion] = useState(''), [matches, setMatches] = useState<Passage[]>([]), [answer, setAnswer] = useState(''), [summary, setSummary] = useState<{ text: string; source: Passage }[]>([]), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [table, setTable] = useState('');
  const request = useRef(0);
  async function load(files: File[]) {
    const id = ++request.current; setBusy(true); setStatus('Reading document…');
    try { const result = await readDocument(files[0], setStatus); if (id === request.current) { setDoc(result); setMatches([]); setSummary([]); setAnswer(''); setStatus(result.passages.length ? 'Ready. Answers and summaries link to the extracted source passages.' : 'No readable text found.'); } }
    catch (error) { setStatus(String((error as Error).message)); } finally { setBusy(false); }
  }
  async function ask(ai: boolean) {
    if (!doc) return;
    setAnswer(''); const hits = retrieve(doc.passages, question); setMatches(hits); setSummary([]);
    if (!hits.length) { setStatus('No matching source passages found. Try words used in the document.'); return; }
    if (!ai) { setStatus('Matching passages — review these sources for your answer.'); return; }
    setBusy(true);
    try {
      const candidates: { answer: string; score: number; source: Passage }[] = [];
      for (const source of hits.slice(0, 3)) {
        const result = await localInference('question-answering', { question, context: source.text }, setStatus);
        candidates.push({ answer: result.answer, score: result.score, source });
      }
      const best = candidates.sort((a, b) => b.score - a.score)[0];
      if (!best?.answer?.trim() || best.score < 0.15 || !best.source.text.includes(best.answer)) { setStatus('No confident extracted answer. Review the matching source passages.'); return; }
      setAnswer(`${best.answer} [${best.source.id} — ${best.source.label}]`); setStatus('Answer extracted on this device. Verify it against the source before relying on it.');
    } catch (error) { setStatus(String((error as Error).message)); } finally { setBusy(false); }
  }
  return <div className="tool-content"><h2>Document assistant</h2><p>Search, summarize, listen, and extract answers locally. The answer model quotes source text rather than generating unsupported explanations. First use downloads the model.</p>
    <FilePick accept={ACCEPT} onFiles={files => { if (!busy) void load(files); }}>Choose document</FilePick>{doc && <strong className="tool-filename">{doc.name}</strong>}
    <p role="status">{status}</p>
    {doc && <><div className="row wrap"><input className="question-input" aria-label="Document question" placeholder="What is the renewal date?" value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !busy) void ask(false); }} /><Btn disabled={!question.trim() || busy} onClick={() => ask(false)}>Find source passages</Btn><Btn primary disabled={!question.trim() || busy} onClick={() => ask(true)}>Answer on device</Btn>{busy && <Btn onClick={cancelLocalML}>Cancel model</Btn>}</div>
      <div className="row wrap"><Btn disabled={busy} onClick={() => { setSummary(extractiveSummary(doc.passages)); setMatches([]); setAnswer(''); }}>Summarize key passages</Btn><Btn disabled={busy} onClick={() => { setSummary(extractActions(doc.passages)); setMatches([]); setAnswer(''); }}>Find action candidates</Btn></div>
      {answer && <p className="answer-box">{answer}</p>}
      {summary.length > 0 && <ol>{summary.map((item, i) => <li key={i}>{item.text} <a href={`#assistant-${item.source.id}`}>[{item.source.id} — {item.source.label}]</a></li>)}</ol>}
      {matches.map(source => <article key={source.id} className="source-card"><a href={`#assistant-${source.id}`}>[{source.id}] {source.label}</a><p>{source.text}</p></article>)}
      <h3>Read aloud</h3><ReadAloud text={doc.passages.map(p => p.text).join('\n\n')} />
      <TranslationTool text={doc.passages.map(p => p.text).join('\n\n')} createDocument={createDocument} />
      <h3>Extract a table to Excel</h3><p>Copy a table from a source passage below, then correct its rows and columns before export. Tabs, CSV, and Markdown tables are accepted.</p>
      <textarea aria-label="Table data" className="large-input" value={table} onChange={e => setTable(e.target.value)} placeholder="Item,Quantity,Price" />
      <Btn disabled={!table.trim()} onClick={() => run('Exporting table…', async () => { const { loadWorkbook, saveXlsx } = await import('../engines/sheet'); const wb = await loadWorkbook(null); const rows = delimitedRows(table); rows.forEach((row, i) => row.forEach((value, j) => { wb.worksheets[0].getCell(i + 1, j + 1).value = value; })); await saveFile('Extracted-table.xlsx', await saveXlsx(wb)); })}>Export table .xlsx</Btn>
      <details><summary>Source passages ({doc.passages.length})</summary>{doc.passages.map(passage => <article key={passage.id} id={`assistant-${passage.id}`} className="source-card"><strong>[{passage.id}] {passage.label}</strong><pre>{passage.text}</pre><Btn onClick={() => setTable(passage.text)}>Use as table draft</Btn></article>)}</details>
    </>}
  </div>;
}
