/* REQ-3721-004: Real local HTTP proves cancellation reaches a silent upstream connection. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { createLlmRouterClient, LlmRouterError } from '../llmRouter/llmRouter.js';

const auth: AuthModule = {
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'test-token',
  getToken: () => ({ accessToken: 'test-token' }),
  getWorkspaceId: async () => 'test-workspace',
};
/* REQ-3721-004: IO-only promise handles synchronize HTTP events without sleeps. */
function createGate<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  // Exception: local IO handles are assigned synchronously by the Promise constructor.
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
/* REQ-3721-004: An independent watchdog makes missing cancellation fail without hanging the test. */
async function bounded<T>(operation: Promise<T>): Promise<T> {
  const watchdog = createGate<never>();
  const timer = setTimeout(
    () => watchdog.reject(new Error('Cancellation did not reach upstream')),
    1500
  );
  try {
    return await Promise.race([operation, watchdog.promise]);
  } finally {
    clearTimeout(timer);
  }
}
/* REQ-3721-004: Only the HTTP boundary is real; no provider calls or paid inference occur. */
async function withServer(
  run: (url: string, opened: Promise<ServerResponse>) => Promise<void>
): Promise<void> {
  const opened = createGate<ServerResponse>();
  const server = createServer((_req, response) => {
    opened.resolve(response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`, opened.promise);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}
/* REQ-3721-004: Draining waits for the real SDK iterator, not a local cancellation wrapper. */
async function drain(chunks: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of chunks) {
    void chunk;
  }
}
for (const headers of [false, true]) {
  /* REQ-3721-004: Abort closes requests both before headers and while the response body is silent. */
  test(`stream cancellation closes upstream ${headers ? 'after' : 'before'} response headers`, async () => {
    await withServer(async (url, opened) => {
      const stop = new AbortController();
      const client = createLlmRouterClient({ auth, url });
      const iterator = client.completions
        .stream({ provider: 'test', model: 'pulse', messages: [], signal: stop.signal })
        [Symbol.asyncIterator]();
      const first = iterator.next();
      const response = await bounded(opened);
      if (headers) {
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        response.write(
          `${JSON.stringify({ id: 'first', model: 'pulse', created: 0, choices: [] })}\n`
        );
        await bounded(first);
      }
      const pending = headers ? iterator.next() : first;
      const closed = once(response, 'close');
      stop.abort();
      try {
        await assert.rejects(bounded(pending), { name: 'AbortError' });
        await bounded(closed);
      } finally {
        response.destroy();
        await Promise.allSettled([pending]);
      }
    });
  });
}
/* REQ-3721-004: Ending iteration cancels the unread body so provider work is not left open. */
test('breaking iteration closes the unread upstream body', async () => {
  await withServer(async (url, opened) => {
    const client = createLlmRouterClient({ auth, url });
    const first = (async () => {
      for await (const chunk of client.completions.stream({
        provider: 'test',
        model: 'pulse',
        messages: [],
      })) {
        assert.equal(chunk.id, 'first');
        break;
      }
    })();
    const response = await bounded(opened);
    const closed = once(response, 'close');
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    response.write(`${JSON.stringify({ id: 'first', model: 'pulse', created: 0, choices: [] })}\n`);
    try {
      await bounded(first);
      await bounded(closed);
    } finally {
      response.destroy();
      await Promise.allSettled([first]);
    }
  });
});

for (const tail of [false, true]) {
  /* REQ-3721-001/004: A malformed transport frame cannot silently remove output before dispatch. */
  test(`malformed ${tail ? 'tail' : 'line'} terminates the stream explicitly`, async () => {
    await withServer(async (url, opened) => {
      const client = createLlmRouterClient({ auth, url });
      const pending = drain(
        client.completions.stream({ provider: 'test', model: 'pulse', messages: [] })
      );
      const response = await bounded(opened);
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      response.end(`not-json${tail ? '' : '\n'}`);
      await assert.rejects(bounded(pending), { name: 'SyntaxError' });
    });
  });
}

/* REQ-3721-004: Replacing transport preserves typed HTTP failures used by retry policy. */
test('preserves a non-JSON HTTP server failure as a typed router error', async () => {
  await withServer(async (url, opened) => {
    const client = createLlmRouterClient({ auth, url });
    const pending = drain(
      client.completions.stream({ provider: 'test', model: 'pulse', messages: [] })
    );
    const response = await bounded(opened);
    response.writeHead(503, { 'Content-Type': 'text/plain' });
    response.end('upstream unavailable');
    await assert.rejects(
      bounded(pending),
      (error) => error instanceof LlmRouterError && error.httpStatus === 503
    );
  });
});

/* REQ-3721-004: Buffered frames cannot escape after caller cancellation. */
test('abort prevents a second frame already buffered in the same HTTP chunk', async () => {
  await withServer(async (url, opened) => {
    const stop = new AbortController();
    const client = createLlmRouterClient({ auth, url });
    const iterator = client.completions
      .stream({ provider: 'test', model: 'pulse', messages: [], signal: stop.signal })
      [Symbol.asyncIterator]();
    const first = iterator.next();
    const response = await bounded(opened);
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    response.write(
      `${['first', 'second']
        .map((id) => JSON.stringify({ id, model: 'pulse', created: 0, choices: [] }))
        .join('\n')}\n`
    );
    const yielded = await bounded(first);
    assert.equal(yielded.done, false);
    assert.equal(yielded.value.id, 'first');
    stop.abort();
    try {
      await assert.rejects(bounded(iterator.next()), { name: 'AbortError' });
    } finally {
      response.destroy();
    }
  });
});
