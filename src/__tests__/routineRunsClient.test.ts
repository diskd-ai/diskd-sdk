import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import type { RoutineRun } from '../routineRuns/routineRunsTypes.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const stubRun: RoutineRun = {
  id: '01JFXYZ000000000000000001',
  runId: '01JFXYZ000000000000000002',
  routineSlug: 'intake-sorter',
  projectSlug: 'OrgName',
  operativeSlug: 'mail-agent',
  sessionId: '01JFXYZ000000000000000003',
  status: 'completed',
  summary: 'Processed 5 emails',
  errorTag: null,
  errorMessage: null,
  durationMs: 12345,
  createdAt: '2026-03-16T10:00:00.000Z',
  completedAt: '2026-03-16T10:00:12.345Z',
};

const stubFailedRun: RoutineRun = {
  id: '01JFXYZ000000000000000004',
  runId: '01JFXYZ000000000000000005',
  routineSlug: 'intake-sorter',
  projectSlug: 'OrgName',
  operativeSlug: 'mail-agent',
  sessionId: null,
  status: 'failed',
  summary: null,
  errorTag: 'ExecutionFailed',
  errorMessage: 'Agent timeout',
  durationMs: 300000,
  createdAt: '2026-03-16T11:00:00.000Z',
  completedAt: '2026-03-16T11:05:00.000Z',
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

test('routineRuns.list sends GET with routineSlug and unwraps items', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ items: [stubRun, stubFailedRun] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routineRuns({ auth: makeAuth(), url });
      const result = await client.list({ routineSlug: 'intake-sorter' });

      assert.deepEqual(result, [stubRun, stubFailedRun]);
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/routines/intake-sorter/executions');
      assert.equal(calls[0]?.init?.method, 'GET');
      const authHeader = (calls[0]?.init?.headers as Record<string, string>)?.Authorization;
      assert.equal(authHeader, 'Bearer token-123');
    }
  );
});

test('routineRuns.list with scope and projectName appends query params', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ items: [stubRun] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routineRuns({ auth: makeAuth(), url });
      await client.list({
        routineSlug: 'intake-sorter',
        scope: 'project',
        projectName: 'OrgName',
      });

      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/routines/intake-sorter/executions?scope=project&projectName=OrgName'
      );
    }
  );
});

test('routineRuns.list with empty result returns empty array', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      const client = diskd.platform.routineRuns({ auth: makeAuth(), url });
      const result = await client.list({ routineSlug: 'no-runs' });

      assert.deepEqual(result, []);
    }
  );
});

test('routineRuns.get sends GET with routineSlug and executionId and unwraps run', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ run: stubRun }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routineRuns({ auth: makeAuth(), url });
      const result = await client.get({
        routineSlug: 'intake-sorter',
        executionId: '01JFXYZ000000000000000001',
      });

      assert.deepEqual(result, stubRun);
      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/routines/intake-sorter/executions/01JFXYZ000000000000000001'
      );
      assert.equal(calls[0]?.init?.method, 'GET');
    }
  );
});

test('routineRuns.get encodes special characters in slug and executionId', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ run: stubRun }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routineRuns({ auth: makeAuth(), url });
      await client.get({
        routineSlug: 'my routine',
        executionId: 'id with spaces',
      });

      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/routines/my%20routine/executions/id%20with%20spaces'
      );
    }
  );
});

test('routineRuns client throws on HTTP error with parsed message', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ message: 'Execution run not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      const client = diskd.platform.routineRuns({ auth: makeAuth(), url });
      await assert.rejects(
        () =>
          client.get({
            routineSlug: 'intake-sorter',
            executionId: 'nonexistent',
          }),
        (err: Error) => {
          assert.ok(err.message.includes('404'));
          assert.ok(err.message.includes('Execution run not found'));
          return true;
        }
      );
    }
  );
});

test('routineRuns client uses gateway URL when no url override provided', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routineRuns({ auth: makeAuth() });
      await client.list({ routineSlug: 'test' });

      assert.equal(
        calls[0]?.url,
        'https://apis.example/platform/routineRuns/api/routines/test/executions'
      );
    }
  );

  delete process.env.APIS_BASE_URL;
});

test('diskd.platform.routineRuns factory returns a client with all methods', () => {
  const client = diskd.platform.routineRuns({
    auth: makeAuth(),
    url: 'http://app-service:3000',
  });

  assert.equal(typeof client.list, 'function');
  assert.equal(typeof client.get, 'function');
});
