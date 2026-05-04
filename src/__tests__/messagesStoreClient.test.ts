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
  handler: (input: string, init?: RequestInit) => Response,
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
          dbInode: null,
          recordCount: 21,
          sizeBytes: 0,
          updatedAt: '2026-05-02T14:09:08.752Z',
        },
      ]);
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
