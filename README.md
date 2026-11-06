# Docaville

Create, edit, convert, and review PDFs, Word documents, spreadsheets, presentations, and images. Turn speech and scans into editable documents with on-device transcription, dictation, OCR, and translation.

**Release candidate: 1.1.0.** Application branding, package metadata, and new application identifiers now use Docaville. Existing desktop recovery data uses the legacy profile when present; internal storage keys remain compatible. This is a beta preparation build, pending the acceptance and signing checks in [the release checklist](docs/release/README.md).

No account or hosted document-processing backend is required. Cloud connections and team workspaces are deferred to a later build.

## Platforms

One TypeScript/React codebase that opens, edits, converts and exports **PDF, Word (.docx), Excel (.xlsx/.csv), PowerPoint (.pptx) and images**, with on-device OCR. It runs on:

| Platform | Shell | Command |
|---|---|---|
| Windows, macOS | Electron | `npm run desktop:dev` · `npm run desktop:build` |
| iPhone / iPad (iOS/iPadOS 16.4+) | Capacitor (WKWebView) | `npm run ios` (sync/open the tracked native project) |
| Android | Capacitor (WebView) | `npm run android` (sync/open the tracked native project) |
| Browser | Vite | `npm run dev` |

## Getting started

Use Node.js **22.12 or newer**, npm, and Git. Mobile development additionally requires Xcode on macOS or Android Studio with the appropriate SDKs.

```bash
git clone https://github.com/Tunde-Babs/Docaville.git
cd Docaville
npm ci
npm run desktop:dev
```

For browser development, use `npm run dev`. For a production build, use `npm run build`.

## Tests and verification

```bash
npm run typecheck
npm run test:release
npm test
npm run test:regressions
npm run test:productivity
# Includes real speech, source-answer, and translation models:
npm run test:models
```

The recorded 1.1.0 build passed **100 automated checks**: 26 smoke checks, 49 regression checks, and 25 productivity/model checks. The model suite includes the productivity checks, so these two suites should not be added together. TypeScript and the production build also passed. Model tests download the required models on first use.

`npm test` runs the engine smoke tests in headless Chromium. Inside VS Code's terminal, use `env -u ELECTRON_RUN_AS_NODE npm test`.
`npm run test:regressions` runs the additional fixes from the 6 November exploratory review. The original report and evidence are in `docs/qa-2026-11-06`; current verification is written separately under `fix-verification`.

Reports cover [PDF editing end to end](docs/pdf-edit-e2e/report.md) and [1.1.0 productivity verification](docs/productivity-build/report.md). Generated logs, accessibility dumps, and exported documents referenced by historical reports may only be present in the local QA workspace.

## Architecture

```
src/
  engines/        # format logic, no UI
    pdf.ts        # pdf.js render/extract + pdf-lib write; overlay editing, merge, images→PDF
    ocr.ts        # Tesseract WASM: word boxes, searchable-PDF text layer, OCR→paragraphs
    docx.ts       # mammoth import; editor JSON → native .docx (lists, tables, images, colours)
    sheet.ts      # ExcelJS in-place editing, CSV, safe formula evaluator
    slides.ts     # .pptx XML parse + write-back in place; pptxgenjs for new decks
    layoutPdf.ts  # vector PDF layout for documents and spreadsheets
    imageEdit.ts  # rotate/flip/crop/resize + pixel adjustments
    localML.ts    # local speech, translation, and extractive-answer client
    batch.ts      # reusable multi-file PDF workflows
    review.ts     # extracted-text comparison and review decisions
    scan.ts       # scan preparation and estimated table extraction
  components/     # productivity tools, Home, and shared controls
  workers/        # on-device model inference worker
  editors/        # PdfEditor, DocEditor (TipTap), SheetEditor, SlideEditor, ImageEditor
  lib/            # file I/O, templates, save coordination, local storage and versions
electron/         # desktop shell, native file/print bridge, native speech bridges
tests/            # smoke, regressions, productivity/model tests and input fixtures
licenses/         # packaged third-party runtime notices
```

## Quality decisions

- **PDF Cover and Edit text export a clean, flattened copy.** Pages are rebuilt from lossless 300 DPI renders with covered pixels removed; no original content streams, nested objects, attachments or metadata are copied. Uncovered text boxes receive a fresh searchable layer when their geometry/font is supported. Partially covered or unsupported text boxes remain visible as pixels. Forms and links are flattened, and the first Save suggests a separate `-covered.pdf` copy. The editor explains this before saving. Keep the original for editable forms and links.
- **PDF saves without opaque covers preserve original objects when page order is unchanged (or trailing pages are removed).** Reassembling pages flattens existing forms. New text/image/highlight overlays do not require rasterizing the original pages.
- **Images are embedded byte-for-byte.** PNG and JPEG go into PDF/DOCX without recompression. Other formats become lossless PNG.
- **Image→Word keeps the look of the page.** OCR auto-detects the language and reads with that language's model first, so German umlauts are recognised. Small images are enlarged and contrast-boosted before OCR. Each word's text colour is sampled from the image, then grouped into a consistent page palette. Font sizes come from letter shapes, and indentation, alignment, spacing, fill-in blanks (`____`) and the page colour are carried over ([src/engines/ocrLayout.ts](src/engines/ocrLayout.ts)).
- **Exported PDFs are vector.** Text stays real text in documents, sheets and slides. Raster exports render at 300 DPI.
- **Office preservation has explicit scope.** Excel retains supported styles, merges and formulas; structural row/column edits and sheet renames update A1 references across the workbook. VBA parts are retained in `.xlsm`, but macros never execute. PowerPoint edits are written into the original package to preserve existing masters and notes. Unsupported Office objects still require compatibility testing.

## Editing and conversion

| Workspace | Implemented features |
| --- | --- |
| PDF | Edit existing text through replacement overlays; add text, highlights, images, opaque covers, and drawn signatures; fill existing forms/add fields; insert, rotate, reorder, and delete pages; merge PDFs; OCR; export and print. See flattening behavior above. |
| Word | Rich text, headings, fonts, sizes, colors, highlights, alignment, spacing, lists, tables, images, undo/redo, dictation, read aloud, and reusable templates. Export DOCX, PDF, HTML, and plain text. |
| Spreadsheets | XLSX/XLSM/CSV/TSV, cell editing, supported formulas, formatting, number formats, merges, row/column operations, and sheet management. Export XLSX, CSV, and PDF. Macros never execute. |
| Presentations | Edit supported PPTX text, shapes, and images; move/resize/arrange objects; add, duplicate, reorder, hide, or delete slides; adjust backgrounds. Export PPTX, PDF, and slide images. |
| Images | Rotate, flip, crop, resize, adjust, undo/redo, OCR, and correct recognized text. Export PNG, JPEG, WebP, PDF, searchable PDF, Word, and plain text. HEIC/HEIF and multi-page TIFF decoding are included. |
| Image conversion | Combine images into PDF or Word; select A4, US Letter, or image-sized PDF pages; create searchable PDFs or OCR-based editable Word documents with reconstructed colors/layout. |

## Productivity tools

Open **Home → Work smarter** or **Productivity tools**. Word also provides **Dictate**, **Read aloud**, and **Save as template** in its toolbar.

| Tool | Implemented features |
| --- | --- |
| Audio to document | Import audio or record with pause/resume; transcribe locally; edit timestamped passages; play back passages; assign manual speaker labels; flag passages for review; export transcripts; create editable transcript, minutes, lecture-note, and report drafts in Word. Audio retention is optional. |
| Dictation | Microphone/language selection, input-level meter, pause/resume/stop, paragraph commands, optional spelling rules, retry for failed speech passages, and pending-speech protection during Save All/close. Recognition arrives in short passages. |
| Custom vocabulary | Save explicit spelling replacement rules locally and apply them to transcripts or dictation. Restore original recognition text when reviewing corrections. These rules do not retrain a model. |
| Translation | English, German, French, and Spanish text translation in Audio Studio and the document assistant. Edit a separate translation draft, export it, or open it in Word. Non-English pairs translate through English. |
| Read aloud | Local voices, speed control, pause/resume/stop, and paragraph highlighting in Word and the assistant. Electron includes native macOS and Windows speech bridges. |
| Batch workflows | Convert supported files to PDF; add searchable OCR; flatten/compress; extract ranges; add watermarks/page numbers; rename copies; save presets; inspect per-file results; cancel at step boundaries; export completed results as a ZIP with collision-safe names. |
| Document assistant | Single-document search, extractive answers with source references, source-linked key-passage summaries/action candidates, table-to-Excel export, translation, and read aloud. Low-confidence answers are declined. |
| Compare and review | Compare extracted text; accept/reject individual or all changes; undo/redo; preview output; add quoted comments and resolve/reopen them; export reviewed Word/text copies or a JSON review. Decisions/comments persist locally for the same document pair. |
| Scan and extract | Import an image or use device-dependent photo capture; suggest/adjust crop; rotate/straighten/enhance; recognize text; review confidence and correct words; export prepared images, searchable PDFs, corrected Word text, and editable estimated tables to Excel. |
| Business templates | Save business details, logo, and brand color; fill placeholders; use starter/custom templates; import DOCX or template JSON; export templates; save a Word document as a reusable template. |
| Recovery and versions | Automatic local checkpoints after a two-second editing pause, manual checkpoints, latest recovery drafts, up to 30 archived saved versions per document identity, filtering, export, and restore as separate copies. PDF sources/overlays and pending PDF/spreadsheet inputs are retained. |

Speaker labels are manual. Review operates on extracted text and does not round-trip native Word tracked changes or Office comments. Crop/table detection provides suggestions requiring human review. Searchable scan PDF corrections update the text layer while retaining the image appearance.

## Saving and local data

- **Productivity tools (1.1):** local audio transcription and dictation, editable transcript-to-document drafts, custom spelling rules, English/German/French/Spanish text translation, batch PDF workflows, source-linked document answers and summaries, text comparison with accept/reject and comments, scan correction/table extraction, business branding/templates, and local recovery/version history. Open **Productivity tools** or a **Work smarter** card from Home. [Build notes and verification](docs/productivity-build/report.md).
- **Local recovery:** edits are checkpointed after a two-second pause; disk Save remains explicit. Recovery stores the latest draft and up to 30 saved versions per document in IndexedDB. Restoring creates a copy. PDF drafts retain editable sources and overlays; pending PDF and spreadsheet inputs are captured without closing their editor inputs. Changes immediately before a crash may not have reached the checkpoint.
- **Local speech and translation:** models download from Hugging Face on first use and are cached locally. Audio/document contents are processed on the device. Dictation supports microphone selection, pause/resume, an input meter, and optional saved spelling rules. Transcripts support timestamps, manual speaker labels, review flags, correction, and separate editable document/translation drafts. Recordings are retained across sessions only when the user enables local retention or chooses Save All while recording.
- **Read aloud:** local browser voices, with native macOS and Windows speech bridges for Electron. Pause/resume/stop and paragraph highlighting are available in Word and the document assistant.
- **Batch workflows:** PDF conversion, searchable PDF OCR, flattened compression, page extraction, watermarks, page numbering, and renaming copies. Jobs provide per-file results, cancellation at step boundaries, collision-safe names, reusable presets, and a ZIP export. Compression flattens interactive content and can increase the size of already efficient PDFs.
- **Review:** comparison operates on extracted text; accepted/rejected decisions, undo/redo and quoted comments are stored locally. Export a new reviewed Word/text copy or the complete JSON review. This is not native Office tracked-change round-tripping.

- **Save / Save As:** **Save** (Cmd/Ctrl+S) commits active spreadsheet input before writing the opened file atomically. **Save As…** (Cmd/Ctrl+Shift+S), a new document, a format change, or the first flattened covered-PDF save asks for a destination. Later saves go to that chosen file. Cancellation/failure keeps the unsaved state.
- **Print:** 🖨 Print or Cmd/Ctrl+P in every editor. Pages print at 300 DPI with their exact paper sizes, mixed orientation included. On iOS and Android, Print opens the share sheet.
- **Templates:** Word (letter, CV, meeting notes, report), Excel (budget, invoice, timesheet, with live formulas), PowerPoint (pitch deck, lesson) and PDF (blank, fillable registration form).
- **PDF forms:** fill existing fields (text, checkbox, radio, dropdown), add new fields, draw and place a signature, or export flattened.

## Mac distribution

```bash
npm run dist:mac      # → release/Docaville-1.1.0-mac-{arm64,x64}.{dmg,zip}
```

- `arm64` is for Apple Silicon (M1 and later); `x64` is for Intel Macs. Both require macOS 13 or later, matching the bundled Electron runtime.
- Builds are **ad-hoc signed** (no Apple Developer ID on the build machine). The first time someone opens the app, macOS will say it "can't be checked for malicious software". For local testing of a trusted build, use Finder’s **Open** flow or the relevant Privacy & Security setting.
- For distribution without that warning, sign with a Developer ID certificate and notarize: set `mac.identity` to the certificate name, set `hardenedRuntime: true`, and add `notarize` settings (Apple ID / team ID) in `package.json` → `build`.
- File associations: PDF, Word, Excel/CSV, PowerPoint and images all list Docaville under "Open With".

## App icon

One source drawing ([scripts/icon.mjs](scripts/icon.mjs)) generates every platform asset. After editing the design, run `npm run icons`:
- `build/icon.icns` (macOS, Apple icon grid), `build/icon.ico` (Windows, 16–256 px) and `build/icon.png`, used by electron-builder and the dev Dock icon.
- `public/favicon.svg`, `logo.svg`, `apple-touch-icon.png` (web and in-app).
- `assets/icon-only.png`, `icon-foreground.png` + `icon-background.png` (Android adaptive icon), `splash.png` and `splash-dark.png`. Run `npm run mobile:assets` to regenerate the native icon sets in the tracked projects.

## Known gaps / roadmap

1. **PDF font coverage:** bundled, subset-embedded Noto fonts preserve Latin extensions, Cyrillic, Arabic, and CJK in new PDF text, Office exports and OCR layers without runtime font downloads. A missing glyph stops an ordinary export with an explicit error instead of becoming `?`. Font licenses are in `public/fonts`. Full complex-script typography, additional scripts, emoji, and arbitrary original font fidelity still require compatibility testing.
2. **Full layout fidelity for .docx** (headers/footers, sections, columns, text boxes, tracked changes) and the legacy `.doc/.xls/.ppt/.odt/.rtf` formats need a document engine. Add an optional conversion service (LibreOffice headless or Gotenberg in Docker), or license a commercial SDK (Apryse, Nutrient/PSPDFKit, Syncfusion) if you need native-Office-grade rendering offline.
3. **Spreadsheet formulas.** Live in-app evaluation covers arithmetic and common functions. Excel/Numbers recalculate everything when the file is opened. For a full engine, consider HyperFormula (check its licence).
4. **Opening a deck and adding, reordering or re-colouring slides** rebuilds it with pptxgenjs, which may simplify the theme. In-place edits (text, move, resize, delete) keep everything.
5. **OCR language data** downloads on first use and is cached locally. OCR worker/core runtimes are bundled, including SIMD and non-SIMD LSTM builds. Pre-cache the languages needed before working offline.
6. Not yet built: comments/annotations sync, digital signatures, password-protected PDFs, cloud storage, real-time collaboration.


## Repository contents and Git connection

Commit application source, the npm lockfile, required test input fixtures, fonts, license notices, and icon assets. `build/` contains required packaging inputs and is intentionally retained. `.gitignore` excludes dependencies, compiled output, release packages, temporary Electron profiles/model caches, generated QA exports/logs, personal tool settings, environment files, and signing material. Ignoring files does not remove files already tracked by Git.

Native `ios/` and `android/` project configuration, permissions, icons, and version settings are now tracked. Their platform-specific ignore rules exclude generated web assets, native build output, local SDK settings, and signing material. Run `npm run mobile:sync` before native builds.

Run these commands from the project directory to inspect the Git connection:

```bash
git remote -v
git branch -vv
git status -sb
git ls-remote origin
```

`git remote -v` should show `https://github.com/Tunde-Babs/Docaville.git` for `origin`. `git ls-remote origin` verifies read access; an empty repository can return no branch references successfully. `git branch -vv` shows `[origin/main]` once the local branch has an upstream. A configured remote and an upstream-tracking branch are separate settings.

If the folder is not a Git repository yet, initialize and configure it once:

```bash
git init -b main
git remote add origin https://github.com/Tunde-Babs/Docaville.git
```

These commands configure local Git only. After reviewing and committing the intended files, `git push -u origin main` uploads the first commit and sets the branch upstream. Read access does not establish write permission. Review staged files before uploading to the public repository.

## Release acceptance and licensing

The recorded desktop UI acceptance used macOS arm64. Physical microphone permissions/accuracy/device switching, Windows native speech, Intel Mac, mobile/camera workflows, other browsers, and very large files still need acceptance testing. Imported-audio transcription is verified; the actual translation-model test covered English → German. Extractive answers work best with English questions/documents and cannot perform unrestricted reasoning. Recognition, translation, summaries, and table suggestions require review.

Automatic speaker identification and scan perspective correction are not implemented. Developer ID signing/notarization, store packaging, and installation acceptance remain release work. The renamed candidate resolves the previous npm advisories; the final audit evidence is in [the release verification](docs/release/verification.md). A clean audit does not replace security review. QA results establish the tested scope, not security certification or store approval.

Third-party library/font/model terms must be reviewed for distribution. Packaged runtime notices are in `licenses/`; a license for this project's own source has not yet been selected.
