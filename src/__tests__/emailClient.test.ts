/* REQ-email-workers-004: SDK mail operations use the authenticated worker gateway and wait for durable scoped completion. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
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

/* REQ-3737-003: the same App intent retains its wire identity across repeated SDK calls. */
for (const operation of ['sync', 'stopSync'] as const) {
  test(`email ${operation} preserves the mailbox intent through HTTP redelivery`, async () => {
    const intent = { intentGeneration: 7, operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' };
    const account = 'mail__fixture';
    const captures: { method?: string; path?: string; body: string; key?: string | string[] }[] =
      [];
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      captures.push({
        method: req.method,
        path: req.url,
        body,
        key: req.headers['idempotency-key'],
      });
      if (captures.length === 1) {
        res.writeHead(503).end();
      } else if (req.method === 'DELETE') {
        res.writeHead(204).end();
      } else {
        res.writeHead(202, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            jobId: 'j',
            requestId: 'r',
            status: 'queued',
            syncIntervalSeconds: 300,
          })
        );
      }
    });
    server.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const addr = server.address();
      assert(addr && typeof addr !== 'string');
      const client = diskd.os.email({ auth, url: `http://127.0.0.1:${addr.port}/v1/os/email` });
      const input = { account, ...intent };
      await assert.rejects(client[operation](input), /EmailWorkerHttp503/);
      const outcome = await client[operation](input);
      assert.equal(captures.length, 2);
      assert.deepEqual(captures[1], captures[0]);
      const capture = captures[0];
      assert(capture);
      if (operation === 'sync') {
        assert.equal(capture.key, intent.operationId);
        assert.equal(capture.method, 'POST');
        assert.equal(capture.path, '/v1/os/email/sync');
        assert.deepEqual(JSON.parse(capture.body), input);
        assert.deepEqual(outcome, { jobId: 'j', requestId: 'r', status: 'queued' });
      } else {
        assert.equal(capture.method, 'DELETE');
        assert.equal(capture.path, '/v1/os/email/sync/' + account);
        assert.deepEqual(JSON.parse(capture.body), intent);
        assert.equal(outcome, undefined);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve()))
      );
    }
  });
}

/* REQ-3737-003: legacy sync keeps its admission shape; invalid pairs never reach a worker. */
test('keeps legacy sync and refuses incomplete mailbox intents before HTTP', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(String(init?.body)), { account: 'mail' });
    assert(new Headers(init?.headers).get('idempotency-key'));
    return Response.json({ jobId: 'j', requestId: 'r', status: 'queued' }, { status: 202 });
  };
  try {
    const client = diskd.os.email({ auth, url: 'http://workers' });
    await client.sync({ account: 'mail' });
    for (const call of [client.sync, client.stopSync]) {
      // JavaScript callers can bypass the typed pair.
      await assert.rejects(
        call(JSON.parse('{"account":"mail","intentGeneration":1}')),
        /operationId/
      );
      await assert.rejects(
        call(JSON.parse('{"account":"mail","operationId":"01ARZ3NDEKTSV4RRFFQ69G5FAV"}')),
        /intentGeneration/
      );
      await assert.rejects(
        call({ account: 'mail', intentGeneration: -1, operationId: 'invalid' }),
        /intentGeneration/
      );
    }
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

/* REQ-3737-011 (#3737, owner decision 2026-11-23): the worker status carries one durable snapshot of the account's
   applied mailbox intent { state, appliedGeneration, operationId, pendingPublication }; the SDK passes it through with
   the exact wire names, null when an older worker does not report it, and refuses a malformed snapshot. */
const statusWith = (snapshot: Record<string, unknown>) => ({
  account: 'mail',
  enabled: true,
  intervalMs: 300000,
  nextDueAt: null,
  running: false,
  lastSync: null,
  ...snapshot,
});
const readStatus = async (body: unknown) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json(body);
  try {
    return await diskd.os.email({ auth, url: 'http://workers' }).syncStatus({ account: 'mail' });
  } finally {
    globalThis.fetch = original;
  }
};

test('passes the applied mailbox intent snapshot through the status', async () => {
  const status = await readStatus(
    statusWith({
      state: 'STOPPED',
      appliedGeneration: 2,
      operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      pendingPublication: false,
    })
  );
  assert.equal(status.state, 'STOPPED');
  assert.equal(status.appliedGeneration, 2);
  assert.equal(status.operationId, '01ARZ3NDEKTSV4RRFFQ69G5FAV');
  assert.equal(status.pendingPublication, false);
});

test('reports an UNDECLARED account without an applied pair', async () => {
  const status = await readStatus(
    statusWith({
      state: 'UNDECLARED',
      appliedGeneration: null,
      operationId: null,
      pendingPublication: false,
    })
  );
  assert.equal(status.state, 'UNDECLARED');
  assert.equal(status.appliedGeneration, null);
  assert.equal(status.operationId, null);
});

test('reads a status without the snapshot (older workers) as nulls', async () => {
  const status = await readStatus(statusWith({}));
  assert.equal(status.enabled, true);
  assert.equal(status.state, null);
  assert.equal(status.appliedGeneration, null);
  assert.equal(status.operationId, null);
  assert.equal(status.pendingPublication, null);
});

test('refuses a malformed snapshot', async () => {
  for (const snapshot of [
    {
      state: 'PAUSED',
      appliedGeneration: 1,
      operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      pendingPublication: false,
    },
    {
      state: 'ENABLED',
      appliedGeneration: '1',
      operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      pendingPublication: false,
    },
    {
      state: 'ENABLED',
      appliedGeneration: 1,
      operationId: 'not-a-ulid',
      pendingPublication: false,
    },
    {
      state: 'ENABLED',
      appliedGeneration: 1,
      operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      pendingPublication: 'no',
    },
    { state: 'ENABLED', appliedGeneration: null, operationId: null, pendingPublication: false },
  ]) {
    await assert.rejects(readStatus(statusWith(snapshot)), /InvalidEmailResponse/);
  }
});

test('sends the Stop pair in the DELETE body', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: 204 });
  };
  try {
    await diskd.os.email({ auth, url: 'http://workers' }).stopSync({
      account: 'mail',
      intentGeneration: 2,
      operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    });
    assert.equal(calls[0]?.url, 'http://workers/sync/mail');
    assert.equal(calls[0]?.init?.method, 'DELETE');
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      intentGeneration: 2,
      operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    });
  } finally {
    globalThis.fetch = original;
  }
});

/* REQ-3737-011 (review): a snapshot is present when any of its four fields is present, and then all four are
   required; UNDECLARED never carries a pair. */
test('refuses partial or inconsistent snapshots', async () => {
  for (const snapshot of [
    { appliedGeneration: 2, operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', pendingPublication: false },
    { pendingPublication: false },
    { state: 'STOPPED', appliedGeneration: 2, operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    {
      state: 'UNDECLARED',
      appliedGeneration: 2,
      operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      pendingPublication: false,
    },
  ]) {
    await assert.rejects(readStatus(statusWith(snapshot)), /InvalidEmailResponse/);
  }
});

/* REQ-3737-005 (review): an explicitly undefined pair is a legacy request, and sync forwards only the account and
   the pair, never other fields a JavaScript caller passes. */
test('treats an undefined pair as legacy and forwards only account and pair', async () => {
  const original = globalThis.fetch;
  const seen: { method: string; body: unknown }[] = [];
  globalThis.fetch = async (_input, init) => {
    seen.push({
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return init?.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : Response.json({ jobId: 'j', requestId: 'r', status: 'queued' }, { status: 202 });
  };
  try {
    const client = diskd.os.email({ auth, url: 'http://workers' });
    await client.sync({ account: 'mail', intentGeneration: undefined, operationId: undefined });
    await client.stopSync({ account: 'mail', intentGeneration: undefined, operationId: undefined });
    await client.sync(
      JSON.parse(
        '{"account":"mail","intentGeneration":3,"operationId":"01ARZ3NDEKTSV4RRFFQ69G5FAV","extra":"x"}'
      )
    );
    assert.deepEqual(seen, [
      { method: 'POST', body: { account: 'mail' } },
      { method: 'DELETE', body: undefined },
      {
        method: 'POST',
        body: { account: 'mail', intentGeneration: 3, operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});
