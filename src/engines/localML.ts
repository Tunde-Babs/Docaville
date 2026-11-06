let worker: Worker | undefined;
let sequence = 0;
let active: { id: number; reject: (reason: Error) => void } | undefined;
export function cancelLocalML() {
  active?.reject(new DOMException('Processing cancelled', 'AbortError'));
  active = undefined; worker?.terminate(); worker = undefined;
}
export async function localInference(task: 'automatic-speech-recognition' | 'question-answering' | 'translation', input: Record<string, unknown>, progress: (message: string) => void): Promise<any> {
  if (active) throw new Error('Another local model is busy. Finish or cancel that operation first.');
  worker ??= new Worker(new URL('../workers/ml.worker.ts', import.meta.url), { type: 'module' });
  const target = worker, id = ++sequence;
  return new Promise((resolve, reject) => {
    active = { id, reject };
    target.onmessage = event => {
      if (event.data.id !== id) return;
      if (event.data.type === 'progress') {
        const p = event.data.progress;
        progress(p.status === 'progress' ? `Downloading model: ${Math.round(p.progress ?? 0)}%` : p.status === 'ready' ? 'Processing on this device…' : 'Preparing local model…');
      } else {
        active = undefined;
        event.data.type === 'error' ? reject(new Error(event.data.error)) : resolve(event.data.result);
      }
    };
    target.onerror = error => { active = undefined; target.terminate(); worker = undefined; reject(new Error(error.message || 'The local model could not start.')); };
    progress('Loading local model…'); target.postMessage({ id, task, ...input });
  });
}
export interface TranscriptSegment { id: string; start: number; end: number | null; text: string; originalText?: string; speaker: string; review: boolean; live?: boolean }
export async function decodeAudio(blob: Blob): Promise<{ samples: Float32Array; duration: number }> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (audio.duration > 2 * 60 * 60) throw new Error('Choose a recording shorter than two hours.');
    const offline = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = audio; source.connect(offline.destination); source.start();
    return { samples: (await offline.startRendering()).getChannelData(0).slice(), duration: audio.duration };
  } finally { await context.close(); }
}
export function transcriptSegments(result: { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }, duration: number): TranscriptSegment[] {
  const chunks = result.chunks?.length ? result.chunks : [{ text: result.text, timestamp: [0, duration] as [number, number] }];
  return chunks.filter(c => c.text.trim()).map(c => ({ id: crypto.randomUUID(), start: Math.max(0, c.timestamp[0] ?? 0), end: c.timestamp[1], text: c.text.trim(), originalText: c.text.trim(), speaker: '', review: true }));
}
export function vocabularyRules(input: string): [string, string][] {
  return input.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const parts = line.split('=>');
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) throw new Error('Use one spelling rule per line: recognized spelling => preferred spelling');
    return [parts[0].trim(), parts[1].trim()] as [string, string];
  }).slice(0, 100);
}
export function applyVocabulary(text: string, rules: [string, string][]) {
  let result = text;
  for (const [before, after] of rules) result = result.replace(new RegExp(`(?<![\\p{L}\\p{N}])${before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), () => after);
  return result;
}
export async function translateLocally(text: string, source: string, target: string, progress: (message: string) => void) {
  if (![source, target].every(language => ['en', 'de', 'fr', 'es'].includes(language))) throw new Error('Text translation supports English, German, French, and Spanish.');
  if (source === target) return text;
  // Short segments avoid silently truncating long paragraphs at the model's token limit.
  const chunks = text.match(/[\s\S]{1,350}(?:\s|$)|[\s\S]{1,350}/g) ?? [];
  const translated: string[] = [];
  for (const [i, chunk] of chunks.entries()) {
    progress(`Translating passage ${i + 1}/${chunks.length}…`);
    const route = source !== 'en' && target !== 'en' ? [`${source}-en`, `en-${target}`] : [`${source}-${target}`];
    let current = chunk;
    for (const pair of route) { const result = await localInference('translation', { pair, text: current }, progress); if (!result[0]?.translation_text) throw new Error('The translation model returned no text.'); current = result[0].translation_text; }
    translated.push(current);
  }
  return translated.join('\n\n');
}
export function timestamp(seconds: number) {
  return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
export function spokenText(text: string) {
  return text.replace(/\b(new paragraph|neuer absatz)\b/gi, '\n\n').replace(/\b(new line|neue zeile)\b/gi, '\n')
    .replace(/\s+([,.!?;:])/g, '$1');
}
