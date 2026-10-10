import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { diskd } from '../sdk/diskd.js';

const auth: AuthModule = {
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token',
  getToken: () => ({ accessToken: 'token' }),
  getWorkspaceId: async () => 'workspace-a',
};
const base = {
  account: 'mail__fixture',
  enabled: true,
  running: false,
  intervalMs: 300000,
  nextDueAt: 2000,
};

/** Exercise the public SDK method with only the HTTP adapter controlled. */
async function readStatus(body: unknown) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'http://workers/status/mail__fixture');
    assert.equal(new Headers(init?.headers).get('x-workspace-id'), 'workspace-a');
    return Response.json(body);
  };
  try {
    return await diskd.os
      .email({ auth, url: 'http://workers' })
      .syncStatus({ account: base.account });
  } finally {
    globalThis.fetch = original;
  }
}

/* REQ-3208-SDK-001: Completed worker success reaches the consumer with its real timestamp. */
test('keeps successful completion', async () => {
  const status = { ...base, lastSync: { status: 'succeeded', completedAt: 1000 } };
  assert.deepEqual(await readStatus(status), status);
});

/* REQ-3208-SDK-002: Enrollment alone never becomes a successful sync. */
test('preserves no completed attempt and a disabled account', async () => {
  for (const enabled of [true, false]) {
    const status = { ...base, enabled, lastSync: null };
    assert.deepEqual(await readStatus(status), status);
  }
});

/* REQ-3208-SDK-003: Running and previously completed state coexist across the boundary. */
test('keeps previous completion during an active attempt', async () => {
  const status = { ...base, running: true, lastSync: { status: 'succeeded', completedAt: 1000 } };
  assert.deepEqual(await readStatus(status), status);
});

/* REQ-3208-SDK-004: Failure recovery semantics survive decoding, and success has no stale failure. */
test('preserves transient and reconnect failures followed by recovery', async () => {
  for (const lastSync of [
    { status: 'failed', completedAt: 1000, errorCode: 'EAUTH', requiresReconnect: true },
    { status: 'failed', completedAt: 1001, errorCode: 'ETIMEDOUT', requiresReconnect: false },
    { status: 'succeeded', completedAt: 1002 },
  ]) {
    const status = { ...base, lastSync };
    assert.deepEqual(await readStatus(status), status);
  }
});

/* REQ-3208-SDK-005: Malformed owner data is an error, never a fabricated unknown/healthy result. */
test('rejects invalid outcomes, timestamps and missing failure semantics', async () => {
  for (const lastSync of [
    undefined,
    { status: 'queued', completedAt: 1000 },
    { status: 'succeeded', completedAt: -1 },
    { status: 'succeeded', completedAt: 'yesterday' },
    { status: 'failed', completedAt: 1000, errorCode: 'EAUTH' },
  ])
    await assert.rejects(() => readStatus({ ...base, lastSync }), /InvalidEmailResponse/);
});
