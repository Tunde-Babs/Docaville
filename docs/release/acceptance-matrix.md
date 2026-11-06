# Release acceptance matrix

Record device/OS, exact build checksum, tester, result, and evidence for each run. Pending is not a pass. Use synthetic documents and obtain permission before collecting any private examples.

| Target | Candidate build | Engine checks | Native/hardware acceptance | Store readiness |
| --- | --- | --- | --- | --- |
| macOS Apple Silicon | See verification.md | See verification.md | New-brand fresh install/upgrade, real microphone, large files pending | Developer ID/notarization pending |
| macOS Intel | CI workflow prepared | Pending CI run | Pending Intel device | Signing pending |
| Windows x64 | CI workflow prepared | Pending CI run | Pending Windows device | Signing/store route pending |
| iPhone | See verification.md | Shared web checks only | Pending physical iPhone | Apple team, TestFlight, review pending |
| iPad | Same iOS project | Shared web checks only | Pending physical iPad, keyboard, split view | TestFlight/review pending |
| Android phone | See verification.md | Shared web checks only | Pending physical low/mid-range phone | Play signing/testing/review pending |
| Android tablet | Same Android project | Shared web checks only | Pending physical tablet/layout | Play testing/review pending |
| Browser | Production assets built when verified | Shared engine checks | Chrome/Safari/Firefox acceptance pending | Hosting/HTTPS pending; no PWA claim |
| Linux x64 (optional) | CI workflow prepared | Pending CI run | Pending Linux desktop | Direct-distribution acceptance pending |

For each supported target, verify:

- Fresh install/open; rename/upgrade and existing-file associations; no unexpected profile loss.
- Create, edit, Save/Save As, cancel/fail saves, reopen, export, and print/share for PDF, DOCX, XLSX/CSV, PPTX, images.
- PDF replacement and covering output, forms, page operations, Unicode, signatures, searchability, and original preservation.
- Unsaved-close decisions, active input capture, process interruption, recovery and saved-version restore.
- Audio import, microphone permission allow/deny/revoke, device selection, pause/resume, retry, pending speech close, retention/removal.
- Camera permission/photo capture, crop, corrected OCR exports, and table correction.
- Model/language download progress, network failure/retry, cache reuse offline, low storage/memory, long audio and large files.
- Translation language pairs and accents; source-answer citations; review accept/reject/comments; batch cancellation/results/ZIP.
- Touch sizes, screen reader labels, keyboard-only navigation, focus, contrast, zoom, narrow screens, mobile keyboard and orientation.
- Sleep/resume, background/foreground, interrupted writes, unsupported/encrypted/corrupt documents, and error messages.
- Privacy/support links, no private data in diagnostics, notices, clean-machine signature checks, and update/rollback behavior.

Release blockers: data loss/corruption, privacy/security failures, crashes on core workflows, broken saves, payment/restore failures if introduced, misleading compatibility claims, or missing required signatures/store disclosures.
