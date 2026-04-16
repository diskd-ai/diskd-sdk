/* REQUIREMENT ADR-028: SDK default clients must derive versioned APIS gateway URLs under `/v1/{namespace}/{module}`. */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

test('drive.init calls JSON-RPC with Bearer token', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

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

    assert.equal(calls[0]?.url, 'https://apis.example/v1/os/drive/api/v1');
    const init = calls[0]?.init;
    const authHeader = (init?.headers as { Authorization?: string } | undefined)?.Authorization;
    assert.equal(authHeader, 'Bearer token-123');
    assert.equal(typeof init?.body, 'string');
    assert.ok(String(init?.body).includes('"method":"drive/init"'));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.create forwards file_id for file-link creation', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          inode: 'inode-1',
          name: 'invoice.pdf',
          type: 'file',
          parent_inode: 'parent-1',
          file_id: 'file-123',
          etag: 'etag-1',
          metadata: {},
          attributes: [],
          updated_at: 1710000000,
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
    const result = await drive.create({
      name: 'invoice.pdf',
      type: 'file',
      parentPath: '/Projects/prj-1/docs',
      fileId: 'file-123',
    });

    assert.equal(calls[0]?.url, 'https://apis.example/v1/os/drive/api/v1');
    assert.ok(String(calls[0]?.init?.body).includes('"method":"drive/paths/create"'));
    assert.ok(String(calls[0]?.init?.body).includes('"name":"invoice.pdf"'));
    assert.ok(String(calls[0]?.init?.body).includes('"type":"file"'));
    assert.ok(String(calls[0]?.init?.body).includes('"parent_path":"/Projects/prj-1/docs"'));
    assert.ok(String(calls[0]?.init?.body).includes('"file_id":"file-123"'));
    assert.deepEqual(result, {
      id: 'inode-1',
      parentId: 'parent-1',
      name: 'invoice.pdf',
      type: 'file',
      fileId: 'file-123',
      etag: 'etag-1',
      metadata: {},
      attributes: [],
      updatedAt: 1710000000,
    });
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.crontab.getStatus uses the drive JSON-RPC endpoint', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

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
        scopeType: 'workspace',
      },
    });

    assert.deepEqual(result, {
      jobCount: 0,
      nextRunAt: null,
      updatedAt: '2026-03-13T10:00:00Z',
    });
    assert.equal(calls[0]?.url, 'https://apis.example/v1/os/drive/api/v1');
    assert.ok(String(calls[0]?.init?.body).includes('"method":"drive/crontab/get-status"'));
    assert.ok(String(calls[0]?.init?.body).includes('"scope_type":"workspace"'));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('diskd.platform.crontab binds scope + timezone in the constructor', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

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
    assert.equal(calls[0]?.url, 'https://apis.example/v1/platform/crontab/api/v1');
    assert.ok(String(calls[0]?.init?.body).includes('"method":"drive/crontab/save"'));
    assert.ok(String(calls[0]?.init?.body).includes('"scope_type":"project"'));
    assert.ok(String(calls[0]?.init?.body).includes('"project_id":"proj-1"'));
    assert.ok(String(calls[0]?.init?.body).includes('"timezone":"UTC"'));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('diskd.platform.crontab defaults timezone from the caller runtime', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

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
    delete process.env.APIS_BASE_URL;
  }
});

test('diskd.platform.sessions.list uses the drive JSON-RPC endpoint', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

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
    assert.equal(calls[0]?.url, 'https://apis.example/v1/platform/sessions/api/v1');
    assert.ok(String(calls[0]?.init?.body).includes('"method":"drive/session/list"'));
    assert.ok(String(calls[0]?.init?.body).includes('"root_path":"/Projects/proj-1"'));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
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
  process.env.APIS_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    if (url === 'https://apis.example/v1/os/llm/api/v1/invoke') {
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

    if (url === 'https://apis.example/v1/os/agents/supported-agents') {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url === 'https://apis.example/v1/os/mcp/api/catalog') {
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

    if (url === 'https://apis.example/v1/utils/tg-userbot/api/v1/channels') {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url === 'https://apis.example/v1/utils/web-navigator/api/v1/resolve') {
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
        'https://apis.example/v1/os/llm/api/v1/invoke',
        'https://apis.example/v1/os/agents/supported-agents',
        'https://apis.example/v1/os/mcp/api/catalog',
        'https://apis.example/v1/utils/tg-userbot/api/v1/channels',
        'https://apis.example/v1/utils/web-navigator/api/v1/resolve',
      ]
    );
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.readFile sends paths/tools/read and decodes parts', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

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
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.writeFile sends paths/tools/write with path and content', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

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
    delete process.env.APIS_BASE_URL;
  }
});

// ---------------------------------------------------------------------------
// Stage 1: Typed tools results (TDD specs -- these tests define the target API)
// ---------------------------------------------------------------------------

test('drive.tools.ls returns DriveToolsLsResult with typed entries', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

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
              inode: 'inode-1',
              name: 'docs',
              type: 'dir',
              parent_inode: 'root-inode',
              mime_type: null,
              file_id: null,
              etag: null,
              size: null,
              metadata: {},
              attributes: [],
              created_at: 1700000000,
              updated_at: 1700000001,
              indexing_status: null,
              processing_status: null,
              processing_error: null,
              external_status: null,
              external_error: null,
              full_path: '/docs',
            },
            {
              inode: 'inode-2',
              name: 'readme.md',
              type: 'file',
              parent_inode: 'inode-1',
              mime_type: 'text/markdown',
              file_id: 'fid-2',
              etag: 'etag-2',
              size: 1024,
              metadata: {},
              attributes: [],
              created_at: 1700000002,
              updated_at: 1700000003,
              indexing_status: null,
              processing_status: null,
              processing_error: null,
              external_status: null,
              external_error: null,
              full_path: '/docs/readme.md',
            },
          ],
        },
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
    const result = await drive.tools.ls({ path: '/docs', recursive: true });

    // Must return typed DriveToolsLsResult with entries array
    assert.ok(Array.isArray(result.entries), 'result.entries must be an array');
    assert.equal(result.entries.length, 2);

    // First entry: directory
    const dir = result.entries[0];
    assert.equal(dir?.id, 'inode-1');
    assert.equal(dir?.name, 'docs');
    assert.equal(dir?.type, 'dir');
    assert.equal(dir?.parentId, 'root-inode');
    assert.equal(dir?.fullPath, '/docs');
    assert.equal(dir?.createdAt, 1700000000);

    // Second entry: file with all fields
    const file = result.entries[1];
    assert.equal(file?.id, 'inode-2');
    assert.equal(file?.name, 'readme.md');
    assert.equal(file?.type, 'file');
    assert.equal(file?.mimeType, 'text/markdown');
    assert.equal(file?.fileId, 'fid-2');
    assert.equal(file?.size, 1024);
    assert.equal(file?.fullPath, '/docs/readme.md');

    // Verify RPC call
    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.method, 'paths/tools/ls');
    assert.equal(body.params.path, '/docs');
    assert.equal(body.params.recursive, true);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.ls returns empty entries for empty result', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const originalFetch = globalThis.fetch;
  const fetchMock = async (): Promise<Response> =>
    new Response(
      JSON.stringify({ jsonrpc: '2.0', result: { items: [] }, id: 1 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
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
    const result = await drive.tools.ls();
    assert.ok(Array.isArray(result.entries));
    assert.equal(result.entries.length, 0);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.glob returns DriveToolsGlobResult with typed entries', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          items: [
            {
              inode: 'inode-3',
              name: 'notes.md',
              type: 'file',
              parent_inode: 'inode-1',
              mime_type: 'text/markdown',
              file_id: null,
              etag: null,
              size: 512,
              metadata: {},
              attributes: [],
              created_at: 1700000010,
              updated_at: 1700000011,
              indexing_status: null,
              processing_status: null,
              processing_error: null,
              external_status: null,
              external_error: null,
              full_path: '/docs/notes.md',
            },
          ],
        },
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
    const result = await drive.tools.glob({ pattern: '**/*.md' });

    assert.ok(Array.isArray(result.entries), 'result.entries must be an array');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.id, 'inode-3');
    assert.equal(result.entries[0]?.name, 'notes.md');
    assert.equal(result.entries[0]?.type, 'file');
    assert.equal(result.entries[0]?.fullPath, '/docs/notes.md');

    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.method, 'paths/tools/glob');
    assert.equal(body.params.pattern, '**/*.md');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.grep returns DriveToolsGrepResult with typed documents', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          results: [
            {
              id: 'inode-10',
              parts: [
                {
                  type: 'text',
                  title: 'Chapter 1',
                  content: 'The quick brown fox jumps over the lazy dog.',
                  page_number: 1,
                  origin_url: null,
                  author: 'Alice',
                  timestamp: 1700000100,
                },
                {
                  type: 'text',
                  title: null,
                  content: 'Another paragraph with the search term.',
                  page_number: 2,
                  origin_url: 'https://example.com/source',
                  author: null,
                  timestamp: null,
                },
              ],
            },
            {
              id: 'inode-11',
              parts: [
                {
                  type: 'text',
                  title: 'Summary',
                  content: 'A matching summary.',
                  page_number: null,
                  origin_url: null,
                  author: null,
                  timestamp: null,
                },
              ],
            },
            // Error result -- must be filtered out
            { error: 'File not found', code: 404 },
          ],
        },
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
    const result = await drive.tools.grep({
      query: 'fox',
      paths: ['/docs/chapter1.md', '/docs/summary.md'],
    });

    // Must return typed documents, error results filtered out
    assert.ok(Array.isArray(result.documents), 'result.documents must be an array');
    assert.equal(result.documents.length, 2, 'error results must be filtered out');

    // First document
    const doc1 = result.documents[0];
    assert.equal(doc1?.id, 'inode-10');
    assert.equal(doc1?.parts.length, 2);
    assert.equal(doc1?.parts[0]?.type, 'text');
    assert.equal(doc1?.parts[0]?.title, 'Chapter 1');
    assert.equal(doc1?.parts[0]?.content, 'The quick brown fox jumps over the lazy dog.');
    assert.equal(doc1?.parts[0]?.pageNumber, 1);
    assert.equal(doc1?.parts[0]?.originUrl, null);
    assert.equal(doc1?.parts[0]?.author, 'Alice');
    assert.equal(doc1?.parts[0]?.timestamp, 1700000100);

    // Second part of first doc
    assert.equal(doc1?.parts[1]?.title, null);
    assert.equal(doc1?.parts[1]?.originUrl, 'https://example.com/source');
    assert.equal(doc1?.parts[1]?.author, null);

    // Second document
    const doc2 = result.documents[1];
    assert.equal(doc2?.id, 'inode-11');
    assert.equal(doc2?.parts.length, 1);
    assert.equal(doc2?.parts[0]?.title, 'Summary');

    // Verify RPC call
    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.method, 'paths/tools/grep');
    assert.equal(body.params.query, 'fox');
    assert.deepEqual(body.params.paths, ['/docs/chapter1.md', '/docs/summary.md']);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.grep returns empty documents when all results are errors', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const originalFetch = globalThis.fetch;
  const fetchMock = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          results: [
            { error: 'File not found', code: 404 },
            { error: 'Permission denied', code: 403 },
          ],
        },
        id: 1,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
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
    const result = await drive.tools.grep({ query: 'test', paths: ['/missing'] });
    assert.ok(Array.isArray(result.documents));
    assert.equal(result.documents.length, 0);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.vsearch returns DriveToolsVsearchResult with typed documents', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          results: [
            {
              id: 'inode-20',
              parts: [
                {
                  type: 'text',
                  title: 'Relevant section',
                  content: 'Semantically similar content found here.',
                  page_number: 3,
                  origin_url: null,
                  author: null,
                  timestamp: null,
                },
              ],
            },
          ],
        },
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
    const result = await drive.tools.vsearch({
      query: 'machine learning concepts',
      path: '/research',
    });

    assert.ok(Array.isArray(result.documents), 'result.documents must be an array');
    assert.equal(result.documents.length, 1);

    const doc = result.documents[0];
    assert.equal(doc?.id, 'inode-20');
    assert.equal(doc?.parts.length, 1);
    assert.equal(doc?.parts[0]?.type, 'text');
    assert.equal(doc?.parts[0]?.title, 'Relevant section');
    assert.equal(doc?.parts[0]?.content, 'Semantically similar content found here.');
    assert.equal(doc?.parts[0]?.pageNumber, 3);

    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.method, 'paths/tools/vsearch');
    assert.equal(body.params.query, 'machine learning concepts');
    assert.equal(body.params.path, '/research');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

// ---------------------------------------------------------------------------
// Stage 2: New tools methods (TDD specs)
// ---------------------------------------------------------------------------

test('drive.tools.biQuery sends paths/tools/bi-query and returns typed tables', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          tables: {
            'inode-30': {
              headers: ['Name', 'Revenue', 'Active'],
              rows: [
                ['Alice', 50000, true],
                ['Bob', 30000, false],
              ],
            },
            'inode-31': {
              headers: ['Product', 'Quantity'],
              rows: [['Widget', 100]],
            },
          },
        },
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
    const result = await drive.tools.biQuery({
      query: 'SELECT * FROM sheet1',
      paths: ['/data/report.xlsx'],
    });

    assert.ok(result.tables, 'result.tables must exist');
    const table1 = result.tables['inode-30'];
    assert.ok(table1, 'first table must exist');
    assert.deepEqual([...table1.headers], ['Name', 'Revenue', 'Active']);
    assert.equal(table1.rows.length, 2);
    assert.deepEqual([...table1.rows[0]!], ['Alice', 50000, true]);

    const table2 = result.tables['inode-31'];
    assert.ok(table2, 'second table must exist');
    assert.deepEqual([...table2.headers], ['Product', 'Quantity']);

    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.method, 'paths/tools/bi-query');
    assert.equal(body.params.query, 'SELECT * FROM sheet1');
    assert.deepEqual(body.params.paths, ['/data/report.xlsx']);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.biQuery returns empty tables for empty result', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const originalFetch = globalThis.fetch;
  const fetchMock = async (): Promise<Response> =>
    new Response(
      JSON.stringify({ jsonrpc: '2.0', result: { tables: {} }, id: 1 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
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
    const result = await drive.tools.biQuery({ query: 'SELECT 1', paths: ['/empty.xlsx'] });
    assert.deepEqual(result.tables, {});
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.inodesQuery sends paths/tools/inodes-query with all options', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          documents: [
            {
              id: 'inode-40',
              parts: [
                {
                  type: 'text',
                  title: 'Meeting notes',
                  content: 'Discussed Q4 targets.',
                  page_number: 1,
                  origin_url: null,
                  author: 'Charlie',
                  timestamp: 1700000200,
                },
              ],
            },
          ],
          tables: {
            'inode-41': {
              headers: ['Date', 'Amount'],
              rows: [['2025-01-15', 42000]],
            },
          },
        },
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
    const result = await drive.tools.inodesQuery({
      query: 'Q4 targets',
      paths: ['/meetings'],
      dateStart: '2025-01-01',
      dateEnd: '2025-03-31',
      orderBy: 'date_desc',
      limit: 10,
      offset: 0,
    });

    // Documents
    assert.ok(Array.isArray(result.documents));
    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0]?.id, 'inode-40');
    assert.equal(result.documents[0]?.parts[0]?.content, 'Discussed Q4 targets.');
    assert.equal(result.documents[0]?.parts[0]?.author, 'Charlie');

    // Tables
    assert.ok(result.tables);
    const table = result.tables['inode-41'];
    assert.ok(table);
    assert.deepEqual([...table.headers], ['Date', 'Amount']);

    // Verify RPC params
    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.method, 'paths/tools/inodes-query');
    assert.equal(body.params.query, 'Q4 targets');
    assert.deepEqual(body.params.paths, ['/meetings']);
    assert.equal(body.params.date_start, '2025-01-01');
    assert.equal(body.params.date_end, '2025-03-31');
    assert.equal(body.params.order_by, 'date_desc');
    assert.equal(body.params.limit, 10);
    assert.equal(body.params.offset, 0);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.tgSearch sends paths/tools/tg-search and returns typed messages', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: {
          messages: [
            {
              message: {
                message_id: 101,
                text: 'Deploy was successful',
                sender_name: 'DevOps Bot',
                date: '2025-03-20',
                timestamp: 1742486400,
                reply_to_message_id: null,
                is_forward: false,
                views: 42,
                channel_username: 'devops-alerts',
                origin_url: 'https://t.me/devops-alerts/101',
              },
              score: 0.95,
              reply_context: null,
            },
            {
              message: {
                message_id: 99,
                text: 'Starting deploy...',
                sender_name: 'DevOps Bot',
                date: '2025-03-20',
                timestamp: 1742486000,
                reply_to_message_id: null,
                is_forward: false,
                views: null,
                channel_username: 'devops-alerts',
                origin_url: null,
              },
              score: 0.80,
              reply_context: {
                message_id: 98,
                text: 'Approve deploy?',
                sender_name: 'Alice',
                date: '2025-03-20',
                timestamp: 1742485900,
                reply_to_message_id: null,
                is_forward: false,
                views: null,
                channel_username: null,
                origin_url: null,
              },
            },
          ],
          total_found: 2,
          query_type: 'search',
          topics: null,
          date_range_applied: ['2025-03-01', '2025-03-31'],
          database_path: '/Telegram/devops-alerts.telegram',
        },
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
    const result = await drive.tools.tgSearch({
      databasePath: '/Telegram/devops-alerts.telegram',
      query: 'deploy',
      limit: 20,
      offset: 0,
      dateStart: '2025-03-01',
      dateEnd: '2025-03-31',
      orderBy: 'relevance',
    });

    // Top-level fields
    assert.equal(result.totalFound, 2);
    assert.equal(result.queryType, 'search');
    assert.equal(result.topics, null);
    assert.deepStrictEqual(result.dateRangeApplied, ['2025-03-01', '2025-03-31']);
    assert.equal(result.databasePath, '/Telegram/devops-alerts.telegram');

    // First message
    assert.ok(result.messages);
    assert.equal(result.messages.length, 2);
    const msg1 = result.messages[0];
    assert.equal(msg1?.message.messageId, 101);
    assert.equal(msg1?.message.text, 'Deploy was successful');
    assert.equal(msg1?.message.senderName, 'DevOps Bot');
    assert.equal(msg1?.message.timestamp, 1742486400);
    assert.equal(msg1?.message.isForward, false);
    assert.equal(msg1?.message.views, 42);
    assert.equal(msg1?.message.channelUsername, 'devops-alerts');
    assert.equal(msg1?.message.originUrl, 'https://t.me/devops-alerts/101');
    assert.equal(msg1?.score, 0.95);
    assert.equal(msg1?.replyContext, null);

    // Second message with reply context
    assert.ok(result.messages);
    const msg2 = result.messages[1];
    assert.equal(msg2?.message.messageId, 99);
    assert.ok(msg2?.replyContext);
    assert.equal(msg2?.replyContext?.messageId, 98);
    assert.equal(msg2?.replyContext?.text, 'Approve deploy?');
    assert.equal(msg2?.replyContext?.senderName, 'Alice');

    // Verify RPC params
    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.method, 'paths/tools/tg-search');
    assert.equal(body.params.database_path, '/Telegram/devops-alerts.telegram');
    assert.equal(body.params.query, 'deploy');
    assert.equal(body.params.limit, 20);
    assert.equal(body.params.date_start, '2025-03-01');
    assert.equal(body.params.date_end, '2025-03-31');
    assert.equal(body.params.order_by, 'relevance');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.excelWrite sends paths/tools/excel-write and returns write result', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: { inode: 'inode-50', path: '/reports/q4.xlsx' },
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
    const result = await drive.tools.excelWrite({
      path: '/reports/q4.xlsx',
      headers: ['Name', 'Revenue'],
      rows: [
        ['Alice', 50000],
        ['Bob', 30000],
      ],
      sheetName: 'Q4 Data',
    });

    assert.equal(result.id, 'inode-50');
    assert.equal(result.path, '/reports/q4.xlsx');

    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.method, 'paths/tools/excel-write');
    assert.equal(body.params.path, '/reports/q4.xlsx');
    assert.deepEqual(body.params.headers, ['Name', 'Revenue']);
    assert.deepEqual(body.params.rows, [['Alice', 50000], ['Bob', 30000]]);
    assert.equal(body.params.sheet_name, 'Q4 Data');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.excelWrite omits sheet_name when not provided', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        result: { inode: 'inode-51', path: '/data.xlsx' },
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
    await drive.tools.excelWrite({
      path: '/data.xlsx',
      headers: ['A'],
      rows: [['val']],
    });

    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.params.sheet_name, undefined, 'sheet_name must not be sent when omitted');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
});

test('drive.tools.applyPatch sends paths/tools/apply-patch with path and patch', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

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
    delete process.env.APIS_BASE_URL;
  }
});
