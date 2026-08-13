import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
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
  /* REQUIREMENT REVIEW-BOX-SDK-01: SDK forwards single review box create/list/get/delete with snake_case review item params */
  const seenMethods: string[] = [];
  await withFetchMock(
    (_url, init) => {
      const request = parseBody(init);
      seenMethods.push(String(request.method));
      if (request.method === 'messages_store/review/create') {
        assert.deepEqual(request.params, {
          review_id: 'draft-1',
          payload: {
            subject: 'Draft',
            sendAccountId: 'work@example.com',
          },
        });
        return jsonRpcResponse({
          item: {
            review_id: 'draft-1',
            payload: {
              subject: 'Draft',
              sendAccountId: 'work@example.com',
            },
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
              payload: { subject: 'Draft' },
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
            payload: { subject: 'Draft' },
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
        payload: {
          subject: 'Draft',
          sendAccountId: 'work@example.com',
        },
      });
      const listed = await client.review.list({ limit: 20 });
      const got = await client.review.get({ reviewId: 'draft-1' });
      const deleted = await client.review.delete({ reviewId: 'draft-1' });

      assert.equal(created.reviewId, 'draft-1');
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
