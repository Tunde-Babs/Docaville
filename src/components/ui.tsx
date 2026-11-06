import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

// ---- global busy/toast bus ----
type Listener = () => void;
const state = { busy: null as string | null, toast: null as { msg: string; error?: boolean } | null };
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());
let toastTimer: ReturnType<typeof setTimeout>;

export const setBusy = (msg: string | null) => { state.busy = msg; emit(); };
export const toast = (msg: string, error = false) => {
  state.toast = { msg, error }; emit();
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { state.toast = null; emit(); }, error ? 7000 : 3500);
};

/** Run an async job with a busy overlay and error toast. */
export async function run<T>(label: string, job: () => Promise<T>): Promise<T | undefined> {
  setBusy(label);
  try { return await job(); }
  catch (e) { console.error(e); toast((e as Error).message || String(e), true); return undefined; }
  finally { setBusy(null); }
}

export function StatusLayer() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
  return (
    <>
      {state.busy && <div className="busy"><div className="spinner" /><span>{state.busy}</span></div>}
      {state.toast && <div className={'toast' + (state.toast.error ? ' error' : '')}>{state.toast.msg}</div>}
    </>
  );
}

// ---- controls ----
export function Btn({ children, active, primary, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; primary?: boolean }) {
  return <button {...props} className={'btn' + (active ? ' active' : '') + (primary ? ' primary' : '') + (className ? ' ' + className : '')}>{children}</button>;
}

export interface ExportOption { label: string; hint?: string; action: () => unknown }

export function Menu({ label, options, primary }: { label: string; options: ExportOption[]; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const focused = useRef(false);
  const close = (restoreFocus = false) => {
    setOpen(false); setPos(null); focused.current = false;
    if (restoreFocus) ref.current?.querySelector('button')?.focus();
  };
  // Measure before paint and flip above bottom-edge triggers, including the sheet-tab toolbar.
  useLayoutEffect(() => {
    if (!open || !ref.current || !popRef.current) return;
    const b = ref.current.getBoundingClientRect();
    const w = Math.min(popRef.current.offsetWidth, window.innerWidth - 16);
    const left = Math.max(8, Math.min(b.left, window.innerWidth - w - 8));
    const h = popRef.current.scrollHeight + 12;
    const below = Math.max(0, window.innerHeight - b.bottom - 12), above = Math.max(0, b.top - 12);
    const up = h > below && above > below;
    const maxHeight = Math.max(24, up ? above : below);
    const top = up ? Math.max(8, b.top - Math.min(h, maxHeight) - 4) : b.bottom + 4;
    setPos({ left, top, maxHeight });
  }, [open]);
  useEffect(() => {
    if (!open || !pos || focused.current) return;
    focused.current = true;
    popRef.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [open, pos]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
      if (e.key === 'Tab') { close(true); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const buttons = [...popRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    const resize = () => close(true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', resize); };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <Btn primary={primary} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}
        onClick={() => open ? close() : setOpen(true)}>{label} ▾</Btn>
      {open && createPortal(
        // Portalled to <body>: ancestors with backdrop-filter would otherwise become the popup's
        // containing block and shift it off screen inside horizontally-scrolled toolbars.
        <div id={id} role="menu" aria-label={label} className="menu-pop" ref={popRef} style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}>
          {options.map((o) => (
            <button role="menuitem" key={o.label} onClick={() => { close(true); o.action(); }}>
              <b>{o.label}</b>{o.hint && <small>{o.hint}</small>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function FilePick({ accept, multiple, onFiles, children, disabled }: { accept: string; multiple?: boolean; onFiles: (f: File[]) => void; children: ReactNode; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Btn disabled={disabled} onClick={() => ref.current?.click()}>{children}</Btn>
      <input ref={ref} type="file" hidden disabled={disabled} accept={accept} multiple={multiple}
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f); }} />
    </>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}
export const Sep = () => <span className="sep" />;

// ---- right-click (context) menu ----
export type CtxItem =
  | { label: string; icon?: string; kb?: string; action: () => unknown; disabled?: boolean }
  | { head: string }
  | { range: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void } }
  | 'sep';

/** Context menu at a screen point; kept on screen; closes on outside click, Escape, scroll or resize. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: CtxItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    const top = y + h > window.innerHeight - 8 ? Math.max(8, window.innerHeight - h - 8) : y;
    setPos({ left, top, maxHeight: window.innerHeight - top - 8 });
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const out = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
    };
    const close = () => onClose();
    document.addEventListener('pointerdown', out, true); document.addEventListener('keydown', key, true);
    window.addEventListener('resize', close); window.addEventListener('blur', close);
    return () => { document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close); };
  }, [onClose]);
  return createPortal(
    <div className="ctx" ref={ref} role="menu" onContextMenu={(e) => e.preventDefault()}
      style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { left: x, top: y, visibility: 'hidden' }}>
      {items.map((it, i) => {
        if (it === 'sep') return <hr key={i} />;
        if ('head' in it) return <div key={i} className="ctx-head">{it.head}</div>;
        if ('range' in it) {
          const r = it.range;
          return (
            <div key={i} className="ctx-range" title={r.label}>
              <input type="range" aria-label={r.label} min={r.min} max={r.max} step={r.step ?? 1} value={r.value} onChange={(e) => r.onChange(+e.target.value)} />
              <output>{Math.round(r.value)}{r.unit ?? ''}</output>
            </div>
          );
        }
        return (
          <button key={i} role="menuitem" disabled={it.disabled} onClick={() => { onClose(); it.action(); }}>
            <span className="ic">{it.icon ?? ''}</span>{it.label}{it.kb && <span className="kb">{it.kb}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
