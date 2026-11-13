/** REQ-3721-003: Decode only approved error receipt fields; malformed receipts remain incomplete. */
import { decodeCompletionUsage } from './completion-usage.js';
import type { CompletionUsage } from './llmRouterTypes.js';
export type CompletionErrorUsage = {
  readonly usage?: CompletionUsage;
  readonly usageComplete?: boolean;
};
export function decodeCompletionErrorUsage(raw: unknown): CompletionErrorUsage {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  if (!Object.hasOwn(raw, 'usage') && !Object.hasOwn(raw, 'usage_complete')) return {};
  const source = Object.hasOwn(raw, 'usage') && 'usage' in raw ? raw.usage : undefined;
  const hasFields =
    typeof source === 'object' &&
    source !== null &&
    ['prompt_tokens', 'completion_tokens', 'total_tokens'].every((key) =>
      Object.hasOwn(source, key)
    );
  const usage = hasFields ? decodeCompletionUsage(source) : null;
  const complete =
    Object.hasOwn(raw, 'usage_complete') && 'usage_complete' in raw && raw.usage_complete === true;
  return usage === null ? { usageComplete: false } : { usage, usageComplete: complete };
}
