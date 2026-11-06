import { useEffect, useId, useRef, useState } from 'react';
import { localInference, cancelLocalML, spokenText, applyVocabulary, vocabularyRules } from '../engines/localML';
import { localRead } from '../lib/localStore';
import { Btn } from './ui';
import { saveRegistry } from './useSave';

export const SPEECH_LANGUAGES = [['en', 'English'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['yo', 'Yoruba'], ['ar', 'Arabic'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ru', 'Russian']] as const;
export default function Dictation({ onText, onStateChange, documentId }: { onText: (text: string) => void; onStateChange?: (active: boolean) => void; documentId?: string }) {
  const [recording, setRecording] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [language, setLanguage] = useState('en');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [deviceId, setDeviceId] = useState(''), [level, setLevel] = useState(0);
  const [starting, setStarting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [useVocabulary, setUseVocabulary] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const failedSamples = useRef<Float32Array>();
  const session = useRef<{ context: AudioContext; stream: MediaStream; processor: ScriptProcessorNode; source: MediaStreamAudioSourceNode; gain: GainNode }>();
  const chunks = useRef<Float32Array[]>([]), count = useRef(0), working = useRef(false), alive = useRef(true);
  const callback = useRef(onText); callback.current = onText;
  const stateCallback = useRef(onStateChange); stateCallback.current = onStateChange;
  const id = useId(), failed = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const process = async () => {
    if (working.current || count.current < 8000) return;
    const samples = new Float32Array(count.current); let offset = 0;
    chunks.current.forEach(chunk => { samples.set(chunk, offset); offset += chunk.length; }); chunks.current = []; count.current = 0;
    if (samples.reduce((sum, n) => sum + n * n, 0) / samples.length < 0.000025) return;
    working.current = true; setBusy(true);
    try {
      const result = await localInference('automatic-speech-recognition', { audio: samples, language }, message => alive.current && setStatus(message));
      if (alive.current && result.text?.trim()) {
        let text = spokenText(result.text.trim());
        if (useVocabulary) { try { text = applyVocabulary(text, vocabularyRules(await localRead<string>('vocabulary') ?? '')); } catch { /* Preserve the recognized text if local spelling rules cannot be read. */ } }
        callback.current(text);
      }
    } catch (error) {
      failed.current = true; failedSamples.current = samples;
      const current = session.current; session.current = undefined;
      if (current) { current.stream.getTracks().forEach(track => track.stop()); current.processor.disconnect(); current.source.disconnect(); current.gain.disconnect(); void current.context.close(); }
      if (alive.current) { setRetryAvailable(true); setRecording(false); setLevel(0); setStatus(`${String((error as Error).message)}. The pending passage is kept in memory; retry or discard it.`); }
    }
    finally { working.current = false; if (alive.current) { setBusy(false); if (session.current) setStatus('Listening on this device…'); if (!failed.current && (count.current >= 128000 || (!session.current && count.current >= 8000))) void process(); } }
  };
  const stop = () => {
    const s = session.current; session.current = undefined;
    if (s) { s.processor.disconnect(); s.source.disconnect(); s.gain.disconnect(); s.stream.getTracks().forEach(t => t.stop()); void s.context.close(); }
    setRecording(false); setPaused(false); setLevel(0); setStatus('Dictation stopped.'); void process();
  };
  const stopRef = useRef(stop); stopRef.current = stop;
  useEffect(() => {
    const key = `dictation:${id}`, active = recording || busy || starting || retryAvailable;
    stateCallback.current?.(active);
    window.dispatchEvent(new CustomEvent('documenthub-extra-dirty', { detail: { id: key, dirty: active } }));
    if (active) {
      const flush = async () => {
        if (failed.current) return false;
        stopRef.current(); const deadline = Date.now() + 120000;
        while (!failed.current && (working.current || count.current >= 8000) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        return !working.current && !failed.current;
      };
      saveRegistry.set(key, { print: () => {}, owner: documentId, save: flush, flush });
    }
    return () => { stateCallback.current?.(false); saveRegistry.delete(key); window.dispatchEvent(new CustomEvent('documenthub-extra-dirty', { detail: { id: key, dirty: false } })); };
  }, [recording, busy, starting, retryAvailable, id, documentId]);
  useEffect(() => { const changed = () => { if (!container.current?.offsetParent && session.current) stopRef.current(); }; window.addEventListener('documenthub-view', changed); return () => window.removeEventListener('documenthub-view', changed); }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; const s = session.current; session.current = undefined; if (s) { s.stream.getTracks().forEach(t => t.stop()); s.processor.disconnect(); void s.context.close(); } }; }, []);
  useEffect(() => { navigator.mediaDevices?.enumerateDevices().then(all => setDevices(all.filter(device => device.kind === 'audioinput'))).catch(() => undefined); }, []);
  async function start() {
    failed.current = false;
    setStarting(true); let acquired: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is unavailable in this environment.');
      setStatus('Allow microphone access to start dictation.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
      acquired = stream;
      void navigator.mediaDevices.enumerateDevices().then(all => setDevices(all.filter(device => device.kind === 'audioinput')));
      if (!alive.current || !container.current?.offsetParent) { stream.getTracks().forEach(t => t.stop()); return; }
      const context = new AudioContext({ sampleRate: 16000 });
      await context.resume();
      const source = context.createMediaStreamSource(stream), processor = context.createScriptProcessor(4096, 1, 1), gain = context.createGain(); gain.gain.value = 0;
      source.connect(processor); processor.connect(gain); gain.connect(context.destination);
      chunks.current = []; count.current = 0;
      processor.onaudioprocess = event => {
        const input = event.inputBuffer.getChannelData(0);
        setLevel(Math.min(1, Math.sqrt(input.reduce((sum, sample) => sum + sample * sample, 0) / input.length) * 5));
        const ratio = context.sampleRate / 16000, chunk = new Float32Array(Math.floor(input.length / ratio));
        for (let i = 0; i < chunk.length; i++) chunk[i] = input[Math.floor(i * ratio)];
        chunks.current.push(chunk); count.current += chunk.length;
        if (count.current >= 128000) void process();
        if (count.current > 16000 * 60) { stop(); setStatus('Dictation paused: processing is slower than recording. Wait for the current passage to finish.'); }
      };
      session.current = { context, stream, processor, source, gain }; setRecording(true); setStatus('Listening on this device…');
    } catch (error) { acquired?.getTracks().forEach(track => track.stop()); setStatus(String((error as Error).message)); }
    finally { if (alive.current) setStarting(false); }
  }
  return <div className="dictation-control" ref={container}>
    <label>Microphone <select value={deviceId} disabled={recording || busy} onChange={event => setDeviceId(event.target.value)}><option value="">System default</option>{devices.filter(device => device.deviceId).map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${i + 1}`}</option>)}</select></label>
    <label>Speech language <select value={language} disabled={recording || busy} onChange={e => setLanguage(e.target.value)}>{SPEECH_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
    <label className="inline"><input type="checkbox" disabled={recording || busy} checked={useVocabulary} onChange={e => setUseVocabulary(e.target.checked)} /> Use saved spelling rules</label>
    <Btn active={recording} disabled={retryAvailable || starting || (!recording && busy)} onClick={() => recording ? stop() : start()}>{starting ? 'Starting microphone…' : recording ? '■ Stop dictation' : '🎙 Dictate'}</Btn>
    {retryAvailable && <><Btn onClick={() => { const pending = failedSamples.current; if (!pending) return; chunks.current.unshift(pending); count.current += pending.length; failedSamples.current = undefined; failed.current = false; setRetryAvailable(false); void process(); }}>Retry pending speech</Btn><Btn onClick={() => { failedSamples.current = undefined; chunks.current = []; count.current = 0; failed.current = false; setRetryAvailable(false); setStatus('Pending speech discarded.'); }}>Discard pending speech</Btn></>}
    {recording && <Btn onClick={async () => { const current = session.current; if (!current) return; current.stream.getAudioTracks().forEach(track => { track.enabled = paused; }); if (paused) await current.context.resume(); else await current.context.suspend(); setPaused(!paused); setLevel(0); setStatus(paused ? 'Listening on this device…' : 'Dictation paused.'); }}>{paused ? 'Resume dictation' : 'Pause dictation'}</Btn>}
    {recording && <meter aria-label="Microphone level" min={0} max={1} value={level} />}
    {busy && !recording && <Btn onClick={() => { cancelLocalML(); chunks.current = []; count.current = 0; }}>Cancel processing</Btn>}
    <small role="status">{status || 'Speech stays on this device. First use downloads a speech model. Text arrives in short passages; say “new paragraph” for a paragraph break.'}</small>
  </div>;
}
