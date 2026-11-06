// Image decoding/encoding helpers shared by every engine.

const isHeic = (b: Uint8Array, mime: string) =>
  /heic|heif/i.test(mime) || /ftyp(heic|heix|hevc|mif1|msf1)/.test(String.fromCharCode(...b.subarray(4, 12)));
const isTiff = (b: Uint8Array, mime: string) =>
  /tiff/i.test(mime) || (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a);

/**
 * Convert formats the platform webview can't decode everywhere (HEIC from iPhones, TIFF scans)
 * into lossless PNG. Multi-page TIFFs return one PNG per page.
 */
export async function normalizeImage(bytes: Uint8Array, mime = ''): Promise<{ bytes: Uint8Array; mime: string }[]> {
  if (isTiff(bytes, mime)) {
    const UTIF = (await import('utif')).default;
    const buf = bytes.slice().buffer;
    const ifds = UTIF.decode(buf).filter((i) => i.width || (i as { t256?: unknown }).t256);
    const out: { bytes: Uint8Array; mime: string }[] = [];
    for (const ifd of ifds) {
      UTIF.decodeImage(buf, ifd);
      if (!ifd.width) continue;
      const c = document.createElement('canvas');
      c.width = ifd.width; c.height = ifd.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(ifd)), ifd.width, ifd.height), 0, 0);
      out.push({ bytes: await canvasToBytes(c), mime: 'image/png' });
    }
    if (out.length) return out;
  }
  if (isHeic(bytes, mime)) return decodeHeic(bytes);
  return [{ bytes, mime: mime || sniffMime(bytes) }];
}

/**
 * HEIC/HEIF (iPhone photos) via libheif compiled to WebAssembly — no eval, so it works under the
 * app's Content-Security-Policy. Multi-image HEIC files return one PNG per image.
 */
async function decodeHeic(bytes: Uint8Array): Promise<{ bytes: Uint8Array; mime: string }[]> {
  const factory = (await import('libheif-js/libheif-wasm/libheif-bundle.mjs')).default;
  type Img = { get_width(): number; get_height(): number; display(d: ImageData, cb: (d: ImageData | null) => void): void; free?(): void };
  type Lib = { HeifDecoder: new () => { decode(b: Uint8Array): Img[] }; ready?: Promise<unknown>; then?: unknown };
  let lib = factory() as Lib;
  if (typeof lib.then === 'function') lib = await (lib as unknown as Promise<Lib>);
  if (lib.ready) await lib.ready;
  for (let i = 0; !lib.HeifDecoder && i < 100; i++) await new Promise((r) => setTimeout(r, 20)); // async wasm init
  const images = new lib.HeifDecoder().decode(bytes);
  if (!images?.length) throw new Error('This HEIC photo could not be decoded.');
  const out: { bytes: Uint8Array; mime: string }[] = [];
  for (const im of images) {
    const w = im.get_width(), h = im.get_height();
    const data = await new Promise<ImageData>((res, rej) => im.display(new ImageData(w, h), (d) => (d ? res(d) : rej(new Error('HEIC decode failed')))));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.putImageData(data, 0, 0);
    out.push({ bytes: await canvasToBytes(c), mime: 'image/png' });
    im.free?.();
  }
  return out;
}

/** Decode any browser-supported image (PNG/JPEG/WebP/GIF/BMP/AVIF/SVG, HEIC on Apple WebKit). */
export async function decodeImage(bytes: Uint8Array, mime = ''): Promise<HTMLImageElement> {
  if (isHeic(bytes, mime) || isTiff(bytes, mime)) ({ bytes, mime } = (await normalizeImage(bytes, mime))[0]);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime || sniffMime(bytes) }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('This image format is not supported on this device. Try PNG, JPEG or WebP.');
  } finally {
    // keep URL alive until decode finished
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function sniffMime(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}

export function imageToCanvas(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = (img as HTMLImageElement).naturalWidth || img.width;
  c.height = (img as HTMLImageElement).naturalHeight || img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

export async function canvasToBytes(c: HTMLCanvasElement, type = 'image/png', quality = 0.95): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Return bytes pdf-lib / docx can embed losslessly: PNG and JPEG pass through untouched
 * (no recompression = no quality loss); everything else is decoded and re-encoded as PNG.
 */
export async function toEmbeddable(bytes: Uint8Array, mime = ''): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg'; width: number; height: number }> {
  if (isHeic(bytes, mime) || isTiff(bytes, mime)) ({ bytes, mime } = (await normalizeImage(bytes, mime))[0]);
  const m = mime || sniffMime(bytes);
  const img = await decodeImage(bytes, m);
  const width = img.naturalWidth, height = img.naturalHeight;
  if (m === 'image/png') return { bytes, type: 'png', width, height };
  if (m === 'image/jpeg') return { bytes, type: 'jpg', width, height };
  return { bytes: await canvasToBytes(imageToCanvas(img)), type: 'png', width, height };
}

/** Pick the dominant colour along the border of a rectangle (used to "erase" text over coloured backgrounds). */
export function sampleBackground(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): [number, number, number] {
  const counts = new Map<string, number>();
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const px = x + (w * i) / 12;
    pts.push([px, y - 2], [px, y + h + 2]);
  }
  for (let i = 0; i <= 6; i++) {
    const py = y + (h * i) / 6;
    pts.push([x - 3, py], [x + w + 3, py]);
  }
  for (const [px, py] of pts) {
    const cx = Math.max(0, Math.min(ctx.canvas.width - 1, Math.round(px)));
    const cy = Math.max(0, Math.min(ctx.canvas.height - 1, Math.round(py)));
    const d = ctx.getImageData(cx, cy, 1, 1).data;
    const key = `${d[0] >> 3},${d[1] >> 3},${d[2] >> 3}`; // bucket similar colours
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map((v) => (+v << 3) + 4);
  return [best[0], best[1], best[2]];
}

/** Darkest-contrast colour inside a rectangle ≈ the text colour. */
export function sampleInk(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bg: [number, number, number]): [number, number, number] {
  const sx = Math.max(0, Math.floor(x)), sy = Math.max(0, Math.floor(y));
  const sw = Math.max(1, Math.min(ctx.canvas.width - sx, Math.ceil(w))), sh = Math.max(1, Math.min(ctx.canvas.height - sy, Math.ceil(h)));
  const d = ctx.getImageData(sx, sy, sw, sh).data;
  let best: [number, number, number] = [0, 0, 0], bestDist = -1;
  for (let i = 0; i < d.length; i += 16) {
    const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    if (dist > bestDist) { bestDist = dist; best = [d[i], d[i + 1], d[i + 2]]; }
  }
  return best;
}

export const rgbCss = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
export const hexToRgb01 = (hex: string): [number, number, number] => {
  const v = parseInt(hex.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};
export const rgbToHex = (c: [number, number, number]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
