# Image to Word quality review

7 November 2026. Release status: **HOLD** for faithful editable conversion of complex scanned worksheets.

The supplied three-page worksheet contains tables, checkboxes, illustrations, two-column questions and handwriting. The supplied editable DOCX contains no embedded media and renders as six pages in bundled LibreOffice. Text extends off the page, diagrams become OCR noise, table structure is lost, and some questions are interleaved across columns. Private source images and generated documents remain in local ignored QA storage; they are not public test fixtures.

## Findings

| Finding | Cause | Current status |
| --- | --- | --- |
| Illustrations and source handwriting disappear in editable export | OCR layout path emits text paragraphs only; original image is discarded | Original images included by default in the reviewed OCR workflow; this preserves evidence, not editable artwork |
| Complex worksheets are described as preserving layout | Product labels promise more than the paragraph-based OCR reconstruction implements | Labels and README corrected; a side-by-side source/text review precedes OCR export |
| Portrait/tall images can exceed the Word page and page boundaries are fragile | Width-only image limit, implicit paper size and separate break-only paragraphs | Explicit A4 portrait/landscape sections; image constrained to both usable page axes; no break-only paragraphs |
| OCR misreads drawings, handwriting and checkboxes; column questions merge | Recognition and document segmentation limitations | **Unresolved**; editable draft requires manual review. No recognition-accuracy improvement is claimed by the workflow change |
| Existing QA passes despite unusable complex output | Mostly structural/simple text assertions; insufficient real-document visual coverage | Dedicated regression suite plus source-to-DOCX render inspection added |

## Implemented locally

Home and the image editor now distinguish image-based appearance preservation from editable OCR. Reviewed OCR shows the source beside editable per-page text, reports low-confidence word counts, keeps corrections across page navigation, and retains the review draft if saving is cancelled. Originals are included by default, with an explicit text-only option. OCR text starts on a separate, labeled page and uses consistent readable type rather than sizes inferred from illustration noise. Source files are never overwritten by these exports.

The source pane also supports writing directly on the worksheet: add text or crosses, choose colour/size/answer width, drag the selected answer's handle or move it with arrow keys, delete, and undo/redo per page. Positions are stored relative to the image so display resizing does not move answers. Exports retain the source image and add transparent native Word text boxes for the answers. Annotated source pages cannot be excluded accidentally through text-only export. These tools add answers over a scan; existing printed text and diagrams remain image content. Annotation work is held in the open review; export before closing it.

Annotated exports include a local worksheet project inside the DOCX, referencing its existing embedded images rather than duplicating them. Reopening that file in Docaville routes it to worksheet tools and restores answers and reviewed OCR text; it bypasses the general rich-text importer, which does not retain floating-box geometry. A document fingerprint prevents restoring stale editing data over external Word changes. If the editing part was removed or the main document changed externally, Docaville reports the incompatibility and leaves the file untouched. The ordinary Word serialization path also rejects worksheet documents instead of silently dropping answers. Ordinary saved-byte updates do not remount a rich-text editor with older content.

Image batches normalize source files sequentially, preserving each file's frame order and limiting simultaneous decoding. PNG and JPEG bytes are still embedded without recompression. Image pages use orientation appropriate to each source. Text pages are intentionally separate and may increase total page count.

## Verification

- TypeScript and production build pass.
- Existing engine smoke checks: 26/26 pass.
- Existing document regression checks: 49/49 pass.
- Existing productivity/reader checks: 30/30 pass.
- New image-to-Word suite: 11/11 repeatable checks pass, plus a private real-input conversion check using all three supplied images. These establish export/review behavior, not OCR accuracy. New checks cover direct placement, typed answers, pointer/keyboard movement, undo, deletion, navigation persistence, original-image preservation, native Word text boxes, export/reopen/edit/export, stale-data rejection, and ordinary editor save continuity.
- Synthetic portrait, landscape, very tall and square inputs: four rendered pages inspected, with top/bottom markers and borders visible, correct orientation and source order.
- Two additional annotated synthetic pages (portrait and landscape) rendered and inspected: red Unicode answers and green crosses appear at their image-relative positions; the background remains visible and pagination is unchanged. Physical pointer/touch and Microsoft Word client acceptance remain pending.
- Actual appearance-preserving output: exactly three rendered pages, all visually inspected; illustrations, handwriting and source layout remain visible. Embedded source bytes are unchanged.
- Actual original-plus-OCR output: six rendered pages, all inspected. Image pages preserve source content; text pages fit but contain uncorrected recognition errors and merged columns. This is a review draft, not an accepted faithful editable conversion.
- Cancelled-save and corrected-text export tested through an isolated mounted React review component and a controlled file-picker adapter. No claim of full native picker, physical-mobile or Microsoft Word acceptance is made.

Run `npm run test:image-word` for synthetic checks. Optional image-file arguments exercise actual OCR locally; outputs are written only under ignored `tmp/image-word-qa`. The desktop CI verification workflow includes the synthetic suite. The local checks above do not certify new CI or packaged binaries.

## Gates before release

Faithful editable conversion needs a document-layout solution that distinguishes figures from text, recognizes tables/checkboxes, and retains reading order across mixed columns. Review against a consented corpus covering these features, handwriting, multiple languages and scan qualities. Accept only after content completeness, reading order, visual layout and edit/save/reopen pass in supported Word clients and native apps. Define and enforce large-batch limits with real-device memory tests. Until then, do not advertise scanned worksheets as retaining editable layout or treat image-only preservation as equivalent to editable conversion.
