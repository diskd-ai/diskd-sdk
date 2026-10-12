/* REQ-3248-SDK-001: conditional writes (owner-locked contract, 2026-10-12): writeFile and applyPatch send expected_etag only when given, and read, read-lines, write and patch results carry the file etag. */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const auth: AuthModule = {
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-3248',
  getToken: () => ({ accessToken: 'token-3248' }),
  getWorkspaceId: async () => 'workspace-3248',
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
const ok = (result: unknown) => ({ jsonrpc: '2.0', id: 1, result });

test('writeFile sends expected_etag when given and returns the new etag', async () => {
  await withDrive(
    [
      ok({ success: true, inode: 'i1', path: '/ReadMe', etag: 'e2' }),
      ok({ success: true, inode: 'i1', path: '/ReadMe', etag: 'e3' }),
    ],
    async (drive, calls) => {
      const guarded = await drive.tools.writeFile({
        path: '/ReadMe',
        content: 'x',
        expectedEtag: 'e1',
      });
      assert.deepEqual(guarded, { id: 'i1', path: '/ReadMe', etag: 'e2' });
      assert.equal(sent(calls[0]).params.expected_etag, 'e1');
      await drive.tools.writeFile({ path: '/ReadMe', content: 'y' });
      assert.equal('expected_etag' in sent(calls[1]).params, false);
    }
  );
});

test('applyPatch sends expected_etag when given and returns the new etag', async () => {
  await withDrive(
    [ok({ success: true, inode: 'i1', path: '/ReadMe', etag: 'e5' })],
    async (drive, calls) => {
      const patched = await drive.tools.applyPatch({
        path: '/ReadMe',
        patch: '@@',
        expectedEtag: 'e4',
      });
      assert.equal(patched.etag, 'e5');
      assert.equal(sent(calls[0]).params.expected_etag, 'e4');
    }
  );
});

test('readFile and readLines return the file etag', async () => {
  await withDrive(
    [ok({ parts: [], eof: true, etag: 'e7' }), ok({ lines: ['a'], next_cursor: null, etag: 'e8' })],
    async (drive) => {
      assert.equal((await drive.tools.readFile({ path: '/ReadMe' })).etag, 'e7');
      assert.equal((await drive.tools.readLines({ path: '/MEMORY.jsonl' })).etag, 'e8');
    }
  );
});

test('results of a file without an etag carry etag null', async () => {
  await withDrive(
    [
      ok({ parts: [], eof: true, etag: null }),
      ok({ success: true, inode: 'i9', path: '/new.txt', etag: null }),
    ],
    async (drive) => {
      assert.equal((await drive.tools.readFile({ path: '/legacy.txt' })).etag, null);
      assert.equal((await drive.tools.writeFile({ path: '/new.txt', content: 'x' })).etag, null);
    }
  );
});
