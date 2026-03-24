/* REQUIREMENT ADR-028: Platform REST clients must derive versioned APIS gateway URLs under `/v1/platform/*`. */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import type { Project } from '../projects/projectsTypes.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const stubProject: Project = {
  id: '01JD1234567890ABCDEFGHIJKL',
  name: 'My Project',
  description: 'A test project',
  icon: 'folder',
  iconColor: '#3B82F6',
  updatedAt: '2026-03-16T10:00:00Z',
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

test('projects.list sends GET and returns array', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify([stubProject]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.projects({ auth: makeAuth(), url });
      const result = await client.list();

      assert.deepEqual(result, [stubProject]);
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/projects');
      assert.equal(calls[0]?.init?.method, 'GET');
      const authHeader = (calls[0]?.init?.headers as Record<string, string>)?.Authorization;
      assert.equal(authHeader, 'Bearer token-123');
    }
  );
});

test('projects.get sends GET with projectId path param', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify(stubProject), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.projects({ auth: makeAuth(), url });
      const result = await client.get('01JD1234567890ABCDEFGHIJKL');

      assert.deepEqual(result, stubProject);
      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/projects/01JD1234567890ABCDEFGHIJKL'
      );
      assert.equal(calls[0]?.init?.method, 'GET');
    }
  );
});

test('projects.create sends POST with body', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify(stubProject), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.projects({ auth: makeAuth(), url });
      const result = await client.create({
        name: 'My Project',
        description: 'A test project',
        icon: 'folder',
        iconColor: '#3B82F6',
      });

      assert.deepEqual(result, stubProject);
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/projects');
      assert.equal(calls[0]?.init?.method, 'POST');
      const body = JSON.parse(String(calls[0]?.init?.body));
      assert.equal(body.name, 'My Project');
      assert.equal(body.description, 'A test project');
      const contentType = (calls[0]?.init?.headers as Record<string, string>)?.['Content-Type'];
      assert.equal(contentType, 'application/json');
    }
  );
});

test('projects.update sends PUT with projectId and body', async () => {
  const url = 'http://app-service:3000';
  const updatedProject = { ...stubProject, name: 'Renamed Project' };

  await withFetchMock(
    () =>
      new Response(JSON.stringify(updatedProject), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.projects({ auth: makeAuth(), url });
      const result = await client.update('01JD1234567890ABCDEFGHIJKL', {
        name: 'Renamed Project',
      });

      assert.deepEqual(result, updatedProject);
      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/projects/01JD1234567890ABCDEFGHIJKL'
      );
      assert.equal(calls[0]?.init?.method, 'PUT');
      const body = JSON.parse(String(calls[0]?.init?.body));
      assert.equal(body.name, 'Renamed Project');
    }
  );
});

test('projects.delete sends DELETE with projectId', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(null, {
        status: 204,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.projects({ auth: makeAuth(), url });
      await client.delete('01JD1234567890ABCDEFGHIJKL');

      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/projects/01JD1234567890ABCDEFGHIJKL'
      );
      assert.equal(calls[0]?.init?.method, 'DELETE');
    }
  );
});

test('projects client throws on HTTP error with parsed message', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      const client = diskd.platform.projects({ auth: makeAuth(), url });
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

test('projects client uses gateway URL when no url override provided', async () => {
  process.env.APIS_BASE_URL = 'https://apis.example';

  await withFetchMock(
    () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.projects({ auth: makeAuth() });
      await client.list();

      assert.equal(calls[0]?.url, 'https://apis.example/v1/platform/projects/api/projects');
    }
  );

  delete process.env.APIS_BASE_URL;
});

test('diskd.platform.projects factory returns a client with all methods', () => {
  const client = diskd.platform.projects({
    auth: makeAuth(),
    url: 'http://app-service:3000',
  });

  assert.equal(typeof client.list, 'function');
  assert.equal(typeof client.get, 'function');
  assert.equal(typeof client.create, 'function');
  assert.equal(typeof client.update, 'function');
  assert.equal(typeof client.delete, 'function');
});
