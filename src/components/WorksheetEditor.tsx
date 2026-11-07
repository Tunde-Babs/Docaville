import { useEffect, useRef, useState } from 'react';
import { fitWorksheetAnnotation, worksheetHeight, type WorksheetAnnotation } from '../engines/worksheet';

interface Props {
  url: string;
  pageNumber: number;
  notes: WorksheetAnnotation[];
  onChange: (notes: WorksheetAnnotation[]) => void;
  disabled: boolean;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export default function WorksheetEditor({ url, pageNumber, notes, onChange, disabled, undo, redo, canUndo, canRedo }: Props) {
  const [tool, setTool] = useState<'text' | 'cross' | 'select'>('text');
  const [selected, setSelected] = useState<string | null>(null);
  const [color, setColor] = useState('#d32f2f');
  const [size, setSize] = useState(0.022);
  const [width, setWidth] = useState(0.3);
  const [aspect, setAspect] = useState(1);
  const [displayWidth, setDisplayWidth] = useState(500);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<WorksheetAnnotation | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ note: WorksheetAnnotation; pointer: number; x: number; y: number } | null>(null);
  const active = notes.find(note => note.id === selected);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setDisplayWidth(entries[0].contentRect.width));
    if (surface.current) observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setSelected(null); setPreview(null); drag.current = null; }, [pageNumber]);
  function change(note: WorksheetAnnotation) {
    try {
      const next = fitWorksheetAnnotation(note, aspect);
      onChange(notes.map(value => value.id === note.id ? next : value)); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function place(event: React.MouseEvent<HTMLDivElement>) {
    if (disabled || tool === 'select') { setSelected(null); return; }
    if (!(event.target instanceof HTMLElement) || event.target.closest('[data-worksheet-note]')) return;
    const rect = surface.current!.getBoundingClientRect();
    addAt((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }
  function addAt(x: number, y: number) {
    if (tool === 'select' || disabled) return;
    const note = fitWorksheetAnnotation({ id: crypto.randomUUID(), kind: tool,
      x: tool === 'cross' ? x - size * 0.65 : x, y: tool === 'cross' ? y - size * 0.65 * aspect : y,
      width, size, color, text: '',
    }, aspect);
    onChange([...notes, note]); setSelected(note.id); setError('');
  }
  function beginDrag(event: React.PointerEvent<HTMLElement>, note: WorksheetAnnotation) {
    if (disabled) return;
    event.preventDefault(); event.stopPropagation(); setSelected(note.id);
    drag.current = { note, pointer: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: React.PointerEvent<HTMLElement>, finish: boolean) {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    const rect = surface.current!.getBoundingClientRect();
    const next = fitWorksheetAnnotation({ ...start.note, x: start.note.x + (event.clientX - start.x) / rect.width, y: start.note.y + (event.clientY - start.y) / rect.height }, aspect);
    if (finish) { drag.current = null; setPreview(null); onChange(notes.map(note => note.id === next.id ? next : note)); }
    else setPreview(next);
  }
  return <section className="worksheet-editor" aria-label={`Write on source page ${pageNumber}`}>
    <div className="row wrap worksheet-tools" aria-label="Worksheet tools">
      <button className={'btn' + (tool === 'text' ? ' active' : '')} disabled={disabled} aria-pressed={tool === 'text'} onClick={() => { setTool('text'); setColor('#d32f2f'); setSelected(null); }}>Add text</button>
      <button className={'btn' + (tool === 'cross' ? ' active' : '')} disabled={disabled} aria-pressed={tool === 'cross'} onClick={() => { setTool('cross'); setColor('#008a18'); setSelected(null); }}>Add cross ×</button>
      <button className={'btn' + (tool === 'select' ? ' active' : '')} disabled={disabled} aria-pressed={tool === 'select'} onClick={() => setTool('select')}>Select / move</button>
      <button className="btn" disabled={disabled || !canUndo} onClick={undo}>Undo answer</button>
      <button className="btn" disabled={disabled || !canRedo} onClick={redo}>Redo answer</button>
    </div>
    <div className="row wrap worksheet-tools">
      <label>Answer colour <input type="color" value={active?.color ?? color} disabled={disabled} onChange={event => { setColor(event.target.value); if (active) change({ ...active, color: event.target.value }); }} /></label>
      <label>Text size <select value={active?.size ?? size} disabled={disabled} onChange={event => { const value = Number(event.target.value); setSize(value); if (active) change({ ...active, size: value }); }}>
        <option value={0.016}>Small</option><option value={0.022}>Medium</option><option value={0.032}>Large</option><option value={0.045}>Extra large</option>
      </select></label>
      <label>Answer width <select value={active?.kind === 'text' ? active.width : width} disabled={disabled} onChange={event => { const value = Number(event.target.value); setWidth(value); if (active?.kind === 'text') change({ ...active, width: value }); }}>
        <option value={0.15}>Narrow</option><option value={0.3}>Medium</option><option value={0.5}>Wide</option>
      </select></label>
      <button className="btn" disabled={disabled || !active} onClick={() => { onChange(notes.filter(note => note.id !== selected)); setSelected(null); }}>Delete answer</button>
    </div>
    <p className="muted">Choose Add text or Add cross, then click or tap the worksheet. Type in the new text box. Select an answer and drag its ↔ handle to move it. Keyboard: focus the worksheet and press Enter to add an answer, then use the move handle's arrow keys.</p>
    {error && <p role="alert">{error}</p>}
    <div ref={surface} className={'worksheet-surface worksheet-tool-' + tool} onClick={place} tabIndex={disabled ? -1 : 0} aria-label={`Worksheet page ${pageNumber}: press Enter to place an answer`}
      onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); addAt(0.25, 0.25); } }}>
      <img src={url} alt={`Original source page ${pageNumber}`} draggable={false} onLoad={event => setAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
      {notes.map(saved => {
        const note = preview?.id === saved.id ? preview : saved;
        const chosen = selected === note.id;
        return <div key={note.id} data-worksheet-note={note.id} className={'worksheet-answer' + (chosen ? ' selected' : '')}
          style={{ left: `${note.x * 100}%`, top: `${note.y * 100}%`, width: `${note.width * 100}%`, height: `${worksheetHeight(note, aspect) * 100}%`, color: note.color, fontSize: displayWidth * note.size }}>
          {note.kind === 'text' ? <textarea aria-label={`Answer on source page ${pageNumber}`} value={note.text} placeholder="Type here" autoFocus={chosen && !note.text} disabled={disabled}
            onFocus={() => setSelected(note.id)} onChange={event => change({ ...note, text: event.target.value.slice(0, 1000) })} spellCheck />
            : <button className="worksheet-cross" disabled={disabled} aria-label={`Select cross on source page ${pageNumber}`} onFocus={() => setSelected(note.id)} onClick={() => setSelected(note.id)}>×</button>}
          {chosen && <button className="worksheet-move" aria-label="Move selected answer" disabled={disabled} title="Drag to move; arrow keys move, Shift moves faster"
            onPointerDown={event => beginDrag(event, note)} onPointerMove={event => move(event, false)} onPointerUp={event => move(event, true)} onPointerCancel={() => { drag.current = null; setPreview(null); }}
            onKeyDown={event => {
              const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
              if (steps[event.key]) { event.preventDefault(); const [x, y] = steps[event.key], step = event.shiftKey ? 0.01 : 0.002; change({ ...note, x: note.x + x * step, y: note.y + y * step }); }
            }}>↔</button>}
        </div>;
      })}
    </div>
  </section>;
}
