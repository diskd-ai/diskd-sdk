import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { AuthModule } from '../auth/types.js';
import type { DriveClient } from '../drive/types.js';
import { diskd } from '../sdk/diskd.js';

const auth: AuthModule = {
  signIn: async () => undefined,
  signOut: () => undefined,
  handleRedirectCallback: async () => undefined,
  getAccessToken: async () => 'test-token',
  getToken: () => ({ accessToken: 'test-token' }),
  getWorkspaceId: async () => 'workspace-1',
};

const authModes = [
  { name: 'OAuth', auth, headers: { Authorization: 'Bearer test-token' } },
  {
    name: 'API key',
    auth: {
      ...auth,
      getRequestHeaders: async () => ({
        'X-Api-Key': 'test-api-key',
        'X-Workspace-Id': 'workspace-1',
      }),
    },
    headers: { 'X-Api-Key': 'test-api-key', 'X-Workspace-Id': 'workspace-1' },
  },
];

const features = [
  {
    name: 'crontab',
    route: 'platform/crontab',
    method: 'drive/crontab/get-status',
    params: { scope: { scope_type: 'workspace' } },
    result: { job_count: 0, next_run_at: null, updated_at: '2026-10-22T12:00:00Z' },
    expected: { jobCount: 0, nextRunAt: null, updatedAt: '2026-10-22T12:00:00Z' },
    call: (drive: DriveClient) => drive.crontab.getStatus({ scope: { scopeType: 'workspace' } }),
  },
  {
    name: 'session',
    route: 'platform/sessions',
    method: 'drive/session/list',
    params: { root_path: '/Projects/project-1' },
    result: { items: [] },
    expected: { items: [] },
    call: (drive: DriveClient) => drive.session.list({ projectId: 'project-1' }),
  },
] as const;

const setGatewayBase = (context: TestContext, value: string | undefined): void => {
  const previous = process.env.APIS_BASE_URL;
  // IO-boundary exception: each test restores the process environment it temporarily owns.
  if (value === undefined) delete process.env.APIS_BASE_URL;
  else process.env.APIS_BASE_URL = value;
  context.after(() => {
    if (previous === undefined) delete process.env.APIS_BASE_URL;
    else process.env.APIS_BASE_URL = previous;
  });
};

const mockGateway = (
  context: TestContext,
  url: string,
  feature: (typeof features)[number],
  headers: Readonly<{ [key: string]: string | undefined }>
): void => {
  const previousFetch = globalThis.fetch;
  // IO-boundary exception: replace the fetch adapter for this test, then restore it.
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    assert.equal(typeof init?.body, 'string');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      jsonrpc: '2.0',
      id: 1,
      method: feature.method,
      params: feature.params,
    });
    assert.deepEqual(init?.headers, { ...headers, 'Content-Type': 'application/json' });
    const allowed = String(input) === url;
    return new Response(
      JSON.stringify(
        allowed
          ? { jsonrpc: '2.0', id: 1, result: feature.result }
          : { error: { code: 'method_not_allowed' } }
      ),
      { status: allowed ? 200 : 403 }
    );
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
  });
};

features.forEach((feature) => {
  authModes.forEach((mode) => {
    /* REQ-DRIVE-GATEWAY-001: Default Drive subclients use their owning gateway route
     * with unchanged authentication, method names and request parameters. */
    test(`drive.${feature.name} uses its canonical gateway route with ${mode.name}`, async (t) => {
      setGatewayBase(t, 'https://apis.example/');
      mockGateway(t, `https://apis.example/v1/${feature.route}/api/v1`, feature, mode.headers);
      const result = await feature.call(diskd.os.drive({ version: 'v1', auth: mode.auth }));
      assert.deepEqual(result, feature.expected);
    });
  });

  /* REQ-DRIVE-GATEWAY-002: An explicit Drive RPC URL remains authoritative for
   * every subclient and works without a public gateway base URL. */
  test(`drive.${feature.name} preserves an explicit internal RPC endpoint`, async (t) => {
    setGatewayBase(t, undefined);
    mockGateway(t, 'http://drive.internal/api/v1', feature, {
      Authorization: 'Bearer test-token',
    });
    const result = await feature.call(
      diskd.os.drive({ version: 'v1', auth, url: 'http://drive.internal/api/v1///' })
    );
    assert.deepEqual(result, feature.expected);
  });

  /* REQ-DRIVE-GATEWAY-003: The canonical platform factories retain their existing
   * gateway endpoints when the shared Drive factory separates default routes. */
  test(`platform.${feature.name} retains its canonical gateway route`, async (t) => {
    setGatewayBase(t, 'https://apis.example');
    mockGateway(t, `https://apis.example/v1/${feature.route}/api/v1`, feature, {
      Authorization: 'Bearer test-token',
    });
    const result =
      feature.name === 'crontab'
        ? await diskd.platform.crontab({ auth, scope: { scopeType: 'workspace' } }).getStatus()
        : await diskd.platform
            .sessions({ auth, scope: { scopeType: 'project', projectId: 'project-1' } })
            .list();
    assert.deepEqual(result, feature.expected);
  });
});
