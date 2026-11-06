# Docaville release candidate verification

Prepared 6 November 2026. This records completed preparation and explicit release blockers. It is not approval for all devices or a commercial store release.

## Completed checks

| Check | Result |
| --- | --- |
| TypeScript and production assets | Pass (`npm run build`) |
| Existing smoke suite | 26/26 pass after the Tiptap 3 security migration |
| Regression suite | 49/49 pass |
| Productivity and real model suite | 25/25 pass, including actual speech recognition, source answers, English–German translation, and recovery helpers |
| New release checks | 4/4 pass: legacy profile selection, fresh profile selection, and mobile path compatibility/validation |
| Total | 104 automated checks; the model suite already includes the productivity checks |
| npm dependency audit | Zero known npm advisories after patches; [audit JSON](dependency-audit.json). This does not assess every native dependency or establish security certification. |
| Packaged macOS arm64 candidate | 78 production/native/notice files match the workspace; correct Docaville name, `com.docaville.app` bundle ID, and macOS 13 minimum matching Electron; ad-hoc signature integrity passes. [Package evidence](package-verification.json) |
| Legacy recovery → renamed application | A synthetic draft created in the previous DocumentHub build was recovered as a copy in the Docaville package using the same isolated QA profile. Profile-selection policy was checked separately. No real user data was migrated or altered during testing. |
| Upgraded Word editor | Recovered draft edited → native Save → close tab → native Open → content retained. Independent DOCX inspection confirms both markers and creator `Docaville`. [Evidence](word-recovery-verification.json) |
| Privacy/support UI | In-app About/Privacy information opens and exposes support/model attribution links |
| Android compilation | Final debug APK and unsigned release AAB build successfully with API 36, AGP 8.13.2, Gradle 8.13, version 1.1.0/build 11001 |
| Android lint | Zero errors, 19 warnings; mostly generated resources/dependency currency/theme icon checks. [Summary](android-lint-summary.json) |
| iOS source validation | Native project, Info.plist, required-reason privacy manifest, and macOS entitlement plist parse successfully |
| Git exclusions | Native configuration/resources included; copied web assets, native build outputs, SDK locations, keys, temporary profiles/caches, and test exports excluded |

Local detailed logs/accessibility evidence are under ignored `tmp/release-*`. The previous installed DocumentHub apps and existing user session were left untouched. The synthetic test processes were closed after testing. No physical microphone/camera acceptance is claimed.

## Security changes

Upgraded Tiptap packages together to 3.33.0 and adapted imports/content loading to the current API. Applied scoped compatible overrides for patched image-size, UUID, and minimatch dependencies, including the icon generator's Xcode helper. The previous 45-advisory count is reduced to zero in the recorded npm audit. Native dependencies have separate review obligations.

Desktop IPC now checks the sending main frame; external navigation is constrained to HTTP/HTTPS browser links; permission handlers restrict media access to the trusted app and audio. OS microphone consent remains in force. These changes need physical microphone acceptance before launch.

New mobile saves use app-private storage instead of relying on shared Documents permissions. Android shares a selected temporary cache copy through a narrowly scoped FileProvider. Genuine share errors are reported; canceling sharing retains the saved local file. Existing legacy mobile target identities are recognized. These behaviors still need physical-device end-to-end acceptance.

## Candidate artifacts

In `release/docaville-1.1.0/` (not committed to Git):

- `Docaville-1.1.0-beta-mac-arm64.zip`: local ad-hoc-signed macOS candidate, not notarized.
- `Docaville-1.1.0-beta-android-debug.apk`: debug-signed test build, not a production installer.
- `Docaville-1.1.0-android-unsigned.aab`: compiled release bundle requiring upload signing before Play submission.
- `SHA256SUMS.txt`: artifact checksums, also recorded in [artifacts.json](artifacts.json).

No Windows/Intel/Linux candidate has been built locally. Cross-platform CI definitions are prepared; results must be recorded after they run. No iOS archive has passed compilation.

## iOS environment blocker

The installed Xcode reports version 27.2, but `xcodebuild` cannot load its simulator plugin because `/Library/Developer/PrivateFrameworks/CoreSimulator.framework` is absent. A simulator build fails before compiling application source. Xcode first-launch setup did not complete or restore the framework during this session; the unresponsive setup command was stopped.

Open Xcode and complete its component/first-launch installation, or repair/reinstall the official Xcode installation, then rerun the simulator build. Any new licence agreement or administrator authentication must be completed by the owner. After the toolchain works, compile/archive and test on physical iPhone/iPad with the Apple team configured.

CocoaPods is not installed. The iOS project uses Swift Package Manager instead; it was generated through Capacitor's own configuration/add helpers because the installed v7 CLI lowercases its `--packagemanager SPM` option before a case-sensitive comparison. Native source is tracked, so ordinary future `cap sync` detects the SPM project and works.

## Remaining release gates

Physical-device/clean-machine acceptance; Windows/Intel/Linux checks if advertised; Apple/Google/Microsoft accounts and signing; final publisher/contact/privacy policy; pricing decision and any purchase/restore implementation; exact model revision/converted-model licence review; store screenshots/disclosures; and beta feedback. See [acceptance matrix](acceptance-matrix.md), [model review](model-licenses.md), and [release sequence](README.md).

No store submission, payment configuration, public binary release, or installed-app replacement was performed.
