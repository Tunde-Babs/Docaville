// Non-destructive image pipeline: the original pixels are kept, and every render re-applies
// transforms + adjustments from the source at full resolution (no generational quality loss).

export interface Adjust { brightness: number; contrast: number; saturation: number; grayscale: boolean; invert: boolean; threshold: number | null }
export const DEFAULT_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, grayscale: false, invert: false, threshold: null };

export interface Transform { rotate: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean; crop: { x: number; y: number; w: number; h: number } | null; scale: number }
export const DEFAULT_TRANSFORM: Transform = { rotate: 0, flipH: false, flipV: false, crop: null, scale: 1 };

export function renderEdited(src: HTMLCanvasElement, t: Transform, a: Adjust): HTMLCanvasElement {
  // 1. crop (in source coords)
  const c = t.crop ?? { x: 0, y: 0, w: src.width, h: src.height };
  // 2. rotate / flip / scale
  const sw = Math.round(c.w * t.scale), sh = Math.round(c.h * t.scale);
  const swap = t.rotate === 90 || t.rotate === 270;
  const out = document.createElement('canvas');
  out.width = swap ? sh : sw;
  out.height = swap ? sw : sh;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((t.rotate * Math.PI) / 180);
  ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
  ctx.drawImage(src, c.x, c.y, c.w, c.h, -sw / 2, -sh / 2, sw, sh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // 3. pixel adjustments
  if (JSON.stringify(a) !== JSON.stringify(DEFAULT_ADJUST)) {
    const img = ctx.getImageData(0, 0, out.width, out.height);
    applyAdjust(img.data, a);
    ctx.putImageData(img, 0, 0);
  }
  return out;
}

function applyAdjust(d: Uint8ClampedArray, a: Adjust) {
  const b = a.brightness * 2.55;
  const cf = (259 * (a.contrast + 255)) / (255 * (259 - a.contrast));
  const s = 1 + a.saturation / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], bl = d[i + 2];
    r = cf * (r - 128) + 128 + b; g = cf * (g - 128) + 128 + b; bl = cf * (bl - 128) + 128 + b;
    const l = 0.299 * r + 0.587 * g + 0.114 * bl;
    if (a.grayscale || a.threshold !== null) { r = g = bl = l; }
    else if (s !== 1) { r = l + (r - l) * s; g = l + (g - l) * s; bl = l + (bl - l) * s; }
    if (a.threshold !== null) r = g = bl = l >= a.threshold ? 255 : 0;
    if (a.invert) { r = 255 - r; g = 255 - g; bl = 255 - bl; }
    d[i] = r; d[i + 1] = g; d[i + 2] = bl;
  }
}

/** "Scan" preset: boosts OCR accuracy on photos of documents. */
export const SCAN_PRESET: Adjust = { brightness: 10, contrast: 40, saturation: 0, grayscale: true, invert: false, threshold: null };
