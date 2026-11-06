// Printing. Every editor produces a PDF of the current document; we print that PDF so the paper
// output is identical to the exported PDF on every platform.
//  - Desktop/web: pages rendered at print resolution (300 DPI; 200 DPI for long docs) into a hidden
//    frame with exact per-page @page sizes, then the native print dialog.
//  - iOS/Android: the PDF goes to the OS share sheet, which has Print (AirPrint / Android printing).
import { isNativeMobile, saveFile } from './fileio';

export async function printPdf(bytes: Uint8Array, title: string, onProgress?: (msg: string) => void) {
  if (isNativeMobile()) {
    await saveFile(`${title}.pdf`, bytes); // opens the share sheet → "Print"
    return;
  }
  const { loadPdfJs, pdfPageToCanvas } = await import('../engines/pdf');
  const js = await loadPdfJs(bytes);
  const dpi = js.numPages > 20 ? 200 : 300;
  const pages: { url: string; w: number; h: number }[] = [];
  for (let p = 1; p <= js.numPages; p++) {
    onProgress?.(`Preparing page ${p}/${js.numPages} for printing…`);
    const vp = (await js.getPage(p)).getViewport({ scale: 1 });
    const canvas = await pdfPageToCanvas(js, p, dpi);
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    pages.push({ url: URL.createObjectURL(blob), w: vp.width, h: vp.height });
  }

  // One named @page per distinct size so mixed portrait/landscape documents print correctly.
  const sizes = [...new Set(pages.map((p) => `${p.w.toFixed(2)}x${p.h.toFixed(2)}`))];
  const css = sizes.map((s, i) => { const [w, h] = s.split('x'); return `@page s${i} { size: ${w}pt ${h}pt; margin: 0 }`; }).join('\n');
  const body = pages.map((p) => {
    const i = sizes.indexOf(`${p.w.toFixed(2)}x${p.h.toFixed(2)}`);
    return `<img src="${p.url}" style="page: s${i}; width: ${p.w}pt; height: ${p.h}pt">`;
  }).join('');

  document.querySelectorAll('iframe[data-dh-print]').forEach((f) => f.remove()); // leftovers from a previous print
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.dataset.dhPrint = '1';
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><title>${title.replace(/</g, '')}</title><style>
    ${css}
    @page { margin: 0 } html, body { margin: 0; padding: 0 }
    img { display: block; break-after: page; page-break-after: always }
    img:last-child { break-after: auto; page-break-after: auto }
  </style></head><body>${body}</body></html>`);
  doc.close();
  // If the hidden print frame keeps keyboard focus, forward shortcuts (Cmd+S, Cmd+P…) to the app.
  doc.addEventListener('keydown', (e) => window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, bubbles: true, cancelable: true })));
  await Promise.all([...doc.images].map((img) => img.decode().catch(() => undefined)));

  const cleanup = () => { frame.remove(); pages.forEach((p) => URL.revokeObjectURL(p.url)); };
  frame.contentWindow!.addEventListener('afterprint', () => setTimeout(cleanup, 500));
  setTimeout(cleanup, 10 * 60_000); // safety net
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  // Give keyboard focus back to the app so shortcuts (Cmd+S, Cmd+P…) keep working afterwards.
  window.focus();
  (document.activeElement as HTMLElement | null)?.blur?.();
}
