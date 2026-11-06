# Docaville Free and Pro release model

Owner decisions received 6 November 2026:

- Free app with a paid feature unlock.
- Free viewing; Pro editing and productivity tools.
- Google Play registration is not yet complete: the owner confirmed the developer registration/account-type page. Choose a personal account when publishing personally, or an organization account when publishing for a business; both can monetize. Organization verification generally requires a D-U-N-S number. [Google account guidance](https://support.google.com/googleplay/android-developer/answer/13634885).
- Recommended support address: `support@docaville.com`, subject to domain ownership and a working mailbox. Until confirmed, the app uses GitHub Issues; no uncreated mailbox is listed as a live contact.

## Product split

| Free | Pro |
| --- | --- |
| Open and view supported PDFs, Word documents, spreadsheets, presentations, and images | Create and edit documents, PDF content/forms/signatures, spreadsheets, slides, and images |
| Navigate pages/slides/sheets and zoom | Convert/export, OCR and scan correction, audio recording/transcription, dictation, translation, and read aloud |
| Access help, privacy information, and support | Batch PDF workflows, document assistant, comparison/review, business templates, and advanced version workflows |

Data safety rule: purchasing, refund, account changes, or entitlement errors must not delete documents or trap existing unsaved work. Existing saved files remain available to view, and users should retain access to exporting their own previously saved recovery data. Define the exact recovery/print behavior before enabling the commercial gate.

The current beta still includes all implemented features. A separate **Free viewer preview** is implemented with `npm run build:free-preview`: rendering-only PDF/Office/image viewing, page/zoom controls, selectable page text, and Pro explanations at creation/editing/save/productivity boundaries. Office previews use the supported PDF layout engine, with a selectable-text fallback when font/layout export fails. Existing recovery data remains accessible.

**Verified paid entitlements, actual purchases, and purchase restoration are not implemented.** Only `beta` and `free-preview` build channels are accepted; an unconfigured store channel fails the build. The access preview is not evidence of payment or a production licensing mechanism. Do not describe this beta as a working paid-unlock release.

## Purchase implementation sequence

1. Confirm Play Console developer access, legal publisher/merchant setup, application ID availability, and public support/privacy contacts.
2. Choose the initial price/currencies/countries. A one-time non-consumable Pro unlock is the proposed implementation; no price or charge has been configured.
3. Create the application and actual in-app product in the store. Proposed Android identifier: `docaville_pro`; confirm it in Play Console before wiring the release build.
4. Integrate the current supported store billing SDK, purchase acknowledgement, authenticated entitlement verification, restoration, and offline behavior. Never embed store service-account keys in the application or grant Pro on a button click/local preference alone.
5. Implement a genuine read-only viewer for the free tier and enforce Pro at command/action boundaries, including keyboard shortcuts, native menus, drop/import workflows, and exports. Hiding toolbar buttons alone is insufficient.
6. Use store test accounts/tracks for successful, canceled, pending, declined, interrupted, refunded, and revoked purchases; restoration after reinstall; same-store-account/device changes; offline use; and failed verification. Verify that no scenario causes document loss.
7. Activate the commercial gate only after purchase and restoration pass end to end on the exact signed build.

Initial cross-device restoration should be defined within the same store account/platform. Cross-store ownership (for example Android purchase unlocking Windows/iOS) needs a deliberate entitlement/account design and must not be promised before implementation. Cloud document connections and team workspaces remain out of scope.

Apple and Microsoft store versions require their developer accounts and store-specific durable/non-consumable purchase implementations. Direct desktop distribution additionally needs a selected licensing/payment route. They cannot rely on an Android purchase token alone.

Reference: [Google Play Billing](https://developer.android.com/google/play/billing), [one-time products](https://developer.android.com/google/play/billing/one-time-products), [billing security](https://developer.android.com/google/play/billing/security).
