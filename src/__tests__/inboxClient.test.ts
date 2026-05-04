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
      assert.match(result.messageRef ?? '', /^op-inbox:/);
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
