import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

test('drive.init calls JSON-RPC with Bearer token', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return new Response(JSON.stringify({ jsonrpc: '2.0', result: { success: true }, id: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

  const auth: AuthModule = {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => 'token-123',
    getToken: () => ({ accessToken: 'token-123' }),
    getWorkspaceId: async () => 'test-workspace',
  };

  try {
    const drive = diskd.os.drive({ version: 'v1', auth });
    await drive.init();

    assert.equal(calls[0]?.url, 'https://apis.example/os/drive/api/v1');
    const init = calls[0]?.init;
    const authHeader = (init?.headers as { Authorization?: string } | undefined)?.Authorization;
    assert.equal(authHeader, 'Bearer token-123');
    assert.equal(typeof init?.body, 'string');
    assert.ok(String(init?.body).includes('"method":"drive/init"'));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.DISKD_BASE_URL;
  }
});

test('drive.crontab.getStatus uses the drive JSON-RPC endpoint', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          job_count: 0,
          next_run_at: null,
          updated_at: '2026-03-13T10:00:00Z',
        },
        id: 1,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

  const auth: AuthModule = {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => 'token-123',
    getToken: () => ({ accessToken: 'token-123' }),
    getWorkspaceId: async () => 'test-workspace',
  };

  try {
    const drive = diskd.os.drive({ version: 'v1', auth });
    const result = await drive.crontab.getStatus({
      scope: {
        scopeType: 'profile',
      },
    });

    assert.deepEqual(result, {
      jobCount: 0,
      nextRunAt: null,
      updatedAt: '2026-03-13T10:00:00Z',
    });
    assert.equal(calls[0]?.url, 'https://apis.example/os/drive/api/v1');
    assert.ok(String(calls[0]?.init?.body).includes('"method":"drive/crontab/get-status"'));
    assert.ok(String(calls[0]?.init?.body).includes('"scope_type":"profile"'));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.DISKD_BASE_URL;
  }
});

test('diskd.platform.crontab binds scope + timezone in the constructor', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          job_count: 0,
          next_run_at: null,
          updated_at: '2026-03-13T10:00:00Z',
        },
        id: 1,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

  const auth: AuthModule = {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => 'token-123',
    getToken: () => ({ accessToken: 'token-123' }),
    getWorkspaceId: async () => 'test-workspace',
  };

  try {
    const crontab = diskd.platform.crontab({
      auth,
      scope: {
        scopeType: 'project',
        projectId: 'proj-1',
      },
      timezone: 'UTC',
    });
    const result = await crontab.save({
      jobs: [],
    });

    assert.deepEqual(result, {
      jobCount: 0,
      nextRunAt: null,
      updatedAt: '2026-03-13T10:00:00Z',
    });
    assert.equal(calls[0]?.url, 'https://apis.example/platform/crontab/api/v1');
    assert.ok(String(calls[0]?.init?.body).includes('"method":"drive/crontab/save"'));
    assert.ok(String(calls[0]?.init?.body).includes('"scope_type":"project"'));
    assert.ok(String(calls[0]?.init?.body).includes('"project_id":"proj-1"'));
    assert.ok(String(calls[0]?.init?.body).includes('"timezone":"UTC"'));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.DISKD_BASE_URL;
  }
});

test('diskd.platform.crontab defaults timezone from the caller runtime', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          job_count: 0,
          next_run_at: null,
          updated_at: '2026-03-13T10:00:00Z',
        },
        id: 1,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

  const auth: AuthModule = {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => 'token-123',
    getToken: () => ({ accessToken: 'token-123' }),
    getWorkspaceId: async () => 'test-workspace',
  };

  try {
    const expectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const expectedTimezoneFragment =
      typeof expectedTimezone === 'string' && expectedTimezone.length > 0
        ? `"timezone":"${expectedTimezone}"`
        : '"timezone":null';
    const crontab = diskd.platform.crontab({
      auth,
      scope: {
        scopeType: 'project',
        projectId: 'proj-1',
      },
    });
    await crontab.save({
      jobs: [],
    });

    assert.ok(String(calls[0]?.init?.body).includes(expectedTimezoneFragment));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.DISKD_BASE_URL;
  }
});

test('diskd.platform.sessions.list uses the drive JSON-RPC endpoint', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          items: [
            {
              session_id: 'sess-1',
              title: 'Deployment help',
              message_count: 2,
              updated_at: '2026-03-13T10:00:00Z',
              provider: 'openai',
              model: 'gpt-5',
            },
          ],
        },
        id: 1,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

  const auth: AuthModule = {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => 'token-123',
    getToken: () => ({ accessToken: 'token-123' }),
    getWorkspaceId: async () => 'test-workspace',
  };

  try {
    const sessions = diskd.platform.sessions({
      auth,
      scope: {
        scopeType: 'project',
        projectId: 'proj-1',
      },
    });
    const result = await sessions.list();

    assert.deepEqual(result, {
      items: [
        {
          sessionId: 'sess-1',
          title: 'Deployment help',
          messageCount: 2,
          updatedAt: '2026-03-13T10:00:00Z',
          provider: 'openai',
          model: 'gpt-5',
        },
      ],
    });
    assert.equal(calls[0]?.url, 'https://apis.example/platform/sessions/api/v1');
    assert.ok(String(calls[0]?.init?.body).includes('"method":"drive/session/list"'));
    assert.ok(String(calls[0]?.init?.body).includes('"project_id":"proj-1"'));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.DISKD_BASE_URL;
  }
});

test('diskd exposes namespaced os and utils factories for non-drive services', () => {
  const auth: AuthModule = {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => 'token-123',
    getToken: () => ({ accessToken: 'token-123' }),
    getWorkspaceId: async () => 'test-workspace',
  };

  const llm = diskd.os.llm({ auth, url: 'http://llm-router:3000' });
  const agents = diskd.os.agents({ auth, url: 'http://agent-hub:8081' });
  const mcp = diskd.os.mcp({ auth, url: 'http://mcp-hub:8300' });
  const tg = diskd.utils.tgUserBot({ auth, url: 'http://tg-userbot:8000' });
  const webNavigator = diskd.utils.webNavigator({
    auth,
    url: 'http://web-navigator:8080',
  });

  assert.equal(typeof llm.completions.create, 'function');
  assert.equal(typeof agents.agents.list, 'function');
  assert.equal(typeof mcp.catalog.list, 'function');
  assert.equal(typeof tg.channels.list, 'function');
  assert.equal(typeof webNavigator.scrape.submit, 'function');
});

test('resource clients derive gateway paths from SDK namespaces', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    if (url === 'https://apis.example/os/llm/api/v1/invoke') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          result: {
            models: [],
          },
          id: 1,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (url === 'https://apis.example/os/agents/supported-agents') {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url === 'https://apis.example/os/mcp/api/catalog') {
      return new Response(
        JSON.stringify({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 0,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (url === 'https://apis.example/utils/tg-userbot/api/v1/channels') {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url === 'https://apis.example/utils/web-navigator/api/v1/resolve') {
      return new Response(
        JSON.stringify({
          title: null,
          description: null,
          favicon: null,
          dbname: 'web.sqlite',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response('not found', { status: 404 });
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

  const auth: AuthModule = {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => 'token-123',
    getToken: () => ({ accessToken: 'token-123' }),
    getWorkspaceId: async () => 'test-workspace',
  };

  try {
    await diskd.os.llm({ auth }).models.listAll();
    await diskd.os.agents({ auth }).agents.list();
    await diskd.os.mcp({ auth }).catalog.list();
    await diskd.utils.tgUserBot({ auth }).channels.list();
    await diskd.utils.webNavigator({ auth }).resolve({
      url: 'https://example.com',
    });

    assert.deepEqual(
      calls.map((call) => call.url),
      [
        'https://apis.example/os/llm/api/v1/invoke',
        'https://apis.example/os/agents/supported-agents',
        'https://apis.example/os/mcp/api/catalog',
        'https://apis.example/utils/tg-userbot/api/v1/channels',
        'https://apis.example/utils/web-navigator/api/v1/resolve',
      ]
    );
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.DISKD_BASE_URL;
  }
});

test('drive.tools.readFile sends paths/tools/read and decodes parts', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          parts: [
            {
              type: 'text',
              content: '# Hello World',
              title: 'Main heading',
              page_number: 1,
              confidence: 0.95,
            },
          ],
        },
        id: 1,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

  const auth: AuthModule = {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => 'token-123',
    getToken: () => ({ accessToken: 'token-123' }),
    getWorkspaceId: async () => 'test-workspace',
  };

  try {
    const drive = diskd.os.drive({ version: 'v1', auth });
    const result = await drive.tools.readFile({
      path: '/docs/readme.md',
      partsLimit: 5,
      partsOffset: 0,
    });

    assert.equal(result.parts.length, 1);
    assert.equal(result.parts[0]?.type, 'text');
    assert.equal(result.parts[0]?.content, '# Hello World');
    assert.equal(result.parts[0]?.title, 'Main heading');
    assert.equal(result.parts[0]?.pageNumber, 1);
    assert.equal(result.parts[0]?.confidence, 0.95);

    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.ok(body.method === 'paths/tools/read');
    assert.equal(body.params.path, '/docs/readme.md');
    assert.equal(body.params.parts_limit, 5);
    assert.equal(body.params.parts_offset, 0);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.DISKD_BASE_URL;
  }
});

test('drive.tools.writeFile sends paths/tools/write with path and content', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: { success: true, inode: 'inode-abc', path: '/docs/readme.md' },
        id: 1,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

  const auth: AuthModule = {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => 'token-123',
    getToken: () => ({ accessToken: 'token-123' }),
    getWorkspaceId: async () => 'test-workspace',
  };

  try {
    const drive = diskd.os.drive({ version: 'v1', auth });
    const result = await drive.tools.writeFile({
      path: '/docs/readme.md',
      content: '# Hello World',
    });

    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.method, 'paths/tools/write');
    assert.equal(body.params.path, '/docs/readme.md');
    assert.equal(body.params.content, '# Hello World');
    assert.equal(result.id, 'inode-abc');
    assert.equal(result.path, '/docs/readme.md');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.DISKD_BASE_URL;
  }
});

test('drive.tools.applyPatch sends paths/tools/apply-patch with path and patch', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: { success: true, inode: 'inode-xyz', path: '/docs/readme.md' },
        id: 1,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

  const auth: AuthModule = {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => 'token-123',
    getToken: () => ({ accessToken: 'token-123' }),
    getWorkspaceId: async () => 'test-workspace',
  };

  const patchContent = '--- a/readme.md\n+++ b/readme.md\n@@ -1 +1 @@\n-old\n+new';

  try {
    const drive = diskd.os.drive({ version: 'v1', auth });
    const result = await drive.tools.applyPatch({
      path: '/docs/readme.md',
      patch: patchContent,
    });

    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.method, 'paths/tools/apply-patch');
    assert.equal(body.params.path, '/docs/readme.md');
    assert.equal(body.params.patch, patchContent);
    assert.equal(result.id, 'inode-xyz');
    assert.equal(result.path, '/docs/readme.md');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.DISKD_BASE_URL;
  }
});
