"""Independently verify the PDFs produced by the native desktop editing walkthrough."""
import json
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
output = root / 'output/pdf'
evidence = root / 'docs/pdf-edit-e2e/evidence'
checks = {}
source = output / 'pdf-edit-e2e-source.pdf'
checks['original untouched'] = source.read_bytes() == (output / 'pdf-edit-e2e-working.pdf').read_bytes()
form = PdfReader(output / 'pdf-edit-e2e-form.pdf', strict=True)
checks['form: edited value persisted'] = form.get_fields()['qa_note']['/V'] == 'Form edit verified'
checks['form: original text retained'] = 'Customer: SAMPLE ORIGINAL' in form.pages[0].extract_text()
for name, customer, annotation in [
    ('edited', 'Customer: EDITED SUCCESSFULLY', False),
    ('final', 'Customer: FINAL VERIFIED', True),
]:
    path = output / f'pdf-edit-e2e-{name}.pdf'
    reader = PdfReader(path, strict=True)
    texts = [page.extract_text() for page in reader.pages]
    text = '\n'.join(texts)
    checks[f'{name}: two pages preserved'] = len(reader.pages) == 2
    checks[f'{name}: replacement exactly once'] = text.count(customer) == 1
    checks[f'{name}: original removed'] = 'SAMPLE ORIGINAL' not in text
    checks[f'{name}: cancelled edit absent'] = 'THIS MUST NOT SAVE' not in text
    checks[f'{name}: unchanged lines preserved'] = all(s in texts[0] for s in [
        'Reference: QA-ORIGINAL-001', 'Unchanged paragraph: preserve this line.', 'Amount: 125.00 EUR'])
    checks[f'{name}: second page and form appearance preserved'] = all(s in texts[1] for s in [
        'Second page content stays intact.', 'Original form value'])
    if annotation:
        checks[f'{name}: added text exactly once'] = text.count('Added annotation verified') == 1
        checks[f'{name}: superseded replacements absent'] = all(s not in text for s in ['EDITED SUCCESSFULLY', 'SECOND EDIT'])
    pdf = pdfium.PdfDocument(str(path))
    for i in range(len(pdf)):
        pdf[i].render(scale=1.5).to_pil().save(str(evidence / f'{name}-page-{i+1}.png'))
    pdf.close()

(evidence / 'independent-verification.json').write_text(json.dumps(checks, indent=2) + '\n')
for name, passed in checks.items():
    print(f'{"PASS" if passed else "FAIL"} {name}')
assert all(checks.values()), 'Saved PDF verification failed'
