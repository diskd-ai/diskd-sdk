import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const DRIVE_API_URL = process.env.DRIVE_API_URL;
const TEST_DIR = `__sdk-integration-${Date.now()}`;

const makeDrive = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ workspaceId: check.env.workspaceId });
  return diskd.os.drive({ version: 'v1', auth, ...(DRIVE_API_URL ? { url: DRIVE_API_URL } : {}) });
};

// -- Init & basic reads --

test('integration: drive.init succeeds', { skip: skipReason }, async () => {
  const drive = makeDrive();
  await drive.init();
});

test('integration: drive.list returns entries for root', { skip: skipReason }, async () => {
  const drive = makeDrive();
  const entries = await drive.list({ path: '/' });
  assert.ok(Array.isArray(entries));
});

test('integration: drive.diskUsage returns numeric used field', { skip: skipReason }, async () => {
  const drive = makeDrive();
  const usage = await drive.diskUsage();
  assert.equal(typeof usage.used, 'number');
});

// -- Directory CRUD flow --

test('integration: drive create → list → rename → delete directory', {
  skip: skipReason,
}, async () => {
  const drive = makeDrive();

  // create
  const created = await drive.create({ dirName: TEST_DIR, parentPath: '/' });
  assert.ok(created.id);

  try {
    // list parent to see new dir
    const entries = await drive.list({ path: '/' });
    const found = entries.find((e) => e.name === TEST_DIR);
    assert.ok(found, `directory ${TEST_DIR} should appear in listing`);

    // rename
    const renamed = await drive.rename({ path: `/${TEST_DIR}`, newName: `${TEST_DIR}-renamed` });
    assert.ok(renamed.id);

    // verify rename
    const entriesAfterRename = await drive.list({ path: '/' });
    assert.ok(entriesAfterRename.find((e) => e.name === `${TEST_DIR}-renamed`));
    assert.ok(!entriesAfterRename.find((e) => e.name === TEST_DIR));
  } finally {
    // cleanup -- delete (try both names)
    try {
      await drive.delete({ paths: [`/${TEST_DIR}-renamed`], recursive: true });
    } catch {
      try {
        await drive.delete({ paths: [`/${TEST_DIR}`], recursive: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
});

// -- File write → ls → list → delete --

test('integration: drive tools.writeFile → ls → list → delete', {
  skip: skipReason,
}, async () => {
  const drive = makeDrive();
  const filePath = `/__sdk-ls-test-${Date.now()}.txt`;

  const writeResult = await drive.tools.writeFile({
    path: filePath,
    content: 'Hello from SDK integration test',
  });
  assert.ok(writeResult.id);

  try {
    // tools.ls should return typed entries
    const lsResult = await drive.tools.ls({ path: '/' });
    assert.ok(lsResult.entries.length > 0, 'ls should return at least one entry');

    // list should include the written file
    const entries = await drive.list({ path: '/' });
    const found = entries.find((e) => e.name === filePath.slice(1));
    assert.ok(found, `written file should appear in listing`);
    assert.equal(found?.type, 'file');
  } finally {
    await drive.delete({ paths: [filePath] });
  }
});

// -- File write → read → patch → read --

test('integration: drive tools.writeFile → readFile → applyPatch', {
  skip: skipReason,
}, async () => {
  const drive = makeDrive();
  const filePath = `/__sdk-write-test-${Date.now()}.md`;

  const writeResult = await drive.tools.writeFile({
    path: filePath,
    content: '# Original\nLine 2',
  });
  assert.ok(writeResult.id);

  try {
    // read back
    const readResult = await drive.tools.readFile({ path: filePath });
    assert.ok(readResult.parts[0]?.content?.includes('# Original'));

    // apply patch
    const patch = '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-# Original\n+# Patched';
    const patchResult = await drive.tools.applyPatch({ path: filePath, patch });
    assert.ok(patchResult.id);

    // verify patch applied
    const readAfterPatch = await drive.tools.readFile({ path: filePath });
    assert.ok(readAfterPatch.parts[0]?.content?.includes('# Patched'));
  } finally {
    await drive.delete({ paths: [filePath] });
  }
});

// -- tools.glob and tools.grep --

test('integration: drive tools.glob finds files by pattern', { skip: skipReason }, async () => {
  const drive = makeDrive();
  const filePath = `/__sdk-glob-test-${Date.now()}.txt`;

  await drive.tools.writeFile({ path: filePath, content: 'glob-test-content' });

  try {
    const globResult = await drive.tools.glob({ pattern: '__sdk-glob-test-*.txt', path: '/' });
    assert.ok(globResult.entries.length > 0, 'glob should find the test file');
  } finally {
    await drive.delete({ paths: [filePath] });
  }
});

test('integration: drive tools.grep searches file content', { skip: skipReason }, async () => {
  const drive = makeDrive();
  const filePath = `/__sdk-grep-test-${Date.now()}.txt`;

  await drive.tools.writeFile({ path: filePath, content: 'findme-unique-marker-xyz' });

  try {
    const grepResult = await drive.tools.grep({
      query: 'findme-unique-marker-xyz',
      paths: [filePath],
    });
    assert.ok(grepResult.documents.length > 0, 'grep should find the marker');
  } finally {
    await drive.delete({ paths: [filePath] });
  }
});
