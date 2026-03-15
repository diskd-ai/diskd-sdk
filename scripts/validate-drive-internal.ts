/**
 * Drive validation -- internal auth (API key)
 *
 * Validates Drive SDK methods using ONLY path-based operations.
 * Covers: init, diskUsage, list, create, tools.ls, tools.writeFile, tools.readFile,
 *         tools.applyPatch, tools.grep
 *
 * Operations requiring path-based backend API (not yet implemented):
 *   upload.file, download.file, rename -- see missing-api.md
 *
 * Environment:
 *   DISKD_BASE_URL  - Gateway URL (default: https://apis.diskd.local:8080)
 *   API_KEY         - API key (default: key-dev-1234567890)
 *   WORKSPACE_ID    - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   DISKD_BASE_URL=https://apis.diskd.local:8080 NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *     bun run scripts:build && node dist-scripts/scripts/validate-drive-internal.js
 */

import { diskd } from '../src/sdk/diskd.js';
import { createHarness } from './_harness.js';

const API_KEY = process.env.API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';
const BASE_URL = process.env.DISKD_BASE_URL ?? 'https://apis.diskd.local:8080';
const h = createHarness('Drive (internal)');

const TEST_DIR = '/sdk-validation-test';
const TOOLS_FILE = `${TEST_DIR}/tools-written.txt`;

console.log('=== Drive validation (internal / API key) ===\n');
console.log(`Gateway: ${BASE_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

const driveAuth = diskd.auth.apiKey({ apiKey: API_KEY, workspaceId: WORKSPACE_ID });
h.ok('auth', 'api_key configured');

const driveUrl = `${BASE_URL}/os/drive/api/v1`;
const drive = diskd.os.drive({ version: 'v1', auth: driveAuth, url: driveUrl });

// -- init --
try {
  await drive.init();
  h.ok('drive.init');
} catch (err) {
  h.fail('drive.init', err);
}

// -- diskUsage --
try {
  const usage = await drive.diskUsage();
  h.ok('drive.diskUsage', `used=${usage.used} bytes`);
} catch (err) {
  h.fail('drive.diskUsage', err);
}

// -- create dir (root-level, no parent needed) --
try {
  await drive.create({ dirName: 'sdk-validation-test' });
  h.ok('drive.create', `mkdir ${TEST_DIR}`);
} catch {
  h.ok('drive.create', `${TEST_DIR} already exists`);
}

// -- list root by path --
try {
  const entries = await drive.list({ path: '/' });
  const names = entries.map((e) => e.name).join(', ');
  h.ok('drive.list (/)', `${entries.length} entries: ${names}`);
} catch (err) {
  h.fail('drive.list (/)', err);
}

// -- tools.ls (root) --
try {
  const result = await drive.tools.ls({ path: '/' });
  h.ok('drive.tools.ls (/)', `${result.items.length} items`);
} catch (err) {
  h.fail('drive.tools.ls (/)', err);
}

// -- tools.writeFile --
const toolsWriteContent = `tools-write test ${Date.now()}`;
try {
  const result = await drive.tools.writeFile({ path: TOOLS_FILE, content: toolsWriteContent });
  h.ok('drive.tools.writeFile', `path=${result.path}`);
} catch (err) {
  h.fail('drive.tools.writeFile', err);
}

// -- tools.readFile --
try {
  const result = await drive.tools.readFile({ path: TOOLS_FILE });
  const text = result.parts.map((p) => p.content).join('');
  if (text.includes('tools-write test')) {
    h.ok('drive.tools.readFile', `${result.parts.length} part(s), content matches`);
  } else {
    h.fail('drive.tools.readFile', `unexpected content: "${text.slice(0, 50)}"`);
  }
} catch (err) {
  h.fail('drive.tools.readFile', err);
}

// -- tools.applyPatch --
try {
  const patch = [
    `--- a${TOOLS_FILE}`,
    `+++ b${TOOLS_FILE}`,
    '@@ -1 +1,2 @@',
    ` ${toolsWriteContent}`,
    '+patched line added by applyPatch',
  ].join('\n');

  const result = await drive.tools.applyPatch({ path: TOOLS_FILE, patch });
  h.ok('drive.tools.applyPatch', `path=${result.path}`);
} catch (err) {
  h.fail('drive.tools.applyPatch', err);
}

// -- verify patch via tools.readFile --
try {
  const result = await drive.tools.readFile({ path: TOOLS_FILE });
  const text = result.parts.map((p) => p.content).join('');
  if (text.includes('patched line added by applyPatch')) {
    h.ok('drive.tools.readFile (verify patch)', 'patched content found');
  } else {
    h.fail('drive.tools.readFile (verify patch)', `patch not applied: "${text.slice(0, 80)}"`);
  }
} catch (err) {
  h.fail('drive.tools.readFile (verify patch)', err);
}

// -- tools.ls (subdir) --
try {
  const result = await drive.tools.ls({ path: TEST_DIR });
  h.ok('drive.tools.ls (subdir)', `${result.items.length} items`);
} catch (err) {
  h.fail('drive.tools.ls (subdir)', err);
}

// -- tools.grep --
try {
  const result = await drive.tools.grep({ pattern: 'tools-write test', path: TEST_DIR });
  h.ok('drive.tools.grep', `${result.items.length} matches`);
} catch (err) {
  h.fail('drive.tools.grep', err);
}

// -- list subdir by path --
try {
  const entries = await drive.list({ path: TEST_DIR });
  const names = entries.map((e) => e.name).join(', ');
  h.ok('drive.list (subdir)', `${entries.length} files: ${names}`);
} catch (err) {
  h.fail('drive.list (subdir)', err);
}

// -- delete by path --
try {
  await drive.delete({ paths: [TEST_DIR], recursive: true });
  h.ok('drive.delete (recursive)', `${TEST_DIR} deleted`);
} catch (err) {
  h.fail('drive.delete', err);
}

// -- verify deletion --
try {
  const entries = await drive.list({ path: '/' });
  const still = entries.find((e) => e.name === 'sdk-validation-test');
  if (!still) {
    h.ok('drive.verify', 'directory gone');
  } else {
    h.fail('drive.verify', 'directory still present');
  }
} catch (err) {
  h.fail('drive.verify', err);
}

h.summary();
process.exit(h.exitCode());
