# Docaville release candidate verification

Prepared 6 November 2026. This records completed preparation and explicit release blockers. It is not approval for all devices or a commercial store release.

## Completed checks

| Check | Result |
| --- | --- |
| TypeScript and production assets | Pass (`npm run build`) |
| Existing smoke suite | 26/26 pass after the Tiptap 3 security migration |
| Regression suite | 49/49 pass |
| Productivity/reader checks | 30/30 pass in the final component/engine run; includes all five read-only formats, source immutability, no save registration, rapid replacement, unsupported input, and text fallback |
| Actual model inference | 3/3 pass for speech recognition, source answers, and English–German translation in the completed model run |
| New release checks | 6/6 pass: profile selection, mobile paths, Free/Beta access policy, and rejection of unconfigured retail channels |
| Total | 114 distinct checks across smoke, regression, reader/productivity, model inference, and release-policy suites; overlapping suite cases are counted once |
| npm dependency audit | Zero known npm advisories after patches; [audit JSON](dependency-audit.json). This does not assess every native dependency or establish security certification. |
| Packaged macOS arm64 candidate | 80 production/native/notice files match the workspace; correct Docaville name, `com.docaville.app` bundle ID, and macOS 13 minimum matching Electron; ad-hoc signature integrity passes. [Package evidence](package-verification.json) |
| Legacy recovery → renamed application | A synthetic draft created in the previous DocumentHub build was recovered as a copy in the Docaville package using the same isolated QA profile. Profile-selection policy was checked separately. No real user data was migrated or altered during testing. |
| Upgraded Word editor | Recovered draft edited → native Save → close tab → native Open → content retained. Independent DOCX inspection confirms both markers and creator `Docaville`. [Evidence](word-recovery-verification.json) |
| Free access preview | Creation gate verified in native UI; renderer component checks pass for five formats. Full native file-picker/Free-flow acceptance remains pending because UI automation became unreliable (stale-window/no-window responses). No claim of end-to-end paid unlock. |
| Retail build guard | `VITE_RELEASE_CHANNEL=store npm run build` fails explicitly until verified billing is implemented; Beta remains fully enabled |
| Privacy/support UI | In-app About/Privacy information opens and exposes support/model attribution links |
| Android compilation | Final debug APK and unsigned release AAB build successfully with API 36, AGP 8.13.2, Gradle 8.13, version 1.1.0/build 11001 |
| Android lint | Zero errors, 19 warnings; mostly generated resources/dependency currency/theme icon checks. [Summary](android-lint-summary.json) |
| Cross-platform CI | Windows/macOS/Linux engine checks, native Android compilation/device-test compilation/lint, and iOS simulator build pass. [Evidence](ci-verification.json) |
| Desktop beta packages | Windows x64 NSIS, macOS arm64/x64 DMG/ZIP, and Linux x64 AppImage build/upload jobs all pass. [Downloads](https://github.com/Tunde-Babs/Docaville/actions/runs/42305231061) |
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

Windows x64, Intel Mac, Apple Silicon Mac, and Linux x64 desktop installers were built successfully in CI and are available from the linked workflow artifacts. They still require native installation/hardware acceptance. iOS simulator compilation passes in CI; no signed iOS device/archive distribution is certified.

## iOS environment blocker

CI successfully compiles the iOS simulator application, including the iOS 16.4 minimum. Local device/archive work is still blocked: the installed Xcode reports version 27.2, but `xcodebuild` cannot load its simulator plugin because `/Library/Developer/PrivateFrameworks/CoreSimulator.framework` is absent. A simulator build fails before compiling application source. Xcode first-launch setup did not complete or restore the framework during this session; the unresponsive setup command was stopped.

Open Xcode and complete its component/first-launch installation, or repair/reinstall the official Xcode installation, then rerun the simulator build. Any new licence agreement or administrator authentication must be completed by the owner. After the toolchain works, compile/archive and test on physical iPhone/iPad with the Apple team configured.

CocoaPods is not installed. The iOS project uses Swift Package Manager instead; it was generated through Capacitor's own configuration/add helpers because the installed v7 CLI lowercases its `--packagemanager SPM` option before a case-sensitive comparison. Native source is tracked, so ordinary future `cap sync` detects the SPM project and works.

## Remaining release gates

Physical-device/clean-machine acceptance; Windows/Intel/Linux checks if advertised; Apple/Google/Microsoft accounts and signing; final publisher/contact/privacy policy; pricing decision and any purchase/restore implementation; exact model revision/converted-model licence review; store screenshots/disclosures; and beta feedback. See [acceptance matrix](acceptance-matrix.md), [model review](model-licenses.md), and [release sequence](README.md).

No store submission, payment configuration, public binary release, or installed-app replacement was performed.


## Commercial model and account setup

The owner selected free viewing with Pro editing/productivity. A Free reader/access preview is implemented and tested separately; the beta remains fully enabled. Paid purchase/restore and verified entitlement integration are not implemented, and an unconfigured store build is rejected. Play Console registration is incomplete; the owner must complete registration/verification before the actual Pro product and purchase tests can be configured. See [commercialization](commercialization.md).
