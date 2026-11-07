import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { WordReviewPage } from '../components/ImageWordReview';
import { readWorksheetDocument, type SavedWorksheetPage } from '../engines/worksheetDocument';
import { useEditor, EditorContent, Extension, type Editor } from '@tiptap/react';
import FontFamily from '@tiptap/extension-font-family';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Link from '@tiptap/extension-link';
import { Node as EditorNode } from '@tiptap/core';
import type { OpenFile } from '../lib/formats';
import { textToHtml, jsonToDocx, type DocDefaults } from '../engines/docx';
import { richTextToPdf } from '../engines/layoutPdf';
import { saveFile, baseName, isDesktop } from '../lib/fileio';
import { normalizeImage } from '../lib/image';
import { Btn, Menu, Toolbar, Sep, FilePick, run } from '../components/ui';
import { ColorPicker } from '../components/ColorPicker';
import { lineCss, DEFAULT_PAGE } from '../lib/paraFormat';
import { useSave, loadOrFail, type EditorProps } from '../components/useSave';
import Dictation from '../components/Dictation';
import ReadAloud from '../components/ReadAloud';
import { localRead, localWrite } from '../lib/localStore';
import { textHtml } from '../engines/documentTools';

declare module '@tiptap/core' {
  interface Commands<ReturnType> { fontSize: { setFontSize: (size: string) => ReturnType; unsetFontSize: () => ReturnType } }
}
/** font-size as a textStyle attribute (round-trips to Word run size). */
const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{ types: ['textStyle'], attributes: { fontSize: {
      default: null,
      parseHTML: (el: HTMLElement) => el.style.fontSize || null,
      renderHTML: (a: { fontSize?: string | null }) => (a.fontSize ? { style: `font-size: ${a.fontSize}` } : {}),
    } } }];
  },
  addCommands() {
    return {
      setFontSize: (size: string) => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});
/** Paragraph spacing before/after, line spacing and left indent — read from / written to Word exactly. */
const num = (data: string, css: (v: number) => string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => { const v = el.getAttribute(data); return v !== null && v !== '' && !isNaN(+v) ? +v : null; },
  renderHTML: (a: Record<string, unknown>, key = '') => (a[key] == null ? {} : { [data]: String(a[key]), style: css(a[key] as number) }),
});
const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    const sb = num('data-sb', (v) => `padding-top: ${v}pt`), sa = num('data-sa', (v) => `padding-bottom: ${v}pt`), ind = num('data-ind', (v) => `margin-left: ${v}pt`);
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        spaceBefore: { ...sb, renderHTML: (a: Record<string, unknown>) => sb.renderHTML(a, 'spaceBefore') },
        spaceAfter: { ...sa, renderHTML: (a: Record<string, unknown>) => sa.renderHTML(a, 'spaceAfter') },
        indentLeft: { ...ind, renderHTML: (a: Record<string, unknown>) => ind.renderHTML(a, 'indentLeft') },
        lineHeight: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-lh') || null,
          renderHTML: (a: { lineHeight?: string | null }) => (a.lineHeight ? { 'data-lh': a.lineHeight, style: `line-height: ${lineCss(a.lineHeight)}` } : {}),
        },
      },
    }];
  },
});
/** Images keep the size they had in the Word document. */
const SizedImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), width: { default: null }, height: { default: null } };
  },
});
// Keep Word section boundaries anchored in the editor instead of inferring their positions on save.
const SectionBreak = EditorNode.create({
  name: 'sectionBreak', group: 'block', atom: true, isolating: true,
  addAttributes() { return { section: { default: 0, parseHTML: el => +(el.getAttribute('data-section-break') ?? 0) } }; },
  parseHTML() { return [{ tag: 'div[data-section-break]' }]; },
  renderHTML({ node }) { return ['div', { 'data-section-break': node.attrs.section, class: 'section-break', contenteditable: 'false' }, 'Section break']; },
});
const Bookmark = EditorNode.create({
  name: 'bookmark', group: 'inline', inline: true, atom: true, selectable: false,
  addAttributes() { return { name: { default: '', parseHTML: el => el.getAttribute('data-bookmark-name') ?? '' } }; },
  parseHTML() { return [{ tag: 'span[data-bookmark-name]' }]; },
  renderHTML({ node }) { return ['span', { 'data-bookmark-name': node.attrs.name, 'aria-hidden': 'true' }]; },
});
const FONTS = ['Calibri', 'Aptos', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Garamond', 'Cambria', 'Verdana', 'Courier New'];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

/** Every text colour and highlight colour used in the document (most used first). */
function docColours(json: unknown) {
  const text = new Map<string, number>(), hl = new Map<string, number>();
  const walk = (n: { marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: unknown[] }) => {
    for (const m of n.marks ?? []) {
      const c = m.attrs?.color as string | undefined;
      if (!c) continue;
      const map = m.type === 'highlight' ? hl : m.type === 'textStyle' ? text : null;
      map?.set(c, (map.get(c) ?? 0) + 1);
    }
    (n.content as typeof n[] | undefined)?.forEach(walk);
  };
  walk(json as Parameters<typeof walk>[0]);
  const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return { text: sorted(text), highlight: sorted(hl) };
}

interface Loaded { html: string; defaults?: DocDefaults; header?: string; footer?: string }
const ImageWordReview = lazy(() => import('../components/ImageWordReview'));


export const documentExtensions = [
  StarterKit.configure({ link: false, underline: false }), Underline, TextStyle, Color, FontFamily, FontSize, ParagraphFormat, SectionBreak, Bookmark, Highlight.configure({ multicolor: true }),
  Link.configure({ openOnClick: false, autolink: false }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  SizedImage.configure({ allowBase64: true }),
  Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
];

async function loadContent(file: OpenFile): Promise<Loaded> {
  if (file.initialHtml !== undefined) return { html: file.initialHtml };
  if (!file.bytes) return { html: (await import('../lib/templates')).docTemplate(file.template ?? 'doc-blank') };
  const ext = file.name.split('.').pop()!.toLowerCase();
  if (ext === 'docx') return (await import('../engines/docxImport')).importDocx(file.bytes);
  const text = new TextDecoder().decode(file.bytes);
  if (ext === 'html' || ext === 'htm') return { html: text };
  if (ext === 'txt' || ext === 'md') return { html: textToHtml(text) };
  throw new Error(`.${ext} files need the server conversion add-on (see README → "Legacy formats"). Save as .docx and reopen.`);
}

/** Keep positioned worksheet answers out of the general rich-text importer. */
export default function DocEditor(props: EditorProps) {
  const [worksheet, setWorksheet] = useState<SavedWorksheetPage[] | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let stopped = false;
    setError(''); setWorksheet(undefined); setOpen(true);
    (async () => {
      const result = props.file.bytes && /\.docx$/i.test(props.file.name) ? await readWorksheetDocument(props.file.bytes) : null;
      if (!stopped) setWorksheet(result);
    })().catch(failure => { if (!stopped) setError((failure as Error).message); });
    return () => { stopped = true; };
    // A normal save updates file.bytes while the rich editor may contain newer edits.
    // Route once per opened tab; never remount that editor merely because a save finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.file.id]);
  if (error) return <div className="panel" role="alert">{error} The file has not been changed.</div>;
  if (worksheet === undefined) return <p>Opening document…</p>;
  if (!worksheet) return <RichDocEditor {...props} />;
  const pages: WordReviewPage[] = worksheet.map(page => ({ ...page, savedWorksheet: true, ocr: { text: page.text, lines: [], width: 0, height: 0 } }));
  return <div className="panel"><h2>Worksheet</h2><p>Your original pages, positioned answers, crosses and reviewed text are saved in this Word document. Open the worksheet tools to continue editing, then export a Word copy.</p>
    <button className="btn primary" onClick={() => setOpen(true)}>Edit worksheet</button>
    {open && <Suspense fallback={<p>Opening worksheet tools…</p>}><ImageWordReview pages={pages} name={props.file.name} close={() => setOpen(false)}
      onSaved={(bytes, target) => {
        props.onChange({ bytes, name: target.name, path: target.path, handle: target.handle, mobilePath: target.mobilePath, dirty: false });
        void readWorksheetDocument(bytes).then(setWorksheet).catch(failure => setError((failure as Error).message));
      }} /></Suspense>}
  </div>;
}

function RichDocEditor({ file, onChange, onFail }: EditorProps) {
  const editor = useEditor({ extensions: documentExtensions, content: '' });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The original .docx (if any) donates its headers, footers and page setup on save.
  const original = useRef<{ bytes: Uint8Array; defaults?: DocDefaults } | undefined>(undefined);
  const { root, save, print, markDirty } = useSave(file, onChange, () => 'docx',
    async () => {
      if (!loaded) throw new Error('The document is still opening. Wait for it to finish before saving.');
      return jsonToDocx(editor!.getJSON(), baseName(file.name), original.current ?? (loaded.defaults ? { bytes: new Uint8Array(), defaults: loaded.defaults } : undefined));
    },
    () => richTextToPdf(editor!.getJSON(), baseName(file.name), loaded?.defaults));
  const [, setTick] = useState(0);
  // Word-style: the A / 🖍 buttons re-apply the last colour picked; ▾ opens the palette.
  const [lastColour, setLastColour] = useState('#C00000');
  const [lastHighlight, setLastHighlight] = useState('#FFF59D');
  const [speechPanel, setSpeechPanel] = useState<'dictate' | 'read' | 'template' | null>(null);
  const [templateName, setTemplateName] = useState('My document template');
  const [dictating, setDictating] = useState(false);

  useEffect(() => {
    if (!editor) return;
    loadOrFail('Opening document…', async () => {
      const res = await loadContent(file);
      editor.commands.setContent(res.html, { emitUpdate: false }); // false = loading is not an edit
      if (file.bytes && /\.docx$/i.test(file.name)) original.current = { bytes: file.bytes, defaults: res.defaults };
      setLoaded(res);
    }, onFail);
    const t = () => setTick((n) => n + 1);
    editor.on('selectionUpdate', t); editor.on('transaction', t); editor.on('update', markDirty);
    return () => { editor.off('selectionUpdate', t); editor.off('transaction', t); editor.off('update', markDirty); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, file.id]);

  if (!editor) return null;
  const name = baseName(file.name);
  const ch = () => editor.chain().focus();

  const exportPdf = () => run('Creating PDF…', async () => saveFile(`${name}.pdf`, await richTextToPdf(editor.getJSON(), name, loaded?.defaults)));
  const printPdf = () => run('Printing to PDF…', async () => {
    // Desktop: Chromium's print engine = exact on-screen typography, vector output.
    document.body.classList.add('printing-doc');
    try { await saveFile(`${name}.pdf`, await window.docHubNative!.printToPDF(false)); }
    finally { document.body.classList.remove('printing-doc'); }
  });

  async function insertImage(files: File[]) {
    for (const f of files) {
      const [n] = await normalizeImage(new Uint8Array(await f.arrayBuffer()), f.type);
      const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(new Blob([n.bytes as BlobPart], { type: n.mime })); });
      ch().setImage({ src: url }).run();
    }
  }

  const heading = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';

  return (
    <div className="editor" ref={root}>
      <Toolbar>
        <Btn primary onClick={() => save()} title="Save (Ctrl/Cmd+S)">💾 Save</Btn>
        <Btn onClick={print} title="Print (Ctrl/Cmd+P)">🖨 Print</Btn>
        <Menu label="Export" options={[
          { label: 'Save As…', hint: 'Ctrl/Cmd+Shift+S', action: () => save(true) },
          { label: 'PDF (vector)', hint: 'Same output on every device', action: exportPdf },
          ...(isDesktop() ? [{ label: 'PDF (print engine)', hint: 'Exact on-screen typography', action: printPdf }] : []),
          { label: 'Word .docx', action: () => run('Saving…', async () => saveFile(`${name}.docx`, await jsonToDocx(editor.getJSON(), name, original.current))) },
          { label: 'Web page .html', action: () => saveFile(`${name}.html`, `<!doctype html><meta charset="utf-8"><title>${name}</title><body style="font-family:Calibri,Arial;max-width:800px;margin:auto">${editor.getHTML()}`) },
          { label: 'Plain text .txt', action: () => saveFile(`${name}.txt`, editor.getText({ blockSeparator: '\n\n' })) },
        ]} />
        <Sep />
        <Btn onClick={() => ch().undo().run()} disabled={!editor.can().undo()}>↶</Btn>
        <Btn onClick={() => ch().redo().run()} disabled={!editor.can().redo()}>↷</Btn>
        <select value={heading} onChange={(e) => { const v = e.target.value; v === 'p' ? ch().setParagraph().run() : ch().setHeading({ level: +v[1] as 1 | 2 | 3 }).run(); }}>
          <option value="p">Normal</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
        </select>
        <select className="font-select" title="Font" value={(editor.getAttributes('textStyle').fontFamily as string | undefined)?.replace(/['"]/g, '') ?? ''}
          onChange={(e) => (e.target.value ? ch().setFontFamily(e.target.value).run() : ch().unsetFontFamily().run())}>
          <option value="">{loaded?.defaults?.font ?? 'Calibri'} (default)</option>
          {FONTS.filter((f) => f !== loaded?.defaults?.font).map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
        <select className="size-select" title="Font size" value={String(parseFloat(editor.getAttributes('textStyle').fontSize ?? '') || '')}
          onChange={(e) => (e.target.value ? ch().setFontSize(`${e.target.value}pt`).run() : ch().unsetFontSize().run())}>
          <option value="">{loaded?.defaults?.sizePt ?? 11}</option>
          {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <Btn active={editor.isActive('bold')} onClick={() => ch().toggleBold().run()}><b>B</b></Btn>
        <Btn active={editor.isActive('italic')} onClick={() => ch().toggleItalic().run()}><i>I</i></Btn>
        <Btn active={editor.isActive('underline')} onClick={() => ch().toggleUnderline().run()}><u>U</u></Btn>
        <Btn active={editor.isActive('strike')} onClick={() => ch().toggleStrike().run()}><s>S</s></Btn>
        <ColorPicker icon="A" title="Font colour" applyOnClick value={lastColour}
          used={() => { const d = docColours(editor.getJSON()); return [editor.getAttributes('textStyle').color as string | undefined, ...d.text, ...d.highlight]; }}
          onChange={(c) => { setLastColour(c); ch().setColor(c).run(); }}
          none={{ label: 'Automatic', action: () => ch().unsetColor().run() }} />
        <ColorPicker icon="🖍" title="Highlight colour" applyOnClick value={lastHighlight}
          used={() => { const d = docColours(editor.getJSON()); return [...d.highlight, ...d.text]; }}
          onChange={(c) => { setLastHighlight(c); ch().setHighlight({ color: c }).run(); }}
          none={{ label: 'No highlight', action: () => ch().unsetHighlight().run() }} />
        <Sep />
        {(['left', 'center', 'right', 'justify'] as const).map((a) => (
          <Btn key={a} active={editor.isActive({ textAlign: a })} onClick={() => ch().setTextAlign(a).run()}>{{ left: '⇤', center: '↔', right: '⇥', justify: '☰' }[a]}</Btn>
        ))}
        <SpacingMenu editor={editor} />
        <Sep />
        <Btn active={editor.isActive('bulletList')} onClick={() => ch().toggleBulletList().run()}>• List</Btn>
        <Btn active={editor.isActive('orderedList')} onClick={() => ch().toggleOrderedList().run()}>1. List</Btn>
        <Btn active={editor.isActive('blockquote')} onClick={() => ch().toggleBlockquote().run()}>❝</Btn>
        <Btn onClick={() => ch().setHorizontalRule().run()}>―</Btn>
        <FilePick accept="image/*,.heic,.tif,.tiff" multiple onFiles={insertImage}>🖼</FilePick>
        <TableMenu editor={editor} />
        <Sep />
        <Btn disabled={dictating} active={speechPanel === 'dictate'} onClick={() => setSpeechPanel(speechPanel === 'dictate' ? null : 'dictate')}>🎙 Dictate</Btn>
        <Btn disabled={dictating} active={speechPanel === 'read'} onClick={() => setSpeechPanel(speechPanel === 'read' ? null : 'read')}>Read aloud</Btn>
        <Btn disabled={dictating} active={speechPanel === 'template'} onClick={() => setSpeechPanel(speechPanel === 'template' ? null : 'template')}>Save as template</Btn>
      </Toolbar>
      {speechPanel && <div className="editor-tools-panel">
        {speechPanel === 'dictate' && <Dictation documentId={file.id} onStateChange={setDictating} onText={text => { editor.chain().focus().insertContent(textHtml(text)).run(); }} />}
        {speechPanel === 'read' && <ReadAloud text={editor.getText({ blockSeparator: '\n\n' })} />}
        {speechPanel === 'template' && <div className="row wrap"><label>Template name <input value={templateName} onChange={e => setTemplateName(e.target.value)} /></label><Btn disabled={!templateName.trim()} onClick={() => run('Saving template…', async () => { const templates = await localRead<{ id: string; name: string; html: string }[]>('personal-templates') ?? []; await localWrite('personal-templates', [...templates, { id: crypto.randomUUID(), name: templateName.trim(), html: editor.getHTML() }]); setSpeechPanel(null); })}>Save locally</Btn><span>Use {'{{customer}}'} placeholders for reusable fields. Find saved templates under Productivity tools.</span></div>}
      </div>}
      <div className="doc-scroll">
        <div className="doc-page print-area" style={pageStyle(loaded?.defaults)}>
          {loaded?.header && <div className="doc-hf" title="Header from the original document — kept unchanged when you save">{loaded.header}</div>}
          <EditorContent editor={editor} />
          {loaded?.footer && <div className="doc-hf footer" title="Footer from the original document — kept unchanged when you save">{loaded.footer}</div>}
        </div>
      </div>
    </div>
  );
}

/** Page size, margins and base font as CSS (px at 96 dpi; phones override the margins in CSS). */
function pageStyle(d?: { font: string; sizePt: number; page?: typeof DEFAULT_PAGE }): React.CSSProperties {
  const g = d?.page ?? DEFAULT_PAGE, px = (pt: number) => `${Math.round((pt * 96) / 72)}px`;
  return {
    ...(d ? { fontFamily: `'${d.font}', Calibri, Carlito, Arial, sans-serif`, fontSize: `${d.sizePt}pt` } : {}),
    ['--page-w' as string]: px(g.w), ['--page-h' as string]: px(g.h),
    ['--m-top' as string]: px(g.top), ['--m-right' as string]: px(g.right), ['--m-bottom' as string]: px(g.bottom), ['--m-left' as string]: px(g.left),
  };
}

/** Word's "Line and Paragraph Spacing" menu, applied to every selected paragraph and heading. */
function SpacingMenu({ editor }: { editor: Editor }) {
  const set = (attrs: Record<string, unknown>) => editor.chain().focus().updateAttributes('paragraph', attrs).updateAttributes('heading', attrs).run();
  const cur = (editor.getAttributes('paragraph').lineHeight ?? editor.getAttributes('heading').lineHeight) as string | undefined;
  const sel = (k: string) => { const v = editor.getAttributes('paragraph')[k] ?? editor.getAttributes('heading')[k]; return typeof v === 'number' ? v : undefined; };
  return (
    <Menu label="↕" options={[
      ...['1', '1.15', '1.5', '2', '2.5', '3'].map((l) => ({ label: `${cur === l ? '✓ ' : ''}Line spacing ${l}`, action: () => set({ lineHeight: l }) })),
      { label: (sel('spaceBefore') ?? 0) > 0 ? 'Remove space before paragraph' : 'Add space before paragraph', hint: '12 pt', action: () => set({ spaceBefore: (sel('spaceBefore') ?? 0) > 0 ? 0 : 12 }) },
      { label: (sel('spaceAfter') ?? 8) > 0 ? 'Remove space after paragraph' : 'Add space after paragraph', hint: '8 pt', action: () => set({ spaceAfter: (sel('spaceAfter') ?? 8) > 0 ? 0 : 8 }) },
      { label: 'Increase indent', hint: '+0.5 inch', action: () => set({ indentLeft: (sel('indentLeft') ?? 0) + 36 }) },
      { label: 'Decrease indent', action: () => set({ indentLeft: Math.max(0, (sel('indentLeft') ?? 0) - 36) || null }) },
      { label: 'Reset spacing', hint: 'Document default', action: () => set({ lineHeight: null, spaceBefore: null, spaceAfter: null, indentLeft: null }) },
    ]} />
  );
}

function TableMenu({ editor }: { editor: Editor }) {
  const c = () => editor.chain().focus();
  const inTable = editor.isActive('table');
  return (
    <Menu label="▦ Table" options={[
      { label: 'Insert 3×3 table', action: () => { c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
      ...(inTable ? [
        { label: 'Add row below', action: () => { c().addRowAfter().run(); } },
        { label: 'Add column right', action: () => { c().addColumnAfter().run(); } },
        { label: 'Delete row', action: () => { c().deleteRow().run(); } },
        { label: 'Delete column', action: () => { c().deleteColumn().run(); } },
        { label: 'Merge / split cells', action: () => { c().mergeOrSplit().run(); } },
        { label: 'Delete table', action: () => { c().deleteTable().run(); } },
      ] : []),
    ]} />
  );
}
