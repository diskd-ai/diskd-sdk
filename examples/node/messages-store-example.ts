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

import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

/**
 * Typed row decoders for the mailbox SQLite schema.
 *
 * Concept: node:sqlite returns `Record<string, SQLOutputValue>` rows; we
 * convert each row to a domain shape at the boundary. Bad rows fail loudly
 * rather than producing silently-undefined fields downstream.
 */
type MailboxMetaRow = {
  readonly mailboxId: string;
  readonly displayName: string;
  readonly schemaVersion: number;
};

type FolderRow = {
  readonly folderId: string;
  readonly displayName: string;
};

type MessageIdRow = { readonly externalId: string };

type PayloadRow = { readonly payload: string };

const requireString = (raw: Record<string, unknown>, key: string): string => {
  const v = raw[key];
  if (typeof v !== 'string') {
    throw new Error(`SQLite row: expected string at '${key}', got ${typeof v}`);
  }
  return v;
};

const requireNumber = (raw: Record<string, unknown>, key: string): number => {
  const v = raw[key];
  if (typeof v !== 'number') {
    throw new Error(`SQLite row: expected number at '${key}', got ${typeof v}`);
  }
  return v;
};

const decodeMailboxMetaRow = (raw: Record<string, unknown>): MailboxMetaRow => ({
  mailboxId: requireString(raw, 'mailbox_id'),
  displayName: requireString(raw, 'display_name'),
  schemaVersion: requireNumber(raw, 'schema_version'),
});

const decodeFolderRow = (raw: Record<string, unknown>): FolderRow => ({
  folderId: requireString(raw, 'folder_id'),
  displayName: requireString(raw, 'display_name'),
});

const decodeMessageIdRow = (raw: Record<string, unknown>): MessageIdRow => ({
  externalId: requireString(raw, 'external_id'),
});

const decodePayloadRow = (raw: Record<string, unknown>): PayloadRow => ({
  payload: requireString(raw, 'payload'),
});

/**
 * Collect a Web ReadableStream<Uint8Array> into a single Uint8Array.
 *
 * Concept: node:sqlite needs a file path on disk, not a stream, so the
 * mailbox SQLite blob must be fully buffered before we can open it.
 * Pure helper -- the I/O lives in the caller (writeFile).
 */
const collectStream = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  chunks.reduce((offset, chunk) => {
    out.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return out;
};

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

  // -- Drive client (used later to fetch the per-mailbox SQLite file) --
  // Concept: each mailbox is backed by a `.mailbox` SQLite file on Drive at
  // `drivePath`. We reuse the same auth so the download is workspace-scoped.
  const drive = diskd.os.drive({ version: 'v1', auth });

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

  // -------------------------------------------------------------------------
  // Verify the underlying SQLite file on Drive.
  //
  // Concept: every mailbox is backed by a `.mailbox` SQLite file at
  // `created.drivePath`. We download that file via Drive, open it locally
  // with node:sqlite, and assert that the schema + the rows we just wrote
  // are physically present. This proves the mailbox API isn't lying about
  // persistence -- the bytes round-trip through Drive.
  // -------------------------------------------------------------------------
  console.log('\n=== 11b. Verify SQLite file on Drive ===');
  console.log(`     drivePath: ${created.drivePath}`);

  const downloaded = await drive.download.file({ path: created.drivePath });
  console.log(`[ok] download stream acquired (size=${downloaded.size} bytes)`);

  // Collect the stream into a single buffer; node:sqlite needs a file path,
  // so we materialise the bytes to a unique tmp file and clean up after.
  const sqliteBytes = await collectStream(downloaded.stream);
  const localDbPath = path.join(tmpdir(), `mailbox-verify-${RUN_ID}.sqlite`);
  await writeFile(localDbPath, sqliteBytes);
  console.log(`[ok] wrote ${sqliteBytes.byteLength} bytes -> ${localDbPath}`);

  const db = new DatabaseSync(localDbPath, { readOnly: true });
  try {
    // 1. mailbox_meta should hold exactly our mailboxId.
    const metaRaw = db
      .prepare('SELECT mailbox_id, display_name, schema_version FROM mailbox_meta')
      .get();
    if (!metaRaw) {
      throw new Error('mailbox_meta is empty -- schema bootstrap did not seed metadata');
    }
    const meta = decodeMailboxMetaRow(metaRaw);
    if (meta.mailboxId !== MAILBOX_ID) {
      throw new Error(
        `mailbox_meta mismatch: expected mailbox_id=${MAILBOX_ID}, got=${meta.mailboxId}`
      );
    }
    console.log(
      `[ok] mailbox_meta: id=${meta.mailboxId} name="${meta.displayName}" schema=v${meta.schemaVersion}`
    );

    // 2. folders should hold exactly our INBOX.
    const folderRows = db
      .prepare('SELECT folder_id, display_name FROM folders ORDER BY folder_id')
      .all()
      .map(decodeFolderRow);
    if (folderRows.length !== 1 || folderRows[0]?.folderId !== FOLDER_ID) {
      throw new Error(
        `folders mismatch: expected [${FOLDER_ID}], got=${JSON.stringify(folderRows)}`
      );
    }
    console.log(
      `[ok] folders (${folderRows.length}): ${folderRows.map((f) => `${f.folderId}="${f.displayName}"`).join(', ')}`
    );

    // 3. messages should hold all three external_ids we upserted.
    const actualIds = db
      .prepare('SELECT external_id FROM messages ORDER BY external_id')
      .all()
      .map(decodeMessageIdRow)
      .map((r) => r.externalId);
    const expectedIds = sampleMessages
      .map((m) => m.externalId)
      .slice()
      .sort();
    const idsMatch =
      actualIds.length === expectedIds.length && actualIds.every((id, i) => id === expectedIds[i]);
    if (!idsMatch) {
      throw new Error(
        `messages mismatch: expected=${JSON.stringify(expectedIds)}, got=${JSON.stringify(actualIds)}`
      );
    }
    console.log(`[ok] messages (${actualIds.length}): ${actualIds.join(', ')}`);

    // 4. Round-trip a payload field through SQLite to prove JSON is intact.
    const payloadRaw = db
      .prepare('SELECT payload FROM messages WHERE external_id = ?')
      .get('imap-uid-1002');
    if (!payloadRaw) {
      throw new Error('payload row for imap-uid-1002 missing in SQLite file');
    }
    const { payload } = decodePayloadRow(payloadRaw);
    const decoded: unknown = JSON.parse(payload);
    const subject =
      typeof decoded === 'object' &&
      decoded !== null &&
      'subject' in decoded &&
      typeof (decoded as { subject: unknown }).subject === 'string'
        ? (decoded as { subject: string }).subject
        : null;
    if (subject !== 'Your weekly digest') {
      throw new Error(
        `payload subject mismatch: expected "Your weekly digest", got ${JSON.stringify(subject)}`
      );
    }
    console.log(`[ok] payload round-trip: subject="${subject}"`);
  } finally {
    db.close();
    // Best-effort cleanup -- do not mask verification errors with rm errors.
    await unlink(localDbPath).catch((err: unknown) => {
      console.warn(
        `[warn] could not delete tmp sqlite file ${localDbPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }

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
