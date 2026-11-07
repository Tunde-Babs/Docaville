# Docaville 1.1.1 beta 1

This is an unrestricted device-testing beta, not a commercial store release. Viewing, editing, creation, conversion and productivity tools are enabled without purchases or a trial expiry. OCR and model accuracy still require review. The worksheet editing tools add answers/crosses over a source image; they do not reconstruct the printed page into editable tables and figures.

## Changes

- Direct worksheet text/cross placement, colours and sizes, movement, undo/redo, and positioned Word export.
- Exported annotated worksheets reopen in Docaville's worksheet tools; stale external edits cannot be overwritten by old project data.
- Fitted image pages and source-backed OCR review in multi-image Word conversion.
- Mobile saved-document library, collision-resistant new copies, reopening and share-copy export from private storage.
- Consistent desktop/mobile version identity: npm 1.1.1-beta.1; Android code 11002; iOS marketing version 1.1.1/build 11002.

## Distribution targets

| Target | Package | Requirements |
| --- | --- | --- |
| macOS Apple Silicon | arm64 DMG/ZIP | macOS 13+; ad-hoc signed beta, not notarized |
| macOS Intel | x64 DMG/ZIP | macOS 13+; ad-hoc signed beta, not notarized |
| Windows | x64 installer | Unsigned beta; Windows may display publisher warnings |
| Android | Debug-signed APK | Android 6+; enable installation from the chosen trusted source; runtime/memory acceptance varies by device |
| iPhone/iPad | Native project prepared | iOS/iPadOS 16.4+ technical minimum; Apple signing/provisioning and Developer Program membership required for sharing via TestFlight or ad hoc distribution. No installable IPA is claimed |

Retain the Android beta signing key for subsequent updates. The local APK uses the existing local debug key; a CI-generated debug APK may use a different key and must not be substituted as an update. Export mobile saved copies to Files before uninstalling any beta. Native iOS sharing is pending owner enrollment, signing and testing; an unsigned archive or simulator app is not an iPhone installer.

## Mac installation and duplicate cleanup

The intended installed copy is `/Applications/Docaville.app`. Older DocumentHub, Docaville test and Free Preview app bundles can be archived as ZIPs and unregistered from Launch Services, leaving one active app. Do not remove the legacy application-data folders: Docaville reuses them to preserve settings and recovery data. ZIP backups do not appear as applications in Open With. Old mounted application DMGs should be ejected. Register only the current installed app after cleanup.

Save open documents and quit older copies before replacing app bundles. Application installation does not change the default handler for Word/PDF files; use Finder's Get Info → Open with → Change All only if you want to change that preference.

Build/check evidence and final download locations are recorded after packaging. Commercial release remains on hold pending the existing acceptance, licensing, signing and purchase requirements; beta testing does not certify all devices.
