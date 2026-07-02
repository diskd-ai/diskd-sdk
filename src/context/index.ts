// ---------------------------------------------------------------------------
// @diskd-ai/sdk/context -- Node-only token counting for LLM Router context
// budgets. The single shared source of truth for how many o200k tokens a
// string occupies, so every service (llm-router preflight, pi-agent history
// trimming) counts identically. tiktoken is an optional dependency; when it is
// not installed we fall back to a coarse character estimate rather than throw,
// preserving availability at the cost of accuracy.
// ---------------------------------------------------------------------------

import { createRequire } from 'node:module';

/** The slice of the tiktoken encoder API this module depends on. */
interface Encoding {
  encode(text: string): ArrayLike<number>;
}

/** The slice of the tiktoken module this module depends on. */
interface TiktokenModule {
  get_encoding(name: 'o200k_base'): Encoding;
}

const require = createRequire(import.meta.url);

/** Rough characters-per-token used only when tiktoken is unavailable. */
const CHARS_PER_TOKEN = 4;

let encoding: Encoding | null = null;
let encodingResolved = false;

/**
 * Lazily load and memoize the o200k_base encoder. Loading the encoder (WASM +
 * BPE ranks) is expensive, so it is attempted once and the result reused.
 * Returns null when tiktoken (an optional dependency) is not installed or fails
 * to initialize, so callers silently degrade to a character-based estimate.
 * This is a deterministic, memoized Node adapter (it loads and caches the
 * encoder), not a pure function. The silent, unlogged degrade is deliberate:
 * availability over accuracy, since the optional dependency is normally present
 * in the services that use this subpath -- observing its absence (and any
 * fail-fast policy) is the consumer's concern.
 */
function getEncoding(): Encoding | null {
  if (encodingResolved) return encoding;
  encodingResolved = true;
  try {
    const tiktoken = require('tiktoken') as TiktokenModule;
    encoding = tiktoken.get_encoding('o200k_base');
  } catch {
    encoding = null;
  }
  return encoding;
}

/**
 * Count the number of tokens `text` occupies under the OpenAI o200k_base
 * tokenizer (the tokenizer used by GLM / Together / groq / OpenAI-family
 * models). Falls back to ceil(length / 4) when tiktoken is not installed.
 *
 * This is the single shared token-counting primitive: llm-router builds its
 * request preflight on it and pi-agent builds its history trimmer on it, so
 * both agree on the string-level token count.
 */
export function countTokensForString(text: string): number {
  if (!text) return 0;
  const enc = getEncoding();
  if (!enc) return Math.ceil(text.length / CHARS_PER_TOKEN);
  return enc.encode(text).length;
}
