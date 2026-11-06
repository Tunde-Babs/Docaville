// Office-style colour palette used by every editor:
//   • "In this document" — every colour already applied (always offered first, so reusing a colour is one click)
//   • Recent colours (remembered on this device)
//   • Theme colours with tints/shades + standard colours
//   • Hex entry and the system colour picker (with eyedropper) for anything else
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const BASE = ['#FFFFFF', '#000000', '#E7E6E6', '#44546A', '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'];
const STANDARD = ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'];
// tint (+) / shade (−) steps under each theme colour, like Office
const STEPS: Record<string, number[]> = { light: [-0.05, -0.15, -0.25, -0.35, -0.5], dark: [0.5, 0.35, 0.25, 0.15, 0.05], mid: [0.8, 0.6, 0.4, -0.25, -0.5] };

const RECENT_KEY = 'dh.recentColours';
function readRecent(): string[] { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]').filter((c: unknown) => typeof c === 'string'); } catch { return []; } }
function pushRecent(c: string) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...readRecent().filter((x) => x !== c)].slice(0, 10))); } catch { /* storage unavailable */ } }

let probe: CanvasRenderingContext2D | null = null;
/** Any CSS colour (hex, #rgb, rgb(), names) → '#RRGGBB', or null. Fully transparent colours → null. */
export function toHex(css?: string | null): string | null {
  if (!css) return null;
  const s = css.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + [...s.slice(1)].map((c) => c + c).join('')).toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return ('#' + s).toUpperCase();
  if (/^[0-9a-f]{8}$/i.test(s)) return ('#' + s.slice(2)).toUpperCase(); // Excel ARGB
  const m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return '#' + [m[1], m[2], m[3]].map((v) => Math.min(255, +v).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  try {
    probe ??= document.createElement('canvas').getContext('2d');
    if (!probe) return null;
    probe.fillStyle = '#010203'; probe.fillStyle = s;
    const out = String(probe.fillStyle);
    return out === '#010203' && s.toLowerCase() !== '#010203' ? null : toHex(out);
  } catch { return null; }
}

function adjust(hex: string, amt: number) {
  const v = parseInt(hex.slice(1), 16), ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const out = ch.map((c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt)));
  return '#' + out.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}
const lum = (hex: string) => { const v = parseInt(hex.slice(1), 16); return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255; };
const THEME_GRID = BASE.map((c) => [c, ...(lum(c) > 0.85 ? STEPS.light : lum(c) < 0.2 ? STEPS.dark : STEPS.mid).map((a) => adjust(c, a))]);

/** De-duplicated, normalised list of colours (keeps first-seen order). */
export function uniqueColours(list: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const c of list) { const h = toHex(c); if (h) seen.add(h); }
  return [...seen];
}

interface Props {
  /** Colour shown on the button (current colour or last-used colour). */
  value?: string | null;
  onChange: (hex: string) => void;
  /** Icon / label drawn above the colour bar, e.g. "A", "🖍", "Fill". */
  icon: ReactNode;
  title: string;
  /** Colours already used in the document (called each time the palette opens). */
  used?: () => (string | null | undefined)[];
  /** Adds a "no colour" choice (Automatic text colour, No fill, No highlight…). */
  none?: { label: string; action: () => void };
  /** Split button: clicking the icon re-applies `value` (Word-style); the ▾ opens the palette. */
  applyOnClick?: boolean;
  /** Extra controls at the bottom of the palette (e.g. opacity). */
  children?: ReactNode;
}

export function ColorPicker({ value, onChange, icon, title, used, none, applyOnClick, children }: Props) {
  const [open, setOpen] = useState(false);
  const [docColours, setDocColours] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [hex, setHex] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null);
  const cur = toHex(value);

  const openPalette = () => {
    setDocColours(uniqueColours(used?.() ?? []).slice(0, 30));
    setRecent(readRecent());
    setHex(cur ?? '');
    setPos(null);
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const b = btn.current.getBoundingClientRect(), w = Math.min(pop.current?.offsetWidth ?? 248, window.innerWidth - 16);
    const h = pop.current?.offsetHeight ?? 360;
    const below = window.innerHeight - b.bottom - 12;
    const top = below >= Math.min(h, 320) ? b.bottom + 4 : Math.max(8, b.top - h - 4);
    setPos({ left: Math.max(8, Math.min(b.left, window.innerWidth - w - 8)), top, maxHeight: window.innerHeight - top - 8 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc, true); };
  }, [open]);

  const choose = (c: string, keepOpen = false) => {
    const h = toHex(c); if (!h) return;
    pushRecent(h); onChange(h);
    if (!keepOpen) setOpen(false);
  };
  const sw = (c: string, key: string) => (
    <button key={key} type="button" className={'sw' + (cur === c ? ' on' : '')} style={{ background: c }} title={c} aria-label={c}
      onMouseDown={(e) => e.preventDefault() /* keep the text selection in rich-text editors */} onClick={() => choose(c)} />
  );

  return (
    <div className={'cpick' + (applyOnClick ? ' split' : '')} ref={btn}>
      <button type="button" className="btn cpick-main" title={applyOnClick ? `${title} (${cur ?? 'none'}) — ▾ for more colours` : title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (applyOnClick && cur ? choose(cur) : open ? setOpen(false) : openPalette())}>
        <span className="cpick-icon">{icon}</span>
        <span className="cpick-bar" style={{ background: cur ?? 'transparent' }} data-none={cur ? undefined : '1'} />
      </button>
      {applyOnClick && <button type="button" className="btn cpick-arrow" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => (open ? setOpen(false) : openPalette())}>▾</button>}
      {open && createPortal(
        <div className="cpick-pop" ref={pop} role="dialog" aria-label={title} style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}>
          {none && <button type="button" className="cpick-none" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); none.action(); }}><span className="sw none" />{none.label}</button>}
          <h4>In this document</h4>
          {docColours.length ? <div className="sw-row wrap">{docColours.map((c) => sw(c, 'd' + c))}</div> : <p className="cpick-empty">No colours used yet</p>}
          {recent.length > 0 && (<><h4>Recent</h4><div className="sw-row">{recent.map((c) => sw(c, 'r' + c))}</div></>)}
          <h4>Theme colours</h4>
          <div className="sw-grid">{THEME_GRID.map((col, i) => <div key={i} className="sw-col">{col.map((c, j) => sw(c, `t${i}-${j}`))}</div>)}</div>
          <h4>Standard colours</h4>
          <div className="sw-row">{STANDARD.map((c) => sw(c, 's' + c))}</div>
          <div className="cpick-custom">
            <input type="text" value={hex} placeholder="#RRGGBB" aria-label="Hex colour" spellCheck={false}
              onChange={(e) => setHex(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && toHex(hex)) choose(hex); }} />
            <button type="button" className="btn" disabled={!toHex(hex)} onClick={() => choose(hex)}>Apply</button>
            <label className="btn cpick-more" title="More colours (system picker with eyedropper)">🎨 More…
              {/* live preview while dragging in the system picker; remembered as "recent" when it closes */}
              <input type="color" value={cur?.toLowerCase() ?? '#000000'} onChange={(e) => { const h = e.target.value.toUpperCase(); setHex(h); onChange(h); }}
                onBlur={(e) => pushRecent(e.target.value.toUpperCase())} />
            </label>
          </div>
          {children && <div className="cpick-extra">{children}</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}
