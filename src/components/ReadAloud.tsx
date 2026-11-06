import { useEffect, useRef, useState } from 'react';
import { Btn } from './ui';
export default function ReadAloud({ text }: { text: string }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]), [voice, setVoice] = useState(''), [rate, setRate] = useState(1), [playing, setPlaying] = useState(false), [paused, setPaused] = useState(false), [current, setCurrent] = useState(-1), [status, setStatus] = useState('');
  const generation = useRef(0), utterance = useRef<SpeechSynthesisUtterance>();
  const [nativeVoices, setNativeVoices] = useState<{ id: string; name: string; language: string }[]>([]);
  const paragraphs = text.split(/\n\s*\n|\n/).filter(p => p.trim());
  useEffect(() => {
    window.docHubNative?.speechVoices?.().then(setNativeVoices).catch(() => undefined);
    if (!window.speechSynthesis) return;
    const refresh = () => setVoices(speechSynthesis.getVoices().filter(v => v.localService)); refresh(); speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => { generation.current++; speechSynthesis.cancel(); void window.docHubNative?.speechControl?.('stop'); speechSynthesis.removeEventListener('voiceschanged', refresh); };
  }, []);
  useEffect(() => { generation.current++; window.speechSynthesis?.cancel(); void window.docHubNative?.speechControl?.('stop'); setPlaying(false); setPaused(false); setCurrent(-1); }, [text]);
  const stop = () => { generation.current++; window.speechSynthesis?.cancel(); void window.docHubNative?.speechControl?.('stop'); setPlaying(false); setPaused(false); setCurrent(-1); };
  function start() {
    stop(); const run = ++generation.current;
    const read = (index: number) => {
      if (run !== generation.current) return;
      if (index >= paragraphs.length) { setPlaying(false); setCurrent(-1); return; }
      if (nativeVoices.length && window.docHubNative) {
        setCurrent(index); setPlaying(true);
        void window.docHubNative.speak(paragraphs[index], voice || nativeVoices[0].id, rate).then(() => read(index + 1)).catch(error => { if (run === generation.current) { setStatus(String(error)); setPlaying(false); } });
        return;
      }
      const speech = new SpeechSynthesisUtterance(paragraphs[index]); utterance.current = speech;
      speech.voice = voices.find(v => v.voiceURI === voice) ?? voices[0] ?? null; speech.rate = rate;
      speech.onend = () => read(index + 1);
      speech.onerror = event => { if (event.error !== 'canceled' && event.error !== 'interrupted') { setStatus(`Read aloud: ${event.error}`); setPlaying(false); } };
      setCurrent(index); setPlaying(true); speechSynthesis.speak(speech);
    }; read(0);
  }
  return <div className="read-aloud"><div className="row wrap"><label>Local voice <select aria-label="Read aloud voice" disabled={playing} value={voice} onChange={e => setVoice(e.target.value)}><option value="">Default local voice</option>{nativeVoices.length ? nativeVoices.map(v => <option key={v.id} value={v.id}>{v.name} ({v.language})</option>) : voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}</select></label>
    <label>Speed <select value={rate} disabled={playing} onChange={e => setRate(+e.target.value)}>{[0.75, 1, 1.25, 1.5, 2].map(r => <option key={r} value={r}>{r}×</option>)}</select></label>
    <Btn disabled={!text.trim() || (!voices.length && !nativeVoices.length) || playing} onClick={start}>▶ Read aloud</Btn><Btn disabled={!playing} onClick={() => { if (nativeVoices.length) void window.docHubNative?.speechControl(paused ? 'resume' : 'pause'); else if (paused) speechSynthesis.resume(); else speechSynthesis.pause(); setPaused(!paused); }}>{paused ? 'Resume' : 'Pause'}</Btn><Btn disabled={!playing} onClick={stop}>Stop</Btn></div>
    {!voices.length && !nativeVoices.length && <p role="status">No local speech voice is available. Install a voice in your device's accessibility settings.</p>}{status && <p role="alert">{status}</p>}
    {playing && <div className="reading-text" aria-live="off">{paragraphs.map((p, i) => <p key={i} className={i === current ? 'reading-current' : ''}>{p}</p>)}</div>}
  </div>;
}
