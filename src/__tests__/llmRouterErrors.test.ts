import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { JsonRpcError, jsonRpcCall } from '../drive/rpc.js';
import {
  ContextTooLargeError,
  createLlmRouterClient,
  LlmRouterError,
} from '../llmRouter/llmRouter.js';
import { decodeLlmRouterErrorData } from '../llmRouter/llmRouterErrors.js';
import { withFetchMock } from '../testing/fetchMock.js';

type StructuredError = Error & {
  readonly code?: number;
  readonly rpcCode?: number;
  readonly httpStatus?: number;
  readonly data?: unknown;
};

const auth: AuthModule = {
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'test-token',
  getToken: () => ({ accessToken: 'test-token' }),
  getWorkspaceId: async () => 'test-workspace',
};
const params = { provider: 'iosya', model: 'compiler', messages: [] };
const data = {
  reason: 'glm_tool_protocol_error',
  status: 429,
  type: 'rate_limit_error',
  code: 'provider_code',
  param: 'messages',
  message: 'Display only',
};
const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });
const drain = async (stream: AsyncIterable<unknown>): Promise<void> => {
  for await (const chunk of stream) void chunk;
};
const captureError = async (run: () => Promise<unknown>): Promise<StructuredError> => {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  assert.fail('Expected a transport error');
};

/* REQ-3642-075: structured transport errors retain machine facts independently of display text. */
for (const status of [200, 500]) {
  test(`JSON-RPC retains code, transport status and data on HTTP ${status}`, async () => {
    await withFetchMock(
      () => response({ error: { code: -32603, message: 'Changed wording', data } }, status),
      async () => {
        const error = await captureError(() =>
          jsonRpcCall({
            url: 'https://test.invalid',
            bearerToken: 'test',
            method: 'test',
            rpcParams: {},
            id: 1,
          })
        );
        assert.ok(error instanceof JsonRpcError);
        assert.equal(error.name, 'JsonRpcError');
        assert.equal(error.code, -32603);
        assert.equal(error.httpStatus, status);
        assert.deepEqual(error.data, data);
      }
    );
  });
}

/* REQ-3642-075: every LLM transport preserves the same validated safe error DTO. */
for (const path of ['invoke', 'stream-start', 'stream-line', 'stream-tail'] as const) {
  test(`${path} preserves structured error facts and discards unknown provider data`, async () => {
    const unsafeData = {
      ...data,
      failed_generation: 'private model output',
      prompt: 'private input',
    };
    const streamError = {
      type: 'error',
      message: 'Any display wording',
      code: -32603,
      data: unsafeData,
    };
    const makeResponse = (): Response => {
      if (path === 'invoke')
        return response(
          { error: { code: -32603, message: 'Any display wording', data: unsafeData } },
          500
        );
      if (path === 'stream-start')
        return response({ error: 'Any display wording', code: -32603, data: unsafeData }, 502);
      return new Response(JSON.stringify(streamError) + (path === 'stream-line' ? '\n' : ''));
    };
    await withFetchMock(makeResponse, async () => {
      const client = createLlmRouterClient({ auth, url: 'https://test.invalid' });
      const error = await captureError(() =>
        path === 'invoke'
          ? client.completions.create(params)
          : drain(client.completions.stream(params))
      );
      assert.ok(error instanceof LlmRouterError);
      assert.equal(error.name, 'LlmRouterError');
      assert.equal(error.rpcCode, -32603);
      assert.equal(error.httpStatus, path === 'invoke' ? 500 : path === 'stream-start' ? 502 : 200);
      assert.deepEqual(error.data, data);
    });
  });
}

/* REQ-3642-075: context overflow remains compatible on all transports using explicit codes. */
for (const path of ['invoke', 'stream-start', 'stream-line'] as const) {
  test(`${path} retains ContextTooLargeError compatibility from reason`, async () => {
    const fields = { reason: 'context_too_large', message: 'Window exceeded' };
    await withFetchMock(
      () => {
        if (path === 'invoke')
          return response(
            { error: { code: -32602, message: 'Window exceeded', data: fields } },
            413
          );
        if (path === 'stream-start')
          return response({ error: 'Window exceeded', data: fields }, 413);
        return new Response(
          `${JSON.stringify({ type: 'error', message: 'Window exceeded', code: -32602, data: fields })}\n`
        );
      },
      async () => {
        const client = createLlmRouterClient({ auth, url: 'https://test.invalid' });
        const error = await captureError(() =>
          path === 'invoke'
            ? client.completions.create(params)
            : drain(client.completions.stream(params))
        );
        assert.deepEqual(error.data, fields);
        assert.ok(error instanceof ContextTooLargeError);
        assert.equal(error.reason, 'context_too_large');
      }
    );
  });
}

/* REQ-3642-075: malformed DTO fields and error-looking prose never become machine facts. */
test('invalid structured fields are omitted without classifying error prose', async () => {
  await withFetchMock(
    () =>
      response({
        error: {
          code: 'bad',
          message: 'context_too_large rate_limit_error',
          data: {
            reason: 42,
            status: '429',
            type: [],
            code: {},
            param: null,
            message: false,
            secret: 'private',
          },
        },
      }),
    async () => {
      const client = createLlmRouterClient({ auth, url: 'https://test.invalid' });
      const error = await captureError(() => client.completions.create(params));
      assert.equal(error.name, 'LlmRouterError');
      assert.equal(error.rpcCode, undefined);
      assert.equal(error.httpStatus, 200);
      assert.deepEqual(error.data, {});
      assert.ok(!(error instanceof ContextTooLargeError));
    }
  );
});

/* REQ-3642-075: network cancellation is not recast as a provider/model error. */
test('the original fetch cancellation propagates unchanged', async () => {
  const aborted = new DOMException('Caller cancelled', 'AbortError');
  await withFetchMock(
    () => {
      throw aborted;
    },
    async () => {
      const client = createLlmRouterClient({ auth, url: 'https://test.invalid' });
      const error = await captureError(() => client.completions.create(params));
      assert.equal(error, aborted);
    }
  );
});

/* REQ-3642-075: the previously published streaming context code remains supported. */
test('legacy stream-start context code remains typed with transport status', async () => {
  await withFetchMock(
    () => response({ error: 'Old display wording', code: 'context_too_large' }, 413),
    async () => {
      const client = createLlmRouterClient({ auth, url: 'https://test.invalid' });
      const error = await captureError(() => drain(client.completions.stream(params)));
      assert.ok(error instanceof ContextTooLargeError);
      assert.ok(error instanceof LlmRouterError);
      assert.equal(error.httpStatus, 413);
      assert.equal(error.rpcCode, undefined);
      assert.deepEqual(error.data, { reason: 'context_too_large' });
    }
  );
});

/* REQ-3642-075: malformed or legacy string data contains no machine-readable facts. */
for (const invalid of [null, [], ['rate_limit_error'], 'rate_limit_error', 42]) {
  test(`DTO rejects ${JSON.stringify(invalid)}`, () => {
    assert.deepEqual(decodeLlmRouterErrorData(invalid), {});
  });
}

/* REQ-3642-075: safe projection never reads inherited provider facts or invalid numbers. */
test('DTO validates own fields and status ranges without spreading provider objects', () => {
  const inherited: unknown = Object.create(data);
  assert.deepEqual(decodeLlmRouterErrorData(inherited), {});
  for (const status of [0, 99, 600, 429.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(decodeLlmRouterErrorData({ status, code: Number.NaN }), {});
  }
  assert.deepEqual(decodeLlmRouterErrorData({ status: 429, code: 0 }), { status: 429, code: 0 });
});

/* REQ-3642-075: generic non-router HTTP failures preserve transport status only. */
test('non-JSON stream startup retains HTTP status without inventing provider facts', async () => {
  await withFetchMock(
    () => new Response('rate_limit_error in a proxy display page', { status: 503 }),
    async () => {
      const client = createLlmRouterClient({ auth, url: 'https://test.invalid' });
      const error = await captureError(() => drain(client.completions.stream(params)));
      assert.ok(error instanceof LlmRouterError);
      assert.equal(error.httpStatus, 503);
      assert.deepEqual(error.data, {});
    }
  );
});

/* REQ-3642-075: API-key auth has the same structured invoke boundary as bearer auth. */
test('invoke through API-key headers preserves safe provider facts', async () => {
  await withFetchMock(
    () => response({ error: { code: -32603, message: 'Changed', data } }),
    async (calls) => {
      const client = createLlmRouterClient({
        auth: { ...auth, getRequestHeaders: async () => ({ 'X-Api-Key': 'test' }) },
        url: 'https://test.invalid',
      });
      const error = await captureError(() => client.completions.create(params));
      assert.ok(error instanceof LlmRouterError);
      assert.deepEqual(error.data, data);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0]?.init?.headers, {
        'X-Api-Key': 'test',
        'Content-Type': 'application/json',
      });
    }
  );
});

/* REQ-3642-075: published error constructors are identical across Node and browser exports. */
test('root and browser entrypoints expose compatible error classes', async () => {
  const root = await import('../index.js');
  const browser = await import('../browser/index.js');
  assert.equal(root.JsonRpcError, JsonRpcError);
  assert.equal(browser.JsonRpcError, JsonRpcError);
  assert.equal(root.LlmRouterError, LlmRouterError);
  assert.equal(browser.LlmRouterError, LlmRouterError);
  const context = new root.ContextTooLargeError('Existing caller');
  assert.ok(context instanceof browser.ContextTooLargeError);
  assert.ok(context instanceof LlmRouterError);
  assert.equal(context.reason, 'context_too_large');
  assert.deepEqual(context.data, { reason: 'context_too_large' });
});

/* REQ-3642-075: DTO identifiers use the same bounded ASCII contract as the router. */
test('DTO rejects empty, oversized and nonidentifier strings but retains bounded facts', () => {
  for (const value of [
    '',
    'rate limit',
    'a'.repeat(129),
    '\nrate_limit',
    '\u0442\u0435\u0441\u0442',
  ]) {
    assert.deepEqual(
      decodeLlmRouterErrorData({ reason: value, code: value, type: value, param: value }),
      {}
    );
  }
  assert.deepEqual(
    decodeLlmRouterErrorData({
      reason: 'api[0].tool-name:failed',
      code: 'a'.repeat(128),
      message: 'x'.repeat(1000),
    }),
    { reason: 'api[0].tool-name:failed', code: 'a'.repeat(128), message: 'x'.repeat(1000) }
  );
  assert.deepEqual(decodeLlmRouterErrorData({ message: 'x'.repeat(1001) }), {});
});

/* REQ-3642-075: invoke proxy failures retain transport status even without JSON-RPC data. */
for (const body of ['', '<html>Proxy unavailable</html>']) {
  test(`invoke HTTP503 with ${body.length === 0 ? 'empty' : 'non-JSON'} body retains transport status`, async () => {
    await withFetchMock(
      () => new Response(body, { status: 503 }),
      async () => {
        const client = createLlmRouterClient({ auth, url: 'https://test.invalid' });
        const error = await captureError(() => client.completions.create(params));
        assert.ok(error instanceof LlmRouterError);
        assert.equal(error.httpStatus, 503);
        assert.deepEqual(error.data, {});
        assert.equal(error.rpcCode, undefined);
      }
    );
  });
}
