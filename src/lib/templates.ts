// Starter templates for "Create new". Each is built natively (real headings/tables/lists in Word,
// real formulas and number formats in Excel, real fillable fields in PDF forms).
import type { DocKind } from './formats';
import type { Workbook } from '../engines/sheet';
import type { Deck, Slide, SlideEl } from '../engines/slides';

export interface Template { id: string; kind: DocKind; title: string; file: string; icon: string; desc: string }

export const TEMPLATES: Template[] = [
  { id: 'doc-blank', kind: 'doc', title: 'Blank document', file: 'Document.docx', icon: '📄', desc: 'Start from scratch' },
  { id: 'doc-letter', kind: 'doc', title: 'Letter', file: 'Letter.docx', icon: '✉️', desc: 'Formal letter layout' },
  { id: 'doc-resume', kind: 'doc', title: 'CV / Resume', file: 'Resume.docx', icon: '👤', desc: 'Experience, education, skills' },
  { id: 'doc-meeting', kind: 'doc', title: 'Meeting notes', file: 'Meeting notes.docx', icon: '🗒️', desc: 'Agenda & action items' },
  { id: 'doc-report', kind: 'doc', title: 'Report', file: 'Report.docx', icon: '📑', desc: 'Summary, findings, recommendations' },
  { id: 'sheet-blank', kind: 'sheet', title: 'Blank workbook', file: 'Workbook.xlsx', icon: '📗', desc: 'Empty spreadsheet' },
  { id: 'sheet-budget', kind: 'sheet', title: 'Monthly budget', file: 'Budget.xlsx', icon: '💰', desc: 'Planned vs actual with totals' },
  { id: 'sheet-invoice', kind: 'sheet', title: 'Invoice', file: 'Invoice.xlsx', icon: '🧾', desc: 'Line items, tax and total' },
  { id: 'sheet-timesheet', kind: 'sheet', title: 'Timesheet', file: 'Timesheet.xlsx', icon: '⏱️', desc: 'Daily hours with weekly total' },
  { id: 'slides-blank', kind: 'slides', title: 'Blank presentation', file: 'Presentation.pptx', icon: '📙', desc: 'Title slide' },
  { id: 'slides-pitch', kind: 'slides', title: 'Pitch deck', file: 'Pitch deck.pptx', icon: '🚀', desc: '8 slides: problem → ask' },
  { id: 'slides-lesson', kind: 'slides', title: 'Lesson', file: 'Lesson.pptx', icon: '🎓', desc: 'Objectives, vocabulary, exercises' },
  { id: 'pdf-blank', kind: 'pdf', title: 'Blank PDF', file: 'Blank.pdf', icon: '📕', desc: 'A4 page to write on' },
  { id: 'pdf-form', kind: 'pdf', title: 'Registration form', file: 'Registration form.pdf', icon: '📝', desc: 'Fillable PDF form' },
];

// ---------------- Word ----------------
const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export function docTemplate(id: string): string {
  switch (id) {
    case 'doc-letter': return `
      <p style="text-align: right"><strong>Your Name</strong><br>Street address<br>City, Postcode<br>email@example.com</p>
      <p>${today()}</p>
      <p>Recipient Name<br>Company<br>Street address<br>City, Postcode</p>
      <p><strong>Subject: Your subject line</strong></p>
      <p>Dear Recipient Name,</p>
      <p>Opening paragraph — state why you are writing.</p>
      <p>Middle paragraph — give the details, facts or background.</p>
      <p>Closing paragraph — say what you would like to happen next and thank the reader.</p>
      <p>Yours sincerely,</p><p><br></p><p>Your Name</p>`;
    case 'doc-resume': return `
      <h1 style="text-align: center">Your Name</h1>
      <p style="text-align: center">City, Country · +000 000 0000 · email@example.com · linkedin.com/in/you</p><hr>
      <h2>Profile</h2><p>Two or three sentences summarising your experience, strengths and what you are looking for.</p>
      <h2>Experience</h2>
      <h3>Job Title — Company</h3><p><em>Month Year – Present · City</em></p>
      <ul><li><p>Achievement with a measurable result (e.g. reduced costs by 20%).</p></li><li><p>Key responsibility or project you led.</p></li></ul>
      <h3>Job Title — Company</h3><p><em>Month Year – Month Year · City</em></p>
      <ul><li><p>Achievement with a measurable result.</p></li></ul>
      <h2>Education</h2><p><strong>Degree, Subject</strong> — University, Year</p>
      <h2>Skills</h2><ul><li><p>Skill · Skill · Skill</p></li><li><p>Languages: English (fluent), German (B1)</p></li></ul>`;
    case 'doc-meeting': return `
      <h1>Meeting notes</h1>
      <table><tbody>
        <tr><th><p>Date</p></th><td><p>${today()}</p></td><th><p>Time</p></th><td><p></p></td></tr>
        <tr><th><p>Location</p></th><td><p></p></td><th><p>Chair</p></th><td><p></p></td></tr>
        <tr><th><p>Attendees</p></th><td colspan="3"><p></p></td></tr>
      </tbody></table>
      <h2>Agenda</h2><ol><li><p>Item one</p></li><li><p>Item two</p></li><li><p>Any other business</p></li></ol>
      <h2>Discussion</h2><p>Key points and decisions.</p>
      <h2>Action items</h2>
      <table><tbody>
        <tr><th><p>Action</p></th><th><p>Owner</p></th><th><p>Due</p></th></tr>
        <tr><td><p></p></td><td><p></p></td><td><p></p></td></tr>
        <tr><td><p></p></td><td><p></p></td><td><p></p></td></tr>
      </tbody></table>`;
    case 'doc-report': return `
      <h1 style="text-align: center">Report Title</h1>
      <p style="text-align: center"><em>Prepared by Your Name · ${today()}</em></p>
      <h2>Executive summary</h2><p>The main conclusion in a few sentences.</p>
      <h2>1. Introduction</h2><p>Purpose, scope and background.</p>
      <h2>2. Findings</h2><ul><li><p>Finding one</p></li><li><p>Finding two</p></li><li><p>Finding three</p></li></ul>
      <h2>3. Recommendations</h2><ol><li><p>Recommendation</p></li><li><p>Recommendation</p></li></ol>
      <h2>4. Conclusion</h2><p>Summary and next steps.</p>`;
    default: return '<h1>Untitled document</h1><p></p>';
  }
}

// ---------------- Excel ----------------
const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF2563EB' } } };
const MONEY = '#,##0.00';

export function sheetTemplate(wb: Workbook, id: string) {
  const ws = wb.worksheets[0];
  const header = (row: number, labels: string[]) => labels.forEach((l, i) => { const c = ws.getCell(row, i + 1); c.value = l; c.font = HEAD.font; c.fill = HEAD.fill; });
  if (id === 'sheet-budget') {
    ws.name = 'Budget';
    ws.getCell('A1').value = 'Monthly budget'; ws.getCell('A1').font = { bold: true, size: 16 };
    header(3, ['Category', 'Planned', 'Actual', 'Difference']);
    const rows = [['Rent / mortgage', 1200, 1200], ['Utilities', 180, 165], ['Groceries', 450, 498], ['Transport', 150, 120], ['Internet & phone', 60, 60], ['Savings', 300, 300], ['Entertainment', 120, 155]];
    rows.forEach((r, i) => { const n = i + 4; ws.getCell(`A${n}`).value = r[0]; ws.getCell(`B${n}`).value = r[1]; ws.getCell(`C${n}`).value = r[2]; ws.getCell(`D${n}`).value = { formula: `B${n}-C${n}` } as never; });
    const t = rows.length + 4;
    ws.getCell(`A${t}`).value = 'Total'; ws.getCell(`A${t}`).font = { bold: true };
    for (const c of ['B', 'C', 'D']) { ws.getCell(`${c}${t}`).value = { formula: `SUM(${c}4:${c}${t - 1})` } as never; ws.getCell(`${c}${t}`).font = { bold: true }; }
    for (let r = 4; r <= t; r++) for (const c of ['B', 'C', 'D']) ws.getCell(`${c}${r}`).numFmt = MONEY;
    ws.getColumn(1).width = 22; [2, 3, 4].forEach((c) => (ws.getColumn(c).width = 13));
  } else if (id === 'sheet-invoice') {
    ws.name = 'Invoice';
    ws.getCell('A1').value = 'INVOICE'; ws.getCell('A1').font = { bold: true, size: 20, color: { argb: 'FF2563EB' } };
    ws.getCell('A3').value = 'Your Company'; ws.getCell('A3').font = { bold: true };
    ws.getCell('A4').value = 'Address · email@example.com';
    ws.getCell('C3').value = 'Invoice #'; ws.getCell('D3').value = 'INV-0001';
    ws.getCell('C4').value = 'Date'; ws.getCell('D4').value = new Date().toISOString().slice(0, 10);
    ws.getCell('A6').value = 'Bill to:'; ws.getCell('A6').font = { bold: true }; ws.getCell('A7').value = 'Client name';
    header(9, ['Description', 'Qty', 'Unit price', 'Amount']);
    const items = [['Consulting (hours)', 10, 75], ['Design work', 1, 450], ['Hosting (month)', 3, 20]];
    items.forEach((it, i) => { const n = i + 10; ws.getCell(`A${n}`).value = it[0]; ws.getCell(`B${n}`).value = it[1]; ws.getCell(`C${n}`).value = it[2]; ws.getCell(`D${n}`).value = { formula: `B${n}*C${n}` } as never; });
    const last = 9 + items.length + 3; // leave 3 empty lines for more items
    ws.getCell(`C${last + 1}`).value = 'Subtotal'; ws.getCell(`D${last + 1}`).value = { formula: `SUM(D10:D${last})` } as never;
    ws.getCell(`B${last + 2}`).value = 0.075; ws.getCell(`B${last + 2}`).numFmt = '0.0%';
    ws.getCell(`C${last + 2}`).value = 'Tax'; ws.getCell(`D${last + 2}`).value = { formula: `D${last + 1}*B${last + 2}` } as never;
    ws.getCell(`C${last + 3}`).value = 'TOTAL'; ws.getCell(`C${last + 3}`).font = { bold: true };
    ws.getCell(`D${last + 3}`).value = { formula: `D${last + 1}+D${last + 2}` } as never; ws.getCell(`D${last + 3}`).font = { bold: true };
    for (let r = 10; r <= last + 3; r++) { ws.getCell(`C${r}`).numFmt = MONEY; ws.getCell(`D${r}`).numFmt = MONEY; }
    ws.getColumn(1).width = 30; [2, 3, 4].forEach((c) => (ws.getColumn(c).width = 14));
  } else if (id === 'sheet-timesheet') {
    ws.name = 'Timesheet';
    ws.getCell('A1').value = 'Weekly timesheet'; ws.getCell('A1').font = { bold: true, size: 16 };
    ws.getCell('A2').value = 'Name:'; ws.getCell('C2').value = 'Week of:';
    header(4, ['Day', 'Start (h)', 'End (h)', 'Break (h)', 'Hours']);
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach((d, i) => {
      const n = i + 5, work = i < 5;
      ws.getCell(`A${n}`).value = d;
      if (work) { ws.getCell(`B${n}`).value = 9; ws.getCell(`C${n}`).value = 17.5; ws.getCell(`D${n}`).value = 0.5; }
      ws.getCell(`E${n}`).value = { formula: `C${n}-B${n}-D${n}` } as never;
    });
    ws.getCell('D12').value = 'Total'; ws.getCell('D12').font = { bold: true };
    ws.getCell('E12').value = { formula: 'SUM(E5:E11)' } as never; ws.getCell('E12').font = { bold: true };
    ws.getColumn(1).width = 14;
  }
}

// ---------------- PowerPoint ----------------
let k = 0;
const el = (p: Partial<SlideEl>): SlideEl => ({ id: `t${++k}`, kind: 'text', x: 60, y: 40, w: 840, h: 70, fontSize: 20, color: '#111827', align: 'left', ...p });
const titled = (title: string, body: string, accent = '#2563EB'): Slide => ({
  id: `s${++k}`, bg: '#FFFFFF', els: [
    el({ kind: 'shape', x: 0, y: 0, w: 960, h: 8, fill: accent, text: '' }),
    el({ y: 36, text: title, fontSize: 34, bold: true }),
    el({ y: 130, h: 360, text: body, fontSize: 22, color: '#374151' }),
  ],
});
const cover = (title: string, sub: string, bg: string): Slide => ({
  id: `s${++k}`, bg, els: [
    el({ y: 180, h: 100, text: title, fontSize: 48, bold: true, color: '#FFFFFF', align: 'center' }),
    el({ y: 300, h: 60, text: sub, fontSize: 24, color: '#DBEAFE', align: 'center' }),
  ],
});

export function deckTemplate(id: string): Deck | null {
  if (id === 'slides-pitch') return {
    width: 960, height: 540, structureChanged: true, slides: [
      cover('Company Name', 'One line that explains what you do', '#1E3A8A'),
      titled('The problem', '• Who has the problem?\n• How painful / costly is it?\n• How is it solved today?'),
      titled('Our solution', '• What you built\n• Why it is 10× better\n• Screenshot or demo'),
      titled('Market', '• Total addressable market\n• Target segment\n• Why now'),
      titled('Business model', '• How you make money\n• Pricing\n• Unit economics'),
      titled('Traction & roadmap', '• Key metrics so far\n• Next 6 months\n• Next 18 months'),
      titled('Team', '• Founder — background\n• Co-founder — background\n• Advisors'),
      cover('Thank you', 'Contact · email@example.com', '#1E3A8A'),
    ],
  };
  if (id === 'slides-lesson') return {
    width: 960, height: 540, structureChanged: true, slides: [
      cover('Lesson title', 'Course · Level · Date', '#0F766E'),
      titled('Learning objectives', 'By the end of this lesson you can:\n• Objective one\n• Objective two\n• Objective three', '#0F766E'),
      titled('Vocabulary', '• word — meaning\n• word — meaning\n• word — meaning\n• word — meaning', '#0F766E'),
      titled('Grammar', 'Rule explained simply\n\nExample 1\nExample 2', '#0F766E'),
      titled('Exercise', '1. ______________________\n2. ______________________\n3. ______________________', '#0F766E'),
      titled('Homework', '• Task\n• Due date', '#0F766E'),
    ],
  };
  return null;
}

// ---------------- PDF ----------------
export async function pdfTemplate(id: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  if (id !== 'pdf-form') return doc.save();
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  page.drawRectangle({ x: 0, y: 781.89, width: 595.28, height: 60, color: rgb(0.15, 0.39, 0.92) });
  page.drawText('Registration form', { x: 50, y: 803, size: 24, font: b, color: rgb(1, 1, 1) });
  page.drawText('Please complete all fields and save or print this form.', { x: 50, y: 750, size: 11, font: f, color: rgb(0.3, 0.3, 0.3) });
  let y = 700;
  const label = (t: string) => page.drawText(t, { x: 50, y: y + 6, size: 11, font: b, color: rgb(0.1, 0.1, 0.1) });
  const text = (name: string, t: string, multiline = false) => {
    label(t);
    const h = multiline ? 70 : 22;
    const tf = form.createTextField(name);
    if (multiline) tf.enableMultiline();
    tf.addToPage(page, { x: 180, y: y - h + 22, width: 365, height: h, font: f, borderColor: rgb(0.7, 0.74, 0.8), borderWidth: 1 });
    y -= h + 18;
  };
  text('full_name', 'Full name'); text('email', 'Email'); text('phone', 'Phone'); text('dob', 'Date of birth');
  label('Course');
  const dd = form.createDropdown('course');
  dd.addOptions(['German A1', 'German A2', 'German B1', 'German B2', 'English', 'French']);
  dd.select('German A1');
  dd.addToPage(page, { x: 180, y, width: 200, height: 22, font: f, borderColor: rgb(0.7, 0.74, 0.8), borderWidth: 1 });
  y -= 40;
  label('Preferred time');
  const times = ['Morning', 'Afternoon', 'Evening'];
  times.forEach((t, i) => {
    const cb = form.createCheckBox(`time_${t.toLowerCase()}`);
    cb.addToPage(page, { x: 180 + i * 110, y: y + 2, width: 16, height: 16, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 1 });
    page.drawText(t, { x: 202 + i * 110, y: y + 6, size: 11, font: f });
  });
  y -= 40;
  text('notes', 'Notes', true);
  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 50, y: y + 2, width: 16, height: 16, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 1 });
  page.drawText('I agree to the terms and conditions.', { x: 74, y: y + 6, size: 11, font: f });
  y -= 50;
  label('Signature'); page.drawLine({ start: { x: 180, y: y }, end: { x: 400, y: y }, thickness: 0.8, color: rgb(0.4, 0.4, 0.4) });
  page.drawText('Date', { x: 420, y: y + 6, size: 11, font: b });
  page.drawLine({ start: { x: 455, y }, end: { x: 545, y }, thickness: 0.8, color: rgb(0.4, 0.4, 0.4) });
  form.updateFieldAppearances(f);
  return doc.save();
}
