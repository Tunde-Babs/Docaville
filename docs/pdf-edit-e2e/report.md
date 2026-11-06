# PDF editing end-to-end verification

Result: the tested desktop PDF text-editing and form-editing workflows pass after fixes. DocumentHub 1.0.2 is built and installed at `/Applications/DocumentHub.app`. Save existing work, quit, and reopen DocumentHub to load the update. The running user session was left untouched.

## Bugs fixed

| Issue | Reproduction and impact | Resolution and verification |
| --- | --- | --- |
| PDF-01 — Existing text editor closes immediately | Select Edit text and click an existing text run. The pointer-down activation and default focus behavior caused the new input to blur immediately. | Activate using a semantic button's click event. Verified with a real mouse click and accessibility activation; the input remains focused and accepts replacement text. |
| PDF-02 — Replacement cannot be edited again | After committing a text replacement, the original hit target disappears and the replacement has no Edit text action. | Replacement text now has an accessible edit action and inline input. Verified two successive edits in one session, then Undo and Redo. |
| PDF-03 — Successful save becomes dirty again | Save As while the text properties textarea has focus. Returning focus from the native dialog creates an undo snapshot and marks the document dirty without any content change. | Create the text-edit history snapshot on the first actual change instead of on focus. Verified Save As returns to a clean tab with the textarea still focused, and a later formatting edit becomes dirty then saves cleanly. |

Save reliability was also strengthened: active inline drafts commit synchronously before save, print, or export; replacement overlays are read from their current value during serialization; a commit is idempotent to avoid Enter/blur duplicates; all PDF updates use the save revision counter. This prevents a pending replacement from being omitted or an edit during saving from being marked clean. Cmd+S from an active existing-text input was verified through the native Save As dialog and independently checked in the resulting PDF.

## Desktop walkthrough

All document content used in these checks was synthetic. Testing ran in an isolated Electron instance using the production `dist` bundle and the real desktop preload, file-open, and save handlers.

| Scenario | Result |
| --- | --- |
| Open a two-page PDF using its startup path | Pass |
| Open a PDF using File → Open and the native dialog | Pass |
| Click existing text with the mouse and type a replacement | Pass |
| Save while the inline text input remains active | Pass; copy dialog opens and replacement appears once in the saved PDF |
| Close/restart and reopen the saved PDF | Pass; replacement is selectable for another edit |
| Edit the replacement twice in one session | Pass |
| Undo and Redo the second replacement | Pass; prior and final values restored |
| Escape from an uncommitted edit | Pass; cancelled text absent from saved output |
| Cancel Save As | Pass; changes remain unsaved and can subsequently be saved |
| Add text and edit it through the properties panel | Pass |
| Save As with the properties textarea focused | Pass; clean state retained after native dialog closes |
| Change Bold after saving, then Save in place | Pass; dirty state reflects the change and clears after saving |
| Edit an existing AcroForm text field, Save As, restart and reopen | Pass; `Form edit verified` persists in the widget and PDF field value |
| Preserve untouched lines, second page, and form appearance during text replacement | Pass; independent extraction and rendered review |
| Preserve original source file | Pass; source and working-copy bytes remain identical |

An initial native-picker automation attempt left Open disabled. Retesting with normal keyboard input enabled Open and successfully opened the fixture; no application file-picker change was needed. Saved text and form PDFs were reopened through startup file paths.

## Independent and automated verification

- TypeScript and production build: pass, [build log](build.log).
- Existing application smoke suite: **26/26** pass, [smoke log](smoke.log).
- Existing engine/save regression suite: **49/49** pass, [regression log](regressions.log).
- Independent saved-PDF assertions using pypdf: **17/17** pass, [results](evidence/independent-verification.json). Checks include exact replacement counts, absence of superseded/cancelled text, preserved content, form value, and unchanged source bytes.
- PDFium rendering and visual review: both final pages retain readable text, intended placement, and the form appearance. See [final page 1](evidence/final-page-1.png), [final page 2](evidence/final-page-2.png).
- Packaged version **1.0.2** contains all **41** production files byte-for-byte: [bundle verification](bundle-verification.json). The package and installed bundle pass macOS signature integrity verification. The signature is ad hoc; this is not notarization or store certification.

Key native evidence: [mouse input remains open](evidence/mouse-edit-fixed.ax.txt), [saved tab is clean](evidence/save-focus-fixed.ax.txt), [native Open succeeded](evidence/native-open-success.ax.txt), [form value after reopen](evidence/form-reopened.ax.txt).

## Artifacts and scope

- Updated application: `/Applications/DocumentHub.app`.
- Installable archive: `release/DocumentHub-1.0.2-mac-arm64.zip`.
- Previous installed bundle preserved: `release/pdf-edit-fixed/previous-installed/DocumentHub-1.0.1.app`.
- Source fixture and saved results: `output/pdf/pdf-edit-e2e-*.pdf`.
- Reproducible fixture builder: `tests/make-pdf-edit-fixture.py`; independent verifier: `tests/verify-pdf-edit-output.py`. These require ReportLab, pypdf, PDFium, and Pillow. Regenerating the fixture resets the disposable working PDF.

This verifies the common text-based PDF edit/save/reopen path and an existing text form field on macOS arm64. It does not certify every PDF font, rotated text, scanned-image OCR, encrypted or signed PDFs, every annotation type, Windows/mobile, or very large documents. Text replacement uses the app's disclosed covered-copy workflow: covered content is removed and pages/forms are flattened; the original remains available for editable forms and links.
