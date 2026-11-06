import { useEffect, useRef, useState } from 'react';
import { canvasToBytes } from '../lib/image';
import { Btn } from './ui';

/** Draw a signature with mouse, finger or stylus; returns a transparent, tightly-cropped PNG. */
export default function SignaturePad({ onDone, onCancel }: { onDone: (png: Uint8Array, w: number, h: number) => void; onCancel: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState('#0b1f66');
  const [empty, setEmpty] = useState(true);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = ref.current!, dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr * 2; c.height = c.clientHeight * dpr * 2; // 2× oversampled for print-quality ink
  }, []);

  const pt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * ref.current!.width, y: ((e.clientY - r.top) / r.height) * ref.current!.height };
  };
  const draw = (e: React.PointerEvent) => {
    if (!last.current) return;
    const ctx = ref.current!.getContext('2d')!, p = pt(e);
    const w = (ref.current!.width / 260) * (0.6 + (e.pressure || 0.5)); // pressure-sensitive on pens
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p; setEmpty(false);
  };

  async function done() {
    const c = ref.current!, ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = 12, w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    out.getContext('2d')!.drawImage(c, x0 - pad, y0 - pad, w, h, 0, 0, w, h);
    onDone(await canvasToBytes(out), w, h);
  }

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <h3>Draw your signature</h3>
        <canvas ref={ref} className="sig-canvas"
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); last.current = pt(e); }}
          onPointerMove={draw} onPointerUp={() => (last.current = null)} />
        <div className="row wrap">
          {['#0b1f66', '#111111', '#1d4ed8'].map((c) => (
            <button key={c} className={'swatch' + (c === color ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} aria-label="ink colour" />
          ))}
          <span style={{ flex: 1 }} />
          <Btn onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setEmpty(true); }}>Clear</Btn>
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn primary disabled={empty} onClick={done}>Place signature</Btn>
        </div>
      </div>
    </div>
  );
}
