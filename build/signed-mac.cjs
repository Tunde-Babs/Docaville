// Opt-in Developer ID distribution. Never use ad-hoc signing as a release fallback.
if (!process.env.CSC_NAME) throw new Error('Set CSC_NAME to your installed Developer ID Application identity.');
if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
  throw new Error('Apple notarization requires APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID.');
}
const base = require('../package.json').build;
module.exports = {
  ...base,
  mac: {
    ...base.mac,
    identity: process.env.CSC_NAME,
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: { teamId: process.env.APPLE_TEAM_ID },
  },
};
