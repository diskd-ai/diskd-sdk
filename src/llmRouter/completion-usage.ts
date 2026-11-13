import type { CompletionUsage } from './llmRouterTypes.js';

/** Missing or malformed accounting stays unknown under the existing nullable contract. */
export function decodeCompletionUsage(raw: unknown): CompletionUsage | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  if (!('prompt_tokens' in raw) || !('completion_tokens' in raw) || !('total_tokens' in raw))
    return null;
  const promptTokens = raw.prompt_tokens;
  const completionTokens = raw.completion_tokens;
  const totalTokens = raw.total_tokens;
  if (!isTokenCount(promptTokens) || !isTokenCount(completionTokens) || !isTokenCount(totalTokens))
    return null;
  // Provider totals can include thought/tool tokens beyond prompt and completion.
  return { promptTokens, completionTokens, totalTokens };
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
