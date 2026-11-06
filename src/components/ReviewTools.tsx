import { useState } from 'react';
import { compareText, reviewedText, type ReviewChange } from '../engines/review';
import { readDocument, textHtml } from '../engines/documentTools';
import { localRead, localWrite } from '../lib/localStore';
import { saveFile } from '../lib/fileio';
import { ACCEPT } from '../lib/formats';
import { Btn, FilePick, run } from './ui';
interface Comment { id: string; quote: string; text: string; author: string; at: number; resolved: boolean }
export default function ReviewTools({ createDocument }: { createDocument: (name: string, html: string) => void }) {
  const [left, setLeft] = useState<File>(), [right, setRight] = useState<File>(), [changes, setChanges] = useState<ReviewChange[]>([]), [past, setPast] = useState<ReviewChange[][]>([]), [future, setFuture] = useState<ReviewChange[][]>([]), [status, setStatus] = useState('');
  const [comments, setComments] = useState<Comment[]>([]), [key, setKey] = useState(''), [quote, setQuote] = useState(''), [note, setNote] = useState(''), [author, setAuthor] = useState('Me');
  const [busy, setBusy] = useState(false);
  async function compare() {
    if (!left || !right) return;
    setBusy(true);
    try {
      setStatus('Reading original…'); const a = await readDocument(left, setStatus); setStatus('Reading revised document…'); const b = await readDocument(right, setStatus);
      const before = a.passages.map(p => p.text).join('\n\n'), after = b.passages.map(p => p.text).join('\n\n');
      if (before.length + after.length > 600000) throw new Error('Choose documents with fewer than 600,000 combined characters for comparison.');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(before + '\u0000' + after)))].map(n => n.toString(16).padStart(2, '0')).join('');
      const storageKey = `review:${digest}`; setKey(storageKey);
      const saved = await localRead<{ comments: Comment[]; decisions: ReviewChange['decision'][] }>(storageKey);
      const diff = compareText(before, after).map((change, i) => ({ ...change, decision: saved?.decisions[i] ?? 'pending' }));
      setChanges(diff); setComments(saved?.comments ?? []); setPast([]); setFuture([]); setStatus(diff.some(c => c.changed) ? 'Review each text change. Pending changes keep the original text in the output.' : 'The extracted text is identical.');
    } catch (error) { setStatus(String((error as Error).message)); } finally { setBusy(false); }
  }
  async function persist(nextChanges: ReviewChange[], nextComments: Comment[]) { if (key) await localWrite(key, { decisions: nextChanges.map(c => c.decision), comments: nextComments }); }
  const changeDecision = (id: number | 'all', decision: ReviewChange['decision']) => run('Saving review…', async () => {
    const next = changes.map(change => change.changed && (id === 'all' || change.id === id) ? { ...change, decision } : change);
    await persist(next, comments); setPast(current => [...current.slice(-49), changes]); setFuture([]); setChanges(next);
  });
  const history = (redo: boolean) => run('Restoring review…', async () => {
    const from = redo ? future : past, next = from.at(-1); if (!next) return; await persist(next, comments);
    if (redo) { setFuture(from.slice(0, -1)); setPast(current => [...current, changes]); } else { setPast(from.slice(0, -1)); setFuture(current => [...current, changes]); } setChanges(next);
  });
  const pending = changes.filter(change => change.changed && change.decision === 'pending').length;
  return <div className="tool-content"><h2>Compare and review</h2><p>Compare extracted text across document versions, accept or reject changes, and keep local review notes. The reviewed output is a new text-based Word document; original formatting and Office tracked-change records are not transferred.</p>
    <div className="row wrap"><FilePick accept={ACCEPT} onFiles={files => setLeft(files[0])}>Choose original</FilePick><span>{left?.name}</span><FilePick accept={ACCEPT} onFiles={files => setRight(files[0])}>Choose revised</FilePick><span>{right?.name}</span><Btn primary disabled={!left || !right || busy} onClick={compare}>Compare versions</Btn></div>
    <p role="status">{status}</p>
    {!!changes.length && <><div className="row wrap"><span>{changes.filter(c => c.changed).length} changes · {pending} pending</span><Btn onClick={() => changeDecision('all', 'accepted')}>Accept all</Btn><Btn onClick={() => changeDecision('all', 'rejected')}>Reject all</Btn><Btn disabled={!past.length} onClick={() => history(false)}>Undo review</Btn><Btn disabled={!future.length} onClick={() => history(true)}>Redo review</Btn></div>
      <div className="diff-document">{changes.map(change => change.changed ? <span key={change.id} className={`diff-change ${change.decision}`}>
        {change.before && <del>{change.before}</del>}{change.after && <ins>{change.after}</ins>}
        <span className="diff-actions"><Btn aria-label={`Accept change ${change.id + 1}`} active={change.decision === 'accepted'} onClick={() => changeDecision(change.id, 'accepted')}>Accept</Btn><Btn aria-label={`Reject change ${change.id + 1}`} active={change.decision === 'rejected'} onClick={() => changeDecision(change.id, 'rejected')}>Reject</Btn><Btn onClick={() => setQuote(change.before || change.after)}>Comment</Btn></span>
      </span> : <span key={change.id}>{change.after}</span>)}</div>
      <details><summary>Reviewed output preview</summary><pre className="review-preview">{reviewedText(changes)}</pre></details>
      <div className="row wrap"><Btn primary onClick={() => createDocument('Reviewed document', textHtml(reviewedText(changes)))}>Open reviewed copy in Word</Btn><Btn onClick={() => saveFile('Reviewed-document.txt', reviewedText(changes))}>Export reviewed text</Btn><Btn onClick={() => saveFile('Document-review.json', JSON.stringify({ original: left?.name, revised: right?.name, changes, comments }, null, 2))}>Export review and comments</Btn></div>
      <h3>Local review notes</h3><label>Author <input value={author} onChange={e => setAuthor(e.target.value)} /></label><label>Quoted text <input value={quote} onChange={e => setQuote(e.target.value)} /></label><textarea aria-label="Review comment" value={note} onChange={e => setNote(e.target.value)} placeholder="Add a comment about this change" />
      <Btn disabled={!note.trim()} onClick={() => run('Saving comment…', async () => { const next = [...comments, { id: crypto.randomUUID(), quote, text: note.trim(), author: author.trim() || 'Me', at: Date.now(), resolved: false }]; await persist(changes, next); setComments(next); setNote(''); setQuote(''); })}>Add comment</Btn>
      {comments.map(comment => <article className="source-card" key={comment.id}><strong>{comment.author}</strong> · {new Date(comment.at).toLocaleString()} {comment.resolved && '· Resolved'}{comment.quote && <blockquote>{comment.quote}</blockquote>}<p>{comment.text}</p><Btn onClick={() => run('Updating comment…', async () => { const next = comments.map(c => c.id === comment.id ? { ...c, resolved: !c.resolved } : c); await persist(changes, next); setComments(next); })}>{comment.resolved ? 'Reopen' : 'Resolve'}</Btn></article>)}
    </>}
  </div>;
}
