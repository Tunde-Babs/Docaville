import { lazy, Suspense, useState } from 'react';
import type { OpenFile } from '../lib/formats';
import type { LocalVersion } from '../lib/localStore';
const AudioStudio = lazy(() => import('./AudioStudio'));
const BatchTools = lazy(() => import('./BatchTools'));
const DocumentAssistant = lazy(() => import('./DocumentAssistant'));
const ReviewTools = lazy(() => import('./ReviewTools'));
const ScanStudio = lazy(() => import('./ScanStudio'));
const TemplateStudio = lazy(() => import('./TemplateStudio'));
const RecoveryTools = lazy(() => import('./RecoveryTools'));
export const PRODUCTIVITY_TOOLS = [
  ['audio', '🎙', 'Audio to document', 'Transcribe recordings, dictate, and prepare documents'],
  ['batch', '⚡', 'Batch workflows', 'Convert, OCR, extract, watermark, and rename files'],
  ['assistant', '⌕', 'Document assistant', 'Find cited answers, summaries, tables, and read aloud'],
  ['review', '⇄', 'Compare and review', 'Review text changes and keep comments'],
  ['scan', '▣', 'Scan and extract', 'Prepare photos, correct OCR, and extract tables'],
  ['templates', '▤', 'Business templates', 'Reuse branding, business details, and placeholders'],
  ['recovery', '↶', 'Recovery and versions', 'Restore local drafts and saved versions'],
] as const;
export type ProductivityTool = typeof PRODUCTIVITY_TOOLS[number][0];
export default function ProductivityHub({ tool, navigate, createDocument, restore, files }: {
  tool: ProductivityTool; navigate: (tool: ProductivityTool) => void; createDocument: (name: string, html: string) => void; restore: (version: LocalVersion) => void; files: OpenFile[];
}) {
  const [visited, setVisited] = useState<Set<ProductivityTool>>(new Set([tool]));
  const select = (next: ProductivityTool) => { setVisited(current => new Set([...current, next])); navigate(next); };
  const visible = new Set([...visited, tool]);
  return <div className="productivity-hub"><aside className="tool-navigation"><h2>Productivity</h2>{PRODUCTIVITY_TOOLS.map(([id, icon, label]) => <button key={id} className={'tool-nav-button' + (tool === id ? ' active' : '')} onClick={() => select(id)} aria-current={tool === id ? 'page' : undefined}><span aria-hidden="true">{icon}</span>{label}</button>)}<small>Files and processing stay on this device. Models and OCR language packs download on first use.</small></aside>
    <div className="tool-workspace"><Suspense fallback={<p className="loading">Opening tool…</p>}>
      {visible.has('audio') && <div hidden={tool !== 'audio'}><AudioStudio createDocument={createDocument} /></div>}
      {visible.has('batch') && <div hidden={tool !== 'batch'}><BatchTools /></div>}
      {visible.has('assistant') && <div hidden={tool !== 'assistant'}><DocumentAssistant createDocument={createDocument} /></div>}
      {visible.has('review') && <div hidden={tool !== 'review'}><ReviewTools createDocument={createDocument} /></div>}
      {visible.has('scan') && <div hidden={tool !== 'scan'}><ScanStudio createDocument={createDocument} /></div>}
      {visible.has('templates') && <div hidden={tool !== 'templates'}><TemplateStudio createDocument={createDocument} /></div>}
      {visible.has('recovery') && <div hidden={tool !== 'recovery'}><RecoveryTools files={files} restore={restore} /></div>}
    </Suspense></div></div>;
}
