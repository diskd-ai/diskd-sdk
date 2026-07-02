/* REQUIREMENT llm-router-glm-context-overflow Phase C1: @diskd-ai/sdk/context
   exposes a single o200k token counter (countTokensForString) so llm-router and
   pi-agent count string tokens identically. The counts must be the real tiktoken
   o200k_base values (not the chars/4 fallback), and an empty string must be 0. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { countTokensForString } from '../context/index.js';

test('countTokensForString returns 0 for an empty string', () => {
  assert.equal(countTokensForString(''), 0);
});

test('countTokensForString returns exact o200k_base counts', () => {
  // Pinned ground-truth from tiktoken o200k_base. These anchor the counter to
  // the real tokenizer -- if it silently regressed to the chars/4 fallback the
  // values below would change (see the next test).
  assert.equal(countTokensForString('hello world'), 2);
  assert.equal(countTokensForString('The quick brown fox jumps over the lazy dog.'), 10);
});

test('countTokensForString uses the tokenizer, not the chars/4 estimate', () => {
  // ceil(11/4) = 3 and ceil(44/4) = 11 -- both differ from the real o200k counts
  // (2 and 10), proving tiktoken is in use rather than the character fallback.
  assert.notEqual(countTokensForString('hello world'), Math.ceil('hello world'.length / 4));
  const fox = 'The quick brown fox jumps over the lazy dog.';
  assert.notEqual(countTokensForString(fox), Math.ceil(fox.length / 4));
});

test('countTokensForString is deterministic across repeated calls', () => {
  const text = '{"role":"user","content":"count these JSON-heavy tokens please"}';
  assert.equal(countTokensForString(text), countTokensForString(text));
});

test('countTokensForString counts a superstring with at least as many tokens', () => {
  const base = 'context window enforcement';
  const longer = `${base} ${base} ${base}`;
  assert.ok(countTokensForString(longer) >= countTokensForString(base));
});
