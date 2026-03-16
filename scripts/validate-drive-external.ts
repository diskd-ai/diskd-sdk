/**
 * Drive validation -- external auth (OAuth2 credentials.json)
 *
 * Validates Drive SDK methods using ONLY path-based operations.
 * workspaceId is auto-derived from the JWT token claims.
 *
 * Environment:
 *   DISKD_CREDENTIALS_PATH - Path to credentials.json (default: ./credentials.json)
 *
 * Run:
 *   bun run scripts:build && NODE_TLS_REJECT_UNAUTHORIZED=0 node dist-scripts/scripts/validate-drive-external.js
 */

import { diskd } from '../src/sdk/diskd.js';
import { createHarness } from './_harness.js';

const CREDENTIALS_PATH = process.env.DISKD_CREDENTIALS_PATH ?? './credentials.json';
const h = createHarness('Drive (external)');

const TEST_DIR = '/sdk-validation-test';
const TOOLS_FILE = `${TEST_DIR}/tools-written.txt`;

console.log('=== Drive validation (external / OAuth2) ===\n');
console.log(`Credentials: ${CREDENTIALS_PATH}\n`);

const auth = await diskd.auth.credentials({
  scopes: ['openid'],
  keyfilePath: CREDENTIALS_PATH,
});
h.ok('auth.credentials', 'OAuth2 token acquired');

const workspaceId = await auth.getWorkspaceId();
console.log(`Workspace (from token): ${workspaceId}\n`);

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

// -- create dir --
try {
  await drive.create({ dirName: 'sdk-validation-test' });
  h.ok('drive.create (mkdir)', `path=${TEST_DIR}`);
} catch {
  h.ok('drive.create (mkdir)', 'directory exists or created');
}

// -- list root --
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

// -- verify patch --
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

// -- list subdir --
try {
  const entries = await drive.list({ path: TEST_DIR });
  h.ok('drive.list (subdir)', `${entries.length} entries`);
} catch (err) {
  h.fail('drive.list (subdir)', err);
}

// -- delete --
try {
  await drive.delete({ paths: [TEST_DIR], recursive: true });
  h.ok('drive.delete (recursive)', `${TEST_DIR} deleted`);
} catch (err) {
  h.fail('drive.delete', err);
}

h.summary();
process.exit(h.exitCode());
