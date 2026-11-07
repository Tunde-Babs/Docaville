# Docaville 1.1.1 beta 2

Worksheet conversion now exports only original pages with positioned answers/crosses by default. Extracted OCR text remains available for review, but additional text pages require explicitly selecting **Include extracted OCR text as additional Word pages**. Both-pages and OCR-only outputs remain available. Excluded OCR is also omitted from the embedded worksheet editing project, while answers still reopen for editing.

Beta 1 always included OCR pages in this workflow, which produced unwanted raw-text sections when users only wanted completed worksheets. This behavior is corrected in beta 2. Existing files are not rewritten automatically; reopen an annotated worksheet and export with OCR unchecked, or create a separate cleaned copy. User documents are not overwritten by the fix.

Version identity: npm/desktop 1.1.1-beta.2; Android build 11003; iOS marketing version 1.1.1/build 11003. This patch does not remove beta feature access or solve OCR recognition accuracy.

Validation: 12 image-to-Word regression checks, including explicit OCR opt-in, default worksheet-only export, no hidden raw OCR when excluded, editable-answer preservation and export/reopen/edit/export. TypeScript and production build pass. The supplied three-image document was cleaned into a separate three-page Word copy; its rendered source pages match the previously inspected source images. Private inputs/outputs remain under ignored local QA storage.

Installed at `/Applications/Docaville.app` after the owner confirmed that work was saved and the app was closed. The app signature verifies, all 81 packaged runtime/notice files match the current built source, and the previous beta 1 ZIP remains available for rollback. The duplicate unpacked beta 2 app was removed after verifying its ZIP; application-data/recovery folders were not changed.

The cross-platform public beta 1 remains unchanged until a subsequent release is published; this source push produces new CI build artifacts but does not silently replace beta 1 release assets.
