import test from 'node:test';
import assert from 'node:assert/strict';

import { diskd } from '../sdk/diskd.js';
import type { AuthModule } from '../auth/types.js';

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
  };

  try {
    const drive = diskd.drive({ version: 'v1', auth });
    await drive.init();

    assert.equal(calls[0]?.url, 'https://apis.example/drive/api/v1');
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
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      result: {
        job_count: 0,
        next_run_at: null,
        updated_at: '2026-03-13T10:00:00Z',
      },
      id: 1,
    }), {
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
  };

  try {
    const drive = diskd.drive({ version: 'v1', auth });
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
    assert.equal(calls[0]?.url, 'https://apis.example/drive/api/v1');
    assert.ok(String(calls[0]?.init?.body).includes('"method":"drive/crontab/get-status"'));
    assert.ok(String(calls[0]?.init?.body).includes('"scope_type":"profile"'));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.DISKD_BASE_URL;
  }
});
