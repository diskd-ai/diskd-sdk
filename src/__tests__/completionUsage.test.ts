/* REQ-3721-003: A usage receipt requires three finite, exact counters. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCompletionUsage } from '../llmRouter/completion-usage.js';

/* REQ-3721-003: No omitted-field combination may claim known usage. */
test('requires every counter for every field-presence combination', () => {
  for (let mask = 0; mask < 8; mask += 1) {
    const wire = Object.freeze({
      ...(mask & 1 ? { prompt_tokens: 7 } : {}),
      ...(mask & 2 ? { completion_tokens: 3 } : {}),
      ...(mask & 4 ? { total_tokens: 10 } : {}),
    });
    assert.deepEqual(
      decodeCompletionUsage(wire),
      mask === 7 ? { promptTokens: 7, completionTokens: 3, totalTokens: 10 } : null
    );
  }
});

/* REQ-3721-003: Every counter independently rejects untrusted numerical values. */
test('rejects invalid values in each counter', () => {
  for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    for (const value of [
      undefined,
      null,
      true,
      '0',
      {},
      [],
      NaN,
      Infinity,
      -Infinity,
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      assert.equal(
        decodeCompletionUsage({
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          [field]: value,
        }),
        null
      );
    }
  }
});

/* REQ-3721-003: Token totals cannot overflow or fabricate missing spend. */
test('accepts exact safe totals and preserves additional provider token categories', () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(
    decodeCompletionUsage({
      prompt_tokens: maximum - 1,
      completion_tokens: 1,
      total_tokens: maximum,
    }),
    { promptTokens: maximum - 1, completionTokens: 1, totalTokens: maximum }
  );
  assert.deepEqual(
    decodeCompletionUsage({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 20 }),
    { promptTokens: 10, completionTokens: 4, totalTokens: 20 }
  );
  assert.equal(
    decodeCompletionUsage({
      prompt_tokens: maximum,
      completion_tokens: 1,
      total_tokens: maximum + 1,
    }),
    null
  );
});

/* REQ-3721-003: Explicit zero usage remains valid and input objects are never mutated. */
test('preserves known zero usage and leaves the wire object unchanged', () => {
  const wire = Object.freeze({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  assert.deepEqual(decodeCompletionUsage(wire), {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });
  assert.deepEqual(wire, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  assert.equal(decodeCompletionUsage([]), null);
  assert.equal(decodeCompletionUsage(0), null);
});
