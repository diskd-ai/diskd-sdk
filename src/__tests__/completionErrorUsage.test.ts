/* REQ-3721-003: Accepted error receipts preserve known usage without inventing completeness. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeLlmRouterErrorData as decode } from '../llmRouter/llmRouterErrors.js';

const usage = { prompt_tokens: 10, completion_tokens: 4, total_tokens: 17 };
const decoded = { promptTokens: 10, completionTokens: 4, totalTokens: 17 };
for (const complete of [true, false])
  test(`decodes explicit completeness ${complete}`, () =>
    assert.deepEqual(
      decode({ reason: 'glm_tool_protocol_error', usage, usage_complete: complete }),
      { reason: 'glm_tool_protocol_error', usage: decoded, usageComplete: complete }
    ));
test('keeps older errors compatible', () =>
  assert.deepEqual(decode({ reason: 'glm_tool_protocol_error' }), {
    reason: 'glm_tool_protocol_error',
  }));
test('does not infer completeness from a subtotal', () =>
  assert.deepEqual(decode({ usage }), { usage: decoded, usageComplete: false }));
test('accepts complete zero receipt', () =>
  assert.deepEqual(
    decode({
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      usage_complete: true,
    }),
    { usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, usageComplete: true }
  ));
for (const [index, raw] of [
  undefined,
  null,
  [],
  {},
  { ...usage, completion_tokens: -1 },
  { ...usage, completion_tokens: 0.5 },
  { ...usage, total_tokens: Number.MAX_SAFE_INTEGER + 1 },
  Object.create(usage),
].entries())
  test(`invalid receipt ${index} stays incomplete`, () =>
    assert.deepEqual(decode({ usage: raw, usage_complete: true }), { usageComplete: false }));
test('ignores inherited and private fields', () => {
  assert.deepEqual(decode(Object.create({ usage, usage_complete: true })), {});
  assert.deepEqual(decode({ usage, usage_complete: 'true', raw_response: 'PRIVATE' }), {
    usage: decoded,
    usageComplete: false,
  });
});
