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

const rpc = (id: unknown, result: unknown): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'mcp-session-id': 'mcp-session' },
  });

const rpcError = (id: unknown, message: string, code = -32004): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'mcp-session-id': 'mcp-session' },
  });

const body = (init?: RequestInit): Record<string, unknown> =>
  JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;

const messageRow = (bodyState: string, bodyText: string | null) => ({
  message: {
    external_id: '14:42',
    payload: {
      accountId: 'google__personal',
      mailbox: 'INBOX',
      uid: 42,
      uidValidity: 14,
      messageId: '<rfc@example.com>',
      from: { name: 'Alice', address: 'alice@example.com' },
      to: [],
      cc: [],
      subject: 'Hello',
      date: '2026-05-04T10:00:00.000Z',
      flags: ['\\Seen'],
      labels: [],
      hasAttachments: false,
      attachments: [],
      snippet: 'Preview',
      bodyText,
      bodyHtml: null,
      bodyState,
      fetchedAt: '2026-05-04T10:01:00.000Z',
    },
    created_at: '2026-05-04T10:00:00.000Z',
    updated_at: '2026-05-04T10:00:00.000Z',
  },
});

test('platform.inbox.read hydrates unloaded Exchange body and rereads messagesStore', async () => {
  let getCount = 0;
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/folder/list') {
        return rpc(request.id, {
          folders: [
            {
              folder_id: 'INBOX',
              display_name: 'Inbox',
              metadata: {},
              message_count: 1,
              updated_at: '2026-05-04T10:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/get') {
        getCount += 1;
        return rpc(
          request.id,
          getCount === 1 ? messageRow('not_loaded', null) : messageRow('loaded', 'Hydrated body')
        );
      }
      if (request.method === 'initialize') return rpc(request.id, {});
      if (request.method === 'tools/list') {
        return rpc(request.id, {
          tools: [
            {
              name: 'email_client__system_hydrate_email_bodies',
              description: '',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        });
      }
      if (request.method === 'tools/call') return rpc(request.id, { content: [], isError: false });
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      const result = await inbox.read({ account: 'google__personal', messageId: '14:42' });

      assert.equal(result.messageId, '14:42');
      assert.equal(result.bodyText, 'Hydrated body');
      assert.equal('messageRef' in result, false);
      const methods = calls.map((call) => body(call.init).method);
      assert.deepEqual(methods, [
        'messages_store/folder/list',
        'messages_store/get',
        'initialize',
        'tools/list',
        'tools/call',
        'messages_store/get',
      ]);
      const hydrateCall = calls
        .map((call) => body(call.init))
        .find((item) => item.method === 'tools/call');
      assert.deepEqual(hydrateCall?.params, {
        name: 'email_client__system_hydrate_email_bodies',
        arguments: {
          messages: [
            {
              mailboxId: 'exchange-google-personal',
              folderId: 'INBOX',
              externalId: '14:42',
            },
          ],
          maxMessages: 1,
        },
      });
    }
  );
});

test('platform.inbox.read resolves Exchange messages by account plus UID', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/folder/list') {
        return rpc(request.id, {
          folders: [
            {
              folder_id: 'INBOX',
              display_name: 'Inbox',
              metadata: {},
              message_count: 1,
              updated_at: '2026-05-04T10:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/get') {
        assert.deepEqual(request.params, {
          mailbox_id: 'exchange-mail-personal',
          folder_id: 'INBOX',
          external_id: '864',
        });
        return rpcError(request.id, 'MESSAGE_NOT_FOUND');
      }
      if (request.method === 'messages_store/list') {
        assert.deepEqual(request.params, {
          mailbox_id: 'exchange-mail-personal',
          folder_id: 'INBOX',
          limit: 100,
        });
        const row = messageRow('loaded', 'Body by UID').message;
        return rpc(request.id, {
          items: [
            {
              ...row,
              external_id: '1728649431:864',
              payload: { ...row.payload, accountId: 'mail__personal', uid: 864 },
            },
          ],
          next_cursor: null,
        });
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      const result = await inbox.read({ account: 'mail__personal', messageId: '864' });

      assert.equal(result.messageId, '1728649431:864');
      assert.equal(result.uid, 864);
      assert.equal(result.bodyText, 'Body by UID');
      assert.equal('messageRef' in result, false);
      assert.deepEqual(
        calls.map((call) => body(call.init).method),
        ['messages_store/folder/list', 'messages_store/get', 'messages_store/list']
      );
    }
  );
});

test('platform.inbox.markRead updates Exchange messages by account plus UID', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/folder/list') {
        return rpc(request.id, {
          folders: [
            {
              folder_id: 'INBOX',
              display_name: 'Inbox',
              metadata: {},
              message_count: 1,
              updated_at: '2026-05-04T10:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/get') {
        assert.deepEqual(request.params, {
          mailbox_id: 'exchange-mail-personal',
          folder_id: 'INBOX',
          external_id: '864',
        });
        return rpcError(request.id, 'MESSAGE_NOT_FOUND');
      }
      if (request.method === 'messages_store/list') {
        const row = messageRow('loaded', 'Body by UID').message;
        return rpc(request.id, {
          items: [
            {
              ...row,
              external_id: '1728649431:864',
              payload: { ...row.payload, accountId: 'mail__personal', uid: 864 },
            },
          ],
          next_cursor: null,
        });
      }
      if (request.method === 'messages_store/upsert-batch') {
        assert.deepEqual(request.params, {
          mailbox_id: 'exchange-mail-personal',
          folder_id: 'INBOX',
          items: [
            {
              external_id: '1728649431:864',
              payload: {
                ...messageRow('loaded', 'Body by UID').message.payload,
                accountId: 'mail__personal',
                uid: 864,
                isRead: true,
              },
            },
          ],
        });
        return rpc(request.id, { inserted: 0, updated: 1 });
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async () => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      const result = await inbox.markRead({
        account: 'mail__personal',
        messageId: '864',
        isRead: true,
      });

      assert.equal(result.messageId, '1728649431:864');
      assert.equal(result.isRead, true);
      assert.equal('messageRef' in result, false);
    }
  );
});

test('platform.inbox.markRead updates only isRead for Exchange payload', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/get')
        return rpc(request.id, messageRow('loaded', 'Body'));
      if (request.method === 'messages_store/upsert-batch') {
        const params = request.params as {
          readonly items: readonly { readonly payload: Record<string, unknown> }[];
        };
        assert.equal(params.items[0]?.payload.uid, 42);
        assert.equal(params.items[0]?.payload.bodyText, 'Body');
        assert.equal(params.items[0]?.payload.isRead, true);
        return rpc(request.id, { inserted: 0, updated: 1 });
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async () => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });
      const result = await inbox.markRead({
        account: 'google__personal',
        folderId: 'INBOX',
        messageId: '14:42',
        isRead: true,
      });
      assert.equal(result.isRead, true);
      assert.equal(result.bodyText, 'Body');
    }
  );
});

const attachmentMessageRow = (storageState: string) => ({
  message: {
    external_id: '14:42',
    payload: {
      accountId: 'google__personal',
      mailbox: 'INBOX',
      uid: 42,
      from: { name: 'Alice', address: 'alice@example.com' },
      to: [],
      cc: [],
      subject: 'Attachment',
      date: '2026-05-04T10:00:00.000Z',
      flags: [],
      labels: [],
      hasAttachments: true,
      attachments: [
        {
          attachmentId: 'part-1',
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          sizeBytes: 123,
          storageState,
        },
      ],
      snippet: 'Preview',
      bodyText: 'Body',
      bodyHtml: null,
      bodyState: 'loaded',
      fetchedAt: '2026-05-04T10:01:00.000Z',
    },
    created_at: '2026-05-04T10:00:00.000Z',
    updated_at: '2026-05-04T10:00:00.000Z',
  },
});

test('platform.inbox.saveAttachment saves Exchange attachment by account, messageId, and attachmentId', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/get')
        return rpc(request.id, attachmentMessageRow('loaded'));
      if (request.method === 'messages_store/attachment/list') {
        return rpc(request.id, {
          items: [
            {
              attachment_id: 'part-1',
              filename: 'invoice.pdf',
              content_type: 'application/pdf',
              size_bytes: 123,
              drive_inode: 'source-inode-1',
              created_at: '2026-05-04T10:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/attachment/save-to-drive') {
        assert.deepEqual(request.params, {
          mailbox_id: 'exchange-google-personal',
          folder_id: 'INBOX',
          external_id: '14:42',
          attachment_id: 'part-1',
          target_path: '/Projects/p/docs/invoice.pdf',
        });
        return rpc(request.id, {
          saved: true,
          entry: {
            inode: 'target-inode-1',
            name: 'invoice.pdf',
            type: 'file',
            parent_inode: 'parent-1',
            file_id: 'file-1',
            etag: null,
            size: 123,
            mime_type: 'application/pdf',
            full_path: '/Projects/p/docs/invoice.pdf',
          },
        });
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      const result = await inbox.saveAttachment({
        account: 'exchange-google-personal',
        folderId: 'INBOX',
        messageId: '14:42',
        attachmentId: 'part-1',
        targetPath: '/Projects/p/docs/invoice.pdf',
      });

      assert.deepEqual(result, {
        saved: true,
        entry: {
          id: 'target-inode-1',
          name: 'invoice.pdf',
          path: '/Projects/p/docs/invoice.pdf',
          fileId: 'file-1',
        },
      });
      assert.deepEqual(
        calls.map((call) => body(call.init).method),
        [
          'messages_store/get',
          'messages_store/attachment/list',
          'messages_store/attachment/save-to-drive',
        ]
      );
    }
  );
});

test('platform.inbox.saveAttachment saves Exchange attachment by account plus UID and filename', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/folder/list') {
        return rpc(request.id, {
          folders: [
            {
              folder_id: 'INBOX',
              display_name: 'Inbox',
              metadata: {},
              message_count: 1,
              updated_at: '2026-05-04T10:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/get') {
        assert.deepEqual(request.params, {
          mailbox_id: 'exchange-mail-personal',
          folder_id: 'INBOX',
          external_id: '864',
        });
        return rpcError(request.id, 'MESSAGE_NOT_FOUND');
      }
      if (request.method === 'messages_store/list') {
        assert.deepEqual(request.params, {
          mailbox_id: 'exchange-mail-personal',
          folder_id: 'INBOX',
          limit: 100,
        });
        const row = attachmentMessageRow('loaded').message;
        return rpc(request.id, {
          items: [
            {
              ...row,
              external_id: '1728649431:864',
              payload: { ...row.payload, uid: 864 },
            },
          ],
          next_cursor: null,
        });
      }
      if (request.method === 'messages_store/attachment/list') {
        return rpc(request.id, {
          items: [
            {
              attachment_id: 'part-1',
              filename: 'invoice.pdf',
              content_type: 'application/pdf',
              size_bytes: 123,
              drive_inode: 'source-inode-1',
              created_at: '2026-05-04T10:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/attachment/save-to-drive') {
        assert.deepEqual(request.params, {
          mailbox_id: 'exchange-mail-personal',
          folder_id: 'INBOX',
          external_id: '1728649431:864',
          attachment_id: 'part-1',
          target_path: '/Projects/p/docs/invoice.pdf',
        });
        return rpc(request.id, {
          saved: true,
          entry: {
            inode: 'target-inode-1',
            name: 'invoice.pdf',
            type: 'file',
            parent_inode: 'parent-1',
            file_id: 'file-1',
            etag: null,
            size: 123,
            mime_type: 'application/pdf',
            full_path: '/Projects/p/docs/invoice.pdf',
          },
        });
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      const result = await inbox.saveAttachment({
        account: 'mail__personal',
        messageId: '864',
        filename: 'invoice.pdf',
        targetPath: '/Projects/p/docs/invoice.pdf',
      });

      assert.deepEqual(result, {
        saved: true,
        entry: {
          id: 'target-inode-1',
          name: 'invoice.pdf',
          path: '/Projects/p/docs/invoice.pdf',
          fileId: 'file-1',
        },
      });
      assert.deepEqual(
        calls.map((call) => body(call.init).method),
        [
          'messages_store/folder/list',
          'messages_store/get',
          'messages_store/list',
          'messages_store/attachment/list',
          'messages_store/attachment/save-to-drive',
        ]
      );
    }
  );
});

test('platform.inbox.saveAttachment does not fallback to legacy when Exchange target path is missing', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/folder/list') {
        return rpc(request.id, {
          folders: [
            {
              folder_id: 'INBOX',
              display_name: 'Inbox',
              metadata: {},
              message_count: 1,
              updated_at: '2026-05-04T10:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/get')
        return rpc(request.id, attachmentMessageRow('loaded'));
      if (request.method === 'messages_store/attachment/list') {
        return rpc(request.id, {
          items: [
            {
              attachment_id: 'part-1',
              filename: 'invoice.pdf',
              content_type: 'application/pdf',
              size_bytes: 123,
              drive_inode: 'source-inode-1',
              created_at: '2026-05-04T10:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/attachment/save-to-drive') {
        return rpcError(request.id, 'Drive target parent not found: /Projects/p/missing', -32004);
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      await assert.rejects(
        () =>
          inbox.saveAttachment({
            account: 'mail__personal',
            messageId: '14:42',
            filename: 'invoice.pdf',
            targetPath: '/Projects/p/missing/invoice.pdf',
          }),
        /Drive target parent not found/
      );
      assert.equal(
        calls.some((call) => body(call.init).method === 'drive/paths/list'),
        false
      );
    }
  );
});

test('platform.inbox.saveAttachment hydrates unloaded Exchange attachment before save', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/get')
        return rpc(request.id, attachmentMessageRow('not_loaded'));
      if (request.method === 'messages_store/attachment/list') {
        return rpc(request.id, {
          items: [
            {
              attachment_id: 'part-1',
              filename: 'invoice.pdf',
              content_type: 'application/pdf',
              size_bytes: 123,
              drive_inode: 'source-inode-1',
              created_at: '2026-05-04T10:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'initialize') return rpc(request.id, {});
      if (request.method === 'tools/list') {
        return rpc(request.id, {
          tools: [
            {
              name: 'email_client__system_hydrate_email_attachment',
              description: '',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        });
      }
      if (request.method === 'tools/call') return rpc(request.id, { content: [], isError: false });
      if (request.method === 'messages_store/attachment/save-to-drive') {
        return rpc(request.id, {
          saved: true,
          entry: {
            inode: 'target-inode-1',
            name: 'invoice.pdf',
            type: 'file',
            parent_inode: 'parent-1',
            file_id: 'file-1',
            etag: null,
            size: 123,
            mime_type: 'application/pdf',
            full_path: '/Projects/p/docs/invoice.pdf',
          },
        });
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      await inbox.saveAttachment({
        account: 'exchange-google-personal',
        folderId: 'INBOX',
        messageId: '14:42',
        attachmentId: 'part-1',
        targetPath: '/Projects/p/docs/invoice.pdf',
      });

      const hydrateCall = calls
        .map((call) => body(call.init))
        .find((item) => item.method === 'tools/call');
      assert.deepEqual(hydrateCall?.params, {
        name: 'email_client__system_hydrate_email_attachment',
        arguments: {
          mailboxId: 'exchange-google-personal',
          folderId: 'INBOX',
          externalId: '14:42',
          attachmentId: 'part-1',
        },
      });
    }
  );
});

test('platform.inbox.saveAttachment saves legacy attachment by filename', async () => {
  await withFetchMock(
    (url, init) => {
      if (url === 'https://download/legacy') {
        return new Response(
          JSON.stringify({
            messageId: 'legacy-message-1',
            account: 'work',
            from: { name: '', address: '' },
            to: [],
            cc: [],
            subject: 'Legacy',
            date: '',
            receivedAt: '',
            snippet: '',
            bodyText: '',
            bodyHtml: '',
            hasAttachments: true,
            attachments: [
              {
                filename: 'invoice.pdf',
                contentType: 'application/pdf',
                size: 123,
                drivePath: '/.profile/mail/work/attachments/invoice.pdf',
              },
            ],
            labels: [],
            isRead: false,
            isFlagged: false,
            priority: 'normal',
            webhookEvent: '',
            rule: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json', 'content-length': '100' } }
        );
      }
      const request = body(init);
      if (request.method === 'messages_store/folder/list') {
        return rpcError(request.id, 'MAILBOX_NOT_FOUND');
      }
      if (request.method === 'messages_store/get') {
        return rpcError(request.id, 'MESSAGE_NOT_FOUND');
      }
      if (request.method === 'messages_store/list') {
        return rpcError(request.id, 'MESSAGE_NOT_FOUND');
      }
      if (request.method === 'drive/files/download-url') {
        return rpc(request.id, { url: 'https://download/legacy', expires_in: 3600 });
      }
      if (request.method === 'drive/paths/resolve') {
        return rpc(request.id, {
          items: [
            {
              inode: 'source-inode-1',
              name: 'invoice.pdf',
              type: 'file',
              parent_inode: 'attachments',
              file_id: 'file-1',
              etag: null,
              size: 123,
              metadata: {},
              attributes: [],
            },
          ],
        });
      }
      if (request.method === 'drive/paths/create') {
        assert.deepEqual(request.params, {
          name: 'invoice.pdf',
          dir_name: 'invoice.pdf',
          type: 'file',
          parent_path: '/Projects/p/docs',
          file_id: 'file-1',
        });
        return rpc(request.id, {
          inode: 'target-inode-1',
          name: 'invoice.pdf',
          type: 'file',
          parent_inode: 'parent-1',
          file_id: 'file-1',
          etag: null,
          metadata: {},
          attributes: [],
          updated_at: 1710000000,
        });
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async () => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      const result = await inbox.saveAttachment({
        account: 'work',
        messageId: 'legacy-message-1',
        filename: 'invoice.pdf',
        targetPath: '/Projects/p/docs/invoice.pdf',
      });

      assert.deepEqual(result, {
        saved: true,
        entry: {
          id: 'target-inode-1',
          name: 'invoice.pdf',
          path: '/Projects/p/docs/invoice.pdf',
          fileId: 'file-1',
        },
      });
    }
  );
});
