# Docaville 1.1.0 release preparation

This folder tracks the release candidate. A successful build is not device acceptance, security certification, signing, or store approval.

## Sequence and status

| Step | Status |
| --- | --- |
| Rename source, package metadata, document creators, permission messages, and new identifiers to Docaville | Implemented; verification recorded in verification.md |
| Preserve legacy desktop recovery profiles and internal storage contracts | Implemented; synthetic migration checks included |
| Resolve dependency advisories and revalidate editing | Complete: zero known npm advisories; tests/build passed (verification.md) |
| Add local privacy information, support link, dependency notices, and release workflows | Implemented; store policy/contact review remains |
| Configure native iOS and Android projects, permissions, icons, and build numbers | Android APK/AAB compiled; iOS source configured, Xcode environment blocked (verification.md) |
| Clean-machine/device acceptance and accessibility/performance checks | Pending real-device testing |
| Developer ID, notarization, Windows signing, store accounts | Requires owner credentials/accounts |
| Paid product model, pricing, store billing and purchase restoration if applicable | Free viewing / Pro editing and productivity selected; price, store setup and purchase implementation pending (commercialization.md); beta includes all features |
| TestFlight / Play closed testing / desktop beta feedback | Pending accounts and candidate acceptance |
| Public store submission and staged commercial release | Pending preceding steps |

## Identity and existing data

Minimum iOS/iPadOS deployment target: **16.4**, matching Safari/WebKit WebAssembly SIMD support required by the local inference runtime. This is a technical minimum, not physical-device acceptance. See [Apple Safari 16.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes).

New bundle/application ID: `com.docaville.app`. Confirm availability when creating store records before the first submission; package IDs should then remain stable. Visible product name: Docaville. Version: 1.1.0; native build number: 11001.

Desktop startup reuses an existing `DocumentHub` (or lower-case `documenthub`) profile under Electron's application-data root. It does not copy live databases. Fresh installations use `Docaville`. Internal IndexedDB names, model-cache keys, event names, bridge identifiers, and slide clipboard MIME types are intentionally retained for compatibility. The existing single-instance lock uses that profile. Do not run the old and renamed applications simultaneously against the same profile. Existing installed apps are not replaced by this preparation work.

Changing the bundle ID changes OS permission/signing identity: expect microphone permissions to be requested again. Existing installed mobile apps with a different package ID will not automatically transfer sandbox data to a new app. No mobile migration claim is made.

## Local commands

```bash
npm ci
npm run build
npm run test:release
npm test
npm run test:regressions
npm run test:productivity
npm run test:models
npm run notices
npm run desktop:package
```

Models download on first use. The actual model suite includes the productivity suite. `test:release` checks synthetic legacy-profile selection. Electron tests require a graphical environment; use `xvfb-run -a` on headless Linux. If `ELECTRON_RUN_AS_NODE` is inherited, unset it for Electron scripts.

Native projects are tracked because permissions, manifests, signing settings, icons, and build identifiers are release inputs. Generated native build products, local SDK paths, and signing secrets remain ignored. Run `npm run mobile:sync` after changes to web assets/plugins. Do not put credentials, signing keys, or provision profiles into Git.

## Desktop distribution

- `npm run dist:mac`: ad-hoc-signed local beta DMG/ZIP; not a notarized commercial installer.
- `npm run dist:mac:signed`: Developer ID distribution. Requires installed signing identity (`CSC_NAME`), `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` in the environment/secret store. Configuration fails if required values are absent. Test signing/notarization on a fresh machine before distribution.
- `npm run dist:win`: NSIS x64 on a Windows build host. Configure a trusted Windows signing service/certificate before commercial distribution. ARM Windows is not claimed.
- `npm run dist:linux`: optional x64 AppImage on Linux; separate acceptance required.
- `.github/workflows/verify.yml`: web build and engine checks on macOS, Windows, Linux, plus native Android compilation/lint and an unsigned iOS simulator build when pushed; does not establish hardware acceptance.
- `.github/workflows/beta-packages.yml`: manually triggered unsigned/ad-hoc desktop build artifacts; never publishes a store listing or GitHub release automatically.

For Mac App Store distribution, assess sandbox permissions, document access/security-scoped bookmarks, native speech, model storage, and helper entitlements separately. Developer ID notarization is for direct distribution and is not Mac App Store approval.

## Native distribution

- iOS: open the project with `npm run ios`, choose the Apple team, confirm the bundle ID, archive a Release build, and upload to App Store Connect/TestFlight. Use physical iPhone and iPad for acceptance. Simulators cannot establish microphone, camera, memory, thermal, or background behavior on hardware.
- Android: open with `npm run android`, confirm the application ID/current target SDK, generate an upload key outside the repository, configure Play App Signing, and produce a signed release AAB. Begin internal testing, then closed testing as applicable to the account.
- Check current Apple SDK and Play target API requirements in the consoles at submission time; generated template defaults are not a policy guarantee.

## Owner inputs before commercial release

Developer account availability; legal publisher identity; public support email and privacy-policy contact; pricing/purchase model; intended countries and minimum device/OS support; signing credentials; physical testers. Support currently links to GitHub Issues. The privacy document is a technical draft for owner review, and pricing/purchase features have not been invented without a decision.

## Final release procedure

1. Complete every blocking row in the acceptance matrix and record evidence.
2. Re-run audit, build, tests, signing verification, and install/upgrade checks on the exact candidate.
3. Freeze the version/build numbers and generate platform packages plus SHA-256 checksums.
4. Review release notes, notices, privacy disclosures, screenshots, support URLs, and store metadata against actual behavior.
5. Commit reviewed changes and tag the exact candidate; publish beta artifacts only after verification.
6. Gather beta feedback; fix blocking issues and increment build numbers for replacements.
7. Submit accepted candidates to stores and use staged availability. Retain previous verified packages and a rollback/support plan.

References: [Apple Developer ID](https://developer.apple.com/developer-id/), [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/), [Google testing](https://support.google.com/googleplay/android-developer/answer/14151465), [Android signing](https://developer.android.com/studio/publish/app-signing), [Windows distribution](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path).
