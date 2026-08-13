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

/* REQ-INBOX-ACCOUNTS-001: Connected Inbox accounts must exclude Drive-owned system mailboxes. */
test('platform.inbox.listAccounts excludes the Drive review mailbox', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      assert.equal(request.method, 'messages_store/list_mailboxes');
      return rpc(request.id, {
        mailboxes: [
          {
            mailbox_id: 'exchange-google-personal',
            display_name: 'Personal',
            metadata: { email: 'owner@example.com' },
            db_inode: null,
            record_count: 12,
            size_bytes: 1024,
            updated_at: '2026-08-05T10:00:00.000Z',
          },
          {
            mailbox_id: 'review',
            display_name: 'Review',
            db_inode: null,
            record_count: 1,
            size_bytes: 128,
            updated_at: '2026-08-05T10:00:00.000Z',
          },
        ],
      });
    },
    async () => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        contentMode: 'stored-only',
      });

      const result = await inbox.listAccounts();

      assert.deepEqual(result, {
        accounts: ['exchange-google-personal'],
        items: [
          {
            status: 'searchable',
            account: 'exchange-google-personal',
            email: 'owner@example.com',
            displayName: 'Personal',
          },
        ],
      });
    }
  );
});

/* REQ-3066-003: Inbox account projection must distinguish missing and invalid email metadata. */
test('platform.inbox.listAccounts validates explicit mailbox email metadata', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      return rpc(request.id, {
        mailboxes: [
          {
            mailbox_id: 'exchange-imap-missing',
            display_name: 'Missing address',
            metadata: {},
            db_inode: null,
            record_count: 0,
            size_bytes: 0,
            updated_at: '2026-08-05T10:00:00.000Z',
          },
          {
            mailbox_id: 'exchange-imap-invalid',
            display_name: 'Invalid address',
            metadata: { email: 'not-an-address' },
            db_inode: null,
            record_count: 0,
            size_bytes: 0,
            updated_at: '2026-08-05T10:00:00.000Z',
          },
        ],
      });
    },
    async () => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        contentMode: 'stored-only',
      });

      const result = await inbox.listAccounts();

      assert.deepEqual(result, {
        accounts: ['exchange-imap-invalid', 'exchange-imap-missing'],
        items: [
          {
            status: 'unavailable',
            account: 'exchange-imap-invalid',
            displayName: 'Invalid address',
            reason: 'invalid-email-metadata',
          },
          {
            status: 'unavailable',
            account: 'exchange-imap-missing',
            displayName: 'Missing address',
            reason: 'missing-email-metadata',
          },
        ],
      });
    }
  );
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

/* REQ-INBOX-STORED-ONLY-001: Stored-only Inbox reads must surface unloaded bodies without Email MCP access. */
test('platform.inbox.read rejects unloaded stored-only bodies without Email MCP calls', async () => {
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
        return rpc(request.id, messageRow('not_loaded', null));
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        contentMode: 'stored-only',
      });

      await assert.rejects(
        () => inbox.read({ account: 'google__personal', messageId: '14:42' }),
        /Inbox body is not stored in Drive messagebox: 14:42/
      );
      assert.deepEqual(
        calls.map((call) => body(call.init).method),
        ['messages_store/folder/list', 'messages_store/get']
      );
    }
  );
});

/* REQ-INBOX-STORED-ONLY-002: Stored-only Inbox reads return content already persisted in Drive. */
test('platform.inbox.read returns loaded stored-only bodies directly from Drive', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/get') {
        return rpc(request.id, messageRow('loaded', 'Stored body'));
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        contentMode: 'stored-only',
      });

      const result = await inbox.read({
        account: 'google__personal',
        folderId: 'INBOX',
        messageId: '14:42',
      });

      assert.equal(result.bodyText, 'Stored body');
      assert.deepEqual(
        calls.map((call) => body(call.init).method),
        ['messages_store/get']
      );
    }
  );
});

test('platform.inbox.read returns synthesized attachmentId for unloaded Exchange attachments', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/get') {
        return rpc(request.id, {
          message: {
            external_id: '1728649431:864',
            payload: {
              accountId: 'mail__personal',
              mailbox: 'INBOX',
              uid: 864,
              uidValidity: 1728649431,
              from: { name: 'Alice', address: 'alice@example.com' },
              to: [],
              cc: [],
              subject: 'With attachment',
              date: '2026-05-04T10:00:00.000Z',
              flags: [],
              labels: [],
              hasAttachments: true,
              attachments: [
                {
                  filename: 'ged__2.PDF',
                  contentType: 'application/pdf',
                  sizeBytes: 123,
                  partId: '2',
                  storageState: 'not_loaded',
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
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async () => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      const result = await inbox.read({
        account: 'mail__personal',
        folderId: 'INBOX',
        messageId: '1728649431:864',
      });

      assert.equal(result.attachments[0]?.filename, 'ged__2.PDF');
      assert.equal(result.attachments[0]?.storageState, 'not_loaded');
      assert.equal(result.attachments[0]?.attachmentId, '1728649431:864:2');
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

test('platform.inbox.read does not fallback to legacy Drive mail storage', async () => {
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
              message_count: 0,
              updated_at: '2026-05-04T10:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/get') return rpcError(request.id, 'MESSAGE_NOT_FOUND');
      if (request.method === 'messages_store/list') {
        return rpc(request.id, { items: [], next_cursor: null });
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
        () => inbox.read({ account: 'google__test', messageId: 'missing-message' }),
        /Email not found|MESSAGE_NOT_FOUND/
      );
      assert.equal(
        calls.some((call) => String(body(call.init).method).startsWith('drive/')),
        false
      );
    }
  );
});

/* REQ-2912-SEARCH-013: InboxClient forwards the complete Gmail-like query to Drive search. */
test('platform.inbox.search forwards Gmail-style criteria to Drive', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/search') {
        assert.deepEqual(request.params, {
          mailbox_id: 'exchange-google-personal',
          folder_id: 'INBOX',
          query: 'invoice from:gmail.com after:2025-05-17',
          page_size: 20,
          order_by: 'message_date_desc',
        });
        return rpc(request.id, {
          items: [
            {
              external_id: 'gmail-new-invoice',
              payload: {
                accountId: 'google__personal',
                mailbox: 'INBOX',
                from: { name: 'Alice', address: 'alice@gmail.com' },
                subject: 'Invoice ready',
                date: '2025-05-18T10:00:00.000Z',
                flags: [],
                labels: [],
                hasAttachments: false,
                attachments: [],
                snippet: 'May billing statement',
              },
              created_at: '2025-05-18T10:00:00.000Z',
              updated_at: '2025-05-18T10:00:00.000Z',
            },
          ],
          next_cursor: null,
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

      const result = await inbox.search({
        account: 'google__personal',
        folderId: 'INBOX',
        query: 'invoice from:gmail.com after:2025-05-17',
        limit: 10,
      });

      assert.deepEqual(
        result.results.map((item) => item.messageId),
        ['gmail-new-invoice']
      );
    }
  );
});

/* REQ-2912-SEARCH-012: Body-only matches come directly from Drive without per-message gets. */
test('platform.inbox.search returns Drive body matches without getMessage fan-out', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/search') {
        return rpc(request.id, {
          items: [
            {
              external_id: 'openai-luna',
              payload: {
                from: { name: 'OpenAI', address: 'team@openai.com' },
                to: [],
                cc: [],
                subject: 'New pricing and Fast mode for Sol',
                date: '2026-07-31T00:02:32.000Z',
                flags: [],
                labels: [],
                hasAttachments: false,
                attachments: [],
                snippet: 'Today, we are making GPT-5.6 more affordable and faster.',
                bodyText: 'GPT-5.6 Luna now costs 80% less',
              },
              created_at: '2026-07-31T00:02:32.000Z',
              updated_at: '2026-07-31T00:02:32.000Z',
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

      const result = await inbox.search({
        account: 'exchange-google-aileron',
        folderId: 'INBOX',
        query: 'Luna',
        limit: 20,
      });

      assert.deepEqual(
        result.results.map((item) => item.messageId),
        ['openai-luna']
      );
      assert.deepEqual(
        calls.map((call) => body(call.init).method),
        ['messages_store/search']
      );
    }
  );
});

/* REQ-2912-SEARCH-005: Empty Drive match pages do not trigger per-message reads. */
test('platform.inbox.search does not hydrate candidates outside Drive search', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/search') {
        return rpc(request.id, { items: [], next_cursor: null });
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      const result = await inbox.search({
        account: 'exchange-google-aileron',
        folderId: 'INBOX',
        query: 'Luna',
        limit: 20,
      });

      assert.deepEqual(result.results, []);
      assert.deepEqual(
        calls.map((call) => body(call.init).method),
        ['messages_store/search']
      );
    }
  );
});

/* REQ-2912-SEARCH-016: InboxClient surfaces Drive query validation errors. */
test('platform.inbox.search surfaces unsupported Gmail-style operators from Drive', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/search') {
        return rpcError(request.id, 'INVALID_INBOX_SEARCH_QUERY: unsupported operator "category"');
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async () => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      await assert.rejects(
        () =>
          inbox.search({
            account: 'google__personal',
            folderId: 'INBOX',
            query: 'category:promotions',
            limit: 10,
          }),
        /INVALID_INBOX_SEARCH_QUERY/
      );
    }
  );
});

/* REQ-2912-SEARCH-014: InboxClient follows Drive cursors after an empty match page. */
test('platform.inbox.search follows Drive search pages to reach older mail', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/search') {
        const params = request.params as { readonly cursor?: string };
        if (!params.cursor) {
          return rpc(request.id, {
            items: [],
            next_cursor: 'cursor-2',
          });
        }
        return rpc(request.id, {
          items: [
            {
              external_id: 'old-to-estelle',
              payload: {
                accountId: 'google__personal',
                mailbox: 'INBOX',
                from: { name: 'Alice', address: 'alice@gmail.com' },
                to: [{ name: 'Estelle Roy', address: 'estelle@aileron.fr' }],
                cc: [],
                subject: 'Bulletins de salaire',
                date: '2026-01-04T10:00:00.000Z',
                flags: [],
                labels: [],
                hasAttachments: false,
                attachments: [],
                snippet: 'Older thread',
              },
              created_at: '2026-01-04T10:00:00.000Z',
              updated_at: '2026-01-04T10:00:00.000Z',
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

      const result = await inbox.search({
        account: 'google__personal',
        folderId: 'INBOX',
        query: 'to:estelle',
        limit: 10,
        pageSize: 7,
      });

      assert.deepEqual(
        result.results.map((item) => item.messageId),
        ['old-to-estelle']
      );
      const searchCalls = calls.filter(
        (call) => body(call.init).method === 'messages_store/search'
      );
      assert.equal(searchCalls.length, 2);
      assert.deepEqual(body(searchCalls[0]?.init).params, {
        mailbox_id: 'exchange-google-personal',
        folder_id: 'INBOX',
        query: 'to:estelle',
        page_size: 7,
        order_by: 'message_date_desc',
      });
      assert.deepEqual(body(searchCalls[1]?.init).params, {
        mailbox_id: 'exchange-google-personal',
        folder_id: 'INBOX',
        query: 'to:estelle',
        page_size: 7,
        cursor: 'cursor-2',
        order_by: 'message_date_desc',
      });
    }
  );
});

/* REQ-2912-CANCEL-009: Inbox search must share cancellation with folder discovery and every Drive page. */
test('platform.inbox.search forwards AbortSignal through folder discovery and Drive search', async () => {
  const controller = new AbortController();

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
              updated_at: '2026-08-02T00:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/search') {
        return rpc(request.id, { items: [], next_cursor: null });
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      await inbox.search(
        { account: 'google__personal', query: 'Luna', limit: 1, pageSize: 20 },
        controller.signal
      );

      assert.deepEqual(
        calls.map((call) => body(call.init).method),
        ['messages_store/folder/list', 'messages_store/search']
      );
      assert.ok(calls.every((call) => call.init?.signal === controller.signal));
    }
  );
});

/* REQ-INBOX-SEARCH-UNIQUE-018: mailbox-wide search returns one globally ordered envelope per RFC message across folders. */
test('platform.inbox.search deduplicates and orders matches across folders', async () => {
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
              updated_at: '2026-08-05T00:00:00.000Z',
            },
            {
              folder_id: 'ALL',
              display_name: 'All Mail',
              metadata: {},
              message_count: 1,
              updated_at: '2026-08-05T00:00:00.000Z',
            },
            {
              folder_id: 'SPAM',
              display_name: 'Spam',
              metadata: {},
              message_count: 1,
              updated_at: '2026-08-05T00:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/search') {
        const params = request.params as { readonly folder_id: string };
        if (params.folder_id === 'SPAM') {
          return rpc(request.id, {
            items: [
              {
                external_id: 'spam-newer',
                payload: {
                  messageId: '<newer@example.com>',
                  mailbox: 'SPAM',
                  from: { name: 'Newer', address: 'newer@example.com' },
                  subject: 'Newer message',
                  date: '2026-08-05T16:00:00.000Z',
                  snippet: 'Newer match',
                },
                created_at: '2026-08-05T16:00:00.000Z',
                updated_at: '2026-08-05T16:00:00.000Z',
              },
            ],
            next_cursor: null,
          });
        }
        const isInbox = params.folder_id === 'INBOX';
        return rpc(request.id, {
          items: [
            {
              external_id: isInbox ? 'inbox-copy' : 'all-copy',
              payload: {
                messageId: '<same@example.com>',
                mailbox: params.folder_id,
                from: { name: 'Same', address: 'same@example.com' },
                subject: 'Same message',
                date: '2026-08-01T10:00:00.000Z',
                snippet: 'Same match',
              },
              created_at: '2026-08-01T10:00:00.000Z',
              updated_at: '2026-08-01T10:00:00.000Z',
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

      const result = await inbox.search({
        account: 'google__personal',
        query: 'after:2026-07-29 before:2026-08-06',
        limit: 10,
      });

      assert.deepEqual(
        result.results.map((item) => [item.folderId, item.messageId]),
        [
          ['SPAM', 'spam-newer'],
          ['INBOX', 'inbox-copy'],
        ]
      );
      assert.equal(
        calls.filter((call) => body(call.init).method === 'messages_store/search').length,
        3
      );
    }
  );
});

/* REQ-3088-INBOX-SELECTION-001: Inbox search selects the oldest distinct senders before limit without scanning later ordered pages. */
test('platform.inbox.search selects the oldest distinct senders before limit', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method !== 'messages_store/search') {
        throw new Error(`unexpected method ${String(request.method)}`);
      }
      assert.deepEqual(request.params, {
        mailbox_id: 'exchange-google-personal',
        folder_id: 'INBOX',
        query: 'after:2023-01-01 before:2023-02-01',
        page_size: 100,
        order_by: 'message_date_asc',
      });
      return rpc(request.id, {
        items: [
          {
            external_id: 'old-alice',
            payload: {
              from: { name: 'Alice', address: 'alice@example.com' },
              subject: 'Old Alice',
              date: '2023-01-02T08:00:00.000Z',
            },
            created_at: '2023-01-02T08:00:00.000Z',
            updated_at: '2023-01-02T08:00:00.000Z',
          },
          {
            external_id: 'old-carol',
            payload: {
              from: { name: 'Carol', address: 'carol@example.com' },
              subject: 'Old Carol',
              date: '2023-01-03T08:00:00.000Z',
            },
            created_at: '2023-01-03T08:00:00.000Z',
            updated_at: '2023-01-03T08:00:00.000Z',
          },
          {
            external_id: 'old-dan',
            payload: {
              from: { name: 'Dan', address: 'dan@example.com' },
              subject: 'Old Dan',
              date: '2023-01-04T08:00:00.000Z',
            },
            created_at: '2023-01-04T08:00:00.000Z',
            updated_at: '2023-01-04T08:00:00.000Z',
          },
        ],
        next_cursor: 'later-matches-that-are-not-needed',
      });
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      const result = await inbox.search({
        account: 'google__personal',
        folderId: 'INBOX',
        query: 'after:2023-01-01 before:2023-02-01',
        limit: 3,
        pageSize: 100,
        order: 'oldest',
        distinctBy: 'sender',
      });

      assert.deepEqual(
        result.results.map((item) => item.messageId),
        ['old-alice', 'old-carol', 'old-dan']
      );
      assert.equal(calls.length, 1);
    }
  );
});

/* REQ-2910-005: A folder query searches the exact folder and delimiter-bounded descendants by default. */
test('platform.inbox.search resolves a recursive folder query without matching prefix siblings', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/folder/list') {
        return rpc(request.id, {
          folders: [
            {
              folder_id: 'Aix',
              display_name: 'Aix',
              metadata: { delimiter: '.' },
              message_count: 1,
              updated_at: '2026-08-10T00:00:00.000Z',
            },
            {
              folder_id: 'Aix.Conservatory',
              display_name: 'Conservatory',
              metadata: { delimiter: '.' },
              message_count: 1,
              updated_at: '2026-08-10T00:00:00.000Z',
            },
            {
              folder_id: 'Aix2',
              display_name: 'Aix2',
              metadata: { delimiter: '.' },
              message_count: 1,
              updated_at: '2026-08-10T00:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/search') {
        const params = request.params as {
          readonly folder_id: string;
          readonly query: string;
        };
        assert.equal(params.query, 'subject:invoice');
        return rpc(request.id, {
          items: [
            {
              external_id: `message-${params.folder_id}`,
              payload: {
                mailbox: params.folder_id,
                from: { name: 'Alice', address: 'alice@example.com' },
                subject: 'Invoice',
                date: '2026-08-10T10:00:00.000Z',
                snippet: 'Invoice',
              },
              created_at: '2026-08-10T10:00:00.000Z',
              updated_at: '2026-08-10T10:00:00.000Z',
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
        contentMode: 'stored-only',
      });

      const result = await inbox.search({
        account: 'google__personal',
        query: 'folder:Aix subject:invoice',
        limit: 10,
      });

      assert.deepEqual(
        new Set(result.results.map((item) => item.folderId)),
        new Set(['Aix', 'Aix.Conservatory'])
      );
      assert.deepEqual(
        calls
          .filter((call) => body(call.init).method === 'messages_store/search')
          .map((call) => (body(call.init).params as { readonly folder_id: string }).folder_id),
        ['Aix', 'Aix.Conservatory']
      );
    }
  );
});

/* REQ-2910-006: A non-recursive folder-only query prefers an exact ID and lists only that folder. */
test('platform.inbox.search supports folder-only non-recursive queries', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/folder/list') {
        return rpc(request.id, {
          folders: [
            {
              folder_id: 'Aix',
              display_name: 'Aix',
              metadata: { delimiter: '/' },
              message_count: 1,
              updated_at: '2026-08-10T00:00:00.000Z',
            },
            {
              folder_id: 'Aix/Conservatory',
              display_name: 'Conservatory',
              metadata: { delimiter: '/' },
              message_count: 1,
              updated_at: '2026-08-10T00:00:00.000Z',
            },
            {
              folder_id: 'France/Aix',
              display_name: 'Aix',
              metadata: { delimiter: '/' },
              message_count: 1,
              updated_at: '2026-08-10T00:00:00.000Z',
            },
          ],
        });
      }
      if (request.method === 'messages_store/list') {
        assert.deepEqual(request.params, {
          mailbox_id: 'exchange-google-personal',
          folder_id: 'Aix',
          limit: 20,
          order_by: 'message_date_desc',
        });
        return rpc(request.id, {
          items: [
            {
              external_id: 'aix-message',
              payload: {
                mailbox: 'Aix',
                from: { name: 'Alice', address: 'alice@example.com' },
                subject: 'Aix subject',
                date: '2026-08-10T10:00:00.000Z',
                snippet: 'Aix message',
              },
              created_at: '2026-08-10T10:00:00.000Z',
              updated_at: '2026-08-10T10:00:00.000Z',
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
        contentMode: 'stored-only',
      });

      const result = await inbox.search({
        account: 'google__personal',
        query: 'folder:Aix recursive:false',
        limit: 10,
      });

      assert.deepEqual(
        result.results.map((item) => item.messageId),
        ['aix-message']
      );
      assert.deepEqual(
        calls.map((call) => body(call.init).method),
        ['messages_store/folder/list', 'messages_store/list']
      );
    }
  );
});

/* REQ-2910-007: Display-name folder resolution fails visibly when the name is ambiguous. */
test('platform.inbox.search rejects ambiguous folder display names before message I/O', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method !== 'messages_store/folder/list') {
        throw new Error(`unexpected method ${String(request.method)}`);
      }
      return rpc(request.id, {
        folders: [
          {
            folder_id: 'France/Aix',
            display_name: 'Aix',
            metadata: { delimiter: '/' },
            message_count: 1,
            updated_at: '2026-08-10T00:00:00.000Z',
          },
          {
            folder_id: 'Canada/Aix',
            display_name: 'Aix',
            metadata: { delimiter: '/' },
            message_count: 1,
            updated_at: '2026-08-10T00:00:00.000Z',
          },
        ],
      });
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        contentMode: 'stored-only',
      });

      await assert.rejects(
        () =>
          inbox.search({
            account: 'google__personal',
            query: 'folder:Aix recursive:false',
          }),
        /INBOX_FOLDER_AMBIGUOUS/
      );
      assert.equal(calls.length, 1);
    }
  );
});

/* REQ-2910-010: Folder resolution reports a missing selector instead of falling back mailbox-wide. */
test('platform.inbox.search rejects missing folder selectors before message I/O', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method !== 'messages_store/folder/list') {
        throw new Error(`unexpected method ${String(request.method)}`);
      }
      return rpc(request.id, {
        folders: [
          {
            folder_id: 'INBOX',
            display_name: 'Inbox',
            metadata: { delimiter: '/' },
            message_count: 1,
            updated_at: '2026-08-10T00:00:00.000Z',
          },
        ],
      });
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        contentMode: 'stored-only',
      });

      await assert.rejects(
        () => inbox.search({ account: 'google__personal', query: 'folder:Aix' }),
        /INBOX_FOLDER_NOT_FOUND/
      );
      assert.equal(calls.length, 1);
    }
  );
});

/* REQ-2910-008: Recursive folder search requires persisted provider delimiter metadata. */
test('platform.inbox.search rejects recursive folder selection without delimiter metadata', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method !== 'messages_store/folder/list') {
        throw new Error(`unexpected method ${String(request.method)}`);
      }
      return rpc(request.id, {
        folders: [
          {
            folder_id: 'Aix',
            display_name: 'Aix',
            metadata: {},
            message_count: 1,
            updated_at: '2026-08-10T00:00:00.000Z',
          },
        ],
      });
    },
    async () => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        contentMode: 'stored-only',
      });

      await assert.rejects(
        () => inbox.search({ account: 'google__personal', query: 'folder:Aix' }),
        /INBOX_FOLDER_DELIMITER_MISSING/
      );
    }
  );
});

/* REQ-2912-SEARCH-002: Default bounded pages traverse a 6,500-message mailbox. */
test('platform.inbox.search traverses 6500 messages with default Drive pages', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method !== 'messages_store/search') {
        throw new Error(`unexpected method ${String(request.method)}`);
      }
      const params = request.params as {
        readonly cursor?: string;
        readonly page_size: number;
      };
      assert.equal(params.page_size, 20);
      const offset = Number(params.cursor ?? '0');
      const nextOffset = offset + params.page_size;
      if (nextOffset < 6500) {
        return rpc(request.id, { items: [], next_cursor: String(nextOffset) });
      }
      return rpc(request.id, {
        items: [
          {
            external_id: 'message-6500',
            payload: {
              accountId: 'google__personal',
              mailbox: 'INBOX',
              from: { name: 'OpenAI', address: 'team@openai.com' },
              subject: 'Final page',
              date: '2026-07-15T10:00:00.000Z',
              snippet: 'Luna appears in the final bounded page',
            },
            created_at: '2026-07-15T10:00:00.000Z',
            updated_at: '2026-07-15T10:00:00.000Z',
          },
        ],
        next_cursor: null,
      });
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      const result = await inbox.search({
        account: 'google__personal',
        folderId: 'INBOX',
        query: 'Luna',
        limit: 1,
      });

      assert.deepEqual(
        result.results.map((item) => item.messageId),
        ['message-6500']
      );
      assert.equal(calls.length, 325);
      assert.ok(calls.every((call) => body(call.init).method === 'messages_store/search'));
    }
  );
});

/* REQ-2912-SEARCH-013: InboxClient rejects pageSize outside the Drive contract before I/O. */
test('platform.inbox.search validates pageSize bounds', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
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
          inbox.search({
            account: 'google__personal',
            folderId: 'INBOX',
            query: 'Luna',
            pageSize: 101,
          }),
        /pageSize must be an integer between 1 and 100/
      );
      assert.equal(calls.length, 0);
    }
  );
});

/* REQ-2912-SEARCH-015: result limit stops automatic Drive pagination. */
test('platform.inbox.search stops paging after reaching result limit', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method !== 'messages_store/search') {
        throw new Error(`unexpected method ${String(request.method)}`);
      }
      return rpc(request.id, {
        items: [
          {
            external_id: 'first-match',
            payload: {
              accountId: 'google__personal',
              mailbox: 'INBOX',
              from: { name: 'Alice', address: 'alice@example.com' },
              subject: 'Luna',
              date: '2026-07-15T10:00:00.000Z',
              snippet: 'First',
            },
            created_at: '2026-07-15T10:00:00.000Z',
            updated_at: '2026-07-15T10:00:00.000Z',
          },
        ],
        next_cursor: 'must-not-be-requested',
      });
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        mcpUrl: 'http://mcp',
      });

      const result = await inbox.search({
        account: 'google__personal',
        folderId: 'INBOX',
        query: 'Luna',
        limit: 1,
      });

      assert.deepEqual(
        result.results.map((item) => item.messageId),
        ['first-match']
      );
      assert.equal(calls.length, 1);
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

test('platform.inbox.saveAttachment uses synthesized attachmentId for old unloaded Exchange payloads', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/get') {
        const row = attachmentMessageRow('not_loaded').message;
        return rpc(request.id, {
          message: {
            ...row,
            external_id: '1728649431:864',
            payload: {
              ...row.payload,
              uid: 864,
              uidValidity: 1728649431,
              attachments: [
                {
                  filename: 'ged__2.PDF',
                  contentType: 'application/pdf',
                  sizeBytes: 123,
                  partId: '2',
                  storageState: 'not_loaded',
                },
              ],
            },
          },
        });
      }
      if (request.method === 'messages_store/attachment/list') {
        return rpc(request.id, {
          items: [
            {
              attachment_id: '1728649431:864:2',
              filename: 'ged__2.PDF',
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
      if (request.method === 'tools/call') {
        assert.deepEqual(request.params, {
          name: 'email_client__system_hydrate_email_attachment',
          arguments: {
            mailboxId: 'exchange-mail-personal',
            folderId: 'INBOX',
            externalId: '1728649431:864',
            attachmentId: '1728649431:864:2',
          },
        });
        return rpc(request.id, { content: [], isError: false });
      }
      if (request.method === 'messages_store/attachment/save-to-drive') {
        assert.deepEqual(request.params, {
          mailbox_id: 'exchange-mail-personal',
          folder_id: 'INBOX',
          external_id: '1728649431:864',
          attachment_id: '1728649431:864:2',
          target_path: '/Projects/p/docs/ged__2.PDF',
        });
        return rpc(request.id, {
          saved: true,
          entry: {
            inode: 'target-inode-1',
            name: 'ged__2.PDF',
            type: 'file',
            parent_inode: 'parent-1',
            file_id: 'file-1',
            etag: null,
            size: 123,
            mime_type: 'application/pdf',
            full_path: '/Projects/p/docs/ged__2.PDF',
          },
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
        account: 'mail__personal',
        folderId: 'INBOX',
        messageId: '1728649431:864',
        attachmentId: '1728649431:864:2',
        targetPath: '/Projects/p/docs/ged__2.PDF',
      });

      assert.equal(result.entry.path, '/Projects/p/docs/ged__2.PDF');
    }
  );
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

/* REQ-INBOX-STORED-ONLY-003: Stored-only Inbox attachment reads must not invoke Email MCP hydration. */
test('platform.inbox.saveAttachment rejects unloaded stored-only attachments without Email MCP calls', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/get') {
        return rpc(request.id, attachmentMessageRow('not_loaded'));
      }
      throw new Error(`unexpected method ${String(request.method)}`);
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        contentMode: 'stored-only',
      });

      await assert.rejects(
        () =>
          inbox.saveAttachment({
            account: 'exchange-google-personal',
            folderId: 'INBOX',
            messageId: '14:42',
            attachmentId: 'part-1',
            targetPath: '/Projects/p/docs/invoice.pdf',
          }),
        /Inbox attachment is not stored in Drive messagebox: part-1/
      );
      assert.deepEqual(
        calls.map((call) => body(call.init).method),
        ['messages_store/get']
      );
    }
  );
});

test('platform.inbox.saveAttachment does not fallback to legacy Drive mail storage', async () => {
  await withFetchMock(
    (_url, init) => {
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
            account: 'work',
            messageId: 'legacy-message-1',
            filename: 'invoice.pdf',
            targetPath: '/Projects/p/docs/invoice.pdf',
          }),
        /MESSAGE_NOT_FOUND|MAILBOX_NOT_FOUND|Email not found/
      );
      assert.equal(
        calls.some((call) => String(body(call.init).method).startsWith('drive/')),
        false
      );
    }
  );
});
