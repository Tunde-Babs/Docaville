# DocumentHub 1.0.1 — fixes and verification

**Date:** 6 November 2026, Europe/Berlin.  
**Scope:** the 18 confirmed defects in the exploratory review. All 18 have an implemented fix. This report distinguishes engine verification from desktop UI verification; it is not a declaration that every format, platform or security condition is now certified.

## Verification summary

- Production build, including TypeScript checking: **passed**.
- Baseline smoke suite: **26 passed**.
- Additional regression suite: **49 passed**. This includes the original failing engine cases, actual TipTap document round trips, reference changes across sheets, persisted formula errors, internal bookmarks, and save failure/cancellation/concurrent-edit safeguards.
- Rebuilt macOS Apple Silicon app: **version 1.0.1**. Native UI checks verified active-cell keyboard Save, existing-file Save, bottom menu placement, Escape/focus restoration, worksheet naming collisions, hidden-PDF undo isolation, PDF redo, image keyboard undo/redo, DOCX hyperlink saving and multilingual PDF export.
- The packaged app's exported PDF was independently read back: **Yoruba, Cyrillic, Chinese and Arabic text survived without question-mark substitutions**.
- The final Cover pointer-interaction check was interrupted by desktop automation connection/window failures. Its critical removal behavior is verified through engine export, text extraction, decoded-stream inspection and visual comparisons. It is not recorded as a completed native Cover-save UI test.

The original assessment/evidence remains under [report.md](report.md) and `evidence/`. Current results and synthetic output files are separate under [fix-verification](fix-verification).

## Fix register

| ID | Implemented fix | Verification |
|---|---|---|
| B01 | Cover/Edit-text exports rebuild a clean document from 300 DPI lossless page renders, with covered pixels removed. Original streams, nested forms, attachments and metadata are not copied. Fresh search text is added only for supported, entirely uncovered text boxes. First Save suggests a separate covered copy and the UI explains flattening. | Ordinary and Form-XObject secrets no longer extract; scanning all decoded output streams finds no original secret. Visual comparison confirms uncovered words retain their positions/appearance. |
| B02 | Save and Print synchronously commit pending spreadsheet input before serialization; all spreadsheet export actions also prepare that input. Typing immediately marks the document dirty. Save revisions prevent edits made during a save from being incorrectly marked saved. | Packaged UI saved `7777` to a new workbook, then `9999` in place, using Cmd+S with the cell input active. Both on-disk values were checked. Hook regression checks cover preparation, cancellation and an edit during save. |
| B03 | Current calculation errors propagate to dependants. Cached values can no longer mask division-by-zero or reference errors. Unsupported cached results are labelled `(cached)` and do not silently feed live calculations. Supported formula caches are refreshed when saving. | Direct/dependent errors and reloaded XLSX cached error checked. |
| B04 | Row/column insertion/deletion rewrites A1 references across the workbook, including absolute/mixed addresses, quoted sheets and shrinking/deleted ranges. String literals are excluded. Workbook-wide undo snapshots restore dependent sheets together. Merges are repositioned through structural edits. | Row/column insertion, deletion, quoted cross-sheet ranges, unchanged string literals, dependent values and workbook snapshot restoration checked. |
| B05 | Worksheet rename updates dependent references across the workbook and participates in whole-workbook undo history. | Original failing rename scenario and quoted sheet names checked. |
| B06 | DOCX import retains actual link destinations; the editor schema retains link marks. Export writes external/internal hyperlink objects. Bookmark destination nodes are also preserved for internal links. | External link survived Save in the packaged app, verified by ZIP inspection. Actual editor round trips and internal bookmark destinations checked in regressions. |
| B07 | Imported section boundaries become explicit editor nodes. Saving restores each original section's properties and header/footer references at the corresponding boundary. Preservation failure stops the save instead of silently overwriting with a simplified file. | Two-section import/edit/save retains two sections, with the first boundary before the second section's text; temporary markers do not leak into saved text. |
| B08 | Header/footer text is carried in document defaults and rendered by vector PDF/print layout on each page. Section changes can switch page geometry/header/footer text. | The visible-header fixture's header is present in PDF extraction; section defaults are retained. This does not establish full fidelity for arbitrary graphical, first-page or alternating headers. |
| B09 | Local Noto fonts are embedded as subsets for supported international text, including document/sheet/slide exports, PDF overlays and OCR search text. Combining sequences stay together. Unsupported glyphs produce an explicit error on ordinary export instead of becoming `?`. | Four-script engine export/readback and rendered preview; packaged UI export/readback preserved the exact normalized sample text. |
| B10 | CSV exports use raw numbers, ISO date values and live formula results, independently of display formatting. | `1234.56789` survives export/re-import despite a two-decimal cell display format. |
| B11 | CSV import preserves textual field whitespace; numeric inference no longer trims the input first. | Quoted leading/trailing spaces and leading-zero identifiers retained. |
| B12 | PDF keyboard handlers check editor visibility. Shift+Cmd/Ctrl+Z invokes redo, with a visible redo control/history. | After rotation, Home → Cmd+Z left the inactive PDF's undo history intact. Active undo and redo changed the correct controls/history. |
| B13 | Shared popup positioning measures available space and opens above bottom-edge triggers; width/height remain constrained to the window. | Native worksheet popup visibly opened above its bottom toolbar; screenshot retained. |
| B14 | New-sheet naming searches for the next unused name, rather than using sheet count. Sheet add/rename/delete/move participate in workbook history. | Native Sheet2 → Add Sheet created a separate Sheet1; engine collision check passed. |
| B15 | Spreadsheet PDF layout wraps full cell contents, expands row fragments and paginates long rows instead of removing trailing characters. Export no longer creates empty cells while reading the grid. | The complete business description is present after whitespace-normalized PDF extraction. |
| B16 | ROUND uses decimal exponent shifting and rounds magnitude before restoring sign, matching the tested Excel midpoint cases. | Negative midpoint, `1.005`, negative decimal precision and tens/hundreds rounding checked. |
| B17 | Image history has snapshots and redo for geometry/adjustments, and active-editor keyboard handlers for Cmd/Ctrl+Z and redo. Revert/OCR replacements also use history. | Native 800×400 → rotate → Undo restored 800×400; Redo restored 400×800. |
| B18 | Shared menus expose menu semantics, focus an item on opening, support arrow/Home/End navigation, close on Escape/Tab and restore trigger focus on Escape. | Native image Export closed on Escape and returned focus to Export; worksheet menu keyboard activation also worked. |

## Intentional behavior changes

**Secure Cover is a flattened-copy operation.** It prioritizes excluding original hidden content over preserving the original editable PDF objects. Forms/links are flattened, and original bookmarks, attachments and metadata are not copied. Boxes that intersect a cover are kept visually but omitted from the search layer. Unsupported or unusually large pages fail safely rather than falling back to an unsafe visual patch. Keep the original document if you need its editable structure.

The old smoke check assumed every remaining word in a partially covered text box stayed as original selectable text. That assumption was changed explicitly for the secure export contract: it now verifies that the secret does not extract, an entirely uncovered text box remains searchable, and the untouched words remain visually in place. Separate regression checks inspect all saved streams, including the original forensic failure case.

**CSV is a raw-value data export.** Display-specific rounding/localization is not applied. Dates use ISO values. Unsupported formula results are not silently treated as verified live values.

**Macro preservation:** the synthetic VBA package part from the review is now preserved in `.xlsm`, along with its content type and workbook relationship. DocumentHub does not execute macros. Complete signed VBA projects and real macro-enabled production workbooks still need compatibility validation; the synthetic test is not a macro-execution test.

## Artifacts and commands

- Runnable app: `release/qa-fixed/mac-arm64/DocumentHub.app`.
- **Installed update:** `/Applications/DocumentHub.app` is now **1.0.1**. The previous 1.0.0 app was moved intact to `release/qa-fixed/previous-installed/DocumentHub-1.0.0.app` for rollback. [Installation record](fix-verification/installation.json).
- Downloadable build: [DocumentHub 1.0.1 macOS Apple Silicon ZIP](../../release/DocumentHub-1.0.1-mac-arm64.zip). Installed build hashes and archive checksum are recorded in [final-build.json](fix-verification/final-build.json).
- Verification: [engine results](fix-verification/engine-results.json), [regression log](fix-verification/regressions.log), [smoke log](fix-verification/smoke.log), [build log](fix-verification/build.log), [package log](fix-verification/package.log).
- Native saved-value proof: [new-file save](fix-verification/keyboard-save.json), [existing-file save](fix-verification/keyboard-save-in-place.json).
- Native Word save proof: [hyperlink ZIP inspection](fix-verification/word-ui-save.json).
- Native Unicode export proof: [independent readback](fix-verification/packaged-unicode.json), [saved PDF](fix-verification/fixtures/unicode-packaged.pdf).
- Native interaction evidence: [visible sheet menu](fix-verification/sheet-menu-visible.png), [sheet names](fix-verification/sheet-name-collision.ax.txt), [PDF isolation](fix-verification/pdf-isolated-undo.ax.txt), [image undo](fix-verification/image-keyboard-undo.ax.txt), [Escape](fix-verification/export-escape.ax.txt).

```sh
npm run build
env -u ELECTRON_RUN_AS_NODE npm test
env -u ELECTRON_RUN_AS_NODE npm run test:regressions
```

Regression output uses synthetic fixtures under `fix-verification/fixtures`. Running it regenerates those files, so retain separate copies of any manually exported evidence before rerunning. The packaged-artifact verifier additionally requires the native UI's `unicode-packaged.pdf` fixture.

## Remaining release work outside the 18 defect fixes

The wider product recommendations remain a backlog: crash recovery/version history, external-file conflict handling, comprehensive accessibility work, performance/stress testing, cross-platform/device testing, real printing and a complete compatibility corpus.

The macOS app is still ad-hoc signed. Developer ID signing/notarization requires the publisher's Apple credentials/certificate and has not been completed. No claim is made that a clean-machine Gatekeeper installation has been validated.

A dependency audit during this work reported **45 advisory entries: 2 high and 43 moderate**, with transitive duplication. The two high entries concern `image-size` and its parent `pptxgenjs`; the underlying [image parser advisories](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) have a patched image-size release. Other entries include Tiptap core, minimatch and uuid. These advisories have not been represented as resolved or as proven reachable vulnerabilities in the packaged app. A separate dependency upgrade/backport and security-validation pass is still required; no forced major-version downgrade/upgrade was applied. See [the audit snapshot](fix-verification/dependency-audit.json).

Fixing these 18 defects improves reliability, but does not by itself establish paid-release readiness across all advertised formats and platforms.
