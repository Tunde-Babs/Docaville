"""Synthetic native-UI PDF editing fixture; uses ReportLab and PDFium as independent oracles."""
from pathlib import Path
import shutil
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
output = root / 'output/pdf'
evidence = root / 'docs/pdf-edit-e2e/evidence'
output.mkdir(parents=True, exist_ok=True)
evidence.mkdir(parents=True, exist_ok=True)
source = output / 'pdf-edit-e2e-source.pdf'
c = canvas.Canvas(str(source), pagesize=(600, 400))
c.setTitle('Synthetic PDF editing QA')
c.setFillColor(HexColor('#1e3a5f'))
c.setFont('Helvetica-Bold', 24)
c.drawString(44, 350, 'PDF Editing End-to-End QA')
c.setFillColor(HexColor('#111827'))
for size, y, text in [
    (18, 290, 'Customer: SAMPLE ORIGINAL'),
    (16, 245, 'Reference: QA-ORIGINAL-001'),
    (14, 195, 'Unchanged paragraph: preserve this line.'),
    (16, 145, 'Amount: 125.00 EUR'),
    (10, 40, 'Synthetic test data only - page 1 of 2'),
]:
    c.setFont('Helvetica', size)
    c.drawString(44, y, text)
c.showPage()
c.setFont('Helvetica-Bold', 24)
c.drawString(44, 350, 'Second page - original')
c.setFont('Helvetica', 16)
c.drawString(44, 290, 'Second page content stays intact.')
c.acroForm.textfield(name='qa_note', value='Original form value', x=44, y=210,
                     width=280, height=28, fontName='Helvetica', fontSize=12, forceBorder=True)
c.setFont('Helvetica', 10)
c.drawString(44, 40, 'Synthetic test data only - page 2 of 2')
c.save()
shutil.copyfile(source, output / 'pdf-edit-e2e-working.pdf')
pdf = pdfium.PdfDocument(str(source))
for i in range(len(pdf)):
    pdf[i].render(scale=1.5).to_pil().save(str(evidence / f'source-page-{i+1}.png'))
print(source)
