import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import type { EmailOutboxPayload } from '../messagesStore/messagesStoreTypes.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const makeAuth = (): AuthModule => ({
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-123',
  getToken: () => ({ accessToken: 'token-123' }),
  getWorkspaceId: async () => 'workspace-1',
});

const withFetchMock = async (
  handler: (input: string, init?: RequestInit) => Response | Promise<Response>,
  fn: (calls: FetchCall[]) => Promise<void>
): Promise<void> => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;
  try {
    await fn(calls);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
};

const jsonRpcResponse = (result: unknown): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const parseBody = (init?: RequestInit): Record<string, unknown> =>
  JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;

test('messagesStore.createMailbox forwards storageVersion and accepts null legacy location fields', async () => {
  await withFetchMock(
    () =>
      jsonRpcResponse({
        mailbox_id: 'mail-inbox',
        db_inode: null,
        drive_path: null,
      }),
    async (calls) => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });

      const result = await client.createMailbox({
        mailboxId: 'mail-inbox',
        displayName: 'Inbox',
        storageVersion: 'segments-v1',
      });

      assert.deepEqual(result, {
        mailboxId: 'mail-inbox',
        dbInode: null,
        drivePath: null,
      });
      assert.equal(calls.length, 1);
      const body = parseBody(calls[0]?.init);
      assert.equal(body.method, 'messages_store/create_mailbox');
      assert.deepEqual(body.params, {
        mailbox_id: 'mail-inbox',
        display_name: 'Inbox',
        storage_version: 'segments-v1',
      });
    }
  );
});

test('messagesStore.listMailboxes accepts null db_inode for segment-backed mailboxes', async () => {
  await withFetchMock(
    () =>
      jsonRpcResponse({
        mailboxes: [
          {
            mailbox_id: 'mail-inbox',
            display_name: 'Inbox',
            metadata: { email: 'owner@example.com', provider: 'imap' },
            db_inode: null,
            record_count: 21,
            size_bytes: 0,
            updated_at: '2026-05-02T14:09:08.752Z',
          },
        ],
      }),
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });

      const result = await client.listMailboxes();

      assert.deepEqual(result, [
        {
          mailboxId: 'mail-inbox',
          displayName: 'Inbox',
          metadata: { email: 'owner@example.com', provider: 'imap' },
          dbInode: null,
          recordCount: 21,
          sizeBytes: 0,
          updatedAt: '2026-05-02T14:09:08.752Z',
        },
      ]);
    }
  );
});

test('messagesStore.folder.listMessages forwards orderBy as order_by', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      assert.equal(request.method, 'messages_store/list');
      assert.deepEqual(request.params, {
        mailbox_id: 'exchange-mail-w1upgraidefr',
        folder_id: 'INBOX',
        limit: 50,
        cursor: 'cursor-1',
        order_by: 'message_date_desc',
      });
      return jsonRpcResponse({ items: [], next_cursor: null });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });

      const result = await client
        .mailbox({ mailboxId: 'exchange-mail-w1upgraidefr' })
        .folder({ folderId: 'INBOX' })
        .listMessages({
          limit: 50,
          cursor: 'cursor-1',
          orderBy: 'message_date_desc',
        });

      assert.deepEqual(result, { items: [], nextCursor: null });
    }
  );
});

/* REQ-3088-SEARCH-PREFILTER-004: SDK search forwards chronological index order without exposing Drive cursors. */
test('messagesStore.folder.searchMessages forwards oldest order as order_by', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      assert.equal(request.method, 'messages_store/search');
      assert.deepEqual(request.params, {
        mailbox_id: 'exchange-mail-w1upgraidefr',
        folder_id: 'INBOX',
        query: 'after:2023-01-01 before:2023-01-08',
        page_size: 3,
        order_by: 'message_date_asc',
      });
      return jsonRpcResponse({ items: [], next_cursor: null });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });

      await client
        .mailbox({ mailboxId: 'exchange-mail-w1upgraidefr' })
        .folder({ folderId: 'INBOX' })
        .searchMessages({
          query: 'after:2023-01-01 before:2023-01-08',
          pageSize: 3,
          orderBy: 'message_date_asc',
        });
    }
  );
});

/* REQ-2917-SENDERS-009: the SDK exposes bounded sender aggregation pages without message reads. */
test('messagesStore.mailbox.listSenders encodes cursor fields and decodes totals', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      assert.equal(request.method, 'messages_store/list_senders');
      assert.deepEqual(request.params, {
        mailbox_id: 'exchange-mail-w1upgraidefr',
        folder_id: 'INBOX',
        limit: 100,
        cursor: 'cursor-1',
      });
      return jsonRpcResponse({
        mailbox_id: 'exchange-mail-w1upgraidefr',
        folder_id: 'INBOX',
        total_messages: 6500,
        unique_sender_count: 1882,
        senders: [
          {
            name: null,
            address: 'alice@example.com',
            count: 3,
            first_date: '2026-05-01T00:00:00+00:00',
            last_date: '2026-05-03T00:00:00+00:00',
          },
        ],
        next_cursor: 'cursor-2',
      });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });

      const result = await client
        .mailbox({ mailboxId: 'exchange-mail-w1upgraidefr' })
        .listSenders({ folderId: 'INBOX', limit: 100, cursor: 'cursor-1' });

      assert.deepEqual(result, {
        mailboxId: 'exchange-mail-w1upgraidefr',
        folderId: 'INBOX',
        totalMessages: 6500,
        uniqueSenderCount: 1882,
        senders: [
          {
            name: null,
            address: 'alice@example.com',
            count: 3,
            firstDate: '2026-05-01T00:00:00+00:00',
            lastDate: '2026-05-03T00:00:00+00:00',
          },
        ],
        nextCursor: 'cursor-2',
      });
    }
  );
});

/* REQ-2912-SEARCH-013: Drive search receives query, bounded page size, and cursor. */
test('messagesStore.folder.searchMessages uses the Drive search boundary', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      assert.equal(request.method, 'messages_store/search');
      assert.deepEqual(request.params, {
        mailbox_id: 'exchange-mail-w1upgraidefr',
        folder_id: 'INBOX',
        query: 'Luna after:2026-07-15',
        page_size: 20,
        cursor: 'cursor-1',
      });
      return jsonRpcResponse({ items: [], next_cursor: 'cursor-2' });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });

      const result = await client
        .mailbox({ mailboxId: 'exchange-mail-w1upgraidefr' })
        .folder({ folderId: 'INBOX' })
        .searchMessages({
          query: 'Luna after:2026-07-15',
          pageSize: 20,
          cursor: 'cursor-1',
        });

      assert.deepEqual(result, { items: [], nextCursor: 'cursor-2' });
    }
  );
});

/* REQ-2912-CANCEL-010: Drive JSON-RPC cancellation must reach fetch and remain an abort rejection. */
test('messagesStore.folder.searchMessages forwards AbortSignal to fetch', async () => {
  const controller = new AbortController();
  const abortReason = new Error('search stopped');
  let markFetchStarted: (() => void) | undefined;
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve;
  });

  await withFetchMock(
    (_url, init) => {
      assert.equal(init?.signal, controller.signal);
      markFetchStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });
      const pending = client
        .mailbox({ mailboxId: 'exchange-mail-w1upgraidefr' })
        .folder({ folderId: 'INBOX' })
        .searchMessages({ query: 'Luna', pageSize: 20 }, controller.signal);

      await fetchStarted;
      controller.abort(abortReason);

      await assert.rejects(pending, (error: unknown) => error === abortReason);
    }
  );
});

test('messagesStore attachment.saveToDrive encodes payload and decodes target entry only', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      assert.equal(request.method, 'messages_store/attachment/save-to-drive');
      assert.deepEqual(request.params, {
        mailbox_id: 'exchange-google-personal',
        folder_id: 'INBOX',
        external_id: '14:42',
        attachment_id: 'part-1',
        target_path: '/Projects/p/docs/invoice.pdf',
      });
      return jsonRpcResponse({
        saved: true,
        entry: {
          inode: 'target-inode-1',
          name: 'invoice.pdf',
          type: 'file',
          parent_inode: 'parent-1',
          file_id: 'file-1',
          etag: 'etag-1',
          size: 123,
          mime_type: 'application/pdf',
          full_path: '/Projects/p/docs/invoice.pdf',
        },
      });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });

      const result = await client
        .mailbox({ mailboxId: 'exchange-google-personal' })
        .folder({ folderId: 'INBOX' })
        .message({ externalId: '14:42' })
        .attachments.saveToDrive({
          attachmentId: 'part-1',
          targetPath: '/Projects/p/docs/invoice.pdf',
        });

      assert.deepEqual(result, {
        saved: true,
        entry: {
          id: 'target-inode-1',
          name: 'invoice.pdf',
          type: 'file',
          parentId: 'parent-1',
          fileId: 'file-1',
          etag: 'etag-1',
          size: 123,
          mimeType: 'application/pdf',
          fullPath: '/Projects/p/docs/invoice.pdf',
        },
      });
      assert.equal('driveInode' in result.entry, false);
    }
  );
});

test('messagesStore.review create/list/get/delete use the single workspace review box', async () => {
  /* REQ-EXCHANGE-SDK-001: Review creation requires an account and decodes the canonical item locator and revision. */
  const seenMethods: string[] = [];
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      seenMethods.push(String(request.method));
      if (request.method === 'messages_store/review/create') {
        assert.deepEqual(request.params, {
          review_id: 'draft-1',
          account: 'work@example.com',
          payload: {
            subject: 'Draft',
            sendAccountId: 'work@example.com',
          },
        });
        return jsonRpcResponse({
          item: {
            review_id: 'draft-1',
            account: 'work@example.com',
            mailbox_id: 'exchange-work-example-com',
            payload: {
              subject: 'Draft',
              sendAccountId: 'work@example.com',
            },
            revision: '1',
            created_at: '2026-05-17T20:00:00+00:00',
            updated_at: '2026-05-17T20:00:00+00:00',
          },
        });
      }
      if (request.method === 'messages_store/review/list') {
        assert.deepEqual(request.params, { limit: 20 });
        return jsonRpcResponse({
          items: [
            {
              review_id: 'draft-1',
              account: 'work@example.com',
              mailbox_id: 'exchange-work-example-com',
              payload: { subject: 'Draft' },
              revision: '1',
              created_at: '2026-05-17T20:00:00+00:00',
              updated_at: '2026-05-17T20:00:00+00:00',
            },
          ],
          next_cursor: null,
        });
      }
      if (request.method === 'messages_store/review/get') {
        assert.deepEqual(request.params, { review_id: 'draft-1' });
        return jsonRpcResponse({
          item: {
            review_id: 'draft-1',
            account: 'work@example.com',
            mailbox_id: 'exchange-work-example-com',
            payload: { subject: 'Draft' },
            revision: '1',
            created_at: '2026-05-17T20:00:00+00:00',
            updated_at: '2026-05-17T20:00:00+00:00',
          },
        });
      }
      if (request.method === 'messages_store/review/delete') {
        assert.deepEqual(request.params, { review_id: 'draft-1' });
        return jsonRpcResponse({ review_id: 'draft-1', deleted: true });
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });

      const created = await client.review.create({
        reviewId: 'draft-1',
        account: 'work@example.com',
        payload: {
          subject: 'Draft',
          sendAccountId: 'work@example.com',
        },
      });
      const listed = await client.review.list({ limit: 20 });
      const got = await client.review.get({ reviewId: 'draft-1' });
      const deleted = await client.review.delete({ reviewId: 'draft-1' });

      assert.equal(created.reviewId, 'draft-1');
      assert.equal(created.account, 'work@example.com');
      assert.equal(created.mailboxId, 'exchange-work-example-com');
      assert.equal(created.revision, '1');
      assert.equal(created.payload.sendAccountId, 'work@example.com');
      assert.equal(listed.items[0]?.reviewId, 'draft-1');
      assert.equal(listed.nextCursor, null);
      assert.equal(got.reviewId, 'draft-1');
      assert.deepEqual(deleted, { reviewId: 'draft-1', deleted: true });
      assert.deepEqual(seenMethods, [
        'messages_store/review/create',
        'messages_store/review/list',
        'messages_store/review/get',
        'messages_store/review/delete',
      ]);
    }
  );
});

test('messagesStore.outbox creates the canonical item with an account', async () => {
  /* REQ-EXCHANGE-SDK-002: Outbox creation forwards canonical identity and decodes Drive lifecycle metadata. */
  const payload: EmailOutboxPayload = {
    messageId: 'message-1',
    account: 'work',
    threadId: null,
    inReplyTo: null,
    from: { name: 'Agent', address: 'work' },
    to: [{ name: '', address: 'recipient@example.com' }],
    cc: [],
    bcc: [{ name: '', address: 'audit@example.com' }],
    subject: 'Ready',
    bodyText: 'Ready to send',
    bodyHtml: '',
    hasAttachments: false,
    attachments: [],
  };
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      assert.equal(request.method, 'messages_store/outbox/create');
      assert.deepEqual(request.params, {
        external_id: 'send-1',
        account: 'work',
        payload,
      });
      return jsonRpcResponse({
        item: {
          external_id: 'send-1',
          account: 'work',
          mailbox_id: 'exchange-work-example-com',
          state: 'outbox',
          payload,
          result: null,
          revision: '1',
          delivery_attempts: 0,
          lease_owner: null,
          lease_expires_at: null,
          failure_reason: null,
          created_at: '2026-08-28T10:00:00+00:00',
          updated_at: '2026-08-28T10:00:00+00:00',
        },
      });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });
      const item = await client.outbox.create({
        externalId: 'send-1',
        account: 'work',
        payload,
      });
      assert.equal(item.state, 'outbox');
      assert.equal(item.revision, '1');
      assert.equal(item.result, null);
    }
  );
});

/* REQ-EXCHANGE-SDK-006: Outbound email attachments use canonical Drive paths without embedding provider or storage internals. */
test('EmailOutboxPayload represents non-empty Drive attachment references', () => {
  const payload: EmailOutboxPayload = {
    messageId: 'message-with-attachment',
    account: 'work',
    threadId: null,
    inReplyTo: null,
    from: { name: 'Agent', address: 'agent@example.com' },
    to: [{ name: 'Recipient', address: 'recipient@example.com' }],
    cc: [],
    bcc: [],
    subject: 'Invoice',
    bodyText: 'Attached.',
    bodyHtml: '',
    hasAttachments: true,
    attachments: [
      {
        path: '/Projects/acme/invoice.pdf',
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
      },
    ],
  };

  assert.equal(payload.hasAttachments, true);
  assert.equal(payload.attachments[0].path, '/Projects/acme/invoice.pdf');
});

test('messagesStore review approval and outbox lifecycle use one canonical item', async () => {
  /* REQ-EXCHANGE-SDK-004: Approval, reads, leases, and terminal writes use the Drive-owned lifecycle contract. */
  const seenMethods: string[] = [];
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      const method = String(request.method);
      seenMethods.push(method);
      const revisions: Readonly<Record<string, string>> = {
        'messages_store/review/approve': '2',
        'messages_store/outbox/get': '2',
        'messages_store/outbox/claim': '3',
        'messages_store/outbox/renew-lease': '4',
        'messages_store/outbox/write-terminal': '5',
      };

      if (method === 'messages_store/outbox/list-pending') {
        assert.deepEqual(request.params, { limit: 25, cursor: 'cursor-1' });
        return jsonRpcResponse({
          items: [
            {
              external_id: 'send-1',
              account: 'work@example.com',
              mailbox_id: 'exchange-work-example-com',
              state: 'outbox',
              payload: { subject: 'Ready' },
              result: null,
              revision: '2',
              delivery_attempts: 0,
              lease_owner: null,
              lease_expires_at: null,
              failure_reason: null,
              created_at: '2026-08-29T10:00:00+00:00',
              updated_at: '2026-08-29T10:01:00+00:00',
            },
          ],
          next_cursor: null,
        });
      }

      if (method === 'messages_store/review/approve') {
        assert.deepEqual(request.params, { review_id: 'send-1' });
      } else if (method === 'messages_store/outbox/get') {
        assert.deepEqual(request.params, { external_id: 'send-1' });
      } else if (method === 'messages_store/outbox/claim') {
        assert.deepEqual(request.params, {
          external_id: 'send-1',
          expected_revision: '2',
          lease_owner: 'provider-1',
          lease_seconds: 30,
        });
      } else if (method === 'messages_store/outbox/renew-lease') {
        assert.deepEqual(request.params, {
          external_id: 'send-1',
          expected_revision: '3',
          lease_owner: 'provider-1',
          lease_seconds: 30,
        });
      } else if (method === 'messages_store/outbox/write-terminal') {
        assert.deepEqual(request.params, {
          external_id: 'send-1',
          expected_revision: '4',
          lease_owner: 'provider-1',
          outcome: {
            state: 'sent',
            provider_response: { providerId: 'provider-message-1' },
          },
        });
      } else {
        throw new Error(`unexpected method ${method}`);
      }

      const terminal = method === 'messages_store/outbox/write-terminal';
      const leased =
        method === 'messages_store/outbox/claim' || method === 'messages_store/outbox/renew-lease';
      return jsonRpcResponse({
        item: {
          external_id: 'send-1',
          account: 'work@example.com',
          mailbox_id: 'exchange-work-example-com',
          state: terminal ? 'sent' : 'outbox',
          payload: { subject: 'Ready' },
          result: terminal ? { providerId: 'provider-message-1' } : null,
          revision: revisions[method],
          delivery_attempts: leased || terminal ? 1 : 0,
          lease_owner: leased ? 'provider-1' : null,
          lease_expires_at: leased ? '2026-08-29T10:02:00+00:00' : null,
          failure_reason: null,
          created_at: '2026-08-29T10:00:00+00:00',
          updated_at: '2026-08-29T10:01:00+00:00',
        },
      });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });
      const approved = await client.review.approve({ reviewId: 'send-1' });
      const got = await client.outbox.get({ externalId: 'send-1' });
      const pending = await client.outbox.listPending({ limit: 25, cursor: 'cursor-1' });
      const claimed = await client.outbox.claim({
        externalId: 'send-1',
        expectedRevision: '2',
        leaseOwner: 'provider-1',
        leaseSeconds: 30,
      });
      const renewed = await client.outbox.renewLease({
        externalId: 'send-1',
        expectedRevision: '3',
        leaseOwner: 'provider-1',
        leaseSeconds: 30,
      });
      const sent = await client.outbox.writeTerminal({
        externalId: 'send-1',
        expectedRevision: '4',
        leaseOwner: 'provider-1',
        outcome: {
          state: 'sent',
          providerResponse: { providerId: 'provider-message-1' },
        },
      });

      assert.equal(approved.revision, '2');
      assert.equal(got.deliveryAttempts, 0);
      assert.equal(pending.items[0]?.leaseOwner, null);
      assert.equal(claimed.deliveryAttempts, 1);
      assert.equal(renewed.leaseOwner, 'provider-1');
      assert.equal(sent.state, 'sent');
      assert.equal(sent.leaseOwner, null);
      assert.deepEqual(seenMethods, [
        'messages_store/review/approve',
        'messages_store/outbox/get',
        'messages_store/outbox/list-pending',
        'messages_store/outbox/claim',
        'messages_store/outbox/renew-lease',
        'messages_store/outbox/write-terminal',
      ]);
    }
  );
});

test('messagesStore.outbox writes a terminal Failed reason', async () => {
  /* REQ-EXCHANGE-SDK-005: Failed delivery writes an explicit reason through the terminal outcome variant. */
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      assert.equal(request.method, 'messages_store/outbox/write-terminal');
      assert.deepEqual(request.params, {
        external_id: 'send-2',
        expected_revision: '7',
        lease_owner: 'provider-1',
        outcome: {
          state: 'failed',
          reason: 'provider rejected recipient',
        },
      });
      return jsonRpcResponse({
        item: {
          external_id: 'send-2',
          account: 'work@example.com',
          mailbox_id: 'exchange-work-example-com',
          state: 'failed',
          payload: { subject: 'Ready' },
          result: null,
          revision: '8',
          delivery_attempts: 2,
          lease_owner: null,
          lease_expires_at: null,
          failure_reason: 'provider rejected recipient',
          created_at: '2026-08-29T10:00:00+00:00',
          updated_at: '2026-08-29T10:05:00+00:00',
        },
      });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });
      const failed = await client.outbox.writeTerminal({
        externalId: 'send-2',
        expectedRevision: '7',
        leaseOwner: 'provider-1',
        outcome: {
          state: 'failed',
          reason: 'provider rejected recipient',
        },
      });

      assert.equal(failed.state, 'failed');
      assert.equal(failed.failureReason, 'provider rejected recipient');
    }
  );
});

test('messagesStore.exchange lists a persisted lifecycle state', async () => {
  /* REQ-EXCHANGE-SDK-006: Consumers can reload canonical Outbox, Sent, and Failed projections through the SDK. */
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      assert.equal(request.method, 'messages_store/exchange/list');
      assert.deepEqual(request.params, {
        state: 'sent',
        limit: 25,
        cursor: 'cursor-1',
      });
      return jsonRpcResponse({
        items: [
          {
            external_id: 'send-1',
            account: 'work@example.com',
            mailbox_id: 'exchange-work-example-com',
            state: 'sent',
            payload: { subject: 'Delivered' },
            result: { providerId: 'provider-message-1' },
            revision: '5',
            delivery_attempts: 1,
            lease_owner: null,
            lease_expires_at: null,
            failure_reason: null,
            created_at: '2026-08-29T10:00:00+00:00',
            updated_at: '2026-08-29T10:05:00+00:00',
          },
        ],
        next_cursor: null,
      });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });
      const persisted = await client.exchange.list({
        state: 'sent',
        limit: 25,
        cursor: 'cursor-1',
      });

      assert.equal(persisted.items[0]?.state, 'sent');
      assert.equal(persisted.items[0]?.revision, '5');
    }
  );
});

test('messagesStore.exchange updates by expected revision', async () => {
  /* REQ-EXCHANGE-SDK-003: Lifecycle updates carry the caller revision and one generic patch without transport policy. */
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      assert.equal(request.method, 'messages_store/exchange/update');
      assert.deepEqual(request.params, {
        external_id: 'send-1',
        expected_revision: '1',
        patch: { state: 'sent', result: { providerId: 'provider-7' } },
      });
      return jsonRpcResponse({
        item: {
          external_id: 'send-1',
          account: 'work@example.com',
          mailbox_id: 'exchange-work-example-com',
          state: 'sent',
          payload: { subject: 'Ready' },
          result: { providerId: 'provider-7' },
          revision: '2',
          delivery_attempts: 1,
          lease_owner: null,
          lease_expires_at: null,
          failure_reason: null,
          created_at: '2026-08-28T10:00:00+00:00',
          updated_at: '2026-08-28T10:01:00+00:00',
        },
      });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });
      const item = await client.exchange.update({
        externalId: 'send-1',
        expectedRevision: '1',
        patch: { state: 'sent', result: { providerId: 'provider-7' } },
      });
      assert.equal(item.state, 'sent');
      assert.equal(item.revision, '2');
      assert.deepEqual(item.result, { providerId: 'provider-7' });
    }
  );
});
