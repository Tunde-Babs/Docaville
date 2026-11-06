const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { profilePath } = require('../electron/identity.cjs');
test('rename reuses existing legacy recovery profile without copying databases', () => {
  const root = path.resolve('/synthetic/app-data');
  const legacy = path.join(root, 'DocumentHub');
  assert.equal(profilePath(root, value => value === legacy), legacy);
});
test('rename preserves lower-case development profile on case-sensitive systems', () => {
  const root = path.resolve('/synthetic/app-data');
  const legacy = path.join(root, 'documenthub');
  assert.equal(profilePath(root, value => value === legacy), legacy);
});
test('fresh installation selects Docaville without inspecting unrelated profiles', () => {
  const root = path.resolve('/synthetic/app-data');
  assert.equal(profilePath(root, () => false), path.join(root, 'Docaville'));
});
test('mobile exports use private storage and preserve legacy save destinations', async () => {
  const { mobileTarget } = await import('../src/lib/mobileFiles.ts');
  assert.deepEqual(mobileTarget('Report.docx'), { privateFile: true, path: 'documents/Report.docx', identity: 'data:documents/Report.docx' });
  assert.equal(mobileTarget('Report.docx', 'data:documents/Report.docx').privateFile, true);
  assert.deepEqual(mobileTarget('Report.docx', 'Report.docx'), { privateFile: false, path: 'Report.docx', identity: 'Report.docx' });
  assert.equal(mobileTarget('../Report.docx').path, 'documents/Report.docx');
  assert.throws(() => mobileTarget('Report.docx', '../private.json'));
  assert.throws(() => mobileTarget('..'));
});
test('free preview has no editing access and beta access is explicitly labelled', async () => {
  const { releaseEdition } = await import('../src/lib/edition.ts');
  assert.equal(releaseEdition('free-preview').canEdit, false);
  assert.equal(releaseEdition('beta').canEdit, true);
  assert.match(releaseEdition('beta').label, /Beta/);
});
test('unconfigured commercial channel cannot masquerade as verified Pro access', async () => {
  const { releaseEdition } = await import('../src/lib/edition.ts');
  for (const channel of ['store', 'production', 'pro', 'paid', 'unexpected']) assert.throws(() => releaseEdition(channel), /Store release is not configured/);
});
