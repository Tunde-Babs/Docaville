import { useEffect, useState } from 'react';
import { localRead, localWrite } from '../lib/localStore';
import { escapeHtml, textHtml } from '../engines/documentTools';
import { Btn, FilePick, run } from './ui';
import { saveFile } from '../lib/fileio';
interface BusinessProfile { company: string; address: string; email: string; phone: string; color: string; logo: string }
interface PersonalTemplate { id: string; name: string; html: string }
const DEFAULT_PROFILE: BusinessProfile = { company: '', address: '', email: '', phone: '', color: '#4f46e5', logo: '' };
const STARTERS: PersonalTemplate[] = [
  { id: 'business-letter', name: 'Client letter', html: '<h1>{{subject}}</h1><p>Dear {{customer}},</p><p>{{message}}</p><p>Kind regards,</p><p>{{company}}</p>' },
  { id: 'business-report', name: 'Client report', html: '<h1>{{title}}</h1><p>Prepared for {{customer}} · {{date}}</p><h2>Summary</h2><p>{{summary}}</p><h2>Findings</h2><p>{{findings}}</p><h2>Recommendations</h2><p>{{recommendations}}</p>' },
  { id: 'business-proposal', name: 'Proposal', html: '<h1>Proposal: {{project}}</h1><p>Prepared for {{customer}} · {{date}}</p><h2>Scope</h2><p>{{scope}}</p><h2>Deliverables</h2><p>{{deliverables}}</p><h2>Timeline</h2><p>{{timeline}}</p><h2>Fee</h2><p>{{fee}}</p>' },
];
export const templateFields = (html: string) => [...new Set([...html.matchAll(/\{\{\s*([\w .-]+)\s*\}\}/g)].map(m => m[1].trim()))];
export function fillTemplate(html: string, values: Record<string, string>) { return html.replace(/\{\{\s*([\w .-]+)\s*\}\}/g, (_, field: string) => escapeHtml(values[field.trim()] ?? '').replace(/\n/g, '<br>')); }
export default function TemplateStudio({ createDocument }: { createDocument: (name: string, html: string) => void }) {
  const [profile, setProfile] = useState<BusinessProfile>(DEFAULT_PROFILE), [custom, setCustom] = useState<PersonalTemplate[]>([]), [selected, setSelected] = useState(STARTERS[0]), [values, setValues] = useState<Record<string, string>>({ date: new Date().toLocaleDateString() });
  const [name, setName] = useState('My template'), [body, setBody] = useState('Dear {{customer}},\n\n{{message}}\n\nKind regards,\n{{company}}'), [status, setStatus] = useState('');
  useEffect(() => { Promise.all([localRead<BusinessProfile>('business-profile'), localRead<PersonalTemplate[]>('personal-templates')]).then(([p, t]) => { if (p) setProfile(p); setCustom(t ?? []); }).catch(error => setStatus(String(error))); }, []);
  const merged = { ...profile, ...values, company: profile.company }, fields = templateFields(selected.html).filter(field => !['company', 'address', 'email', 'phone'].includes(field));
  const html = `${profile.logo ? `<p><img src="${profile.logo}" width="120"></p>` : ''}<h2 style="color:${profile.color}">${escapeHtml(profile.company)}</h2>${textHtml([profile.address, profile.email, profile.phone].filter(Boolean).join('\n'))}<hr>${fillTemplate(selected.html, merged)}`;
  return <div className="tool-content"><h2>Business templates and autofill</h2><p>Keep your business details on this device, reuse templates, and create editable documents with consistent branding.</p>
    <details open><summary>Business profile</summary><div className="form-grid">{(['company', 'address', 'email', 'phone'] as const).map(field => <label key={field}>{field[0].toUpperCase() + field.slice(1)}<input value={profile[field]} onChange={e => setProfile(p => ({ ...p, [field]: e.target.value }))} /></label>)}<label>Brand colour <input type="color" value={profile.color} onChange={e => setProfile(p => ({ ...p, color: e.target.value }))} /></label></div>
      <div className="row wrap"><FilePick accept="image/png,image/jpeg" onFiles={files => run('Loading logo…', async () => { if (files[0].size > 2 * 1024 * 1024) throw new Error('Choose a logo smaller than 2 MB.'); const reader = new FileReader(); reader.onload = () => setProfile(p => ({ ...p, logo: reader.result as string })); reader.readAsDataURL(files[0]); })}>Choose logo</FilePick><Btn disabled={!profile.logo} onClick={() => setProfile(p => ({ ...p, logo: '' }))}>Remove logo</Btn><Btn onClick={() => run('Saving business profile…', async () => { await localWrite('business-profile', profile); setStatus('Business profile saved locally.'); })}>Save profile</Btn></div></details>
    <h3>Choose a template</h3><div className="row wrap">{[...STARTERS, ...custom].map(template => <Btn key={template.id} active={selected.id === template.id} onClick={() => setSelected(template)}>{template.name}</Btn>)}</div>
    <div className="form-grid">{fields.map(field => <label key={field}>{field}<textarea value={values[field] ?? ''} onChange={e => setValues(v => ({ ...v, [field]: e.target.value }))} /></label>)}</div>
    <p className="muted">Empty fields will be blank in the document. Review them before sending.</p>
    <div className="row wrap"><Btn primary onClick={() => createDocument(selected.name, html)}>Create branded document</Btn><Btn onClick={() => saveFile(`${selected.name}-template.json`, JSON.stringify(selected, null, 2))}>Export template</Btn>
      {custom.some(t => t.id === selected.id) && <Btn onClick={() => run('Removing template…', async () => { const next = custom.filter(t => t.id !== selected.id); await localWrite('personal-templates', next); setCustom(next); setSelected(STARTERS[0]); })}>Remove custom template</Btn>}</div>
    <h3>Create or import a reusable template</h3><label>Template name <input value={name} onChange={e => setName(e.target.value)} /></label><p>Use placeholders such as {'{{customer}}'}, {'{{project}}'}, and {'{{company}}'}.</p><textarea className="large-input" aria-label="Template text" value={body} onChange={e => setBody(e.target.value)} />
    <div className="row wrap"><Btn disabled={!name.trim() || !body.trim()} onClick={() => run('Saving template…', async () => { const template = { id: crypto.randomUUID(), name: name.trim(), html: textHtml(body) }; const next = [...custom, template]; await localWrite('personal-templates', next); setCustom(next); setSelected(template); })}>Save reusable template</Btn>
      <FilePick accept=".docx,.json" onFiles={files => run('Importing template…', async () => {
        let template: PersonalTemplate;
        if (/\.docx$/i.test(files[0].name)) template = { id: crypto.randomUUID(), name: files[0].name.replace(/\.docx$/i, ''), html: (await (await import('../engines/docxImport')).importDocx(new Uint8Array(await files[0].arrayBuffer()))).html };
        else { const value = JSON.parse(await files[0].text()); if (typeof value.name !== 'string' || typeof value.html !== 'string') throw new Error('Invalid template file.'); const doc = new DOMParser().parseFromString(value.html, 'text/html'); doc.querySelectorAll('script,iframe,object,embed,link,style').forEach(el => el.remove()); doc.querySelectorAll('*').forEach(el => [...el.attributes].forEach(attr => { if (/^on/i.test(attr.name) || /javascript:/i.test(attr.value)) el.removeAttribute(attr.name); })); template = { id: crypto.randomUUID(), name: value.name, html: doc.body.innerHTML }; }
        const next = [...custom, template]; await localWrite('personal-templates', next); setCustom(next); setSelected(template);
      })}>Import DOCX or template file</FilePick></div><p role="status">{status}</p>
  </div>;
}
