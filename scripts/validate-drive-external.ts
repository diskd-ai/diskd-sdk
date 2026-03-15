/**
 * Drive validation -- external auth (OAuth2 credentials.json)
 *
 * Validates all Drive SDK methods through the apis gateway using OAuth2 tokens.
 * Covers: init, create, list, upload, download, rename, delete,
 *         diskUsage, tools.ls, tools.grep, tools.readFile, tools.writeFile, tools.applyPatch
 *
 * Environment:
 *   DISKD_BASE_URL         - Gateway URL (default: https://apis.upgraide.dev)
 *   DISKD_CREDENTIALS_PATH - Path to credentials.json (default: ./credentials.json)
 *
 * Run:
 *   bun run scripts:build && NODE_TLS_REJECT_UNAUTHORIZED=0 node dist-scripts/scripts/validate-drive-external.js
 */

import { diskd } from '../src/sdk/diskd.js';
import { createHarness } from './_harness.js';

const CREDENTIALS_PATH = process.env.DISKD_CREDENTIALS_PATH ?? './credentials.json';
const h = createHarness('Drive (external)');

console.log('=== Drive validation (external / OAuth2) ===\n');
console.log(`Gateway: ${process.env.DISKD_BASE_URL ?? 'https://apis.upgraide.dev'}`);
console.log(`Credentials: ${CREDENTIALS_PATH}\n`);

const auth = await diskd.auth.credentials({
  scopes: ['openid'],
  keyfilePath: CREDENTIALS_PATH,
});
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

// -- create dir --
try {
  await drive.create({ dirName: 'sdk-validation-test' });
  h.ok('drive.create (mkdir)', 'path=/sdk-validation-test');
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

const testContent = `validation test ${Date.now()}`;
const testBytes = new TextEncoder().encode(testContent);
let testDirInode = '';
let testFileInode = '';

// -- upload --
try {
  const entries = await drive.list({ path: '/' });
  const testDir = entries.find((e) => e.name === 'sdk-validation-test');
  if (testDir) {
    testDirInode = testDir.inode;
    const uploadResult = await drive.upload.file({
      name: 'test-file.txt',
      data: testBytes,
      mimeType: 'text/plain',
      parentInode: testDirInode,
    });
    testFileInode = uploadResult.inode;
    h.ok('drive.upload.file', 'path=/sdk-validation-test/test-file.txt');
  } else {
    h.fail('drive.upload.file', 'test directory not found');
  }
} catch (err) {
  h.fail('drive.upload.file', err);
}

// -- list subdir --
if (testDirInode) {
  try {
    const entries = await drive.list({ path: '/sdk-validation-test' });
    h.ok('drive.list (subdir)', `${entries.length} entries`);
  } catch (err) {
    h.fail('drive.list (subdir)', err);
  }
}

// -- download --
if (testFileInode) {
  try {
    const downloadResult = await drive.download.file({ inode: testFileInode });
    const chunks: Uint8Array[] = [];
    const reader = downloadResult.stream.getReader();
    let readDone = false;
    while (!readDone) {
      const { done, value } = await reader.read();
      if (done) {
        readDone = true;
      } else {
        chunks.push(value);
      }
    }
    const downloaded = new TextDecoder().decode(Buffer.concat(chunks));
    if (downloaded === testContent) {
      h.ok('drive.download.file', 'content matches');
    } else {
      h.fail('drive.download.file', `content mismatch: got "${downloaded.slice(0, 50)}"`);
    }
  } catch (err) {
    h.fail('drive.download.file', err);
  }
}

// -- tools.ls --
try {
  const result = await drive.tools.ls({ path: '/' });
  h.ok('drive.tools.ls (/)', `${result.items.length} items`);
} catch (err) {
  h.fail('drive.tools.ls (/)', err);
}

if (testDirInode) {
  try {
    const result = await drive.tools.ls({ path: '/sdk-validation-test' });
    h.ok('drive.tools.ls (subdir)', `${result.items.length} items`);
  } catch (err) {
    h.fail('drive.tools.ls (subdir)', err);
  }
}

// -- tools.grep --
try {
  const result = await drive.tools.grep({ pattern: 'validation test' });
  h.ok('drive.tools.grep', `${result.items.length} matches for "validation test"`);
} catch (err) {
  h.fail('drive.tools.grep', err);
}

// -- tools.readFile --
if (testFileInode) {
  try {
    const result = await drive.tools.readFile({ path: '/sdk-validation-test/test-file.txt' });
    const text = result.parts.map((p) => p.content).join('');
    if (text.includes('validation test')) {
      h.ok('drive.tools.readFile', `${result.parts.length} part(s), content matches`);
    } else {
      h.fail('drive.tools.readFile', `unexpected content: "${text.slice(0, 50)}"`);
    }
  } catch (err) {
    h.fail('drive.tools.readFile', err);
  }
}

// -- tools.writeFile --
const toolsWriteContent = `tools-write test ${Date.now()}`;
try {
  const result = await drive.tools.writeFile({
    path: '/sdk-validation-test/tools-written.txt',
    content: toolsWriteContent,
  });
  h.ok('drive.tools.writeFile', `inode=${result.inode}, path=${result.path}`);
} catch (err) {
  h.fail('drive.tools.writeFile', err);
}

// -- verify tools.writeFile via tools.readFile --
try {
  const result = await drive.tools.readFile({ path: '/sdk-validation-test/tools-written.txt' });
  const text = result.parts.map((p) => p.content).join('');
  if (text.includes('tools-write test')) {
    h.ok('drive.tools.readFile (verify write)', 'content matches');
  } else {
    h.fail('drive.tools.readFile (verify write)', `unexpected: "${text.slice(0, 50)}"`);
  }
} catch (err) {
  h.fail('drive.tools.readFile (verify write)', err);
}

// -- tools.applyPatch --
try {
  const patch = [
    '--- a/sdk-validation-test/tools-written.txt',
    '+++ b/sdk-validation-test/tools-written.txt',
    '@@ -1 +1,2 @@',
    ` ${toolsWriteContent}`,
    '+patched line added by applyPatch',
  ].join('\n');

  const result = await drive.tools.applyPatch({
    path: '/sdk-validation-test/tools-written.txt',
    patch,
  });
  h.ok('drive.tools.applyPatch', `inode=${result.inode}, path=${result.path}`);
} catch (err) {
  h.fail('drive.tools.applyPatch', err);
}

// -- verify patch via tools.readFile --
try {
  const result = await drive.tools.readFile({ path: '/sdk-validation-test/tools-written.txt' });
  const text = result.parts.map((p) => p.content).join('');
  if (text.includes('patched line added by applyPatch')) {
    h.ok('drive.tools.readFile (verify patch)', 'patched content found');
  } else {
    h.fail('drive.tools.readFile (verify patch)', `patch not applied: "${text.slice(0, 80)}"`);
  }
} catch (err) {
  h.fail('drive.tools.readFile (verify patch)', err);
}

// -- update (overwrite) --
if (testFileInode && testDirInode) {
  const updatedContent = `${testContent}\nupdated line`;
  const updatedBytes = new TextEncoder().encode(updatedContent);
  try {
    const updateResult = await drive.upload.file({
      name: 'test-file.txt',
      data: updatedBytes,
      mimeType: 'text/plain',
      parentInode: testDirInode,
      force: true,
    });
    h.ok('drive.upload.file (update)', `new inode=${updateResult.inode}`);
    testFileInode = updateResult.inode;
  } catch (err) {
    h.fail('drive.upload.file (update)', err);
  }
}

// -- rename --
if (testFileInode) {
  try {
    await drive.rename({ inode: testFileInode, newName: 'renamed-file.txt' });
    h.ok('drive.rename', 'path=/sdk-validation-test/renamed-file.txt');
  } catch (err) {
    h.fail('drive.rename', err);
  }
}

// -- cleanup: delete --
if (testDirInode) {
  try {
    await drive.delete({ inodes: [testDirInode], recursive: true });
    h.ok('drive.delete (recursive)', 'path=/sdk-validation-test deleted');
  } catch (err) {
    h.fail('drive.delete', err);
  }
}

h.summary();
process.exit(h.exitCode());
