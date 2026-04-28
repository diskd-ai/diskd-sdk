/**
 * Drive Messages Store SDK -- end-to-end example.
 *
 * Demonstrates the four boundaries of `drive_messages_store` via
 * the functionally-scoped client surface:
 *   1. mailbox lifecycle  (create, list, init, delete)
 *   2. folder lifecycle   (upsert, list, get, delete)
 *   3. messages           (upsert-batch, list, get, delete-batch)
 *
 * Authenticates with OAuth2 via `.agents/credentials.json`.
 *
 * Usage:
 *   npx tsx examples/node/messages-store-example.ts [credentials-path]
 *
 * Environment:
 *   DISKD_CREDENTIALS_PATH  -- override credentials file path
 *                              (default: ../../.agents/credentials.json)
 *   APIS_BASE_URL           -- override gateway URL
 *                              (default resolved from keyfile.apisUrl)
 */

import path from 'node:path';
import type { StoredMessage } from '@diskd/sdk';
import { diskd } from '@diskd/sdk';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CREDENTIALS = path.resolve(process.cwd(), '..', '.agents', 'credentials.json');

const credentialsPath =
  process.argv[2] ?? process.env.DISKD_CREDENTIALS_PATH ?? DEFAULT_CREDENTIALS;

const RUN_ID = `${Date.now()}`;
const MAILBOX_ID = `mb-sdk-example-${RUN_ID}`;
const FOLDER_ID = 'INBOX';

/** Read a subject string out of an opaque message payload for display. */
const readSubject = (m: StoredMessage): string =>
  typeof m.payload.subject === 'string' ? m.payload.subject : '(no subject)';

// ---------------------------------------------------------------------------
// Sample messages -- payload is opaque JSON; the store never reads any field.
// ---------------------------------------------------------------------------

const sampleMessages = [
  {
    externalId: 'imap-uid-1001',
    payload: {
      subject: 'Welcome to upgraide',
      from: 'noreply@upgraide.dev',
      receivedAt: new Date().toISOString(),
      snippet: 'Thanks for signing up...',
      labels: ['inbox', 'unread'],
    },
  },
  {
    externalId: 'imap-uid-1002',
    payload: {
      subject: 'Your weekly digest',
      from: 'digest@upgraide.dev',
      receivedAt: new Date().toISOString(),
      snippet: '5 new updates this week...',
      labels: ['inbox', 'newsletter'],
    },
  },
  {
    externalId: 'imap-uid-1003',
    payload: {
      subject: 'Action required: verify your email',
      from: 'security@upgraide.dev',
      receivedAt: new Date().toISOString(),
      snippet: 'Click the link below...',
      labels: ['inbox', 'unread', 'important'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  console.log('Drive Messages Store -- SDK example');
  console.log('-'.repeat(60));
  console.log(`  Credentials: ${credentialsPath}`);
  console.log(`  Run ID:      ${RUN_ID}`);
  console.log('-'.repeat(60));

  // -- Auth --
  console.log('\n[auth] Authenticating...');
  const auth = await diskd.auth.credentials({
    scopes: ['openid'],
    keyfilePath: credentialsPath,
  });
  console.log(`[auth] OK (APIS_BASE_URL=${process.env.APIS_BASE_URL ?? 'unset'})`);

  // -- Top-level client (B-style: own factory at diskd.os.messagesStore) --
  const messagesStore = diskd.os.messagesStore({ auth });

  // ---------- Boundary 1: mailbox lifecycle ----------

  console.log('\n=== 1. createMailbox ===');
  const created = await messagesStore.createMailbox({
    mailboxId: MAILBOX_ID,
    displayName: 'SDK example mailbox',
    metadata: { protocol: 'imap', host: 'mail.example.com' },
    recreate: true,
  });
  console.log(`[ok] mailboxId=${created.mailboxId}`);
  console.log(`     dbInode=${created.dbInode}`);
  console.log(`     drivePath=${created.drivePath}`);

  // Bind a mailbox-scoped client; subsequent calls don't repeat mailboxId.
  const mailbox = messagesStore.mailbox({ mailboxId: MAILBOX_ID });

  console.log('\n=== 2. mailbox.init (idempotent schema bootstrap) ===');
  const init = await mailbox.init();
  console.log(`[ok] schemaVersion=${init.schemaVersion}`);

  console.log('\n=== 3. listMailboxes ===');
  const all = await messagesStore.listMailboxes();
  const ours = all.find((m) => m.mailboxId === MAILBOX_ID);
  console.log(`[ok] total=${all.length}, ours=${ours ? 'present' : 'missing'}`);
  if (ours) {
    console.log(
      `     records=${ours.recordCount} sizeBytes=${ours.sizeBytes} updatedAt=${ours.updatedAt}`
    );
  }

  // ---------- Boundary 2: folder lifecycle ----------

  console.log('\n=== 4. mailbox.upsertFolder (initial create) ===');
  const folderUpsert = await mailbox.upsertFolder({
    folderId: FOLDER_ID,
    displayName: 'Inbox',
    metadata: { uidvalidity: 12345, uidnext: 1100 },
  });
  console.log(`[ok] folderId=${folderUpsert.folderId} created=${folderUpsert.created}`);

  console.log('\n=== 5. mailbox.upsertFolder (second call -- expect created=false) ===');
  const folderUpsertAgain = await mailbox.upsertFolder({
    folderId: FOLDER_ID,
    displayName: 'Inbox',
    metadata: { uidvalidity: 12345, uidnext: 1101 },
  });
  console.log(`[ok] created=${folderUpsertAgain.created}`);

  // Bind a folder-scoped client; subsequent calls don't repeat ids.
  const folder = mailbox.folder({ folderId: FOLDER_ID });

  console.log('\n=== 6. mailbox.listFolders ===');
  const folders = await mailbox.listFolders();
  for (const f of folders) {
    console.log(
      `     - ${f.folderId} "${f.displayName}" messages=${f.messageCount} updatedAt=${f.updatedAt}`
    );
  }

  console.log('\n=== 7. folder.get ===');
  const folderGet = await folder.get();
  console.log(`[ok] "${folderGet.displayName}" metadata=${JSON.stringify(folderGet.metadata)}`);

  // ---------- Boundary 3: messages ----------

  console.log('\n=== 8. folder.upsertBatch (insert 3 messages) ===');
  const upsert = await folder.upsertBatch({ items: sampleMessages });
  console.log(`[ok] inserted=${upsert.inserted} updated=${upsert.updated}`);

  console.log('\n=== 9. folder.upsertBatch (re-upsert -- expect updated=3) ===');
  const upsert2 = await folder.upsertBatch({ items: sampleMessages });
  console.log(`[ok] inserted=${upsert2.inserted} updated=${upsert2.updated}`);

  console.log('\n=== 10. folder.listMessages ===');
  const listed = await folder.listMessages({ limit: 50 });
  console.log(`[ok] count=${listed.items.length} nextCursor=${listed.nextCursor ?? 'null'}`);
  for (const m of listed.items) {
    const subject = readSubject(m);
    console.log(`     - ${m.externalId} -- "${subject}"`);
  }

  console.log('\n=== 11. folder.getMessage ===');
  const fetched = await folder.getMessage({ externalId: 'imap-uid-1002' });
  console.log(`[ok] "${readSubject(fetched)}" (created=${fetched.createdAt})`);

  console.log('\n=== 12. folder.deleteBatch (remove 2 of 3) ===');
  const deleteBatch = await folder.deleteBatch({
    externalIds: ['imap-uid-1001', 'imap-uid-1003'],
  });
  console.log(`[ok] deleted=${deleteBatch.deleted}`);

  const remaining = await folder.listMessages();
  console.log(`     remaining=${remaining.items.length}`);

  // ---------- Cleanup ----------

  console.log('\n=== 13. folder.delete ===');
  const folderDelete = await folder.delete();
  console.log(
    `[ok] deleted=${folderDelete.deleted} cascaded=${folderDelete.deletedMessageCount} message(s)`
  );

  console.log('\n=== 14. mailbox.delete ===');
  const mailboxDelete = await mailbox.delete();
  console.log(`[ok] deleted=${mailboxDelete.deleted}`);

  console.log('\n[done] Messages Store example completed successfully');
};

main().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
