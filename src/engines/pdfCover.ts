import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import type { Overlay } from './pdf';
import { drawText, fallbackFonts } from './pdfFonts';
import { canvasToBytes } from '../lib/image';

/**
 * Secure covering is a clean export, never an incremental edit. No original PDF objects, forms,
 * attachments or metadata are copied. Rebuild pixels at 300 DPI and add only verified uncovered
 * text boxes as a fresh invisible search layer. This also covers scans, nested forms and Type 3 fonts.
 */
export async function coveredCopy(bytes: Uint8Array, overlays: Overlay[]) {
  const { loadPdfJs } = await import('./pdf');
  const source = await loadPdfJs(bytes), clean = await PDFDocument.create();
  const regular = await clean.embedFont(StandardFonts.Helvetica);
  const normalized: Overlay[] = [];
  try {
    for (let i = 0; i < source.numPages; i++) {
      const original = await source.getPage(i + 1);
      const vp = original.getViewport({ scale: 1, rotation: 0 });
      const scale = 300 / 72, renderVp = original.getViewport({ scale, rotation: 0 });
      if (renderVp.width * renderVp.height > 64_000_000 || Math.max(renderVp.width, renderVp.height) > 32760) throw new Error('This PDF page is too large to safely flatten at print quality. Export smaller pages before covering content.');
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(renderVp.width); canvas.height = Math.ceil(renderVp.height);
      const ctx = canvas.getContext('2d')!;
      await original.render({ canvasContext: ctx, viewport: renderVp, background: '#FFFFFF' }).promise;
      const covers = overlays.filter((o): o is Extract<Overlay, { type: 'rect' }> => o.page === i && o.type === 'rect' && o.opacity >= 1);
      const boxes = covers.map(o => {
        const [x1, y1, x2, y2] = vp.convertToViewportRectangle([o.x, o.y, o.x + o.w, o.y + o.h]);
        const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
        ctx.fillStyle = o.color;
        // Round outward so antialiasing on the pixel boundary cannot retain covered edge pixels.
        ctx.fillRect(Math.floor(box.x * scale), Math.floor(box.y * scale), Math.ceil((box.x + box.w) * scale) - Math.floor(box.x * scale), Math.ceil((box.y + box.h) * scale) - Math.floor(box.y * scale));
        return box;
      });
      const page = clean.addPage([vp.width, vp.height]);
      const image = await clean.embedPng(await canvasToBytes(canvas));
      page.drawImage(image, { x: 0, y: 0, width: vp.width, height: vp.height });
      canvas.width = canvas.height = 0;
      const text = await original.getTextContent();
      for (const item of text.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const t = item.transform;
        // Unknown/rotated text geometry is kept visually but never guessed into the hidden layer.
        if (Math.abs(t[1]) > 0.001 || Math.abs(t[2]) > 0.001 || t[0] <= 0 || t[3] <= 0) continue;
        const [x, y] = vp.convertToViewportPoint(t[4], t[5]);
        const h = Math.abs(t[3]) * vp.scale, w = item.width * vp.scale;
        const bounds = { left: x - 1, right: x + w + 1, top: y - h - 1, bottom: y + h * 0.3 + 1 };
        if (boxes.some(b => bounds.left < b.x + b.w && bounds.right > b.x && bounds.top < b.y + b.h && bounds.bottom > b.y)) continue;
        // If an uncovered script cannot be encoded, keep the pixels and omit its search layer.
        // A searchable layer must never cause incomplete sanitization to be saved.
        try {
          const fonts = await fallbackFonts(clean, item.str);
          drawText(page, item.str, regular, fonts, { x, y: vp.height - y, size: h, opacity: 0 });
        } catch (e) { console.warn('Uncovered PDF text is retained as pixels only', e); }
      }
      page.setRotation(degrees(original.rotate));
      for (const o of overlays.filter(o => o.page === i && !(o.type === 'rect' && o.opacity >= 1))) {
        const [x, y] = vp.convertToViewportPoint(o.x, o.y);
        normalized.push({ ...o, x, y: vp.height - y, ...('w' in o ? { w: o.w * vp.scale, h: o.h * vp.scale } : { size: o.size * vp.scale }) } as Overlay);
      }
    }
    return { bytes: await clean.save(), overlays: normalized, pages: Array.from({ length: source.numPages }, (_, index) => ({ src: 0, index, rotation: 0 })) };
  } finally { await source.destroy(); }
}
