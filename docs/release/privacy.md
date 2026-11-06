# Docaville privacy information

Technical draft for publisher review before store submission. Prepared 6 November 2026. Confirm the legal publisher identity and public contact details before treating this as a final published privacy policy.

Docaville processes documents, images, audio, recognized text, translations, reviews, and templates on the user's device. It has no account system, advertising, analytics, hosted document backend, or cloud/team connections in this build. Document and audio content is not uploaded for model inference.

The app downloads speech, translation, and extractive-answer models from Hugging Face and OCR language data from the configured providers when first needed. These providers receive ordinary network requests, including IP address and requested resource. Their own services have separate privacy terms. Downloads do not include document/audio content. Cached resources support offline processing, subject to device storage and supported functionality.

Microphone access is used when recording/dictation is selected. Photo capture and file selection are initiated by the user on supported devices. OS permissions may be revoked through device settings. Recognition and generated/extracted output can be inaccurate and should be reviewed.

Local storage includes settings, business details/logo, templates, transcripts, drafts, optional retained recordings, review decisions/comments, model caches, and recovery versions. Recordings persist only when local retention is enabled or Save All is chosen while recording. Recovery stores the latest draft and up to 30 saved versions per document identity. This storage is not an encrypted document vault or cloud backup.

Retained recordings can be removed in Audio Studio and recovery versions in Recovery and versions. Export important files before clearing local application/browser data. Storage may be cleared by the OS or browser. Uninstall does not guarantee removal of every desktop profile or exported file. The Docaville desktop rename reuses the legacy DocumentHub profile when present to preserve existing local data.

Exported files are written to destinations selected by the user. Mobile sharing hands the chosen file to the selected application/system service, whose practices are outside Docaville's control. GitHub Issues is the current support route; posting an issue shares its contents with GitHub and potentially the public. Do not attach private documents or recordings to a public issue.

Current support: https://github.com/Tunde-Babs/Docaville/issues

Publisher contact, retention wording, third-party download endpoints, store declarations, and any later payment/diagnostic integrations must be reviewed before public commercial release. Update this document and in-app disclosures whenever processing behavior changes.
