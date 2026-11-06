import { env, pipeline } from '@huggingface/transformers';
import { localRead, localWrite } from '../lib/localStore';

env.allowLocalModels = false;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = {
  async match(request: string | Request) {
    const key = typeof request === 'string' ? request : request.url;
    const saved = await localRead<{ bytes: Uint8Array; headers: [string, string][] }>(`model-cache:${key}`);
    return saved ? new Response(saved.bytes as BodyInit, { headers: saved.headers }) : undefined;
  },
  async put(request: string | Request, response: Response) {
    const key = typeof request === 'string' ? request : request.url;
    try { await localWrite(`model-cache:${key}`, { bytes: new Uint8Array(await response.clone().arrayBuffer()), headers: [...response.headers.entries()] }); }
    catch { /* Inference can still run when local storage is full. */ }
  },
};
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
// The runtime is included with the application; only model weights are downloaded.
env.backends.onnx.wasm!.wasmPaths = new URL('./ml-runtime/', self.location.href).href;
const engines = new Map<string, Promise<any>>();
async function engine(task: 'automatic-speech-recognition' | 'question-answering' | 'translation', id: number, pair?: string) {
  if (task === 'translation' && !['en-de', 'de-en', 'en-fr', 'fr-en', 'en-es', 'es-en'].includes(pair ?? '')) throw new Error('This translation language pair is not supported.');
  const key = task === 'translation' ? `${task}:${pair}` : task;
  let cached = engines.get(key);
  if (!cached) {
    const model = task === 'automatic-speech-recognition' ? 'Xenova/whisper-tiny' : task === 'translation' ? `Xenova/opus-mt-${pair}` : 'Xenova/distilbert-base-cased-distilled-squad';
    cached = (pipeline as any)(task, model, { dtype: 'q8', device: 'wasm', progress_callback: (progress: unknown) => self.postMessage({ id, type: 'progress', progress }) });
    engines.set(key, cached!);
    try { await cached; await localWrite(`model-ready:${key}`, true); }
    catch (e) { engines.delete(key); throw e; }
  }
  return cached;
}
self.onmessage = async (event: MessageEvent) => {
  const { id, task, audio, language, question, context, text, pair } = event.data;
  try {
    const pipe = await engine(task, id, pair);
    const result = task === 'automatic-speech-recognition'
      ? await pipe(audio, { language: language || undefined, task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 })
      : task === 'translation' ? await pipe(text, { max_new_tokens: 256 }) : await pipe(question, context);
    self.postMessage({ id, type: 'result', result });
  } catch (e) { self.postMessage({ id, type: 'error', error: String((e as Error).message || e) }); }
};
