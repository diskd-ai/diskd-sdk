import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import type { Routine } from '../routines/routinesTypes.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const stubRoutine: Routine = {
  slug: 'daily-summary',
  name: 'Daily Summary',
  description: 'Summarize daily activity',
  icon: 'calendar',
  status: 'active',
  triggerType: 'rhythm',
  trigger: { cron: '0 9 * * *' },
  steps: [{ id: 'step-1', name: 'Summarize', action: 'summarize', order: 0 }],
  operativeSlug: 'analyst',
  rhythms: [],
  scope: 'profile',
  createdAt: '2026-03-15T10:00:00Z',
  updatedAt: '2026-03-15T10:00:00Z',
};

const makeAuth = (): AuthModule => ({
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-123',
  getToken: () => ({ accessToken: 'token-123' }),
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

test('routines.list sends GET with scope query params and unwraps items', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ items: [stubRoutine] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routines({ auth: makeAuth(), url });
      const result = await client.list({ scope: 'profile' });

      assert.deepEqual(result, [stubRoutine]);
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/routines?scope=profile');
      assert.equal(calls[0]?.init?.method, 'GET');
      const authHeader = (calls[0]?.init?.headers as Record<string, string>)?.Authorization;
      assert.equal(authHeader, 'Bearer token-123');
    }
  );
});

test('routines.list without params sends GET with no query string', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routines({ auth: makeAuth(), url });
      const result = await client.list();

      assert.deepEqual(result, []);
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/routines');
    }
  );
});

test('routines.list with project scope includes projectName query param', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ items: [stubRoutine] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routines({ auth: makeAuth(), url });
      await client.list({ scope: 'project', projectName: 'my-project' });

      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/routines?scope=project&projectName=my-project'
      );
    }
  );
});

test('routines.get sends GET with slug and scope and unwraps routine', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ routine: stubRoutine }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routines({ auth: makeAuth(), url });
      const result = await client.get({ slug: 'daily-summary', scope: 'profile' });

      assert.deepEqual(result, stubRoutine);
      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/routines/daily-summary?scope=profile'
      );
      assert.equal(calls[0]?.init?.method, 'GET');
    }
  );
});

test('routines.create sends POST with body and unwraps routine', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ routine: stubRoutine }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routines({ auth: makeAuth(), url });
      const result = await client.create({
        name: 'Daily Summary',
        operativeSlug: 'analyst',
        scope: 'profile',
      });

      assert.deepEqual(result, stubRoutine);
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/routines');
      assert.equal(calls[0]?.init?.method, 'POST');
      const body = JSON.parse(String(calls[0]?.init?.body));
      assert.equal(body.name, 'Daily Summary');
      assert.equal(body.scope, 'profile');
      const contentType = (calls[0]?.init?.headers as Record<string, string>)?.['Content-Type'];
      assert.equal(contentType, 'application/json');
    }
  );
});

test('routines.update sends PATCH with slug, body, and scope query', async () => {
  const url = 'http://app-service:3000';
  const updatedRoutine = { ...stubRoutine, name: 'Updated Summary' };

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ routine: updatedRoutine }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routines({ auth: makeAuth(), url });
      const result = await client.update(
        'daily-summary',
        { name: 'Updated Summary' },
        { scopeType: 'profile' }
      );

      assert.deepEqual(result, updatedRoutine);
      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/routines/daily-summary?scope=profile'
      );
      assert.equal(calls[0]?.init?.method, 'PATCH');
      const body = JSON.parse(String(calls[0]?.init?.body));
      assert.equal(body.name, 'Updated Summary');
    }
  );
});

test('routines.update with project scope includes projectName', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ routine: stubRoutine }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routines({ auth: makeAuth(), url });
      await client.update(
        'daily-summary',
        { status: 'paused' },
        { scopeType: 'project', projectName: 'my-project' }
      );

      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/routines/daily-summary?scope=project&projectName=my-project'
      );
    }
  );
});

test('routines.delete sends DELETE with slug and scope', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify(true), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routines({ auth: makeAuth(), url });
      await client.delete({ slug: 'daily-summary', scope: 'profile' });

      assert.equal(
        calls[0]?.url,
        'http://app-service:3000/api/routines/daily-summary?scope=profile'
      );
      assert.equal(calls[0]?.init?.method, 'DELETE');
    }
  );
});

test('routines client throws on HTTP error with parsed message', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      const client = diskd.platform.routines({ auth: makeAuth(), url });
      await assert.rejects(
        () => client.get({ slug: 'nonexistent' }),
        (err: Error) => {
          assert.ok(err.message.includes('404'));
          assert.ok(err.message.includes('Not Found'));
          return true;
        }
      );
    }
  );
});

test('routines client uses gateway URL when no url override provided', async () => {
  process.env.DISKD_BASE_URL = 'https://apis.example';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.routines({ auth: makeAuth() });
      await client.list();

      assert.equal(calls[0]?.url, 'https://apis.example/platform/app/api/routines');
    }
  );

  delete process.env.DISKD_BASE_URL;
});

test('diskd.platform.routines factory returns a client with all methods', () => {
  const client = diskd.platform.routines({
    auth: makeAuth(),
    url: 'http://app-service:3000',
  });

  assert.equal(typeof client.list, 'function');
  assert.equal(typeof client.get, 'function');
  assert.equal(typeof client.create, 'function');
  assert.equal(typeof client.update, 'function');
  assert.equal(typeof client.delete, 'function');
});
