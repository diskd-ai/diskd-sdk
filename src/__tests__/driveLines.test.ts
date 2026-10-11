/* REQ-3143-SDK-001: drive.tools.appendLines and readLines carry Drive's WAL-queued line contract (owner-locked names, 2026-10-11). */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const auth: AuthModule = {
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-3143',
  getToken: () => ({ accessToken: 'token-3143' }),
  getWorkspaceId: async () => 'workspace-3143',
};

/** Answer each JSON-RPC call with the next body and record what was sent. */
const withDrive = async (
  answers: readonly unknown[],
  fn: (drive: ReturnType<typeof diskd.os.drive>, calls: FetchCall[]) => Promise<void>
): Promise<void> => {
  process.env.APIS_BASE_URL = 'https://apis.example';
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    calls.push({ url: input.toString(), init });
    return new Response(JSON.stringify(answers[calls.length - 1]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await fn(diskd.os.drive({ version: 'v1', auth }), calls);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
};

const sent = (call: FetchCall | undefined) => JSON.parse(String(call?.init?.body));

test('appendLines sends paths/tools/append-lines and returns each line status without storage internals', async () => {
  await withDrive(
    [
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          path: '/Projects/p1/MEMORY.jsonl',
          inode: 'inode-1',
          lines: [
            { id: '01A', seq: 7, status: 'appended' },
            { id: '01B', seq: 3, status: 'duplicate' },
          ],
        },
      },
    ],
    async (drive, calls) => {
      const result = await drive.tools.appendLines({
        path: '/Projects/p1/MEMORY.jsonl',
        lines: [
          { id: '01A', line: '{"a":1}' },
          { id: '01B', line: '{"b":2}' },
        ],
      });
      const body = sent(calls[0]);
      assert.equal(body.method, 'paths/tools/append-lines');
      assert.deepEqual(body.params, {
        path: '/Projects/p1/MEMORY.jsonl',
        lines: [
          { id: '01A', line: '{"a":1}' },
          { id: '01B', line: '{"b":2}' },
        ],
      });
      assert.deepEqual(result, {
        id: 'inode-1',
        path: '/Projects/p1/MEMORY.jsonl',
        lines: [
          { id: '01A', status: 'appended' },
          { id: '01B', status: 'duplicate' },
        ],
      });
    }
  );
});

test('appendLines refuses a response with an unknown line status', async () => {
  await withDrive(
    [
      {
        jsonrpc: '2.0',
        id: 1,
        result: { path: '/m.jsonl', inode: 'i', lines: [{ id: '01A', seq: 1, status: 'maybe' }] },
      },
    ],
    async (drive) => {
      await assert.rejects(
        drive.tools.appendLines({ path: '/m.jsonl', lines: [{ id: '01A', line: 'x' }] }),
        /status/
      );
    }
  );
});

test('readLines pages with cursor and limit and decodes next_cursor, null at end of file', async () => {
  await withDrive(
    [
      { jsonrpc: '2.0', id: 1, result: { lines: ['a', 'b'], next_cursor: '2' } },
      { jsonrpc: '2.0', id: 2, result: { lines: ['c'], next_cursor: null } },
    ],
    async (drive, calls) => {
      const first = await drive.tools.readLines({ path: '/m.jsonl', limit: 2 });
      const second = await drive.tools.readLines({
        path: '/m.jsonl',
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });
      assert.deepEqual(sent(calls[0]).params, { path: '/m.jsonl', limit: 2 });
      assert.equal(sent(calls[0]).method, 'paths/tools/read-lines');
      assert.deepEqual(sent(calls[1]).params, { path: '/m.jsonl', limit: 2, cursor: '2' });
      assert.deepEqual(first, { lines: ['a', 'b'], nextCursor: '2' });
      assert.deepEqual(second, { lines: ['c'], nextCursor: null });
    }
  );
});

test('readLines surfaces the owner error code of an absent file', async () => {
  await withDrive(
    [
      {
        jsonrpc: '2.0',
        request_id: 'r1',
        error: {
          code: -32004,
          message: "Read failed for '/m.jsonl'",
          data: { domain_code: 'FILE_NOT_FOUND' },
        },
      },
    ],
    async (drive) => {
      await assert.rejects(drive.tools.readLines({ path: '/m.jsonl' }), /FILE_NOT_FOUND/);
    }
  );
});
