import type { OcrResult } from './ocr';
export interface CropBox { left: number; top: number; right: number; bottom: number }
export const FULL_CROP: CropBox = { left: 0, top: 0, right: 100, bottom: 100 };
export function autoCrop(canvas: HTMLCanvasElement): CropBox {
  const preview = document.createElement('canvas'); const ratio = Math.min(1, 600 / Math.max(canvas.width, canvas.height)); preview.width = Math.max(1, Math.round(canvas.width * ratio)); preview.height = Math.max(1, Math.round(canvas.height * ratio));
  const context = preview.getContext('2d', { willReadFrequently: true })!; context.drawImage(canvas, 0, 0, preview.width, preview.height);
  const { data } = context.getImageData(0, 0, preview.width, preview.height), w = preview.width, h = preview.height;
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, (h * w - 1) * 4];
  const background = [0, 1, 2].map(channel => corners.reduce((sum, i) => sum + data[i + channel], 0) / corners.length);
  let left = w, top = h, right = 0, bottom = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const distance = Math.abs(data[i] - background[0]) + Math.abs(data[i + 1] - background[1]) + Math.abs(data[i + 2] - background[2]); if (distance > 110) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); } }
  if (right <= left || bottom <= top) return FULL_CROP;
  const padding = (right - left) * (bottom - top) / (w * h) > 0.45 ? 0.3 : 3;
  return { left: Math.max(0, left / w * 100 - padding), top: Math.max(0, top / h * 100 - padding), right: Math.min(100, right / w * 100 + padding), bottom: Math.min(100, bottom / h * 100 + padding) };
}
export function prepareScan(source: HTMLCanvasElement, crop: CropBox, angle: number) {
  if (crop.right <= crop.left || crop.bottom <= crop.top) throw new Error('Crop right/bottom must be greater than left/top.');
  const x = source.width * crop.left / 100, y = source.height * crop.top / 100, w = source.width * (crop.right - crop.left) / 100, h = source.height * (crop.bottom - crop.top) / 100;
  const radians = angle * Math.PI / 180, width = Math.max(1, Math.round(Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians)))), height = Math.max(1, Math.round(Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians))));
  const out = document.createElement('canvas'); out.width = width; out.height = height;
  const context = out.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.translate(width / 2, height / 2); context.rotate(radians); context.drawImage(source, x, y, w, h, -w / 2, -h / 2, w, h); return out;
}
export function ocrTable(ocr: OcrResult): string {
  const lines = ocr.lines.filter(line => line.words.length);
  const starts: number[] = [];
  for (const line of lines) {
    starts.push(line.words[0].x0);
    line.words.slice(1).forEach((word, i) => { if (word.x0 - line.words[i].x1 > Math.max(15, (word.y1 - word.y0) * 1.2)) starts.push(word.x0); });
  }
  const anchors: number[] = [];
  starts.sort((a, b) => a - b).forEach(x => { if (!anchors.some(a => Math.abs(a - x) < ocr.width * 0.025)) anchors.push(x); });
  return lines.map(line => {
    const row = Array.from({ length: anchors.length }, () => '');
    line.words.forEach(word => { let column = 0; anchors.forEach((anchor, i) => { if (word.x0 >= anchor - ocr.width * 0.015) column = i; }); row[column] += (row[column] ? ' ' : '') + word.text; });
    return row.join('\t');
  }).join('\n');
}
