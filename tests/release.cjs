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
test('new mobile copies avoid case-insensitive collisions and respect UTF-8 filename limits', async () => {
  const { unusedMobileTarget } = await import('../src/lib/mobileFiles.ts');
  assert.equal(unusedMobileTarget('Report.docx', ['report.docx', 'Report (2).docx']).path, 'documents/Report (3).docx');
  const target = unusedMobileTarget('Ü'.repeat(200) + '.docx', []);
  assert.ok(new TextEncoder().encode(target.path.split('/').pop()).length <= 240);
  assert.ok(target.path.endsWith('.docx'));
});
test('mobile library paths reject traversal and binary reads retain all byte values', async () => {
  const { mobileDocumentPath, decodeMobileData } = await import('../src/lib/mobileFiles.ts');
  for (const value of ['../secret', '/file', 'a/b', 'a\\b', 'file\0name', '..', ' name ']) assert.throws(() => mobileDocumentPath(value));
  const data = new Uint8Array([0, 1, 128, 255]);
  assert.deepEqual(await decodeMobileData('AAGA/w=='), data);
  assert.deepEqual(await decodeMobileData(new Blob([data])), data);
});
test('missing mobile directory is distinct from permission and other filesystem errors', async () => {
  const { missingMobileFile } = await import('../src/lib/mobileFiles.ts');
  assert.equal(missingMobileFile({ code: 'ENOENT' }), true);
  assert.equal(missingMobileFile(new Error('Directory does not exist.')), true);
  assert.equal(missingMobileFile({ code: 'EACCES', message: 'Access denied' }), false);
});
test('unconfigured commercial channel cannot masquerade as verified Pro access', async () => {
  const { releaseEdition } = await import('../src/lib/edition.ts');
  for (const channel of ['store', 'production', 'pro', 'paid', 'unexpected']) assert.throws(() => releaseEdition(channel), /Store release is not configured/);
});
