/* REQ-3721-003: Unknown token usage must not become a known zero-cost receipt. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { createLlmRouterClient } from '../llmRouter/llmRouter.js';
import type { CompletionUsage } from '../llmRouter/llmRouterTypes.js';

const auth: AuthModule = {
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'fixture-only',
  getToken: () => ({ accessToken: 'fixture-only' }),
  getWorkspaceId: async () => 'fixture-only',
};

type Case = {
  readonly name: string;
  readonly wire: unknown;
  readonly expected: CompletionUsage | null;
};
const cases: readonly Case[] = [
  { name: 'absent usage', wire: undefined, expected: null },
  { name: 'null usage', wire: null, expected: null },
  { name: 'empty usage', wire: {}, expected: null },
  {
    name: 'missing prompt tokens',
    wire: { completion_tokens: 4, total_tokens: 4 },
    expected: null,
  },
  {
    name: 'missing completion tokens',
    wire: { prompt_tokens: 4, total_tokens: 4 },
    expected: null,
  },
  {
    name: 'missing total tokens',
    wire: { prompt_tokens: 4, completion_tokens: 2 },
    expected: null,
  },
  {
    name: 'string count',
    wire: { prompt_tokens: '4', completion_tokens: 2, total_tokens: 6 },
    expected: null,
  },
  {
    name: 'null count',
    wire: { prompt_tokens: 4, completion_tokens: null, total_tokens: 4 },
    expected: null,
  },
  {
    name: 'negative count',
    wire: { prompt_tokens: 4, completion_tokens: -1, total_tokens: 3 },
    expected: null,
  },
  {
    name: 'fractional count',
    wire: { prompt_tokens: 4, completion_tokens: 1.5, total_tokens: 5.5 },
    expected: null,
  },
  {
    name: 'total includes provider thought and tool tokens',
    wire: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 20 },
    expected: { promptTokens: 10, completionTokens: 4, totalTokens: 20 },
  },
  {
    name: 'unsafe total',
    wire: {
      prompt_tokens: Number.MAX_SAFE_INTEGER,
      completion_tokens: 1,
      total_tokens: Number.MAX_SAFE_INTEGER + 1,
    },
    expected: null,
  },
  {
    name: 'explicit zero counts',
    wire: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    expected: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  },
  {
    name: 'valid counts',
    wire: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    expected: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
  },
  {
    name: 'provider extra details',
    wire: {
      prompt_tokens: 10,
      completion_tokens: 4,
      total_tokens: 14,
      prompt_tokens_details: { cached_tokens: 8 },
    },
    expected: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
  },
];

for (const transport of ['stream', 'complete'] as const) {
  for (const scenario of cases) {
    /* REQ-3721-003: Both actual HTTP decoders preserve valid counts and unknown usage without losing content. */
    test(`${transport}: ${scenario.name}`, { timeout: 5000 }, async () => {
      const result = {
        id: 'fixture',
        model: 'fixture',
        created: 0,
        usage: scenario.wire,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'preserved' },
            delta: { role: 'assistant', content: 'preserved' },
          },
        ],
      };
      let requests = 0;
      const server = createServer((request, response) => {
        requests += 1;
        request.resume();
        response.setHeader(
          'Content-Type',
          transport === 'stream' ? 'application/x-ndjson' : 'application/json'
        );
        response.end(
          transport === 'stream'
            ? `${JSON.stringify(result)}\n`
            : JSON.stringify({ jsonrpc: '2.0', id: 1, result })
        );
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      try {
        const client = createLlmRouterClient({ auth, url: `http://127.0.0.1:${address.port}` });
        const params = { provider: 'fixture', model: 'fixture', messages: [] };
        if (transport === 'complete') {
          const value = await client.completions.create(params);
          assert.deepEqual(value.usage, scenario.expected);
          assert.equal(value.choices[0]?.message?.content, 'preserved');
        } else {
          const values = [];
          for await (const value of client.completions.stream(params)) values.push(value);
          assert.equal(values.length, 1);
          assert.deepEqual(values[0]?.usage, scenario.expected);
          assert.equal(values[0]?.choices[0]?.delta?.content, 'preserved');
        }
        assert.equal(requests, 1);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    });
  }
}
