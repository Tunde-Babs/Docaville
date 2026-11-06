# DocumentHub 1.1.0 — local productivity build

Implemented the local feature set requested after the product review. Cloud connections and team workspaces are deferred. This is an initial implementation with the scope and verification limits below; it is not a claim of enterprise certification or complete Office compatibility.

## Features included

| Feature | Delivered behavior |
| --- | --- |
| Recovery and version history | Automatic local checkpoints after a two-second editing pause, manual checkpoints, up to 30 archived versions per document identity, filtering, export, and restore as a separate copy. Explicit disk Save is retained. PDF recovery preserves editable sources/overlays; active PDF and spreadsheet drafts are captured without closing their inputs. |
| Audio to document | Record/import audio, pause/resume recording, multilingual on-device transcription, timestamp playback, editable passages, manual speaker labels, review flags, transcript export, and editable transcript/minutes/lecture/report drafts that open in Word and export through its existing Word/PDF tools. Original transcript text is kept separate from document and translation drafts. |
| Dictation | Word and Audio Studio integration; microphone selection, level meter, language selection, pause/resume/stop, paragraph commands, optional spelling rules, pending-speech retry, and close/Save All protection. Text arrives in short passages rather than character-by-character streaming. |
| Custom vocabulary | Locally saved, explicit spelling replacement rules, applied on request to transcripts or optionally to dictation. Original recognition text can be restored. These are post-recognition corrections, not artificial confidence scores or a claim of model fine-tuning. |
| Local translation | English, German, French, and Spanish text translation in Audio Studio and the document assistant. A separate editable translation can be exported or opened in Word. Non-English pairs translate through English; each required model downloads on first use. |
| Batch workflows | Convert supported documents to PDF, searchable PDF OCR, flattened compression, page extraction, watermarks, numbering, and renamed copies. Presets, per-file results, cancellation at step boundaries, filename collision handling, retained completed results, and ZIP export. |
| Document assistant | Single-document source search, on-device extractive question answering, source-linked key-passage summaries and action candidates, table-to-Excel export, translation, and read aloud. Answers quote document text with a source reference and decline low-confidence results. |
| Comparison and review | Extracted-text comparison, per-change accept/reject, accept/reject all, Undo/Redo, reviewed-output preview, quoted local comments with resolve/reopen, reviewed Word/text copies, and JSON review export. Decisions/comments persist for the same document pair. |
| Scan and extract | Image import, device-dependent photo capture, crop suggestion/manual crop, rotation/straightening, enhancement, OCR with confidence indicators, human-reviewed word corrections, searchable PDF, corrected Word text, and editable estimated tables exported to Excel. |
| Reusable business templates | Local business profile, branding/logo, placeholder autofill, starter templates, custom text templates, DOCX/template import, template export, and saving a Word document as a reusable template. |
| Read aloud | Local voices, speed, pause/resume/stop, and paragraph highlighting in Word and the assistant. Native macOS/Windows speech bridges complement browser speech support. |

All tools are available from **Home → Work smarter** or **Productivity tools**. Word also exposes **Dictate**, **Read aloud**, and **Save as template** in its toolbar.

## Data and processing

- Document, audio, transcript, review, branding, template, recovery, and model-cache data are stored/processed locally. No account or hosted document backend was introduced.
- Speech, translation, and answer-model weights download from Hugging Face on first use. OCR language data downloads on first use; the OCR worker and SIMD/non-SIMD LSTM runtimes are bundled.
- Recordings persist across sessions only when local retention is selected or Save All is chosen while recording. Transcript and document-draft text are checkpointed locally. Removing a retained recording updates local storage before reporting its removal.
- Local recovery storage can fill or be cleared by the user/OS. Storage errors are surfaced; a local-history failure does not undo a successful disk save. Checkpoints do not protect the final moments before a crash or an unrecognized spoken passage that has not completed processing.
- Core libraries' license notices are packaged under `licenses/`. Model sources: [Whisper tiny](https://huggingface.co/Xenova/whisper-tiny), [extractive answer model](https://huggingface.co/Xenova/distilbert-base-cased-distilled-squad), and [English–German translation](https://huggingface.co/Xenova/opus-mt-en-de), with corresponding OPUS-MT language-pair models for the other supported languages.

## Verification

| Check | Result / evidence |
| --- | --- |
| TypeScript and production build | Pass — [build log](build.log) |
| Existing engine smoke tests | **26/26** — [log](smoke.log) |
| Existing regression suite | **49/49** — [log](regressions.log) |
| New feature and actual model tests | **25/25** — [results](results-ml.json), [log](model-tests.log). Includes real speech recognition, real source-answer extraction, real English-to-German translation, vocabulary boundaries, batch PDF output, review decisions, table parsing, template escaping, version retention, active-input checkpoints, and speech-flush close ordering/failure protection. |
| Audio desktop flow | Import public WAV → transcribe locally → edit/review → label speaker → create Word document → native Save. [Native evidence](audio-desktop.ax.txt), [independent DOCX inspection](audio-export-verification.json). |
| Recovery after interruption | Unsaved Word marker survives interruption and restores into a separate copy. [Evidence](recovery-restarted.ax.txt). |
| Active PDF draft recovery | A checkpoint captures the uncommitted text while leaving the input open. After interruption/restart, the replacement is restored as editable overlay text and saves correctly once. The original source remains unchanged. [Recovered native state](pdf-recovery-ready.ax.txt), [independent saved-PDF check](pdf-recovery-verification.json), [rendered page](pdf-recovery-preview.png). |
| Native read aloud | macOS local voices load; playback, pause, resume, and stop work. [Evidence](read-aloud-native.ax.txt). |
| Cited document answers | The desktop answer matches the source date and identifies its passage. [Evidence](assistant-desktop.ax.txt). |
| Comparison | Original/revised files show changes; accept, Undo, Redo, preview, and quoted comments work. [Evidence](review-desktop.ax.txt). |
| Batch desktop export | Saved preset → page numbering → ZIP export. Independent inspection confirms page count, numbers, and original text. [Evidence](batch-desktop.ax.txt), [verification](batch-export-verification.json). |
| Scan export | Prepare image → OCR → human correction → searchable PDF and Excel export. Corrections survive both outputs. [Native evidence](scan-desktop.ax.txt), [PDF check](scan-export-verification.json), [spreadsheet check](scan-table-verification.json), [rendered scan](scan-export-preview.png). |
| Offline after caching | Restarted isolated desktop instance with all HTTP/HTTPS requests blocked. Transcription, answer extraction, and OCR complete using cached models/languages and bundled runtimes. [Audio](audio-offline.ax.txt), [answers](assistant-offline.ax.txt), [OCR](ocr-offline.ax.txt). |

All UI work used a separate QA profile and synthetic/public test files. The user's existing unsaved DocumentHub session was not closed or edited. Tests did not drive the private user document.

## Scope limits and remaining release work

- **Physical microphone/recording acceptance is still required.** A synthetic capture attempt was blocked by the macOS audio-service sandbox reading its WAV fixture; security protections were left enabled. Imported-audio transcription is verified. Capture controls, pending-speech handling, and close protection are implemented, but this does not establish real-microphone accuracy, permissions behavior, echo handling, or device switching across hardware.
- Desktop UI verification was on macOS arm64. Windows speech code, Intel Mac, physical mobile devices/camera capture, other browsers, and very large files were not certified in this session.
- Speaker labels are manual. Speech confidence is not fabricated: initial transcript passages are marked for review. English/German/French/Spanish text translation is implemented; the actual translation-model test covered English → German. Other language/accent/pair quality needs a broader corpus. Extractive answering works best with English questions/documents and cannot perform arbitrary reasoning outside the cited source.
- Comparison/review works on extracted text and creates a reviewed copy. It does **not** round-trip native Word tracked-change records or embed review comments as Office comments. Existing Office layout/unsupported-object compatibility limits still apply.
- Scan crop/table detection are suggestions requiring review; perspective correction and automatic speaker identification are not included. Searchable-PDF corrections change the text layer while retaining the source image appearance.
- Compression flattens forms/links/text into image pages and may enlarge already compact PDFs. Cancellation occurs at file/page/step boundaries, not inside an in-progress OCR engine call.
- The app is ad-hoc signed; Developer ID signing/notarization and a fresh-machine installation matrix remain release tasks. The dependency audit is attached as [machine-readable evidence](dependency-audit.json); remaining advisories must be reviewed before a broad commercial launch. Newly introduced sharp/diff advisories were addressed through targeted updates.
- Cloud connections and team workspaces are intentionally deferred. No cloud-sync or collaboration placeholders were added to the user flows.

## Delivered build

- Installed alongside the current app: `/Applications/DocumentHub 1.1.0.app`. The existing `/Applications/DocumentHub.app` and its running session were left in place.
- ZIP: `release/DocumentHub-1.1.0-mac-arm64.zip`.
- [Package verification](bundle-verification.json): version 1.1.0, **66 production files** and all four native speech/shell files match the tested workspace; packaged runtime notices are present. macOS signature integrity verification passes, and the microphone usage description is included.
- [Installation verification](install-verification.json) records the separate installation and preservation of the existing app/session.
- Final dependency audit: **45 advisories (2 high, 43 moderate)**, matching the prior unresolved count. The additional advisories introduced by the speech/compare dependencies were removed using patched sharp/diff versions. This count is not a security certification.

Save existing work, quit the current version, then open **DocumentHub 1.1.0**. Both copies use the same product identity, so close the old copy before starting the new one. The original app remains available for rollback.
