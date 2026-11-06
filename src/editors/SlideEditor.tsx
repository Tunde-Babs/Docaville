import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPptx, newDeck, savePptx, deckToPdf, titleSlide, uid, applyTheme, setProps, THEMES, type Deck, type Slide, type SlideEl, type SlideImage } from '../engines/slides';
import { saveFile, baseName, toBytes } from '../lib/fileio';
import { normalizeImage, decodeImage, canvasToBytes } from '../lib/image';
import { Btn, Menu, Toolbar, Sep, ContextMenu, run, setBusy, toast, type CtxItem } from '../components/ui';
import { ColorPicker } from '../components/ColorPicker';
import { useSave, loadOrFail, type EditorProps } from '../components/useSave';

type Snap = { slides: Slide[]; removed: Slide[]; idx: number };
const cloneSlides = (slides: Slide[]) => slides.map((s) => ({ ...s, els: s.els.map((e) => ({ ...e, changed: new Set(e.changed) })), deleted: [...(s.deleted ?? [])] }));
const isDark = (hex: string) => { const v = parseInt(hex.slice(1, 7), 16); return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) < 140; };
const rgba = (hex: string, a: number) => { const v = parseInt(hex.slice(1, 7), 16); return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`; };
const pct = (op?: number) => Math.round((op ?? 1) * 100);

/** Slide background as CSS: the colour (with its transparency over white) — a picture is a separate layer on top. */
const bgCss = (s: Slide): React.CSSProperties => {
  const op = s.bgOpacity ?? 1;
  if (s.bgImage || op >= 1) return { background: s.bg };
  return { background: `linear-gradient(${rgba(s.bg, op)}, ${rgba(s.bg, op)}), #fff` };
};
const BgLayer = ({ s }: { s: Slide }) => (s.bgImage ? <div className="slide-bg" style={{ backgroundImage: `url(${s.bgImage.url})`, opacity: s.bgOpacity ?? 1 }} /> : null);

/** In-app clipboard for slide elements (shared between open presentations). */
let clip: SlideEl[] = [];
let clipText: string | null = null; // what we put on the system clipboard with it (recognised again on paste)
let pendingPaste = 0;
const CLIP_TYPE = 'application/x-documenthub-slide';
const cloneEl = (e: SlideEl, dx = 0, dy = 0): SlideEl => ({ ...e, id: uid(), x: e.x + dx, y: e.y + dy, node: undefined, dirty: false, changed: new Set<string>() });
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

type Ctx = { x: number; y: number; kind: 'slide' | 'el' | 'thumb'; at?: { x: number; y: number } };

export default function SlideEditor({ file, onChange, onFail }: EditorProps) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const history = useRef<{ past: Snap[]; future: Snap[]; lastKey: string; lastAt: number }>({ past: [], future: [], lastKey: '', lastAt: 0 });
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [pane, setPane] = useState(false);
  const [, setVer] = useState(0);
  const bump = () => setVer((v) => v + 1);
  const stage = useRef<HTMLDivElement>(null);
  const keyHandler = useRef<((ev: KeyboardEvent) => void) | null>(null);
  const clipHandler = useRef<((ev: ClipboardEvent) => void) | null>(null);
  const [scale, setScale] = useState(1);
  const drag = useRef<{ el: SlideEl; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; resize: boolean } | null>(null);
  const closeCtx = useCallback(() => setCtx(null), []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadOrFail('Opening presentation…', async () => setDeck(file.bytes ? await loadPptx(file.bytes) : (file.template && (await import('../lib/templates')).deckTemplate(file.template)) || newDeck()), onFail); }, [file.id]);
  const { root, save: doSave, print, markDirty } = useSave(file, onChange, () => 'pptx', async () => (await savePptx(deck!)).bytes, () => deckToPdf(deck!));

  // Fit slide to available width (works from phone to 4K monitor)
  useEffect(() => {
    if (!deck || !stage.current) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min((e.contentRect.width - 32) / deck.width, (e.contentRect.height - 32) / deck.height)));
    ro.observe(stage.current);
    return () => ro.disconnect();
  }, [deck]);

  // Keyboard + clipboard. Registered before the early return so hook order is stable; the handlers are refreshed every render.
  useEffect(() => {
    const visible = () => !!root.current?.offsetParent;
    const onKey = (ev: KeyboardEvent) => { if (visible()) keyHandler.current?.(ev); };
    const onClip = (ev: Event) => { if (visible()) clipHandler.current?.(ev as ClipboardEvent); };
    const CLIP_EVENTS = ['copy', 'cut', 'paste', 'beforecopy', 'beforecut', 'beforepaste'];
    window.addEventListener('keydown', onKey);
    CLIP_EVENTS.forEach((t) => document.addEventListener(t, onClip));
    return () => { window.removeEventListener('keydown', onKey); CLIP_EVENTS.forEach((t) => document.removeEventListener(t, onClip)); };
  }, [root]);

  if (!deck) return null;
  const slide = deck.slides[idx];
  const el = slide?.els.find((e) => e.id === sel);
  const name = baseName(file.name);
  // ---- undo / redo: snapshot BEFORE each change; typing, dragging & sliders coalesce into one step ----
  const snap = (): Snap => ({ slides: cloneSlides(deck.slides), removed: [...(deck.removed ?? [])], idx });
  const record = (key = '') => {
    const h = history.current, now = Date.now();
    if (!(key && key === h.lastKey && now - h.lastAt < 1200)) { h.past.push(snap()); if (h.past.length > 60) h.past.shift(); }
    h.future = []; h.lastKey = key; h.lastAt = now;
  };
  const restore = (from: Snap[], to: Snap[]) => {
    const sn = from.pop(); if (!sn) return;
    to.push(snap());
    const before = new Map(deck.slides.map((s) => [s.id, s]));
    deck.slides = cloneSlides(sn.slides); deck.removed = [...sn.removed];
    // Re-write only what the snapshot actually differs in (an untouched imported background must stay inherited).
    for (const s of deck.slides) {
      const b = before.get(s.id); if (!b) continue;
      if (b.bg !== s.bg || b.bgImage !== s.bgImage || b.bgOpacity !== s.bgOpacity || b.bgChanged) s.bgChanged = true;
      if (b.els.map((e) => e.id).join() !== s.els.map((e) => e.id).join() || b.orderChanged) s.orderChanged = true;
    }
    setIdx(Math.min(sn.idx, deck.slides.length - 1)); setSel(null); setEditingText(null);
    history.current.lastKey = ''; bump(); markDirty();
  };
  const undo = () => restore(history.current.past, history.current.future);
  const redo = () => restore(history.current.future, history.current.past);
  /** Mutate the deck as one undoable, unsaved change. */
  const mutate = (fn: () => void, key = '') => { record(key); fn(); bump(); markDirty(); };
  const change = (e: SlideEl, patch: Partial<SlideEl>, key = '') => mutate(() => setProps(e, patch), key);
  const setBg = (patch: Partial<Slide>, key = '') => mutate(() => { Object.assign(slide, patch, { bgChanged: true }); }, key);

  // ---- slides ----
  const addSlide = () => mutate(() => { deck.slides.splice(idx + 1, 0, { ...titleSlide('New slide', 'Add your content'), bgChanged: true }); setIdx(idx + 1); setSel(null); });
  const dupSlide = () => mutate(() => {
    // A duplicate is a new slide part; its elements are recreated from the model on save.
    const copy: Slide = { ...slide, id: uid(), xml: undefined, path: undefined, sldId: undefined, rid: undefined, rels: undefined, deleted: [], bgChanged: true,
      els: slide.els.map((e) => cloneEl(e)) };
    deck.slides.splice(idx + 1, 0, copy); setIdx(idx + 1); setSel(null);
  });
  const delSlide = () => {
    if (deck.slides.length < 2) return;
    mutate(() => { const [gone] = deck.slides.splice(idx, 1); if (gone.path) (deck.removed ??= []).push(gone); setIdx(Math.max(0, idx - 1)); setSel(null); });
  };
  const moveSlide = (d: number) => { const j = idx + d; if (j < 0 || j >= deck.slides.length) return; mutate(() => { [deck.slides[idx], deck.slides[j]] = [deck.slides[j], deck.slides[idx]]; setIdx(j); }); };
  const toggleHidden = () => mutate(() => { slide.hidden = !slide.hidden; });

  // ---- elements ----
  const addText = (at?: { x: number; y: number }, text = 'Text') => {
    const e: SlideEl = { id: uid(), kind: 'text', x: at ? at.x : deck.width / 2 - 200, y: at ? at.y : deck.height / 2 - 30, w: 400, h: 60, text, fontSize: 24, color: slide.bgImage || isDark(slide.bg) ? '#FFFFFF' : '#111827', align: 'left' };
    mutate(() => slide.els.push(e)); setSel(e.id);
  };
  const addShape = () => { const e: SlideEl = { id: uid(), kind: 'shape', x: deck.width / 2 - 100, y: deck.height / 2 - 60, w: 200, h: 120, fill: '#3B82F6', text: '', fontSize: 18, color: '#FFFFFF', align: 'center' }; mutate(() => slide.els.push(e)); setSel(e.id); };
  const loadImage = async (f: File): Promise<SlideImage & { w: number; h: number }> => {
    const [n] = await normalizeImage(await toBytes(f), f.type);
    const img = await decodeImage(n.bytes, n.mime);
    return { ...n, url: URL.createObjectURL(new Blob([n.bytes as BlobPart], { type: n.mime })), w: img.naturalWidth, h: img.naturalHeight };
  };
  /** One picture → centred. Several → arranged in a tidy grid on the slide. */
  const addImages = (files: File[]) => run('Adding pictures…', async () => {
    const imgs = await Promise.all(files.map(loadImage));
    record();
    const cols = Math.ceil(Math.sqrt(imgs.length)), rows = Math.ceil(imgs.length / cols);
    const cellW = (deck.width - 80) / cols, cellH = (deck.height - 140) / rows;
    imgs.forEach((im, i) => {
      const s = Math.min((cellW - 16) / im.w, (cellH - 16) / im.h, imgs.length === 1 ? (deck.width * 0.6) / im.w : Infinity);
      const w = im.w * s, h = im.h * s, c = i % cols, r = Math.floor(i / cols);
      slide.els.push({ id: uid(), kind: 'image', x: 40 + c * cellW + (cellW - w) / 2, y: 110 + r * cellH + (cellH - h) / 2, w, h, image: im });
    });
    setSel(slide.els[slide.els.length - 1].id); bump(); markDirty();
  });
  /** Profile / team photos: circular portraits in a row with an editable name caption under each. */
  const addProfiles = (files: File[]) => run('Adding profiles…', async () => {
    const imgs = await Promise.all(files.map(loadImage));
    record();
    const captionColor = slide.bgImage || isDark(slide.bg) ? '#FFFFFF' : '#374151';
    const n = imgs.length, perRow = Math.min(n, 5), rows = Math.ceil(n / perRow);
    const size = Math.min(150, (deck.width - 120) / perRow - 30, (deck.height - 170) / rows - 60);
    imgs.forEach((im, i) => {
      const c = i % perRow, r = Math.floor(i / perRow), inRow = Math.min(perRow, n - r * perRow);
      const rowGap = (deck.width - inRow * size) / (inRow + 1);
      const x = rowGap + c * (size + rowGap), y = 130 + r * (size + 70);
      const name = files[i].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      slide.els.push(
        { id: uid(), kind: 'image', x, y, w: size, h: size, image: im, rounded: true },
        { id: uid(), kind: 'text', x: x - 20, y: y + size + 6, w: size + 40, h: 50, text: `${name}\nRole`, fontSize: 14, bold: false, color: captionColor, align: 'center' },
      );
    });
    bump(); markDirty();
    toast('Double-click a name to edit it · select a photo to toggle the circle crop');
  });
  const setBackgroundImage = (files: File[]) => run('Setting background…', async () => {
    const im = await loadImage(files[0]);
    setBg({ bgImage: im });
  });
  const pick = (accept: string, multiple: boolean, fn: (f: File[]) => unknown) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    input.onchange = () => { const f = [...(input.files ?? [])]; if (f.length) fn(f); };
    input.click();
  };
  const IMG = 'image/*,.heic,.heif,.tif,.tiff';
  const delEl = (target = el) => {
    if (!target) return;
    mutate(() => { if (target.node) (slide.deleted ??= []).push(target.node); slide.els = slide.els.filter((e) => e !== target); });
    setSel(null); setEditingText(null);
  };
  const copyEl = (toSystem = true) => {
    if (!el) return;
    clip = [cloneEl(el)]; clipText = el.text ?? '';
    if (toSystem) navigator.clipboard?.writeText(clipText).catch(() => undefined); // so the text can also be pasted into other apps
  };
  const cutEl = (toSystem = true) => { if (!el) return; copyEl(toSystem); delEl(); };
  const paste = (at?: { x: number; y: number }) => {
    if (!clip.length) return;
    const fresh = clip.map((e) => {
      const onSlide = slide.els.some((x) => Math.abs(x.x - e.x) < 1 && Math.abs(x.y - e.y) < 1);
      return at ? cloneEl(e, at.x - e.x, at.y - e.y) : cloneEl(e, onSlide ? 20 : 0, onSlide ? 20 : 0);
    });
    mutate(() => slide.els.push(...fresh));
    clip = fresh.map((e) => cloneEl(e)); // the next paste cascades further
    setSel(fresh[fresh.length - 1].id);
  };
  const duplicateEl = () => { if (!el) return; const c = cloneEl(el, 20, 20); mutate(() => slide.els.push(c)); setSel(c.id); };
  /** Stacking order — the element list is back-to-front. */
  const arrange = (to: 'front' | 'forward' | 'backward' | 'back') => {
    if (!el) return;
    const i = slide.els.indexOf(el), n = slide.els.length;
    const j = { front: n - 1, forward: Math.min(n - 1, i + 1), backward: Math.max(0, i - 1), back: 0 }[to];
    if (i === j) return;
    mutate(() => { slide.els.splice(i, 1); slide.els.splice(j, 0, el); slide.orderChanged = true; });
  };
  const centre = (axis: 'h' | 'v') => el && change(el, axis === 'h' ? { x: (deck.width - el.w) / 2 } : { y: (deck.height - el.h) / 2 });
  const asBackground = () => { if (el?.kind !== 'image' || !el.image) return; const im = el.image; setBg({ bgImage: im, bgOpacity: 1 }); };

  const usedColours = () => [...slide.els.flatMap((e) => [e.color, e.fill]), slide.bg, ...deck.slides.flatMap((s) => [s.bg, ...s.els.flatMap((e) => [e.color, e.fill])])];

  const exportPng = () => run('Rendering slides…', async () => {
    const { loadPdfJs, pdfPageToCanvas } = await import('../engines/pdf');
    const js = await loadPdfJs(await deckToPdf(deck));
    const JSZip = (await import('jszip')).default; const zip = new JSZip();
    for (let p = 1; p <= js.numPages; p++) { setBusy(`Slide ${p}/${js.numPages}…`); zip.file(`${name}-slide${p}.png`, await canvasToBytes(await pdfPageToCanvas(js, p, 1920 / deck.width * 72))); }
    await saveFile(`${name}-slides.zip`, await zip.generateAsync({ type: 'uint8array' }));
  });

  const inField = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable]');
  keyHandler.current = (ev: KeyboardEvent) => {
    const k = ev.key.toLowerCase(), cmd = ev.metaKey || ev.ctrlKey;
    if (cmd && k === 'z' && !(ev.target as HTMLElement).closest('textarea,input')) { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
    if (inField(ev.target)) return;
    // Paste: let the browser deliver a real paste event (pictures / text from other apps); if none arrives, paste our own copy.
    if (cmd && k === 'v' && !ev.shiftKey) { clearTimeout(pendingPaste); pendingPaste = window.setTimeout(() => { pendingPaste = 0; paste(); }, 200); return; }
    if (!el) return;
    if (cmd && (k === 'c' || k === 'x')) { ev.preventDefault(); if (k === 'x') cutEl(); else copyEl(); return; }
    if (cmd && k === 'd') { ev.preventDefault(); duplicateEl(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); delEl(); return; }
    const nudge = ev.shiftKey ? 10 : 1;
    const d = { arrowleft: [-nudge, 0], arrowright: [nudge, 0], arrowup: [0, -nudge], arrowdown: [0, nudge] }[k];
    if (d) { ev.preventDefault(); change(el, { x: el.x + d[0], y: el.y + d[1] }, 'nudge:' + el.id); }
  };
  // Cut / copy / paste — from the keyboard and from the Edit menu. Pasting an image or text from another app adds it to the slide.
  clipHandler.current = (ev: ClipboardEvent) => {
    if (inField(ev.target) || inField(document.activeElement)) return;
    // Opt in so Edit ▸ Copy / Cut / Paste are enabled even though nothing on the page is "selected" text.
    if (ev.type === 'beforepaste' || (el && (ev.type === 'beforecopy' || ev.type === 'beforecut'))) { ev.preventDefault(); return; }
    if (ev.type.startsWith('before')) return;
    if (ev.type === 'paste') {
      clearTimeout(pendingPaste); pendingPaste = 0;
      const files = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      const text = ev.clipboardData?.getData('text/plain') ?? '';
      if (files.length) { ev.preventDefault(); addImages(files); return; }
      if (clip.length && (ev.clipboardData?.types.includes(CLIP_TYPE) || !text || text === clipText)) { ev.preventDefault(); paste(); return; }
      if (text.trim()) { ev.preventDefault(); addText(undefined, text.trim()); }
      return;
    }
    if (!el) return;
    ev.preventDefault();
    ev.clipboardData?.setData('text/plain', el.text ?? '');
    ev.clipboardData?.setData(CLIP_TYPE, '1');
    if (ev.type === 'cut') cutEl(false); else copyEl(false);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / scale, dy = (e.clientY - d.sy) / scale;
    if (d.resize) change(d.el, { w: Math.max(20, d.ow + dx), h: Math.max(20, d.oh + dy) }, 'drag:' + d.el.id);
    else change(d.el, { x: d.ox + dx, y: d.oy + dy }, 'drag:' + d.el.id);
  };
  const startDrag = (e: React.PointerEvent, x: SlideEl, resize = false) => {
    if (editingText === x.id) return;
    e.stopPropagation(); setSel(x.id);
    if (e.button !== 0) return; // right-click selects, never drags
    (e.currentTarget.closest('.slide') as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { el: x, sx: e.clientX, sy: e.clientY, ox: x.x, oy: x.y, ow: x.w, oh: x.h, resize };
  };
  /** Slide coordinates (points) of a mouse event. */
  const slidePoint = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).closest('.stage')?.querySelector('.slide')?.getBoundingClientRect();
    if (!r) return undefined;
    const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    return x >= 0 && y >= 0 && x <= deck.width && y <= deck.height ? { x, y } : undefined;
  };
  const openCtx = (e: React.MouseEvent, kind: Ctx['kind']) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, kind, at: kind === 'slide' ? slidePoint(e) : undefined }); };

  // ---------- menus ----------
  const bgOpacityItem: CtxItem = { range: { label: slide.bgImage ? 'Background picture opacity' : 'Background colour opacity', value: pct(slide.bgOpacity), min: 0, max: 100, unit: '%', onChange: (v) => setBg({ bgOpacity: v / 100 }, 'bgop:' + slide.id) } };
  const slideItems = (thumb: boolean): CtxItem[] => [
    ...(!thumb ? [
      { label: 'Paste', icon: '📋', kb: `${mod}V`, disabled: !clip.length, action: () => paste(ctx?.at) },
      { label: 'Text box here', icon: 'T', action: () => addText(ctx?.at) },
      { label: 'Picture(s)…', icon: '🖼', action: () => pick(IMG, true, addImages) },
      'sep' as const,
    ] : []),
    { head: 'Background opacity' }, bgOpacityItem,
    { label: 'Format Background…', icon: '🎨', action: () => { setSel(null); setPane(true); } },
    { label: slide.bgImage ? 'Change background picture…' : 'Background picture…', icon: '🏞', action: () => pick(IMG, false, setBackgroundImage) },
    ...(slide.bgImage ? [{ label: 'Remove background picture', icon: '⊘', action: () => setBg({ bgImage: undefined }) }] : []),
    { label: 'Apply background to all slides', icon: '⇶', action: applyBgToAll },
    { label: 'Reset background', icon: '↺', action: () => setBg({ bg: '#FFFFFF', bgImage: undefined, bgOpacity: undefined }) },
    'sep',
    { label: 'New Slide', icon: '＋', action: addSlide },
    { label: 'Duplicate Slide', icon: '⧉', action: dupSlide },
    { label: 'Delete Slide', icon: '🗑', disabled: deck.slides.length < 2, action: delSlide },
    { label: slide.hidden ? 'Show Slide' : 'Hide Slide', icon: slide.hidden ? '👁' : '◌', action: toggleHidden },
    ...(thumb ? ['sep' as const,
      { label: 'Move Up', icon: '↑', disabled: idx === 0, action: () => moveSlide(-1) },
      { label: 'Move Down', icon: '↓', disabled: idx === deck.slides.length - 1, action: () => moveSlide(1) }] : []),
  ];
  const canFade = !!el && (el.kind === 'image' || !!el.fill);
  const elItems = (): CtxItem[] => !el ? [] : [
    { label: 'Cut', icon: '✂', kb: `${mod}X`, action: () => cutEl() },
    { label: 'Copy', icon: '⧉', kb: `${mod}C`, action: () => copyEl() },
    { label: 'Paste', icon: '📋', kb: `${mod}V`, disabled: !clip.length, action: () => paste() },
    { label: 'Duplicate', icon: '⿻', kb: `${mod}D`, action: duplicateEl },
    { label: 'Delete', icon: '🗑', kb: '⌫', action: () => delEl() },
    'sep',
    ...(el.kind !== 'image' ? [{ label: 'Edit Text', icon: '✎', action: () => setEditingText(el.id) }] : []),
    ...(canFade ? [{ head: el.kind === 'image' ? 'Picture opacity' : 'Fill opacity' },
      { range: { label: 'Opacity', value: pct(el.opacity), min: 0, max: 100, unit: '%', onChange: (v: number) => change(el, { opacity: v / 100 }, 'op:' + el.id) } }] : []),
    { label: 'Bring to Front', icon: '⤒', action: () => arrange('front') },
    { label: 'Bring Forward', icon: '↑', action: () => arrange('forward') },
    { label: 'Send Backward', icon: '↓', action: () => arrange('backward') },
    { label: 'Send to Back', icon: '⤓', action: () => arrange('back') },
    'sep',
    { label: 'Centre horizontally on slide', icon: '↔', action: () => centre('h') },
    { label: 'Centre vertically on slide', icon: '↕', action: () => centre('v') },
    ...(el.kind === 'image' ? [
      { label: el.rounded ? 'Remove circle crop' : 'Crop to circle', icon: '◯', action: () => change(el, { rounded: !el.rounded }) },
      { label: 'Use as slide background', icon: '🏞', action: asBackground },
    ] : []),
    'sep',
    { label: el.kind === 'image' ? 'Format Picture…' : 'Format Shape…', icon: '🎨', action: () => setPane(true) },
  ];
  function applyBgToAll() { mutate(() => deck!.slides.forEach((s) => { s.bg = slide.bg; s.bgImage = slide.bgImage; s.bgOpacity = slide.bgOpacity; s.bgChanged = true; })); toast('Background applied to all slides'); }

  return (
    <div className="editor" ref={root}>
      <Toolbar>
        <Btn primary onClick={() => doSave()} title="Save (Ctrl/Cmd+S)">💾 Save</Btn>
        <Btn onClick={print} title="Print (Ctrl/Cmd+P)">🖨 Print</Btn>
        <Menu label="Export" options={[
          { label: 'Save As…', hint: 'Ctrl/Cmd+Shift+S', action: () => doSave(true) },
          { label: 'PDF (vector)', hint: 'Text stays sharp & selectable · hidden slides left out', action: () => run('Creating PDF…', async () => saveFile(`${name}.pdf`, await deckToPdf(deck))) },
          { label: 'PNG slides (1920 px)', action: exportPng },
        ]} />
        <Sep />
        <Btn onClick={undo} disabled={!history.current.past.length} title="Undo (Ctrl/Cmd+Z)">↶</Btn>
        <Btn onClick={redo} disabled={!history.current.future.length} title="Redo (Ctrl/Cmd+Shift+Z)">↷</Btn>
        <Sep />
        <Btn onClick={addSlide} title="Insert a new slide after this one">＋ New slide</Btn>
        <Btn onClick={dupSlide} title="Duplicate this slide">⧉ Duplicate</Btn>
        <Btn onClick={delSlide} disabled={deck.slides.length < 2} title="Delete this slide">🗑 Delete slide</Btn>
        <Sep />
        <Btn onClick={() => addText()}>T Text box</Btn>
        <Btn onClick={addShape}>▭ Shape</Btn>
        <Menu label="🖼 Pictures" options={[
          { label: 'Picture(s)…', hint: 'Select one or many; several are arranged in a grid', action: () => pick(IMG, true, addImages) },
          { label: 'Profile photos…', hint: 'Team / speaker portraits: circles with name captions', action: () => pick(IMG, true, addProfiles) },
        ]} />
        <Menu label="🎨 Design" options={[
          ...THEMES.map((t) => ({ label: `Theme: ${t.name}`, hint: t.gradient ? 'Gradient background' : 'Solid background', action: () => run('Applying theme…', async () => { record(); markDirty(); await applyTheme(deck, t); bump(); }) })),
          { label: 'Format Background…', hint: 'Colour, picture, opacity — or right-click the slide', action: () => { setSel(null); setPane(true); } },
          { label: 'Background picture…', hint: 'This slide (cropped to fit)', action: () => pick(IMG, false, setBackgroundImage) },
          { label: 'Apply this background to all slides', action: applyBgToAll },
          ...(slide.bgImage ? [{ label: 'Remove background picture', action: () => setBg({ bgImage: undefined }) }] : []),
        ]} />
        <ColorPicker icon="Background" title="Background colour (opacity inside)" value={slide.bg} used={usedColours}
          onChange={(c) => setBg({ bg: c, bgImage: undefined }, 'bg:' + slide.id)}>
          <OpacityRow label="Opacity" value={slide.bgOpacity} onChange={(v) => setBg({ bgOpacity: v }, 'bgop:' + slide.id)} />
        </ColorPicker>
        <Btn active={pane} onClick={() => setPane(!pane)} title="Format pane: background, colours, opacity, arrange">⚙ Format</Btn>
        {el?.kind === 'image' && <Btn active={el.rounded} onClick={() => change(el, { rounded: !el.rounded })} title="Circular crop for profile photos">◯ Circle</Btn>}
        {el && el.kind !== 'image' && (<>
          <Sep />
          <input type="number" className="num" value={el.fontSize ?? 18} min={6} max={200} onChange={(e) => change(el, { fontSize: +e.target.value }, 'fs:' + el.id)} title="Font size" />
          <Btn active={el.bold} onClick={() => change(el, { bold: !el.bold })}><b>B</b></Btn>
          {(['left', 'center', 'right'] as const).map((a) => <Btn key={a} active={el.align === a} onClick={() => change(el, { align: a })}>{{ left: '⇤', center: '↔', right: '⇥' }[a]}</Btn>)}
          <ColorPicker icon="A" title="Text colour" value={el.color} used={usedColours} onChange={(c) => change(el, { color: c }, 'color:' + el.id)} />
          <ColorPicker icon="Fill" title="Fill colour" value={el.fill} used={usedColours} onChange={(c) => change(el, { fill: c }, 'fill:' + el.id)}
            none={{ label: 'No fill', action: () => change(el, { fill: undefined }) }}>
            <OpacityRow label="Opacity" value={el.opacity} disabled={!el.fill} onChange={(v) => change(el, { opacity: v }, 'op:' + el.id)} />
          </ColorPicker>
        </>)}
        {el && <Btn onClick={() => delEl()}>✕ Delete</Btn>}
      </Toolbar>

      <div className="editor-body">
        <aside className="sidebar slides-list">
          {deck.slides.map((s, i) => (
            <div key={s.id} className={'slide-thumb' + (i === idx ? ' on' : '') + (s.hidden ? ' hidden' : '')} title={s.hidden ? 'Hidden slide (left out of PDF export)' : undefined}
              onClick={() => { setIdx(i); setSel(null); }}
              onContextMenu={(e) => { setIdx(i); setSel(null); openCtx(e, 'thumb'); }}>
              <span>{i + 1}</span>
              <div className="mini" style={{ aspectRatio: `${deck.width}/${deck.height}`, ...bgCss(s) }}>
                <BgLayer s={s} />
                {s.els.map((e) => (
                  <div key={e.id} className="mini-el" style={{ left: `${(e.x / deck.width) * 100}%`, top: `${(e.y / deck.height) * 100}%`, width: `${(e.w / deck.width) * 100}%`, height: `${(e.h / deck.height) * 100}%`, background: e.fill && e.kind !== 'image' ? rgba(e.fill, e.opacity ?? 1) : undefined }}>
                    {e.kind === 'image' && e.image
                      ? <img src={e.image.url} alt="" className={e.rounded ? 'rounded' : undefined} style={{ opacity: e.opacity ?? 1 }} />
                      : <span style={{ fontSize: `${(e.fontSize ?? 18) * (130 / deck.width)}px`, color: e.color, fontWeight: e.bold ? 700 : 400, textAlign: e.align }}>{e.text}</span>}
                  </div>))}
              </div>
            </div>
          ))}
          <div className="row"><Btn onClick={() => moveSlide(-1)} title="Move slide up">↑</Btn><Btn onClick={() => moveSlide(1)} title="Move slide down">↓</Btn></div>
        </aside>

        <div className="stage" ref={stage} onPointerDown={(e) => { if (e.button === 0 || !(e.target as HTMLElement).closest('.sel-el')) { setSel(null); setEditingText(null); } }}
          onContextMenu={(e) => openCtx(e, 'slide')}>
          <div className="slide" style={{ width: deck.width * scale, height: deck.height * scale, ...bgCss(slide) }}
            onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}>
            <BgLayer s={slide} />
            {slide.els.map((e) => (
              <div key={e.id} className={'sel-el' + (sel === e.id ? ' sel' : '')}
                style={{ left: e.x * scale, top: e.y * scale, width: e.w * scale, height: e.h * scale, background: e.fill && e.kind !== 'image' ? rgba(e.fill, e.opacity ?? 1) : undefined }}
                onPointerDown={(ev) => startDrag(ev, e)} onDoubleClick={() => e.kind !== 'image' && setEditingText(e.id)}
                onContextMenu={(ev) => { setSel(e.id); openCtx(ev, 'el'); }}>
                {e.kind === 'image' && e.image && <img src={e.image.url} alt="" draggable={false} className={e.rounded ? 'rounded' : undefined} style={{ opacity: e.opacity ?? 1 }} />}
                {e.kind !== 'image' && (editingText === e.id
                  ? <textarea autoFocus value={e.text} onPointerDown={(ev) => ev.stopPropagation()} onContextMenu={(ev) => ev.stopPropagation()} onChange={(ev) => change(e, { text: ev.target.value }, 'text:' + e.id)}
                      style={{ fontSize: (e.fontSize ?? 18) * scale, color: e.color, fontWeight: e.bold ? 700 : 400, textAlign: e.align }} />
                  : <div className="txt" style={{ fontSize: (e.fontSize ?? 18) * scale, color: e.color, fontWeight: e.bold ? 700 : 400, textAlign: e.align, padding: 7 * scale }}>{e.text}</div>)}
                {sel === e.id && <span className="handle" onPointerDown={(ev) => startDrag(ev, e, true)} />}
              </div>
            ))}
          </div>
          <p className="hint">Double-click a box to edit text · drag to move · corner to resize · right-click for more options</p>
        </div>

        {pane && (el ? (
          <aside className="props format-pane" aria-label="Format">
            <h3>{el.kind === 'image' ? 'Format Picture' : 'Format Shape'}<button onClick={() => setPane(false)} title="Close">✕</button></h3>
            {el.kind !== 'image' && (<>
              <h5>Text</h5>
              <label>Colour <ColorPicker icon="A" title="Text colour" value={el.color} used={usedColours} onChange={(c) => change(el, { color: c }, 'color:' + el.id)} /></label>
              <label>Size <input type="number" className="num" value={el.fontSize ?? 18} min={6} max={200} onChange={(e) => change(el, { fontSize: +e.target.value }, 'fs:' + el.id)} /></label>
              <h5>Fill</h5>
              <label>Colour <ColorPicker icon="Fill" title="Fill colour" value={el.fill} used={usedColours} onChange={(c) => change(el, { fill: c }, 'fill:' + el.id)} none={{ label: 'No fill', action: () => change(el, { fill: undefined }) }} /></label>
            </>)}
            {canFade && <OpacityRow label="Opacity" value={el.opacity} onChange={(v) => change(el, { opacity: v }, 'op:' + el.id)} />}
            {el.kind === 'image' && <div className="btns"><Btn active={el.rounded} onClick={() => change(el, { rounded: !el.rounded })}>◯ Circle crop</Btn><Btn onClick={asBackground}>🏞 Use as background</Btn></div>}
            <h5>Position &amp; size (pt)</h5>
            <div className="grid2">
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <label key={k}>{{ x: 'Left', y: 'Top', w: 'Width', h: 'Height' }[k]}
                  <input type="number" value={Math.round(el[k])} min={k === 'w' || k === 'h' ? 10 : undefined} onChange={(e) => change(el, { [k]: +e.target.value }, `pos:${k}:${el.id}`)} /></label>
              ))}
            </div>
            <h5>Arrange</h5>
            <div className="btns">
              <Btn onClick={() => arrange('front')} title="Bring to front">⤒ Front</Btn><Btn onClick={() => arrange('forward')} title="Bring forward">↑</Btn>
              <Btn onClick={() => arrange('backward')} title="Send backward">↓</Btn><Btn onClick={() => arrange('back')} title="Send to back">⤓ Back</Btn>
            </div>
            <div className="btns"><Btn onClick={() => centre('h')}>↔ Centre</Btn><Btn onClick={() => centre('v')}>↕ Middle</Btn></div>
            <div className="btns"><Btn onClick={duplicateEl}>⿻ Duplicate</Btn><Btn onClick={() => delEl()}>🗑 Delete</Btn></div>
          </aside>
        ) : (
          <aside className="props format-pane" aria-label="Format Background">
            <h3>Format Background<button onClick={() => setPane(false)} title="Close">✕</button></h3>
            <div className="seg" role="tablist">
              <button className={!slide.bgImage ? 'on' : ''} onClick={() => slide.bgImage && setBg({ bgImage: undefined })}>Solid colour</button>
              <button className={slide.bgImage ? 'on' : ''} onClick={() => !slide.bgImage && pick(IMG, false, setBackgroundImage)}>Picture</button>
            </div>
            {slide.bgImage && (<>
              <div className="bg-preview" style={{ backgroundImage: `url(${slide.bgImage.url})` }} />
              <div className="btns"><Btn onClick={() => pick(IMG, false, setBackgroundImage)}>Change…</Btn><Btn onClick={() => setBg({ bgImage: undefined })}>Remove</Btn></div>
            </>)}
            <label>{slide.bgImage ? 'Colour behind picture' : 'Colour'}
              <ColorPicker icon="Bg" title="Background colour" value={slide.bg} used={usedColours} onChange={(c) => setBg({ bg: c }, 'bg:' + slide.id)} /></label>
            <OpacityRow label={slide.bgImage ? 'Picture opacity' : 'Colour opacity'} value={slide.bgOpacity} onChange={(v) => setBg({ bgOpacity: v }, 'bgop:' + slide.id)} />
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>{slide.bgImage ? 'Lower the opacity to fade the picture into the colour behind it, so text stands out.' : 'Below 100 % the colour fades towards white.'}</p>
            <label><span>Hide slide</span><input type="checkbox" checked={!!slide.hidden} onChange={toggleHidden} /></label>
            <div className="btns"><Btn onClick={applyBgToAll}>⇶ Apply to all</Btn><Btn onClick={() => setBg({ bg: '#FFFFFF', bgImage: undefined, bgOpacity: undefined })}>↺ Reset</Btn></div>
          </aside>
        ))}
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} onClose={closeCtx} items={ctx.kind === 'el' && el ? elItems() : slideItems(ctx.kind === 'thumb')} />}
    </div>
  );
}

/** 0–100 % opacity slider with a number box (values are stored as 0–1). */
function OpacityRow({ label, value, onChange, disabled }: { label: string; value?: number; onChange: (v: number) => void; disabled?: boolean }) {
  const v = pct(value);
  return (
    <div className="range" title={disabled ? 'Choose a fill colour first' : undefined} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 52px', gap: 6, alignItems: 'center', fontSize: 12, opacity: disabled ? 0.5 : 1 }}>
      <span>{label}</span>
      <input type="range" min={0} max={100} value={v} disabled={disabled} aria-label={label} onChange={(e) => onChange(+e.target.value / 100)} />
      <input type="number" min={0} max={100} value={v} disabled={disabled} aria-label={`${label} %`} style={{ width: 52 }}
        onChange={(e) => onChange(Math.max(0, Math.min(100, +e.target.value || 0)) / 100)} />
    </div>
  );
}
