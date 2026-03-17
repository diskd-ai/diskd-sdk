import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { mcpToolName } from '../mcpTools/mcpTools.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const stubTool = {
  name: 'github__list_repos',
  description: 'List GitHub repositories',
  inputSchema: {
    type: 'object' as const,
    properties: { username: { type: 'string' } },
    required: ['username'],
  },
};

const stubTool2 = {
  name: 'slack__send_message',
  description: 'Send a Slack message',
  inputSchema: {
    type: 'object' as const,
    properties: { channel: { type: 'string' }, text: { type: 'string' } },
    required: ['channel', 'text'],
  },
};

const makeAuth = (): AuthModule => ({
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-123',
  getToken: () => ({ accessToken: 'token-123' }),
  getWorkspaceId: async () => 'test-workspace',
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

const jsonRpcResponse = (result: unknown, sessionId?: string): Response => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status: 200,
    headers,
  });
};

const jsonRpcError = (code: number, message: string): Response =>
  new Response(
    JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

const parseBody = (init?: RequestInit): Record<string, unknown> =>
  JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('mcpToolName constructs namespaced tool name', () => {
  assert.equal(mcpToolName('web-search', 'google'), 'web-search__google');
  assert.equal(mcpToolName('github', 'list_repos'), 'github__list_repos');
});

test('list() sends initialize then tools/list and returns tools', async () => {
  const url = 'http://mcp-hub:3000/os/mcp';

  let callIndex = 0;
  await withFetchMock(
    () => {
      callIndex++;
      if (callIndex === 1) {
        // initialize response
        return jsonRpcResponse(
          { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mcp-hub' } },
          'session-abc'
        );
      }
      // tools/list response
      return jsonRpcResponse({ tools: [stubTool, stubTool2] }, 'session-abc');
    },
    async (calls) => {
      const client = diskd.os.mcpTools({ auth: makeAuth(), url });
      const result = await client.list();

      // Two calls: initialize + tools/list
      assert.equal(calls.length, 2);

      // Both go to the gateway URL (derived from base)
      assert.equal(calls[0]?.url, 'http://mcp-hub:3000/v1/mcp');
      assert.equal(calls[1]?.url, 'http://mcp-hub:3000/v1/mcp');

      // First call is initialize
      const initBody = parseBody(calls[0]?.init);
      assert.equal(initBody.method, 'initialize');

      // Second call is tools/list
      const listBody = parseBody(calls[1]?.init);
      assert.equal(listBody.method, 'tools/list');

      // Session ID is forwarded on second call
      const sessionHeader = (calls[1]?.init?.headers as Record<string, string>)?.['mcp-session-id'];
      assert.equal(sessionHeader, 'session-abc');

      // Auth header present
      const authHeader = (calls[0]?.init?.headers as Record<string, string>)?.Authorization;
      assert.equal(authHeader, 'Bearer token-123');

      // Workspace header present
      const wsHeader = (calls[0]?.init?.headers as Record<string, string>)?.['X-Workspace-Id'];
      assert.equal(wsHeader, 'test-workspace');

      // Result
      assert.equal(result.length, 2);
      assert.equal(result[0]?.name, 'github__list_repos');
      assert.equal(result[1]?.name, 'slack__send_message');
    }
  );
});

test('list() second call reuses session (no re-initialize)', async () => {
  const url = 'http://mcp-hub:3000/os/mcp';

  let callIndex = 0;
  await withFetchMock(
    () => {
      callIndex++;
      if (callIndex === 1) {
        return jsonRpcResponse(
          { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mcp-hub' } },
          'session-abc'
        );
      }
      return jsonRpcResponse({ tools: [stubTool] }, 'session-abc');
    },
    async (calls) => {
      const client = diskd.os.mcpTools({ auth: makeAuth(), url });

      // First list: initialize + tools/list = 2 calls
      await client.list();
      assert.equal(calls.length, 2);

      // Reset call counter to see new calls
      const countBefore = calls.length;

      // Second list: only tools/list = 1 call (no re-initialize)
      await client.list();
      assert.equal(calls.length - countBefore, 1);

      // The third call (second list) should have session header
      const lastCall = calls[calls.length - 1];
      const sessionHeader = (lastCall?.init?.headers as Record<string, string>)?.[
        'mcp-session-id'
      ];
      assert.equal(sessionHeader, 'session-abc');

      // And should be tools/list, not initialize
      const body = parseBody(lastCall?.init);
      assert.equal(body.method, 'tools/list');
    }
  );
});

test('find() filters tools by regex on name and description', async () => {
  const url = 'http://mcp-hub:3000/os/mcp';

  let callIndex = 0;
  await withFetchMock(
    () => {
      callIndex++;
      if (callIndex === 1) {
        return jsonRpcResponse(
          { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mcp-hub' } },
          'session-abc'
        );
      }
      return jsonRpcResponse({ tools: [stubTool, stubTool2] }, 'session-abc');
    },
    async () => {
      const client = diskd.os.mcpTools({ auth: makeAuth(), url });

      // Filter by name
      const githubTools = await client.find('github');
      assert.equal(githubTools.length, 1);
      assert.equal(githubTools[0]?.name, 'github__list_repos');

      // Filter by description (case-insensitive)
      const slackTools = await client.find('slack');
      assert.equal(slackTools.length, 1);
      assert.equal(slackTools[0]?.name, 'slack__send_message');
    }
  );
});

test('call() sends tools/call with correct params and returns result', async () => {
  const url = 'http://mcp-hub:3000/os/mcp';

  const stubResult = {
    content: [{ type: 'text', text: '{"repos": ["repo1", "repo2"]}' }],
    isError: false,
  };

  let callIndex = 0;
  await withFetchMock(
    () => {
      callIndex++;
      if (callIndex === 1) {
        return jsonRpcResponse(
          { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mcp-hub' } },
          'session-abc'
        );
      }
      return jsonRpcResponse(stubResult, 'session-abc');
    },
    async (calls) => {
      const client = diskd.os.mcpTools({ auth: makeAuth(), url });
      const result = await client.call('github__list_repos', { username: 'octocat' });

      // Two calls: initialize + tools/call
      assert.equal(calls.length, 2);

      // Second call body
      const callBody = parseBody(calls[1]?.init);
      assert.equal(callBody.method, 'tools/call');
      const rpcParams = callBody.params as Record<string, unknown>;
      assert.equal(rpcParams.name, 'github__list_repos');
      assert.deepEqual(rpcParams.arguments, { username: 'octocat' });

      // Result
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0]?.type, 'text');
      assert.equal(result.isError, false);
    }
  );
});

test('call() without args sends empty arguments object', async () => {
  const url = 'http://mcp-hub:3000/os/mcp';

  let callIndex = 0;
  await withFetchMock(
    () => {
      callIndex++;
      if (callIndex === 1) {
        return jsonRpcResponse(
          { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mcp-hub' } },
          'session-abc'
        );
      }
      return jsonRpcResponse({ content: [{ type: 'text', text: 'ok' }] }, 'session-abc');
    },
    async (calls) => {
      const client = diskd.os.mcpTools({ auth: makeAuth(), url });
      await client.call('some__tool');

      const callBody = parseBody(calls[1]?.init);
      const rpcParams = callBody.params as Record<string, unknown>;
      assert.deepEqual(rpcParams.arguments, {});
    }
  );
});

test('throws on JSON-RPC error with code and message', async () => {
  const url = 'http://mcp-hub:3000/os/mcp';

  let callIndex = 0;
  await withFetchMock(
    () => {
      callIndex++;
      if (callIndex === 1) {
        return jsonRpcResponse(
          { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mcp-hub' } },
          'session-abc'
        );
      }
      return jsonRpcError(-32001, 'Runtime not running');
    },
    async () => {
      const client = diskd.os.mcpTools({ auth: makeAuth(), url });
      await assert.rejects(
        () => client.call('broken__tool', {}),
        (err: Error) => {
          assert.ok(err.message.includes('-32001'));
          assert.ok(err.message.includes('Runtime not running'));
          return true;
        }
      );
    }
  );
});

test('throws on HTTP error with status', async () => {
  const url = 'http://mcp-hub:3000/os/mcp';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      const client = diskd.os.mcpTools({ auth: makeAuth(), url });
      await assert.rejects(
        () => client.list(),
        (err: Error) => {
          assert.ok(err.message.includes('401'));
          assert.ok(err.message.includes('Unauthorized'));
          return true;
        }
      );
    }
  );
});

test('gateway URL derivation uses env var when no url override', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  let callIndex = 0;
  await withFetchMock(
    () => {
      callIndex++;
      if (callIndex === 1) {
        return jsonRpcResponse(
          { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mcp-hub' } },
          'session-abc'
        );
      }
      return jsonRpcResponse({ tools: [] }, 'session-abc');
    },
    async (calls) => {
      const client = diskd.os.mcpTools({ auth: makeAuth() });
      await client.list();

      // The gateway URL should be derived from the base URL origin
      assert.equal(calls[0]?.url, 'https://apis.example/v1/mcp');
    }
  );

  delete process.env.DISKD_BASE_URL;
});

test('diskd.os.mcpTools factory returns client with list, find, and call', () => {
  const client = diskd.os.mcpTools({
    auth: makeAuth(),
    url: 'http://mcp-hub:3000/os/mcp',
  });

  assert.equal(typeof client.list, 'function');
  assert.equal(typeof client.find, 'function');
  assert.equal(typeof client.call, 'function');
});
