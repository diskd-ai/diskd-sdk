/* REQUIREMENT end:core/app-service/notes-drive -- SDK Notes client wraps Drive-backed project-notes API. */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import type { ProjectNote } from '../notes/notesTypes.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const PROJECT_ID = '01JD1234567890ABCDEFGHIJKL';
const NOTE_ID = '01JE1234567890ABCDEFGHIJKL';

const stubNote: ProjectNote = {
  id: NOTE_ID,
  projectId: PROJECT_ID,
  name: 'Architecture note',
  content: '# Architecture',
  prompt: null,
  params: { pin: false, order: 0 },
  metadata: null,
  version: 1,
  createdAt: '2026-05-16T10:00:00.000Z',
  updatedAt: '2026-05-16T10:00:00.000Z',
};

/** Build a deterministic auth module so Notes client tests assert SDK headers. */
const makeAuth = (): AuthModule => ({
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-123',
  getToken: () => ({ accessToken: 'token-123' }),
  getWorkspaceId: async () => 'test-workspace',
});

/** Capture fetch calls while returning handler-provided HTTP responses. */
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

test('notes.create sends POST with project scope bound by SDK client', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify(stubNote), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.notes({
        auth: makeAuth(),
        scope: { scopeType: 'project', projectId: PROJECT_ID },
        url,
      });
      const result = await client.create({
        name: 'Architecture note',
        content: '# Architecture',
        prompt: null,
        metadata: null,
        params: { pin: false, order: 0 },
      });

      assert.deepEqual(result, stubNote);
      assert.equal(calls[0]?.url, 'http://app-service:3000/api/project-notes');
      assert.equal(calls[0]?.init?.method, 'POST');
      const body = JSON.parse(String(calls[0]?.init?.body));
      assert.equal(body.projectId, PROJECT_ID);
      assert.equal(body.name, 'Architecture note');
      assert.equal(body.content, '# Architecture');
      const headers = calls[0]?.init?.headers as Record<string, string>;
      assert.equal(headers.Authorization, 'Bearer token-123');
      assert.equal(headers['Content-Type'], 'application/json');
    }
  );
});

test('notes.read sends GET with noteId path param and bound projectId query', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify(stubNote), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    async (calls) => {
      const client = diskd.platform.notes({
        auth: makeAuth(),
        scope: { scopeType: 'project', projectId: PROJECT_ID },
        url,
      });
      const result = await client.read(NOTE_ID);

      assert.deepEqual(result, stubNote);
      assert.equal(
        calls[0]?.url,
        `http://app-service:3000/api/project-notes/${NOTE_ID}?projectId=${PROJECT_ID}`
      );
      assert.equal(calls[0]?.init?.method, 'GET');
    }
  );
});

test('notes client throws on HTTP error with parsed message', async () => {
  const url = 'http://app-service:3000';

  await withFetchMock(
    () =>
      new Response(JSON.stringify({ message: 'Note not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      const client = diskd.platform.notes({
        auth: makeAuth(),
        scope: { scopeType: 'project', projectId: PROJECT_ID },
        url,
      });

      await assert.rejects(
        () => client.read(NOTE_ID),
        /Project Notes request failed \(404\): Note not found/
      );
    }
  );
});
