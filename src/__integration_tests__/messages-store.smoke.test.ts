// Integration smoke tests for diskd.os.messagesStore.
//
// Gated by DISKD_API_KEY + DISKD_WORKSPACE_ID via checkApiKeyEnv().
// One node:test per boundary (mailboxes, folders, messages); attachments
// are exercised separately to keep the smoke fast and the failure
// surface narrow.
//
// Each test creates a fresh mailbox and unconditionally tears it down
// in a finally{} block so the dev cluster is left clean.

import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const DRIVE_API_URL = process.env.DRIVE_API_URL;

const makeStore = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ workspaceId: check.env.workspaceId });
  return diskd.os.messagesStore({
    auth,
    ...(DRIVE_API_URL ? { url: DRIVE_API_URL } : {}),
  });
};

const uniqueMailboxId = (): string => `mb-sdk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// ---------------------------------------------------------------------------
// Boundary 1: mailbox lifecycle
// ---------------------------------------------------------------------------

test(
  'integration: messagesStore.createMailbox -> listMailboxes -> init -> delete',
  { skip: skipReason },
  async () => {
    const store = makeStore();
    const mailboxId = uniqueMailboxId();

    const created = await store.createMailbox({
      mailboxId,
      displayName: 'SDK smoke mailbox',
      metadata: { protocol: 'imap' },
    });
    assert.equal(created.mailboxId, mailboxId);
    assert.ok(created.dbInode, 'sqlite createMailbox must return dbInode');
    assert.ok(created.drivePath, 'sqlite createMailbox must return drivePath');
    assert.ok(created.drivePath.includes(mailboxId), 'drivePath should contain mailboxId');

    const mailbox = store.mailbox({ mailboxId });
    try {
      const init = await mailbox.init();
      assert.equal(init.mailboxId, mailboxId);
      assert.equal(typeof init.schemaVersion, 'number');

      const all = await store.listMailboxes();
      const ours = all.find((m) => m.mailboxId === mailboxId);
      assert.ok(ours, 'listMailboxes must include the just-created mailbox');
    } finally {
      const deleted = await mailbox.delete();
      assert.equal(deleted.mailboxId, mailboxId);
      assert.equal(deleted.deleted, true);
    }
  }
);

// ---------------------------------------------------------------------------
// Boundary 2: folder lifecycle
// ---------------------------------------------------------------------------

test(
  'integration: mailbox.upsertFolder -> listFolders -> folder.get -> folder.delete',
  { skip: skipReason },
  async () => {
    const store = makeStore();
    const mailboxId = uniqueMailboxId();
    const folderId = 'INBOX';

    await store.createMailbox({ mailboxId, displayName: 'SDK folder smoke' });
    const mailbox = store.mailbox({ mailboxId });
    await mailbox.init();

    try {
      const first = await mailbox.upsertFolder({
        folderId,
        displayName: 'Inbox',
        metadata: { uidvalidity: 1, uidnext: 1 },
      });
      assert.equal(first.folderId, folderId);
      assert.equal(first.created, true);

      const second = await mailbox.upsertFolder({
        folderId,
        displayName: 'Inbox',
        metadata: { uidvalidity: 1, uidnext: 2 },
      });
      assert.equal(second.created, false, 'second upsert must report created=false');

      const folders = await mailbox.listFolders();
      assert.ok(
        folders.some((f) => f.folderId === folderId),
        'listFolders must include the upserted folder'
      );

      const folder = mailbox.folder({ folderId });
      const got = await folder.get();
      assert.equal(got.folderId, folderId);
      assert.equal(got.displayName, 'Inbox');

      const deleted = await folder.delete();
      assert.equal(deleted.folderId, folderId);
      assert.equal(deleted.deleted, true);
      assert.equal(typeof deleted.deletedMessageCount, 'number');
    } finally {
      await mailbox.delete();
    }
  }
);

// ---------------------------------------------------------------------------
// Boundary 3: messages lifecycle (upsert/list/get/delete-batch)
// ---------------------------------------------------------------------------

test(
  'integration: folder.upsertBatch -> listMessages -> getMessage -> deleteBatch',
  { skip: skipReason },
  async () => {
    const store = makeStore();
    const mailboxId = uniqueMailboxId();
    const folderId = 'INBOX';

    await store.createMailbox({ mailboxId, displayName: 'SDK messages smoke' });
    const mailbox = store.mailbox({ mailboxId });
    await mailbox.init();
    await mailbox.upsertFolder({ folderId, displayName: 'Inbox' });
    const folder = mailbox.folder({ folderId });

    const items = [
      { externalId: 'uid-1', payload: { subject: 'Hello', from: 'a@example.com' } },
      { externalId: 'uid-2', payload: { subject: 'World', from: 'b@example.com' } },
      { externalId: 'uid-3', payload: { subject: 'Test', from: 'c@example.com' } },
    ];

    try {
      const ins = await folder.upsertBatch({ items });
      assert.equal(ins.inserted, 3);
      assert.equal(ins.updated, 0);

      const reups = await folder.upsertBatch({ items });
      assert.equal(reups.inserted, 0);
      assert.equal(reups.updated, 3);

      const list = await folder.listMessages({ limit: 50 });
      assert.equal(list.items.length, 3);

      const fetched = await folder.getMessage({ externalId: 'uid-2' });
      assert.equal(fetched.externalId, 'uid-2');
      assert.equal(fetched.payload.subject, 'World');

      const del = await folder.deleteBatch({ externalIds: ['uid-1', 'uid-3'] });
      assert.equal(del.deleted, 2);

      const after = await folder.listMessages();
      assert.equal(after.items.length, 1);
      assert.equal(after.items[0]?.externalId, 'uid-2');
    } finally {
      await mailbox.delete();
    }
  }
);
