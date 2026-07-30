import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { ContextTooLargeError, createLlmRouterClient } from '../llmRouter/llmRouter.js';
import { type FetchCall, withFetchMock } from '../testing/fetchMock.js';

const auth: AuthModule = {
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-123',
  getToken: () => ({ accessToken: 'token-123' }),
  getWorkspaceId: async () => 'test-workspace',
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const drain = async (stream: AsyncIterable<unknown>): Promise<void> => {
  for await (const chunk of stream) {
    void chunk;
  }
};

type RequestBody = {
  readonly params?: {
    readonly messages?: readonly unknown[];
    readonly reasoning?: { readonly enabled?: boolean };
  };
  readonly messages?: readonly unknown[];
  readonly reasoning?: { readonly enabled?: boolean };
};

/** Parse a captured JSON request body at the test boundary. */
const parseRequestBody = (call: FetchCall | undefined): RequestBody => {
  assert.ok(call?.init?.body);
  const parsed: unknown = JSON.parse(String(call.init.body));
  assert.ok(typeof parsed === 'object' && parsed !== null);
  return parsed as RequestBody;
};

/* REQUIREMENT llm-router-glm-context-overflow Phase C2: the SDK ModelInfo decode
   must carry the resolved context window advertised by models/list-all so
   consumers read it from the wire instead of hardcoding a window table. It must
   accept both camelCase (`contextWindow`) and snake_case (`context_window`), and
   yield null when an older router does not advertise it. */
test('models.listAll decodes contextWindow (camelCase) from the wire', async () => {
  const result = {
    models: [
      {
        provider: 'together',
        model: 'zai-org/GLM-5.1',
        displayName: 'GLM 5.1',
        description: '',
        supportedFeatures: [],
        contextWindow: 202752,
      },
    ],
  };

  await withFetchMock(
    () => jsonResponse({ jsonrpc: '2.0', result, id: 1 }),
    async () => {
      const client = createLlmRouterClient({ auth, url: 'https://apis.example' });
      const { models } = await client.models.listAll();
      assert.equal(models[0]?.contextWindow, 202752);
    }
  );
});

test('models.listAll reads snake_case context_window and yields null when absent', async () => {
  const result = {
    models: [
      {
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        displayName: 'gpt-oss',
        description: '',
        supportedFeatures: [],
        context_window: 128000,
      },
      {
        provider: 'x',
        model: 'y',
        displayName: 'y',
        description: '',
        supportedFeatures: [],
      },
    ],
  };

  await withFetchMock(
    () => jsonResponse({ jsonrpc: '2.0', result, id: 1 }),
    async () => {
      const client = createLlmRouterClient({ auth, url: 'https://apis.example' });
      const { models } = await client.models.listAll();
      assert.equal(models[0]?.contextWindow, 128000);
      assert.equal(models[1]?.contextWindow, null);
    }
  );
});

/* REQ-LLM-OUTPUT-BUDGET-005: SDK model metadata decodes the router-owned output cap so agent consumers can use one advertised budget. */
test('models.listAll decodes maxOutputTokens from the wire', async () => {
  const result = {
    models: [
      {
        provider: 'together',
        model: 'moonshotai/Kimi-K2.6',
        displayName: 'Kimi K2.6',
        description: '',
        supportedFeatures: ['thinking'],
        contextWindow: 262144,
        maxOutputTokens: 32768,
      },
    ],
  };

  await withFetchMock(
    () => jsonResponse({ jsonrpc: '2.0', result, id: 1 }),
    async () => {
      const client = createLlmRouterClient({ auth, url: 'https://apis.example' });
      const { models } = await client.models.listAll();
      assert.equal(models[0]?.maxOutputTokens, 32768);
    }
  );
});

/* REQ-SDK-LLM-REASONING-001: SDK completion requests preserve the canonical reasoning toggle and prior assistant reasoning exactly. */
test('completions.create encodes reasoning request and assistant history', async () => {
  await withFetchMock(
    () =>
      jsonResponse({
        jsonrpc: '2.0',
        result: {
          id: 'completion-1',
          choices: [],
          created: 1,
          model: 'moonshotai/Kimi-K2.6',
        },
        id: 1,
      }),
    async (calls) => {
      const client = createLlmRouterClient({ auth, url: 'https://apis.example' });
      await client.completions.create({
        provider: 'together',
        model: 'moonshotai/Kimi-K2.6',
        messages: [
          {
            role: 'assistant',
            content: '',
            reasoning: 'load sources, then group totals',
          },
        ],
        reasoning: { enabled: true },
      });

      const body = parseRequestBody(calls[0]);
      assert.deepEqual(body.params?.reasoning, { enabled: true });
      assert.deepEqual(body.params?.messages, [
        {
          role: 'assistant',
          content: '',
          reasoning: 'load sources, then group totals',
        },
      ]);
    }
  );
});

/* REQ-SDK-LLM-REASONING-002: SDK non-streaming decoding exposes reasoning separately from answer content without alteration. */
test('completions.create decodes response reasoning', async () => {
  await withFetchMock(
    () =>
      jsonResponse({
        jsonrpc: '2.0',
        result: {
          id: 'completion-1',
          choices: [
            {
              index: 0,
              finish_reason: 'length',
              message: {
                role: 'assistant',
                content: '',
                reasoning: 'step one\nstep two',
              },
            },
          ],
          created: 1,
          model: 'moonshotai/Kimi-K2.6',
        },
        id: 1,
      }),
    async () => {
      const client = createLlmRouterClient({ auth, url: 'https://apis.example' });
      const result = await client.completions.create({
        provider: 'together',
        model: 'moonshotai/Kimi-K2.6',
        messages: [{ role: 'user', content: 'Analyze.' }],
      });

      assert.equal(result.choices[0]?.message?.reasoning, 'step one\nstep two');
    }
  );
});

/* REQ-SDK-LLM-REASONING-003: SDK streaming decoding exposes reasoning deltas separately from answer content without alteration. */
test('completions.stream encodes the toggle and decodes reasoning deltas', async () => {
  const chunk = {
    id: 'completion-1',
    choices: [
      {
        index: 0,
        finish_reason: null,
        delta: {
          role: 'assistant',
          content: null,
          reasoning: 'step one\n',
        },
      },
    ],
    created: 1,
    model: 'moonshotai/Kimi-K2.6',
  };

  await withFetchMock(
    () =>
      new Response(`${JSON.stringify(chunk)}\n`, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      }),
    async (calls) => {
      const client = createLlmRouterClient({ auth, url: 'https://apis.example' });
      const chunks = [];
      for await (const current of client.completions.stream({
        provider: 'together',
        model: 'moonshotai/Kimi-K2.6',
        messages: [{ role: 'user', content: 'Analyze.' }],
        reasoning: { enabled: false },
      })) {
        chunks.push(current);
      }

      const body = parseRequestBody(calls[0]);
      assert.deepEqual(body.reasoning, { enabled: false });
      assert.equal(chunks[0]?.choices[0]?.delta?.reasoning, 'step one\n');
    }
  );
});

/* REQUIREMENT llm-router-glm-context-overflow Phase C3: when the LLM Router
   rejects a streaming request because the input exceeds the context window it
   responds HTTP 413 with `code: "context_too_large"`. The SDK must surface this
   as a typed ContextTooLargeError (not a stringly-typed Error) so callers can
   discriminate it and, e.g., trim history and retry. Other HTTP failures must
   still surface as a generic Error. */
test('completions.stream throws a typed ContextTooLargeError on a 413 context_too_large', async () => {
  await withFetchMock(
    () =>
      jsonResponse(
        {
          error:
            'Context too large for together/zai-org/GLM-5.1: estimated input tokens 222461 plus requested output tokens 4096 exceed context window 202752.',
          code: 'context_too_large',
        },
        413
      ),
    async () => {
      const client = createLlmRouterClient({ auth, url: 'https://apis.example' });
      await assert.rejects(
        drain(
          client.completions.stream({
            provider: 'together',
            model: 'zai-org/GLM-5.1',
            messages: [{ role: 'user', content: 'hi' }],
          })
        ),
        (err: unknown) =>
          err instanceof ContextTooLargeError &&
          err.reason === 'context_too_large' &&
          err.message.includes('Context too large')
      );
    }
  );
});

test('completions.stream throws a generic Error for a non-context HTTP failure', async () => {
  await withFetchMock(
    () => jsonResponse({ error: 'internal boom' }, 500),
    async () => {
      const client = createLlmRouterClient({ auth, url: 'https://apis.example' });
      await assert.rejects(
        drain(
          client.completions.stream({
            provider: 'together',
            model: 'zai-org/GLM-5.1',
            messages: [{ role: 'user', content: 'hi' }],
          })
        ),
        (err: unknown) => err instanceof Error && !(err instanceof ContextTooLargeError)
      );
    }
  );
});
