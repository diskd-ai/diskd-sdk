/**
 * Web Navigator SDK -- internal service example
 *
 * Demonstrates URL resolution and scrape job submission
 * using the diskd.webNavigator() factory with API key auth.
 *
 * Environment:
 *   WEB_NAVIGATOR_URL - Web Navigator service URL (default: http://localhost:8080)
 *   WEB_NAV_API_KEY   - API key (default: key-dev-1234567890)
 *   WORKSPACE_ID      - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   npm run examples:build && node dist-examples/node/web-navigator-example.js
 */

import { createApiKeyAuth } from '../../src/auth/createApiKeyAuth.js';
import { diskd } from '../../src/sdk/diskd.js';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const WEB_NAVIGATOR_URL = process.env.WEB_NAVIGATOR_URL ?? 'http://localhost:8080';
const WEB_NAV_API_KEY = process.env.WEB_NAV_API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';

// ---------------------------------------------------------------------------
// Create Web Navigator client via diskd factory
// ---------------------------------------------------------------------------

const auth = createApiKeyAuth({
  apiKey: WEB_NAV_API_KEY,
  workspaceId: WORKSPACE_ID,
});

const webNav = diskd.webNavigator({ auth, workspaceId: WORKSPACE_ID, url: WEB_NAVIGATOR_URL });

console.log(`Connecting to Web Navigator at ${WEB_NAVIGATOR_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

// ---------------------------------------------------------------------------
// 1. Resolve URL metadata
// ---------------------------------------------------------------------------

console.log('=== 1. Resolve URL metadata ===');

const TARGET_URL = process.env.SCRAPE_URL ?? 'https://example.com';

try {
  const resolved = await webNav.resolve({ url: TARGET_URL });
  console.log(`[ok] Resolved "${TARGET_URL}":`);
  console.log(`     Title      : ${resolved.title ?? '(none)'}`);
  console.log(`     Description: ${(resolved.description ?? '(none)').slice(0, 80)}`);
  console.log(`     Favicon    : ${resolved.favicon ?? '(none)'}`);
  console.log(`     DB Name    : ${resolved.dbname}`);
} catch (err) {
  console.log(`[error] Could not resolve URL: ${err instanceof Error ? err.message : String(err)}`);
}

// ---------------------------------------------------------------------------
// 2. Submit a scrape job
// ---------------------------------------------------------------------------

console.log('\n=== 2. Submit scrape job ===');

try {
  const submitResult = await webNav.scrape.submit({
    url: TARGET_URL,
    depth: 0,
    maxPages: 5,
    timeout: 15,
    blockImages: true,
    blockMedia: true,
  });

  console.log(`[ok] Job submitted:`);
  console.log(`     Job ID : ${submitResult.jobId}`);
  console.log(`     Status : ${submitResult.status}`);
  console.log(`     Message: ${submitResult.message}`);

  // ---------------------------------------------------------------------------
  // 3. Poll job status
  // ---------------------------------------------------------------------------

  console.log('\n=== 3. Check job status ===');

  const jobStatus = await webNav.scrape.getStatus(submitResult.jobId);
  console.log(`[ok] Job ${jobStatus.jobId}:`);
  console.log(`     Status  : ${jobStatus.status}`);
  console.log(`     Attempts: ${jobStatus.attempts}/${jobStatus.maxRetries}`);
  if (jobStatus.progress) {
    console.log(`     Progress: ${jobStatus.progress.scrapedPages}/${jobStatus.progress.totalDiscovered} pages`);
  }

  // ---------------------------------------------------------------------------
  // 4. Get full job details
  // ---------------------------------------------------------------------------

  console.log('\n=== 4. Full job details ===');

  const job = await webNav.scrape.getJob(submitResult.jobId);
  console.log(`[ok] Job ${job.id}:`);
  console.log(`     Status   : ${job.status}`);
  console.log(`     Created  : ${job.createdAt}`);
  console.log(`     Updated  : ${job.updatedAt}`);
  console.log(`     URL      : ${job.request.url}`);

  if (job.status === 'completed' && job.result) {
    console.log(`     Pages    : ${job.result.summary.totalPages} (${job.result.summary.successfulPages} ok, ${job.result.summary.failedPages} failed)`);
    console.log(`     Duration : ${job.result.summary.duration}ms`);
    for (const page of job.result.pages.slice(0, 3)) {
      console.log(`       - ${page.url} [${page.statusCode}] "${page.title ?? '(no title)'}"`);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Cancel the job (cleanup)
  // ---------------------------------------------------------------------------

  if (job.status === 'queued' || job.status === 'processing') {
    console.log('\n=== 5. Cancel job ===');
    const cancelled = await webNav.scrape.cancel(submitResult.jobId);
    console.log(`[ok] Cancelled job ${cancelled.id} (status=${cancelled.status})`);
  }
} catch (err) {
  console.log(`[error] Scrape operation failed: ${err instanceof Error ? err.message : String(err)}`);
}

console.log('\n[done] All Web Navigator operations completed successfully');
