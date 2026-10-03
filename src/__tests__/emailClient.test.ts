/* REQ-email-workers-004: SDK mail operations use the authenticated worker gateway and wait for durable scoped completion. */
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

test('email client commits before polling and derives identity from auth', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/commands'))
      return new Response(JSON.stringify({ jobId: 'job-1', status: 'queued' }), { status: 202 });
    assert.equal(url, 'http://workers/jobs/job-1');
    return new Response(
      JSON.stringify({
        jobId: 'job-1',
        status: 'succeeded',
        result: { action: 'delete', succeeded: 1, failedUids: [] },
      })
    );
  };
  try {
    const result = await diskd.os
      .email({ auth, url: 'http://workers' })
      .deleteMessages({ account: 'mail', mailbox: 'INBOX', uids: [1] });
    assert.equal(result.succeeded, 1);
    assert.equal(calls.length, 2);
    const headers = new Headers(calls[0]?.init?.headers);
    assert.equal(headers.get('x-workspace-id'), 'workspace-a');
    assert(headers.get('idempotency-key'));
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      operation: 'delete',
      account: 'mail',
      mailbox: 'INBOX',
      uids: [1],
    });
  } finally {
    globalThis.fetch = original;
  }
});
test('email client surfaces failed work without a legacy MCP request', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) =>
    String(input).endsWith('/commands')
      ? new Response(JSON.stringify({ jobId: 'job-1' }), { status: 202 })
      : new Response(JSON.stringify({ jobId: 'job-1', status: 'failed' }));
  try {
    await assert.rejects(
      () =>
        diskd.os.email({ auth, url: 'http://workers' }).hydrateBodies({
          messages: [{ mailboxId: 'exchange-mail', folderId: 'INBOX', externalId: '1:2' }],
        }),
      /failed/
    );
  } finally {
    globalThis.fetch = original;
  }
});

/* REQ-email-workers-005: bodyless account and cancellation requests must not advertise an empty JSON entity rejected by Fastify. */
test('bodyless worker requests omit JSON content type', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).has('content-type'), false);
    return String(input).endsWith('/accounts')
      ? Response.json({ accounts: [] })
      : new Response(null, { status: 204 });
  };
  try {
    const client = diskd.os.email({ auth, url: 'http://workers' });
    await client.listAccounts();
    await client.stopSync({ account: 'mail' });
  } finally {
    globalThis.fetch = original;
  }
});

/* REQ-email-workers-006: normalize existing service-auth headers before applying trusted workspace scope, preventing duplicated case variants. */
test('API-key auth sends one canonical workspace header', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-workspace-id'), 'workspace-a');
    assert.equal(headers.get('x-api-key'), 'service-key');
    return Response.json({ accounts: [] });
  };
  try {
    await diskd.os
      .email({
        auth: {
          ...auth,
          getRequestHeaders: async () => ({
            'X-Workspace-Id': 'workspace-a',
            'X-Api-Key': 'service-key',
          }),
        },
        url: 'http://workers',
      })
      .listAccounts();
  } finally {
    globalThis.fetch = original;
  }
});
