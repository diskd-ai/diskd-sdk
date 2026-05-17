/**
 * Drive Messages Store Review -- API example.
 *
 * Exercises the singleton workspace review box over the APIS gateway:
 *   1. review.create
 *   2. review.list
 *   3. review.get
 *   4. review.delete
 *
 * Authenticates with OAuth2 via `.agents/credentials-dev.json` by default.
 *
 * Usage:
 *   bun run build
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *   bun examples/node/messages-store-review-example.ts
 *
 * Environment:
 *   DISKD_CREDENTIALS_PATH -- override credentials file path
 *                             (default: .agents/credentials-dev.json)
 *   APIS_BASE_URL          -- override gateway URL
 *                             (default resolved from keyfile.apisUrl)
 */

import path from 'node:path';

import { diskd } from '@diskd-ai/sdk';

const DEFAULT_CREDENTIALS = path.resolve(process.cwd(), '.agents', 'credentials-dev.json');
const credentialsPath =
  process.argv[2] ?? process.env.DISKD_CREDENTIALS_PATH ?? DEFAULT_CREDENTIALS;
const runId = `${Date.now()}`;
const reviewId = `sdk-review-example-${runId}`;

/** Convert thrown values to readable messages at the CLI boundary. */
const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Fail loudly if the singleton review list cannot find the created item. */
const assertListed = (reviewIds: readonly string[]): void => {
  if (!reviewIds.includes(reviewId)) {
    throw new Error(`review.list did not include ${reviewId}`);
  }
};

/** Run the review lifecycle against the configured APIS gateway. */
const main = async (): Promise<void> => {
  console.log('Drive Messages Store Review -- API example');
  console.log('-'.repeat(60));
  console.log(`  Credentials: ${credentialsPath}`);
  console.log(`  Review ID:   ${reviewId}`);
  console.log('-'.repeat(60));

  console.log('\n[auth] Authenticating...');
  const auth = await diskd.auth.credentials({
    scopes: ['openid'],
    keyfilePath: credentialsPath,
  });
  const workspaceId = await auth.getWorkspaceId();
  console.log(`[auth] OK workspace=${workspaceId}`);
  console.log(`[auth] APIS_BASE_URL=${process.env.APIS_BASE_URL ?? 'from credentials'}`);

  const messagesStore = diskd.os.messagesStore({ auth });
  let created = false;

  try {
    console.log('\n=== 1. review.create ===');
    const createResult = await messagesStore.review.create({
      reviewId,
      payload: {
        subject: 'SDK review example',
        bodyText: 'This draft was created by the SDK review example.',
        sendAccountId: 'example-account',
        labels: ['Pending Review'],
        createdBy: 'platform-api/examples/node/messages-store-review-example.ts',
      },
    });
    created = true;
    console.log(`[ok] created reviewId=${createResult.reviewId}`);

    console.log('\n=== 2. review.list ===');
    const listed = await messagesStore.review.list({ limit: 50 });
    const reviewIds = listed.items.map((item) => item.reviewId);
    assertListed(reviewIds);
    console.log(
      `[ok] listed count=${listed.items.length} nextCursor=${listed.nextCursor ?? 'null'}`
    );

    console.log('\n=== 3. review.get ===');
    const fetched = await messagesStore.review.get({ reviewId });
    if (fetched.payload.subject !== 'SDK review example') {
      throw new Error(`unexpected subject: ${String(fetched.payload.subject)}`);
    }
    console.log(`[ok] fetched subject=${String(fetched.payload.subject)}`);

    console.log('\n=== 4. review.delete ===');
    const deleted = await messagesStore.review.delete({ reviewId });
    created = false;
    if (!deleted.deleted) {
      throw new Error(`review.delete returned deleted=false for ${reviewId}`);
    }
    console.log(`[ok] deleted reviewId=${deleted.reviewId}`);

    console.log('\n=== 5. review.get after delete (expect not found) ===');
    try {
      await messagesStore.review.get({ reviewId });
      throw new Error('review.get unexpectedly succeeded after delete');
    } catch (cause) {
      const message = errorMessage(cause);
      if (!/not.?found/i.test(message)) {
        throw cause;
      }
      console.log('[ok] deleted item is no longer readable');
    }

    console.log('\n[done] Review API example completed successfully');
  } finally {
    if (created) {
      await messagesStore.review.delete({ reviewId }).catch((cause: unknown) => {
        console.warn(`[warn] cleanup delete failed for ${reviewId}: ${errorMessage(cause)}`);
      });
    }
  }
};

main().catch((cause: unknown) => {
  console.error('Error:', errorMessage(cause));
  process.exitCode = 1;
});
