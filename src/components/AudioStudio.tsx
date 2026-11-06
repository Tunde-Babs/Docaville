import { useEffect, useRef, useState } from 'react';
import { decodeAudio, localInference, cancelLocalML, transcriptSegments, timestamp, vocabularyRules, applyVocabulary, type TranscriptSegment } from '../engines/localML';
import { extractiveSummary, extractActions, textHtml, type Passage } from '../engines/documentTools';
import { localRead, localWrite, localRemove } from '../lib/localStore';
import { saveFile } from '../lib/fileio';
import { Btn, FilePick, run } from './ui';
import Dictation, { SPEECH_LANGUAGES } from './Dictation';
import { saveRegistry } from './useSave';
import TranslationTool from './TranslationTool';

export default function AudioStudio({ createDocument }: { createDocument: (name: string, html: string) => void }) {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]), [audio, setAudio] = useState<Blob>(), [url, setUrl] = useState('');
  const [title, setTitle] = useState('Meeting notes'), [language, setLanguage] = useState('en'), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [recording, setRecording] = useState(false);
  const [retain, setRetain] = useState(false), [output, setOutput] = useState('transcript'), [draft, setDraft] = useState(''), [ready, setReady] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const player = useRef<HTMLAudioElement>(null), recorder = useRef<MediaRecorder>(), stream = useRef<MediaStream>(), mounted = useRef(true);
  const [persistError, setPersistError] = useState('');
  const [vocabulary, setVocabulary] = useState('');
  const [dictating, setDictating] = useState(false);
  const audioSettings = useRef({ retain, audio }); audioSettings.current = { retain, audio };
  const saveStopped = useRef<(blob: Blob) => void>();
  const project = useRef({ title, segments, draft, output }); project.current = { title, segments, draft, output };
  useEffect(() => {
    if (!ready) return;
    saveRegistry.set('audio-project', { print: () => {}, save: async () => {
      try { await localWrite('audio-project', { ...project.current, audio: audioSettings.current.retain ? audioSettings.current.audio : undefined }); return true; }
      catch (error) { setPersistError(String(error)); return false; }
    } });
    return () => { saveRegistry.delete('audio-project'); };
  }, [ready]);
  useEffect(() => {
    const id = 'audio-recording';
    window.dispatchEvent(new CustomEvent('documenthub-extra-dirty', { detail: { id, dirty: recording } }));
    if (recording) saveRegistry.set(id, { print: () => {}, save: async () => {
      try {
        const blob = await new Promise<Blob>(resolve => { saveStopped.current = resolve; recorder.current?.stop(); });
        await localWrite('audio-project', { ...project.current, audio: blob }); setRetain(true); return true;
      } catch (error) { setStatus(`Could not save recording: ${String(error)}`); return false; }
    } });
    return () => { saveRegistry.delete(id); window.dispatchEvent(new CustomEvent('documenthub-extra-dirty', { detail: { id, dirty: false } })); };
  }, [recording]);
  useEffect(() => {
    mounted.current = true;
    localRead<{ segments: TranscriptSegment[]; title: string; audio?: Blob; draft?: string; output?: string }>('audio-project').then(saved => { if (saved && mounted.current) { setSegments(saved.segments); setTitle(saved.title); setDraft(saved.draft ?? ''); setOutput(saved.output ?? 'transcript'); if (saved.audio) { setAudio(saved.audio); setRetain(true); } } }).catch(e => setPersistError(String(e))).finally(() => setReady(true));
    localRead<string>('vocabulary').then(value => { if (mounted.current) setVocabulary(value ?? ''); }).catch(() => undefined);
    return () => { mounted.current = false; if (recorder.current?.state !== 'inactive') recorder.current?.stop(); stream.current?.getTracks().forEach(t => t.stop()); };
  }, []);
  useEffect(() => {
    if (!audio) { setUrl(''); return; }
    const next = URL.createObjectURL(audio); setUrl(next); return () => URL.revokeObjectURL(next);
  }, [audio]);
  useEffect(() => {
    if (!ready) return;
    const timeout = setTimeout(() => void localWrite('audio-project', { segments, title, draft, output, audio: retain ? audio : undefined }).catch(e => setPersistError(String(e))), 500);
    return () => clearTimeout(timeout);
  }, [segments, title, draft, output, retain, audio, ready]);
  const passages: Passage[] = segments.map((s, i) => ({ id: `T${i + 1}`, label: s.live ? `Dictation passage ${i + 1}` : timestamp(s.start), text: s.text }));
  const transcript = segments.map(s => `[${s.live ? 'Dictation' : timestamp(s.start)}]${s.speaker ? ` ${s.speaker}:` : ''} ${s.text}`).join('\n\n');
  function prepareOutput() {
    const summary = extractiveSummary(passages).map(s => `${s.text} [${s.source.label}]`).join('\n\n');
    const actions = extractActions(passages).map(s => `• ${s.text} [${s.source.label}]\n  Owner: Unassigned | Due: Unassigned`).join('\n\n');
    setDraft(output === 'transcript' ? transcript : `${title}\n\n${output === 'minutes' ? 'Meeting minutes' : output === 'lecture' ? 'Lecture notes' : 'Report'}\n\nKey passages\n${summary || 'Add a summary after reviewing the transcript.'}\n\nAction candidates — review before assigning\n${actions || 'No action candidates found.'}\n\nTranscript\n${transcript}`);
  }
  async function transcribe() {
    if (!audio) return;
    setBusy(true); setStatus('Decoding audio…');
    try {
      const { samples, duration } = await decodeAudio(audio);
      const result = await localInference('automatic-speech-recognition', { audio: samples, language }, setStatus);
      setSegments(transcriptSegments(result, duration)); setDraft(''); setStatus('Transcript ready. Review names, numbers, and timestamps before exporting.');
    } catch (error) { setStatus(String((error as Error).message)); }
    finally { setBusy(false); }
  }
  async function record() {
    setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Audio recording is unavailable in this environment. Import a recording instead.');
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const next = new MediaRecorder(stream.current); recorder.current = next; const chunks: Blob[] = [];
      next.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      next.onstop = () => { const blob = new Blob(chunks, { type: next.mimeType }); if (mounted.current) { setAudio(blob); setRecording(false); setRecordingPaused(false); } saveStopped.current?.(blob); saveStopped.current = undefined; stream.current?.getTracks().forEach(t => t.stop()); };
      next.start(); setRecordingPaused(false); setRecording(true); setStatus('Recording on this device…');
    } catch (e) { stream.current?.getTracks().forEach(track => track.stop()); setStatus(String((e as Error).message)); }
    finally { setBusy(false); }
  }
  const update = (id: string, patch: Partial<TranscriptSegment>) => setSegments(cur => cur.map(s => s.id === id ? { ...s, ...patch } : s));
  return <div className="tool-content">
    <h2>Audio to document</h2><p>Record or import audio, correct the transcript, and create an editable document. Audio is processed on this device. First use downloads a multilingual speech model.</p>
    <div className="row wrap">
      <FilePick disabled={busy || recording || dictating} accept="audio/*,video/mp4,.mp3,.wav,.m4a,.mp4,.webm,.ogg,.flac" onFiles={files => { if (!busy && !recording) { setAudio(files[0]); setStatus(`Selected ${files[0].name}. Transcribe to replace the current transcript.`); } }}>Import recording</FilePick>
      <Btn disabled={busy || dictating} onClick={() => recording ? recorder.current?.stop() : record()}>{recording ? '■ Stop recording' : '● Record audio'}</Btn>
      {recording && <Btn onClick={() => { if (recordingPaused) recorder.current?.resume(); else recorder.current?.pause(); setRecordingPaused(!recordingPaused); }}>{recordingPaused ? 'Resume recording' : 'Pause recording'}</Btn>}
      <label>Language <select value={language} disabled={busy} onChange={e => setLanguage(e.target.value)}>{SPEECH_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <Btn primary disabled={!audio || busy || recording || dictating} onClick={transcribe}>Transcribe on device</Btn>
      {busy && <Btn onClick={cancelLocalML}>Cancel</Btn>}
    </div>
    <p role="status">{status}</p>
    {url && <audio ref={player} controls src={url} />}
    <label className="inline"><input type="checkbox" checked={retain} onChange={e => { const keep = e.target.checked; void run('Updating recording storage…', async () => { await localWrite('audio-project', { ...project.current, audio: keep ? audio : undefined }); setRetain(keep); }); }} /> Keep this recording locally after closing. Transcript text is saved locally.</label>
    <div className="row wrap"><Btn disabled={!audio || recording || busy} onClick={() => run('Removing local recording…', async () => { await localWrite('audio-project', project.current); setAudio(undefined); setRetain(false); })}>Remove recording</Btn>
      <Btn disabled={!segments.length || busy || recording || dictating} onClick={() => run('Clearing local audio project…', async () => { await localRemove('audio-project'); setSegments([]); setDraft(''); setAudio(undefined); setRetain(false); })}>Clear this project</Btn></div>
    {persistError && <p role="alert">Local draft storage failed: {persistError}. Export your transcript to preserve it.</p>}
    <div className="transcript-list">{segments.map(segment => <div key={segment.id} className={'transcript-row' + (segment.review ? ' needs-review' : '')}>
      <Btn disabled={!url || segment.live} onClick={() => { if (player.current) { player.current.currentTime = segment.start; void player.current.play().catch(() => undefined); } }}>{segment.live ? 'Dictation' : timestamp(segment.start)}</Btn>
      <input aria-label={`Speaker at ${timestamp(segment.start)}`} placeholder="Speaker (optional)" value={segment.speaker} onChange={e => update(segment.id, { speaker: e.target.value })} />
      <textarea aria-label={`Transcript at ${timestamp(segment.start)}`} value={segment.text} onChange={e => update(segment.id, { text: e.target.value })} />
      <label className="inline"><input type="checkbox" checked={segment.review} onChange={e => update(segment.id, { review: e.target.checked })} /> Review</label>
    </div>)}</div>
    <details><summary>Custom vocabulary and spelling rules</summary><p>Save preferred spellings for names and specialist terms. These are explicit text replacements after recognition, rather than model confidence estimates. Use one rule per line: recognized spelling {' => '} preferred spelling.</p><textarea className="large-input" aria-label="Custom vocabulary rules" value={vocabulary} onChange={e => setVocabulary(e.target.value)} placeholder="document hub => Docaville" /><div className="row wrap"><Btn onClick={() => run('Saving vocabulary…', async () => { vocabularyRules(vocabulary); await localWrite('vocabulary', vocabulary); })}>Save vocabulary</Btn><Btn disabled={!segments.length} onClick={() => run('Applying spelling rules…', async () => { const rules = vocabularyRules(vocabulary); setSegments(current => current.map(segment => ({ ...segment, originalText: segment.originalText ?? segment.text, text: applyVocabulary(segment.text, rules), review: true }))); })}>Apply to transcript</Btn><Btn disabled={!segments.some(segment => segment.originalText)} onClick={() => setSegments(current => current.map(segment => ({ ...segment, text: segment.originalText ?? segment.text, review: true })))}>Restore original recognition text</Btn></div></details>
    <h3>Dictation</h3><p>Speak into a new transcript passage. Keep the recording tool stopped while dictating.</p>
    {!recording && !busy && <Dictation onStateChange={setDictating} onText={text => setSegments(cur => [...cur, { id: crypto.randomUUID(), start: 0, end: null, text, speaker: '', review: true, live: true }])} />}
    <h3>Create a document</h3><div className="row wrap">
      <label>Title <input value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>Output <select value={output} onChange={e => setOutput(e.target.value)}><option value="transcript">Transcript</option><option value="minutes">Meeting minutes</option><option value="lecture">Lecture notes</option><option value="report">Report</option></select></label>
      <Btn disabled={!segments.length} onClick={prepareOutput}>Prepare draft</Btn>
      <Btn disabled={!segments.length} onClick={() => run('Exporting transcript…', () => saveFile(`${title || 'Transcript'}.txt`, transcript))}>Export transcript .txt</Btn>
    </div>
    {draft && <><p>Review the draft before creating a Word document. Action candidates and summaries quote the transcript; no owners or deadlines are inferred.</p><textarea className="large-input" aria-label="Document draft" value={draft} onChange={e => setDraft(e.target.value)} />
      <Btn primary onClick={() => createDocument(title || 'Transcript', textHtml(draft))}>Open draft in Word editor</Btn></>}
    <TranslationTool text={transcript} createDocument={createDocument} />
  </div>;
}
