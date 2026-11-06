# DocumentHub: exploratory QA and product readiness review

**Assessment date:** 6 November 2026, Europe/Berlin  
**Product:** DocumentHub 1.0.0, installed macOS Apple Silicon build  
**Release recommendation:** **Do not launch as a paid general-purpose office suite yet.**

**Remediation update:** The findings below describe the original 1.0.0 assessment. See [the 1.0.1 fix and verification report](fix-report.md) for implemented fixes, evidence and remaining release work.

The application has a useful foundation: a coherent home screen, practical templates, multiple editors, native save dialogs, and working OCR. However, this session found failures that undermine the central promise of a document product: users must be able to trust that their work is saved accurately and that exporting or editing a document does not silently lose information.

**18 distinct reproducible defects are recorded below: 1 critical, 9 high, and 8 medium.** Some are documented limitations; they remain relevant because the current user flow silently produces incomplete output. Recommendations and unverified risks are separated from confirmed defects.

## Scope, method and confidence

- **Live exploratory testing:** `/Applications/DocumentHub.app`, macOS 26.6.2, arm64. Explored home/templates, spreadsheet editing and saving, Word opening and saving, PDF rotation and undo, slide creation and history, image rotation and OCR, native close protection, and popup menus.
- **Baseline checks:** TypeScript checking passed. The existing `npm test` smoke suite passed **26/26** checks. Electron initially could not start in the filesystem sandbox; running the same suite with approved local process access succeeded.
- **Additional engine exploration:** **22 focused assertions: 5 passed, 17 failed.** Correlated assertions are grouped into defects rather than counted as separate bugs. These were deliberately selected edge cases, so the failure ratio is **not** an estimate of the whole application's reliability.
- **Build identity:** All 33 comparable packaged `dist` files matched the workspace `dist` files by SHA-256. Installed and workspace `electron/main.cjs` also matched. Package metadata differed, as can happen during packaging. The engine probes exercised workspace source; each finding below identifies whether it was reproduced through the installed UI or through the engine. This is not a claim that the full test matrix ran against the installed binary.
- **Test data:** Synthetic files only. No user document was intentionally edited. Application implementation files were not changed; the deliverables are this report, diagnostic probes, synthetic fixtures and evidence.
- **Not covered:** Windows, Intel Mac, physical iOS/Android devices, other browsers, real printers, fresh-machine installation/Gatekeeper, crash recovery, disk-full/permission failures, simultaneous external edits, large-file stress, encrypted documents, adversarial file fuzzing, full assistive-technology testing, and commercial billing/licensing. No penetration-test or compliance certification is implied.

Severity reflects user impact. Priority reflects suggested scheduling: **P0** before broader beta; **P1** before paid release for the affected advertised workflow; **P2** usability/consistency work to schedule before general availability where practical. All defects are open; no fixes were attempted.

## Confirmed defect register

### B01 — Covered PDF text remains recoverable

**Critical · P0 · Engine reproduction**

**Steps:** Generate an ordinary text PDF, apply an opaque Cover rectangle over `SECRET-QA-123`, save, then decode all streams in the saved PDF. Separately, repeat with text inside an embedded PDF page, a Form XObject.

**Expected:** If Cover/Edit text is presented as removing the underlying text, removed content must not remain recoverable in the delivered file. Unsupported content should block that guarantee and explain the limitation.

**Actual:** Ordinary covered text disappears from normal PDF text extraction, but its original encoded text remains in saved stream **`6 0 R`**. For a Form XObject, the secret remains discoverable through normal text extraction as well. This is more serious than a visual rendering issue. The earlier smoke test checks extraction, which does not detect the orphan-stream case.

**Impact:** A user may distribute a file believing information was removed. The UI calls the tool “Cover”; the README and code additionally claim removal of underlying text. Those stronger claims are not currently supported.

**Evidence:** [ordinary-covered.pdf](fixtures/ordinary-covered.pdf), [recovered decoded stream](evidence/pdf-recovered-streams.json), [xobject-covered.pdf](fixtures/xobject-covered.pdf), [engine results](evidence/engine-results.json). Relevant code: [`pdfRedact.ts`](../../src/engines/pdfRedact.ts), [`pdf.ts:117`](../../src/engines/pdf.ts#L117).

**Acceptance:** Independently verify rendered output, extraction, all decoded saved objects, nested XObjects, images and form fields; do not silently succeed when sanitization is incomplete. Rebuilding/garbage-collecting unreachable objects and recursively handling supported objects need explicit validation.

### B02 — Cmd+S reports success while saving the previous spreadsheet value

**High · P0 · Installed UI + on-disk verification**

**Steps:** Open Monthly budget, select B4, change it to `9999` and save. Edit B4 again to `7777`; press Cmd+S while the cell input is still active, without Enter or clicking elsewhere.

**Expected:** Save commits the pending edit and writes `7777`.

**Actual:** The app displays “Saved budget-formula-save.xlsx,” while the file still contains **`9999`**. The pending `7777` remains visible in the editor. Clicking the Save button after blur did commit the value in the earlier control check.

**Evidence:** [disk result](evidence/keyboard-save-result.json), [screenshot](evidence/keyboard-save-pending-value.png), [saved workbook](fixtures/budget-formula-save.xlsx). Relevant code: [`useSave.ts:30`](../../src/components/useSave.ts#L30), [`SheetEditor.tsx:118`](../../src/editors/SheetEditor.tsx#L118).

**Acceptance:** Save, Save As, export, print and close-with-save must all serialize the latest active edit. Test keyboard and toolbar paths separately, including cancelled dialogs.

### B03 — Stale cached formula results hide current calculation errors

**High · P0 · Engine reproduction**

**Steps:** Set A1=10, A2=20 and D1 to formula `A1/A2` with cached result `0.5`. Change A2 to 0, then display D1 and evaluate `D1*100`.

**Expected:** D1 and its dependants reflect the current division-by-zero error.

**Actual:** D1 still displays **0.5** and the dependent expression returns **50**. Fallback to cached values applies to calculation errors, not just unsupported functions.

**Evidence:** [engine results](evidence/engine-results.json). Relevant code: [`sheet.ts:131`](../../src/engines/sheet.ts#L131), [`sheet.ts:337`](../../src/engines/sheet.ts#L337).

**Acceptance:** Propagate current calculation errors. If an unsupported calculation uses a cached result, label it as cached and potentially outdated after inputs change; never present it as a verified live result.

### B04 — Inserting a row leaves formulas pointing at the wrong cells

**High · P1 · Engine reproduction of the UI's splice operation**

**Steps:** Put 10, 20, 30 in A1:A3 and `SUM(A1:A3)` in B1. Insert a row at row 1 using the same `spliceRows` operation as “+ Row.”

**Expected:** Moved formula B2 references A2:A4 and stays 60.

**Actual:** B2 remains `SUM(A1:A3)` and becomes **30**.

**Evidence:** [structural-formulas.xlsx](fixtures/structural-formulas.xlsx). Relevant code: [`SheetEditor.tsx:193`](../../src/editors/SheetEditor.tsx#L193).

**Acceptance:** Update dependent references on row/column insertion and deletion, including absolute/mixed references and references from other sheets. Only row insertion was dynamically demonstrated here; the other operations require regression coverage.

### B05 — Renaming a worksheet breaks dependent formulas

**High · P1 · Engine reproduction of the rename mutation**

**Steps:** Create `Data` with A1=10 and A2=20; in `Calc`, enter `Data!A1+Data!A2`. Rename `Data` to `Renamed`.

**Expected:** Dependent formula references update and continue showing 30.

**Actual:** The dependent value becomes **`#REF!`** because the formula retains the old sheet name.

**Evidence:** [engine results](evidence/engine-results.json). Relevant code: [`SheetEditor.tsx:137`](../../src/editors/SheetEditor.tsx#L137).

**Acceptance:** Rename references transactionally across the workbook, including quoted names, and make the operation undoable.

### B06 — Saving a DOCX removes hyperlinks

**High · P1 · Installed UI + ZIP inspection; engine confirmation**

**Steps:** Open the generated DOCX containing “Visit QA site” linked to `https://example.com/qa`. Click Save, even without editing the body. Inspect the resulting DOCX package.

**Expected:** Link text and its destination remain functional.

**Actual:** The saved file contains neither the hyperlink element nor its destination relationship. Import renders link-like text but does not preserve a real anchor; export also ignores a link mark supplied directly.

**Evidence:** [original](fixtures/header-hyperlink-original.docx), [UI-saved copy](fixtures/header-hyperlink-ui-saved.docx), [inspection result](evidence/word-ui-save-result.json). Relevant code: [`docxImport.ts:161`](../../src/engines/docxImport.ts#L161), [`docx.ts:61`](../../src/engines/docx.ts#L61).

**Acceptance:** Preserve internal and external link destinations on open/edit/save and export; include URLs, email links and bookmarks in round-trip fixtures.

### B07 — Multiple Word sections collapse to one on save

**High · P1 · Engine reproduction**

**Steps:** Export the body of the two-section fixture using the original DOCX as the preservation source.

**Expected:** Both section boundaries and their page settings survive.

**Actual:** The source contains **2** `sectPr` elements; output contains **1**. The preservation logic takes only the last section properties. This contradicts a broad interpretation of section/page setup preservation. Full section fidelity is already mentioned as a README limitation, but saving still proceeds without an in-product warning.

**Evidence:** [before](fixtures/two-sections.docx), [after](fixtures/two-sections-after.docx). Relevant code: [`docx.ts:206`](../../src/engines/docx.ts#L206).

**Acceptance:** Preserve section positions and distinct properties, or identify the unsupported structure before overwriting and offer a clearly labelled converted copy.

### B08 — Word vector PDF export omits visible headers and footers

**High · P1 · Engine reproduction + installed UI observation**

**Steps:** Open `header-hyperlink.docx`; the editor visibly displays `CONFIDENTIAL HEADER` and `QA FOOTER`. Produce the vector PDF through the export engine used by the standard PDF export/print path.

**Expected:** The exported document includes the visible header/footer content.

**Actual:** The vector PDF has body text only. Header/footer content is not passed into `richTextToPdf`. The separate “PDF (print engine)” option was not validated for this fixture.

**Evidence:** [visible editor](evidence/word-header-visible.png), [vector PDF](fixtures/header-export.pdf). Relevant code: [`DocEditor.tsx`](../../src/editors/DocEditor.tsx), [`layoutPdf.ts:195`](../../src/engines/layoutPdf.ts#L195).

**Acceptance:** Include headers, footers, repeating elements and page numbering in the supported PDF/print path, and compare exported pages visually as well as by text.

### B09 — PDF generation silently replaces international text with question marks

**High · P1 · Engine reproduction; documented limitation**

**Steps:** Export `Ẹ káàárọ̀ — Привет — 你好 — مرحبا` as vector PDF.

**Expected:** Supported user text is preserved; unsupported glyphs are identified before export.

**Actual:** Cyrillic, Chinese, Arabic and some Yoruba characters/marks are replaced with `?`. The same sanitization helper is also used for PDF overlays and form values; those additional paths were identified in source, not separately demonstrated here.

**Evidence:** [unicode.pdf](fixtures/unicode.pdf). Relevant code: [`pdf.ts:56`](../../src/engines/pdf.ts#L56).

**Acceptance:** Embed fonts with necessary glyph coverage and validate shaping/direction for complex scripts. Do not silently substitute missing glyphs. README disclosure alone is insufficient during a successful-looking export.

### B10 — CSV export loses stored numeric precision

**Medium · P1 · Engine reproduction**

**Steps:** Store `1234.56789` in A1 with display format `#,##0.00`; export CSV and import it again.

**Expected:** Default data export preserves the underlying value, or explicitly offers a formatted-display export.

**Actual:** Export uses display strings; re-import yields **1234.57**.

**Evidence:** [CSV](fixtures/numeric-roundtrip.csv). Relevant code: [`sheet.ts:94`](../../src/engines/sheet.ts#L94).

**Acceptance:** Separate raw-value and formatted-display CSV modes; default to preserving data. Verify decimal precision, dates, percentages, separators and locale round trips.

### B11 — CSV import trims meaningful quoted whitespace

**Medium · P2 · Engine reproduction**

**Steps:** Import CSV containing a quoted value `"  keep spaces  "`.

**Expected:** Preserve the field's content.

**Actual:** The stored value is `keep spaces`; leading/trailing spaces disappear. Leading zeros in `00123` did survive the control test.

**Evidence:** [engine results](evidence/engine-results.json). Relevant code: [`sheet.ts:19`](../../src/engines/sheet.ts#L19).

**Acceptance:** Preserve textual field content; use separate trimmed copies only for explicitly selected type inference.

### B12 — Undo on Home changes an inactive PDF

**High · P1 · Installed UI reproduction**

**Steps:** Create Blank PDF, rotate right once, switch to Home, press Cmd+Z, then return to the PDF.

**Expected:** Home does not alter a hidden document's history.

**Actual:** The PDF's rotation is undone and its Undo control is disabled. Its global key listener runs while the editor is hidden. Multiple open PDFs could be affected; that extension was not separately tested.

**Evidence:** [AX capture](evidence/hidden-pdf-undo.ax.txt). Relevant code: [`PdfEditor.tsx:58`](../../src/editors/PdfEditor.tsx#L58).

**Acceptance:** Only the active editor handles document shortcuts. Verify two PDFs plus another editor, and ensure Shift+Cmd+Z performs redo rather than undo.

### B13 — Worksheet management popup opens outside the visible window

**Medium · P1 · Installed UI reproduction**

**Steps:** Create a workbook and click the bottom `⋯` sheet button at the normal window size.

**Expected:** Rename/move/delete options are visible and reachable.

**Actual:** Options exist in the accessibility tree but render below the bottom edge. The popup only calculates a position below its trigger. This occurs on desktop, not just narrow screens.

**Evidence:** [screenshot](evidence/sheet-menu-offscreen.png). Relevant code: [`ui.tsx:54`](../../src/components/ui.tsx#L54).

**Acceptance:** Flip menus above the trigger when necessary; maintain a usable height and visible focus at all window edges and zoom levels.

### B14 — Add sheet silently fails when its generated name already exists

**Medium · P2 · Installed UI reproduction**

**Steps:** In a blank workbook, rename the sole sheet from `Sheet1` to `Sheet2`, then click `＋`.

**Expected:** Create a sheet with the next available unique name.

**Actual:** No sheet appears and no error is presented. Source generates `Sheet${sheetCount + 1}`, which collides with the existing name.

**Evidence:** [AX capture](evidence/add-sheet-collision.ax.txt). Relevant code: [`SheetEditor.tsx:240`](../../src/editors/SheetEditor.tsx#L240).

**Acceptance:** Generate a case-insensitively unique name, handle errors through the normal error UI, and cover gaps caused by rename/delete operations.

### B15 — Spreadsheet PDF silently truncates long cell content

**Medium · P1 · Engine reproduction**

**Steps:** Put the long business description from the probe in a cell, set wrapText=true, and export PDF.

**Expected:** Preserve all content through wrapping/pagination or show a preview and explicit clipping choice.

**Actual:** Column width is capped, rows have a fixed height, and the writer repeatedly removes characters until the text fits. Essential trailing content is missing from the resulting PDF.

**Evidence:** [sheet-long-text.pdf](fixtures/sheet-long-text.pdf). Relevant code: [`layoutPdf.ts:240`](../../src/engines/layoutPdf.ts#L240).

**Acceptance:** Honor wrapping and row heights, preserve complete cell text and show pagination/scaling before export. Test long text and merged cells together.

### B16 — ROUND produces the wrong result for negative midpoints

**Medium · P1 · Engine reproduction**

**Steps:** Evaluate `ROUND(-1.5,0)`.

**Expected:** **-2**, matching Excel's midpoint behavior.

**Actual:** **-1**, from JavaScript `Math.round`. [Microsoft's ROUND examples](https://support.microsoft.com/en-us/excel/functions/round-function) also demonstrate negative midpoint rounding away from zero.

**Evidence:** [engine results](evidence/engine-results.json). Relevant code: [`sheet.ts:281`](../../src/engines/sheet.ts#L281).

**Acceptance:** Define Excel-compatible rounding semantics and test positive/negative midpoint values, decimal-place arguments and floating-point edge cases against a reference calculation engine.

### B17 — Image rotation cannot be undone with the standard keyboard shortcut

**Medium · P2 · Installed UI reproduction**

**Steps:** Open the synthetic 800×400 PNG, rotate right, press Cmd+Z.

**Expected:** Return to 800×400.

**Actual:** Dimensions remain **400×800**. Clicking the visible Undo button then returns to 800×400, confirming that history exists but the shortcut is not connected.

**Evidence:** [AX capture](evidence/image-keyboard-undo.ax.txt). Relevant code: [`ImageEditor.tsx`](../../src/editors/ImageEditor.tsx).

**Acceptance:** Connect native menu and keyboard undo/redo to active image history; define consistent history behavior for crop, adjustment, OCR replacement and revert.

### B18 — Escape does not dismiss the export popup

**Medium · P2 · Installed UI reproduction**

**Steps:** Open an image's Export menu and press Escape.

**Expected:** Close the popup and return focus to Export.

**Actual:** The menu remains open and focus stays on its trigger. The shared Menu component handles outside pointer presses but provides no Escape/focus-management behavior.

**Evidence:** [AX capture after Escape](evidence/export-escape.ax.txt). Relevant code: [`ui.tsx`](../../src/components/ui.tsx).

**Acceptance:** Support Escape, deliberate focus entry/return and keyboard traversal. Audit all shared menus rather than fixing only image Export.

## What worked in this session

- Home and template navigation, budget formatting and basic live totals.
- Toolbar spreadsheet Save after blur wrote the committed value correctly; the defect above is the active-edit keyboard path.
- Native unsaved-close dialog showed Save / Don't Save / Cancel. Cancel retained the workbook and its dirty state.
- DOCX opened and displayed header and footer text; those facts do not imply full save/export fidelity.
- Pitch-deck template displayed eight slides. Adding a slide and using keyboard undo/redo restored the expected slide count.
- Image opened, rotated with correct dimensions, and toolbar Undo restored it. Live packaged OCR recognized **“QA sample image 123.”**
- Additional engine controls passed: basic SUM, CSV leading zeros, normal extraction after covering ordinary text, presentation save/reload, and image rotation dimensions. The PDF extraction pass does not negate B01's forensic recovery failure.
- The 26 baseline smoke checks passed across PDF, images, DOCX, XLSX, PPTX, OCR and selected previous regressions.

## Compatibility and release risks requiring separate validation

**Macro workbooks:** A synthetic `.xlsm` container with an added `vbaProject.bin` part lost that part after load/save, and the editor deliberately saves `.xlsx`. This establishes that the part is not preserved; it does **not** establish behavior for a complete, executable, valid macro workbook. Publish this limitation in the file-open/export flow and test real fixtures before claiming macro compatibility. It is not counted as an additional confirmed user-facing defect.

**macOS distribution:** `codesign -dv` reports **ad-hoc signing** and no TeamIdentifier. Configuration also disables hardened runtime. A clean-machine Gatekeeper installation was not tested. Before a paid release, use Developer ID signing, hardened runtime, notarization/stapling and an installation/update test on a fresh machine, following [Apple's distribution guidance](https://developer.apple.com/developer-id/).

**Desktop security:** Context isolation, renderer sandboxing, disabled Node integration, and a production CSP are present. Review IPC sender validation, file/path capabilities, permitted external-link schemes, remote OCR code/data delivery, dependency updates and Electron fuses. The main process's navigation handler forwards non-file URLs to `shell.openExternal` without the same HTTP(S) restriction used by its popup handler. This is a code-review risk requiring a reachable reproduction, not a proven exploit. [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security) specifically addresses external URLs, IPC senders and restrictive policies.

**Offline OCR:** README states language models download on first use. The successful OCR test ran online with possible existing caches. “On-device” must not be confused with “works offline from first launch.” Bundle models or clearly show download size, progress, retry/cancel and offline availability.

**Accessibility:** Document tabs are clickable containers rather than semantic, keyboard-operable tabs; several controls use symbols as their accessible names, and spreadsheet cell selection lacks a full grid-navigation model. These observations justify a dedicated keyboard/screen-reader audit. No full conformance score is assigned. Target the applicable [WCAG 2.2 AA criteria](https://www.w3.org/TR/WCAG22/) for the web-rendered interface and test actual assistive technologies.

## Product-owner recommendations

### 1. Define the first paid promise narrowly

Choose one primary audience and a short set of complete workflows. A plausible hypothesis is people who need local document/image conversion and OCR without uploading document contents. Validate that hypothesis with actual target users before pricing. Full Microsoft Office replacement would require a substantially larger compatibility investment than the current evidence supports.

Publish a capability matrix by platform, input format and operation: view, edit, preserve on save, convert, print, and known losses. Avoid blanket “round-trip” or “exact layout” claims where only a subset is preserved. Explain lossy conversion inside the workflow, before overwriting; offer a copy and a preview.

### 2. Make document safety a product feature

Implement recoverable drafts and crash restoration, explicit saved/saving/unsaved status, a last-saved timestamp, external-modification conflict detection and recoverable versions. Atomic file replacement is useful but does not protect against a logically incomplete export or a stale editing model.

The key acceptance rule should be: **a successful save contains the latest user-visible committed or pending changes, and unsupported content is never silently destroyed.** Handle failed/cancelled saves without clearing dirty state. Keep draft contents local by default and document retention/deletion behavior.

### 3. Establish a measurable compatibility contract

Maintain a representative file corpus: business letters with links and headers, multi-section documents, complex tables, invoice formulas, cross-sheet models, presentations with masters/notes, scanned forms, multilingual text and real mobile photos. Preserve untouched structures where practical; use an explicit conversion mode otherwise.

For spreadsheets, select a reliable calculation/reference-update strategy rather than extending functions one at a time without semantic coverage. Unsupported formulas need a visible state. For PDFs, separate visual covering from verified redaction, and use independent verification before making confidentiality claims.

### 4. Improve the everyday experience

Add recent files, reopen/recovery, searchable commands or clearly named tools, export previews, progress and cancellation for expensive operations, useful errors with recovery actions, and a consistent undo/redo model. Keep optional professional tools discoverable without crowding the primary task.

Make keyboard operation first-class: document tabs, grid selection, menu focus, Escape, shortcut hints and visible focus. Add meaningful names to icon controls and announce save/error/progress status to assistive technology. Validate long filenames, many tabs, high zoom, narrow windows, touch targets and high contrast.

### 5. Build trust around distribution, privacy and support

Deliver signed/notarized installers and signed, recoverable updates. Add a visible version/build number, release notes, support contact, clear export limitations and a concise data-flow explanation: what stays on the device, what is fetched, and whether any content leaves it. Validate those statements with network observation.

Prepare an opt-in diagnostic export that excludes document contents by default. Review third-party license obligations before commercial distribution. A local desktop product can be sold without accounts; do not add mandatory sign-in or collaboration unless user research supports it.

### 6. Validate willingness to pay through complete tasks

Run moderated sessions with 5–10 people from the chosen audience using realistic, non-sensitive files. Observe whether they can open, edit, export, locate and reopen the result without help. Ask what tools they currently use, where time is lost, and whether a trial would replace an existing expense.

Proposed pilot targets, to refine after measurement: at least 95% unassisted completion of the declared primary tasks; zero unnoticed content-loss cases; zero false-save confirmations; and clear recovery from cancelled/failed operations. These are proposed launch targets, not achieved metrics or statistical market validation. Test trial/license activation, purchase, restore and cancellation only if that commercial model is implemented.

## Prioritized delivery plan

| Stage | Required outcome | Suggested owner | Exit evidence |
|---|---|---|---|
| Immediate containment | Resolve B01–B03; correct unsafe preservation/redaction claims; protect originals where loss is known | Engineering + QA + Product | Independent PDF recovery checks; active-edit save/reopen checks; current formula-error propagation |
| Reliability before paid pilot | Resolve remaining high issues plus precision, clipping, rounding and unreachable menu; recover drafts and handle external changes | Engineering + QA | Golden-file round trips, visual export comparisons, reference formula tests, failure/recovery scenarios |
| Product and distribution readiness | Capability matrix, reliable keyboard flows, signed installer/update, offline-state UX and support/privacy material | Product + Design + Engineering | Fresh-machine install, keyboard/assistive-tech review, documented network behavior and supported platform matrix |
| Controlled paid pilot | Deliver one reliable end-to-end value proposition to the target audience | Product + Support + QA | Task observation, support issues, repeat use, willingness-to-pay evidence and no unresolved release blockers |

Do not assign a release date from this exploratory session alone. Estimate after triage: full section preservation, a dependable formula engine and secure PDF redaction may require architectural decisions.

## Suggested paid-release acceptance gate

1. No open critical/high issues in the advertised primary workflows; any deferred unsupported operation is blocked or clearly constrained before it can lose data.
2. All defect regressions pass through the relevant UI and on-disk round trip, not only helper functions.
3. Saved/exported artifacts pass independent checks for content, relationships, structure and visual layout. Redaction requires forensic object-level checks.
4. Save failure, cancellation, crash restoration, disk-full and external-modification cases demonstrate safe recovery.
5. Supported platform installers and upgrades pass clean-machine tests; other platforms are labelled preview/unsupported until tested.
6. Applicable keyboard/accessibility checks and primary-task user tests pass. No accessibility compliance claim without a dedicated audit.
7. Performance targets are measured on declared reference hardware and realistic files. Suggested starting budgets: usable home within 3 seconds on a warm launch, common files within 5 seconds, and visible progress/cancel for longer work. These are targets, not measurements from this session.

## Reproducing the diagnostic evidence

From the repository root:

```sh
npm run typecheck
env -u ELECTRON_RUN_AS_NODE npm test
env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron docs/qa-2026-11-06/run-probes.cjs
```

The additional runner uses a local Vite server on port 5203 and a hidden Electron window for **engine-only** probes. It regenerates synthetic fixtures and `engine-results.json`. It is a diagnostic runner: inspect each assertion's `pass` field; runner completion alone does not mean the assertions passed. Installed UI findings require the manual steps above. Preserve any manually saved evidence copies before rerunning.

The earlier [5 November QA report](../qa-report-2026-11-05.md) records fixes that were narrower than several cases explored here. Its “all fixed” statement should not be used as a release-wide certification. This report adds current evidence and does not assume every earlier scenario was independently retested.
