// Image → Word fidelity harness. The runner sets window.__IMG = { b64, crop?: [x, y, w, h] };
// results land in window.__OCR = { text, langs, background, paras, docx (base64) }.
import { ocrCanvas } from '../src/engines/ocr';
import { analyzeLayout } from '../src/engines/ocrLayout';
import { imagesToDocx } from '../src/engines/docx';
import { decodeImage, canvasToBytes } from '../src/lib/image';

type W = Window & { __IMG?: { b64: string; crop?: number[] }; __OCR?: unknown };
const w = window as W;
(async () => {
  while (!w.__IMG) await new Promise((r) => setTimeout(r, 100));
  try {
    const bytes = Uint8Array.from(atob(w.__IMG.b64), (c) => c.charCodeAt(0));
    const img = await decodeImage(bytes, 'image/png');
    const [x, y, cw, ch] = w.__IMG.crop ?? [0, 0, img.naturalWidth, img.naturalHeight];
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    c.getContext('2d')!.drawImage(img, x, y, cw, ch, 0, 0, cw, ch);
    const t0 = performance.now();
    const ocr = await ocrCanvas(c, 'auto');
    const layout = analyzeLayout(ocr, c);
    const docx = await imagesToDocx([{ bytes: await canvasToBytes(c), mime: 'image/png', layout }]);
    let b = ''; for (let i = 0; i < docx.length; i += 0x8000) b += String.fromCharCode(...docx.subarray(i, i + 0x8000));
    w.__OCR = {
      ms: Math.round(performance.now() - t0), langs: ocr.langs, background: layout.background,
      paras: layout.paras.map((p) => `${p.sizePt}pt ${p.align}${p.indentPt ? ' +' + p.indentPt : ''} | ` + p.runs.map((r) => `[${r.color}${r.bold ? ' B' : ''}]${r.text}`).join('')),
      docx: btoa(b),
    };
  } catch (e) { w.__OCR = { error: (e as Error).stack }; }
})();
