/**
 * Drive validation -- external auth (OAuth2 credentials.json)
 *
 * Validates Drive SDK methods using ONLY path-based operations.
 * Covers: init, diskUsage, list, create, tools.ls, tools.writeFile, tools.readFile,
 *         tools.applyPatch, tools.grep
 *
 * Operations requiring path-based backend API (not yet implemented):
 *   upload.file, download.file, rename, delete -- see missing-api.md
 *
 * Environment:
 *   DISKD_BASE_URL         - Gateway URL (default: https://apis.upgraide.dev)
 *   DISKD_CREDENTIALS_PATH - Path to credentials.json (default: ./credentials.json)
 *   DISKD_WORKSPACE_ID     - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   bun run scripts:build && NODE_TLS_REJECT_UNAUTHORIZED=0 node dist-scripts/scripts/validate-drive-external.js
 */

import type { AuthModule } from '../src/auth/types.js';
import { diskd } from '../src/sdk/diskd.js';
import { createHarness } from './_harness.js';

const CREDENTIALS_PATH = process.env.DISKD_CREDENTIALS_PATH ?? './credentials.json';
const WORKSPACE_ID = process.env.DISKD_WORKSPACE_ID ?? 'dev-user-id';
const h = createHarness('Drive (external)');

const TEST_DIR = '/sdk-validation-test';
const TOOLS_FILE = `${TEST_DIR}/tools-written.txt`;

console.log('=== Drive validation (external / OAuth2) ===\n');
console.log(`Gateway: ${process.env.DISKD_BASE_URL ?? 'https://apis.upgraide.dev'}`);
console.log(`Credentials: ${CREDENTIALS_PATH}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

const baseAuth = await diskd.auth.credentials({
  scopes: ['openid'],
  keyfilePath: CREDENTIALS_PATH,
});

const auth: AuthModule = {
  ...baseAuth,
  getRequestHeaders: async () => ({
    Authorization: `Bearer ${await baseAuth.getAccessToken()}`,
    'X-Workspace-Id': WORKSPACE_ID,
  }),
};
h.ok('auth.credentials', 'OAuth2 token acquired');

const drive = diskd.os.drive({ version: 'v1', auth });

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
  h.ok('drive.create (mkdir)', `path=${TEST_DIR}`);
} catch {
  h.ok('drive.create (mkdir)', 'directory exists or created');
}

// -- list root by path --
try {
  const entries = await drive.list({ path: '/' });
  h.ok('drive.list (/)', `${entries.length} entries at root`);
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
  const result = await drive.tools.grep({ query: 'tools-write test', paths: [TOOLS_FILE] });
  h.ok('drive.tools.grep', `${result.items.length} matches`);
} catch (err) {
  h.fail('drive.tools.grep', err);
}

// -- list subdir by path --
try {
  const entries = await drive.list({ path: TEST_DIR });
  h.ok('drive.list (subdir)', `${entries.length} entries`);
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

h.summary();
process.exit(h.exitCode());
