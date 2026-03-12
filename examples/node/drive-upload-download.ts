/**
 * Drive SDK -- upload and download convenience methods example
 *
 * Demonstrates:
 *   1. Upload a text file (buffer mode) with progress tracking
 *   2. Download the uploaded file (stream mode) with progress tracking
 *   3. Collect the download stream into a buffer
 *   4. Verify that the downloaded content matches the original
 *   5. Clean up (delete the uploaded file)
 *
 * Environment:
 *   DRIVE_API_URL   - Drive service URL (default: http://localhost:8000/api/v1)
 *   DRIVE_API_KEY   - API key (default: key-dev-1234567890)
 *   WORKSPACE_ID    - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   npm run examples:build && node dist-examples/node/drive-upload-download.js
 */

import { createApiKeyAuth } from '../../src/auth/createApiKeyAuth.js';
import { diskd } from '../../src/sdk/diskd.js';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const DRIVE_API_URL = process.env.DRIVE_API_URL ?? 'http://localhost:8000/api/v1';
const DRIVE_API_KEY = process.env.DRIVE_API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';

// ---------------------------------------------------------------------------
// Create Drive client via diskd factory (internal service pattern)
// ---------------------------------------------------------------------------

const auth = createApiKeyAuth({
  apiKey: DRIVE_API_KEY,
  workspaceId: WORKSPACE_ID,
});

const drive = diskd.drive({ version: 'v1', auth, url: DRIVE_API_URL });

console.log(`Connecting to Drive at ${DRIVE_API_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

// ---------------------------------------------------------------------------
// Prepare example content
// ---------------------------------------------------------------------------

const FILENAME = `sdk-example-${Date.now()}.txt`;
const ORIGINAL_CONTENT = [
  'Drive SDK upload/download example',
  `Uploaded at: ${new Date().toISOString()}`,
  '',
  'The quick brown fox jumps over the lazy dog.',
  'Pack my box with five dozen liquor jugs.',
  '',
  'End of example file.',
].join('\n');

const encoder = new TextEncoder();
const contentBytes = encoder.encode(ORIGINAL_CONTENT);

// ---------------------------------------------------------------------------
// 1. Initialize drive workspace
// ---------------------------------------------------------------------------

await drive.init();
console.log('[ok] Drive initialized');

// ---------------------------------------------------------------------------
// 2. Upload the file (buffer mode) with progress tracking
// ---------------------------------------------------------------------------

console.log(`\n=== 1. Upload file (buffer mode) ===`);
console.log(`     Filename : ${FILENAME}`);
console.log(`     Size     : ${contentBytes.byteLength} bytes`);

const uploadResult = await drive.upload.file({
  name: FILENAME,
  data: contentBytes,
  mimeType: 'text/plain',
  onProgress: (uploaded, total) => {
    const pct = total > 0 ? Math.round((uploaded / total) * 100) : 0;
    process.stdout.write(`\r     Progress : ${uploaded}/${total} bytes (${pct}%)    `);
  },
});

process.stdout.write('\n');
console.log(`[ok] Upload complete`);
console.log(`     inode      : ${uploadResult.inode}`);
console.log(`     etag       : ${uploadResult.etag}`);
console.log(`     version    : ${uploadResult.version}`);
console.log(`     committedAt: ${uploadResult.committedAt}`);
console.log(`     intentId   : ${uploadResult.intentId}`);

const uploadedInode = uploadResult.inode;

// ---------------------------------------------------------------------------
// 3. Download the uploaded file (stream mode) with progress tracking
// ---------------------------------------------------------------------------

console.log(`\n=== 2. Download file (stream mode) ===`);
console.log(`     inode: ${uploadedInode}`);

const downloadResult = await drive.download.file({
  inode: uploadedInode,
  onProgress: (downloaded, total) => {
    const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
    process.stdout.write(`\r     Progress : ${downloaded}/${total} bytes (${pct}%)    `);
  },
});

process.stdout.write('\n');
console.log(`[ok] Download stream acquired`);
console.log(`     size    : ${downloadResult.size} bytes`);
console.log(`     mimeType: ${downloadResult.mimeType ?? '(not specified)'}`);

// ---------------------------------------------------------------------------
// 4. Collect the stream into a buffer
// ---------------------------------------------------------------------------

console.log(`\n=== 3. Collect stream into buffer ===`);

const chunks: Uint8Array[] = [];
const reader = downloadResult.stream.getReader();

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
} finally {
  reader.releaseLock();
}

const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
const downloadedBytes = new Uint8Array(totalLength);
let offset = 0;
for (const chunk of chunks) {
  downloadedBytes.set(chunk, offset);
  offset += chunk.byteLength;
}

const decoder = new TextDecoder();
const downloadedContent = decoder.decode(downloadedBytes);

console.log(`[ok] Collected ${downloadedBytes.byteLength} byte(s) from stream`);

// ---------------------------------------------------------------------------
// 5. Verify content matches original
// ---------------------------------------------------------------------------

console.log(`\n=== 4. Verify content ===`);

const contentMatches = downloadedContent === ORIGINAL_CONTENT;
const sizeMatches = downloadedBytes.byteLength === contentBytes.byteLength;

console.log(`     Original size  : ${contentBytes.byteLength} bytes`);
console.log(`     Downloaded size: ${downloadedBytes.byteLength} bytes`);
console.log(`     Size match     : ${sizeMatches ? 'YES' : 'NO (MISMATCH)'}`);
console.log(`     Content match  : ${contentMatches ? 'YES' : 'NO (MISMATCH)'}`);

if (!contentMatches || !sizeMatches) {
  // Print a diff preview to aid debugging
  console.log('\n     Original (first 120 chars):');
  console.log(`     ${JSON.stringify(ORIGINAL_CONTENT.slice(0, 120))}`);
  console.log('     Downloaded (first 120 chars):');
  console.log(`     ${JSON.stringify(downloadedContent.slice(0, 120))}`);
  throw new Error('Content verification failed: uploaded and downloaded content do not match');
}

console.log('[ok] Content verified successfully');

// ---------------------------------------------------------------------------
// 6. Show downloaded content
// ---------------------------------------------------------------------------

console.log(`\n=== 5. Downloaded content ===`);
for (const line of downloadedContent.split('\n')) {
  console.log(`     ${line}`);
}

// ---------------------------------------------------------------------------
// 7. Clean up -- delete the uploaded file
// ---------------------------------------------------------------------------

console.log(`\n=== 6. Clean up ===`);

const deleteResult = await drive.delete({
  inodes: [uploadedInode],
  recursive: false,
});

console.log(`[ok] Deleted inode ${uploadedInode}`);
console.log(`     success: ${deleteResult.success}`);
console.log(`     freed  : ${deleteResult.size} bytes`);

console.log('\n[done] Upload/download example completed successfully');
