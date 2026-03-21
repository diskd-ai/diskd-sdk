import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import type {
  Operative,
  OperativeFile,
  OperativeSkill,
  OperativeTool,
} from '../operatives/operativesTypes.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

// Wire uses engine/engineProvider/engineModel/intelAccess;
// SDK exposes engine/engineProvider/engineModel/fileAccess
const wireOperative = {
  id: 'op-01',
  scope: 'project',
  projectId: 'proj-1',
  workspaceId: 'ws-1',
  name: 'Research Agent',
  slug: 'research-agent',
  engine: 'quick',
  engineProvider: 'openai',
  engineModel: 'gpt-5',
  orders: 'You are a research assistant.',
  intelAccess: 'all',
  trustLevel: 2,
  isPrimary: true,
  status: 'active',
  createdAt: '2026-03-15T10:00:00Z',
  updatedAt: '2026-03-15T10:00:00Z',
};

const expectedOperative: Operative = {
  id: 'op-01',
  scope: 'project',
  projectId: 'proj-1',
  workspaceId: 'ws-1',
  name: 'Research Agent',
  slug: 'research-agent',
  avatarUrl: undefined,
  engine: 'quick',
  engineProvider: 'openai',
  engineModel: 'gpt-5',
  orders: 'You are a research assistant.',
  ordersUpdatedAt: undefined,
  fileAccess: 'all',
  trustLevel: 2,
  isPrimary: true,
  status: 'active',
  sealGradient: undefined,
  createdBy: undefined,
  createdAt: '2026-03-15T10:00:00Z',
  updatedAt: '2026-03-15T10:00:00Z',
};

const wireFile = {
  id: 'file-01',
  operativeId: 'op-01',
  sourceId: '/docs/knowledge-base',
  createdAt: '2026-03-15T10:00:00Z',
};

const expectedFile: OperativeFile = {
  id: 'file-01',
  operativeId: 'op-01',
  path: '/docs/knowledge-base',
  createdAt: '2026-03-15T10:00:00Z',
};

const wireSkill = {
  id: 'eq-01',
  operativeId: 'op-01',
  equipmentType: 'skill',
  refId: 'web-search',
  createdAt: '2026-03-15T10:00:00Z',
};

const expectedSkill: OperativeSkill = {
  id: 'eq-01',
  operativeId: 'op-01',
  refId: 'web-search',
  createdAt: '2026-03-15T10:00:00Z',
};

const wireTool = {
  id: 'eq-02',
  operativeId: 'op-01',
  equipmentType: 'mcp_tool',
  selector: 'github/search_repos',
  display: { serverName: 'github', toolName: 'search_repos' },
  resolutionStatus: 'valid',
  createdAt: '2026-03-15T10:00:00Z',
};

const expectedTool: OperativeTool = {
  id: 'eq-02',
  operativeId: 'op-01',
  selector: 'github/search_repos',
  display: { serverName: 'github', toolName: 'search_repos' },
  resolutionStatus: 'valid',
  createdAt: '2026-03-15T10:00:00Z',
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

// ---------------------------------------------------------------------------
// Core CRUD -- verifies intelAccess <-> fileAccess mapping
// ---------------------------------------------------------------------------

test('operatives.list decodes intelAccess to fileAccess', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify([wireOperative]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      const result = await client.list({ projectId: 'proj-1' });

      assert.deepEqual(result, [expectedOperative]);
      assert.equal(result[0]?.fileAccess, 'all');
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/operatives?projectId=proj-1');
      assert.equal(calls[0]?.init?.method, 'GET');
    }
  );
});

test('operatives.get decodes intelAccess to fileAccess', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify(wireOperative), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      const result = await client.get('op-01');

      assert.equal(result.fileAccess, 'all');
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/operatives/op-01');
    }
  );
});

test('operatives.getBySlug sends projectId and slug query params', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify(wireOperative), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      await client.getBySlug({ projectId: 'proj-1', slug: 'research-agent' });

      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/operatives/by-slug?projectId=proj-1&slug=research-agent'
      );
    }
  );
});

test('operatives.create sends POST with body', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify(wireOperative), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      const result = await client.create({ projectId: 'proj-1', name: 'Research Agent' });

      assert.equal(result.fileAccess, 'all');
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/operatives');
      assert.equal(calls[0]?.init?.method, 'POST');
    }
  );
});

test('operatives.update encodes SDK field names to wire format', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify(wireOperative), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      await client.update('op-01', {
        fileAccess: 'selected',
        engineProvider: 'anthropic',
        engineModel: 'claude-4',
        engine: 'deep',
      });

      const body = JSON.parse(String(calls[0]?.init?.body));
      // fileAccess is still encoded to intelAccess on the wire
      assert.equal(body.intelAccess, 'selected');
      assert.equal(body.fileAccess, undefined);
      // engine fields are now pass-through (no renaming)
      assert.equal(body.engineProvider, 'anthropic');
      assert.equal(body.engineModel, 'claude-4');
      assert.equal(body.engine, 'deep');
    }
  );
});

test('operatives.delete sends DELETE', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () => new Response(null, { status: 204 }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      await client.delete('op-01');

      assert.equal(calls[0]?.url, 'http://app-service:3000/api/operatives/op-01');
      assert.equal(calls[0]?.init?.method, 'DELETE');
    }
  );
});

// ---------------------------------------------------------------------------
// Files (sourceId <-> path mapping)
// ---------------------------------------------------------------------------

test('operatives.files.list decodes sourceId to path', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify([wireFile]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      const result = await client.files.list('op-01');

      assert.deepEqual(result, [expectedFile]);
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/operatives/op-01/intel');
    }
  );
});

test('operatives.files.add sends one POST per path with sourceId on the wire', async () => {
  const url = 'http://app-service:3000';
  let callCount = 0;

  await withFetchMock(
    () => {
      callCount++;
      return new Response(JSON.stringify(wireFile), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      const result = await client.files.add('op-01', {
        paths: ['/docs/knowledge-base', '/docs/readme'],
      });

      assert.equal(result.length, 2);
      assert.equal(callCount, 2);
      assert.equal(calls[0]?.init?.method, 'POST');
      const body0 = JSON.parse(String(calls[0]?.init?.body));
      assert.equal(body0.sourceId, '/docs/knowledge-base');
      const body1 = JSON.parse(String(calls[1]?.init?.body));
      assert.equal(body1.sourceId, '/docs/readme');
    }
  );
});

test('operatives.files.remove sends DELETE', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () => new Response(null, { status: 204 }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      await client.files.remove('op-01', 'file-01');

      assert.equal(calls[0]?.url, 'http://app-service:3000/api/operatives/op-01/intel/file-01');
      assert.equal(calls[0]?.init?.method, 'DELETE');
    }
  );
});

// ---------------------------------------------------------------------------
// Skills (equipmentType hidden, filtered from equipment endpoint)
// ---------------------------------------------------------------------------

test('operatives.skills.list filters to skill type only', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(
        JSON.stringify({
          registryStatus: 'ok',
          items: [wireSkill, wireTool],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      ),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      const result = await client.skills.list('op-01');

      assert.equal(result.length, 1);
      assert.deepEqual(result[0], expectedSkill);
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/operatives/op-01/equipment');
    }
  );
});

test('operatives.skills.add sends equipmentType: skill on the wire', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify(wireSkill), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      const result = await client.skills.add('op-01', { refIds: ['web-search'] });

      assert.equal(result.length, 1);
      assert.deepEqual(result[0], expectedSkill);
      const body = JSON.parse(String(calls[0]?.init?.body));
      assert.equal(body.equipmentType, 'skill');
      assert.equal(body.refId, 'web-search');
    }
  );
});

test('operatives.skills.remove sends DELETE to equipment endpoint', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () => new Response(null, { status: 204 }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      await client.skills.remove('op-01', 'eq-01');

      assert.equal(calls[0]?.url, 'http://app-service:3000/api/operatives/op-01/equipment/eq-01');
    }
  );
});

// ---------------------------------------------------------------------------
// Tools (equipmentType hidden, filtered from equipment endpoint)
// ---------------------------------------------------------------------------

test('operatives.tools.list filters to mcp_tool type only', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(
        JSON.stringify({
          registryStatus: 'ok',
          items: [wireSkill, wireTool],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      ),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      const result = await client.tools.list('op-01');

      assert.equal(result.length, 1);
      assert.deepEqual(result[0], expectedTool);
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/operatives/op-01/equipment');
    }
  );
});

test('operatives.tools.add sends equipmentType: mcp_tool on the wire', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify(wireTool), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      const result = await client.tools.add('op-01', { selectors: ['github/search_repos'] });

      assert.equal(result.length, 1);
      assert.deepEqual(result[0], expectedTool);
      const body = JSON.parse(String(calls[0]?.init?.body));
      assert.equal(body.equipmentType, 'mcp_tool');
      assert.equal(body.selector, 'github/search_repos');
    }
  );
});

test('operatives.tools.remove sends DELETE to equipment endpoint', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () => new Response(null, { status: 204 }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      await client.tools.remove('op-01', 'eq-02');

      assert.equal(calls[0]?.url, 'http://app-service:3000/api/operatives/op-01/equipment/eq-02');
    }
  );
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

test('operatives client throws on HTTP error with parsed message', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      const client = diskd.platform.operatives({ auth: makeAuth(), url });
      await assert.rejects(
        () => client.get('nonexistent'),
        (err: Error) => {
          assert.ok(err.message.includes('404'));
          assert.ok(err.message.includes('Not Found'));
          return true;
        }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Gateway URL
// ---------------------------------------------------------------------------

test('operatives client uses gateway URL when no url override provided', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  await withFetchMock(
    () =>
      new Response(JSON.stringify([wireOperative]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.operatives({ auth: makeAuth() });
      await client.list({ projectId: 'proj-1' });

      assert.equal(
        calls[0]?.url,
        'https://apis.example/platform/operatives/api/operatives?projectId=proj-1'
      );
    }
  );

  delete process.env.DISKD_BASE_URL;
});

// ---------------------------------------------------------------------------
// Factory smoke test
// ---------------------------------------------------------------------------

test('diskd.platform.operatives factory returns a client with all methods', () => {
  const client = diskd.platform.operatives({
    auth: makeAuth(),
    url: 'http://app-service:3000',
  });

  assert.equal(typeof client.list, 'function');
  assert.equal(typeof client.listWorkspace, 'function');
  assert.equal(typeof client.get, 'function');
  assert.equal(typeof client.getBySlug, 'function');
  assert.equal(typeof client.create, 'function');
  assert.equal(typeof client.update, 'function');
  assert.equal(typeof client.delete, 'function');
  assert.equal(typeof client.files.list, 'function');
  assert.equal(typeof client.files.add, 'function');
  assert.equal(typeof client.files.remove, 'function');
  assert.equal(typeof client.skills.list, 'function');
  assert.equal(typeof client.skills.add, 'function');
  assert.equal(typeof client.skills.remove, 'function');
  assert.equal(typeof client.tools.list, 'function');
  assert.equal(typeof client.tools.add, 'function');
  assert.equal(typeof client.tools.remove, 'function');
});
