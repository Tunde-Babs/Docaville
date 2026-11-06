import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { releaseEdition } from './src/lib/edition';

// Content-Security-Policy for production builds (dev needs inline HMR scripts, so it's build-only).
// OCR fetches its WASM engine and language data from jsDelivr / projectnaptha on first use.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: https://cdn.jsdelivr.net https://tessdata.projectnaptha.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://*.xethub.hf.co",
  "media-src 'self' blob: data:",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-src 'self' blob: about:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');
const csp = (): Plugin => ({
  name: 'csp', apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// base './' so the bundle loads from file:// (Electron) and capacitor://, not just http.
export default defineConfig(({ mode }) => {
  const channel = process.env.VITE_RELEASE_CHANNEL ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_RELEASE_CHANNEL ?? 'beta';
  releaseEdition(channel); // Reject a retail build until verified billing has been implemented.
  return {
  define: { 'import.meta.env.VITE_RELEASE_CHANNEL': JSON.stringify(channel) },
  base: './',
  plugins: [react(), csp(), { name: 'local-ml-runtime', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const ocr = request.url?.split('?')[0].match(/\/ocr-runtime\/(worker\.min\.js|tesseract-core(?:-simd)?-lstm\.wasm(?:\.js)?)$/);
      if (ocr) {
        response.setHeader('Content-Type', ocr[1].endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        response.end(readFileSync(ocr[1] === 'worker.min.js' ? 'node_modules/tesseract.js/dist/worker.min.js' : `node_modules/tesseract.js-core/${ocr[1]}`)); return;
      }
      const match = request.url?.split('?')[0].match(/\/ml-runtime\/(ort-wasm-simd-threaded\.jsep\.(?:mjs|wasm))$/);
      if (!match) { next(); return; }
      response.setHeader('Content-Type', match[1].endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      response.end(readFileSync(`node_modules/onnxruntime-web/dist/${match[1]}`));
    });
  }, closeBundle() {
    mkdirSync('dist/assets/ml-runtime', { recursive: true });
    for (const file of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
      cpSync(`node_modules/onnxruntime-web/dist/${file}`, `dist/assets/ml-runtime/${file}`);
    }
    mkdirSync('dist/ocr-runtime', { recursive: true });
    cpSync('node_modules/tesseract.js/dist/worker.min.js', 'dist/ocr-runtime/worker.min.js');
    for (const name of ['tesseract-core-lstm', 'tesseract-core-simd-lstm']) for (const suffix of ['.wasm', '.wasm.js']) cpSync(`node_modules/tesseract.js-core/${name}${suffix}`, `dist/ocr-runtime/${name}${suffix}`);
  } }],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  };
});
