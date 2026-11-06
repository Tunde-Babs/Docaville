import { useEffect, useRef } from 'react';
export default function ProDialog({ beta, close }: { beta: boolean; close: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])];
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); before?.focus(); };
  }, [close]);
  return <div className="pro-backdrop" onClick={close}><div className="pro-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby="pro-title" onClick={event => event.stopPropagation()}>
    <h2 id="pro-title">Docaville Pro</h2>
    <p>{beta ? 'All editing and productivity features are included during the beta.' : 'View documents for free. Pro unlocks editing and productivity tools.'}</p>
    <ul><li>Create and edit PDFs, Word documents, spreadsheets, slides, and images.</li><li>Convert and export files, transcribe audio, dictate, translate, and recognize scanned text.</li><li>Use batch workflows, source-linked answers, document review, and business templates.</li></ul>
    <p>The paid unlock will be available at launch. Purchases are not offered in this preview.</p>
    <button className="btn primary" onClick={close}>Continue {beta ? 'beta' : 'viewing'}</button>
  </div></div>;
}
