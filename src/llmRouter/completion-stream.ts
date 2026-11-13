/* REQ-3721-001/004: Own the completion HTTP lifetime and surface every malformed frame. */
import { makeLlmRouterError } from './llmRouterErrors.js';

type CompletionStreamInput = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal;
};

/** Decode at the transport edge; invalid JSON must never silently remove a tool delta. */
function decodeFrame(line: string, status: number): unknown {
  const parsed: unknown = JSON.parse(line);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'type' in parsed &&
    parsed.type === 'error'
  ) {
    const message =
      'message' in parsed && typeof parsed.message === 'string'
        ? parsed.message
        : JSON.stringify(parsed);
    throw makeLlmRouterError(
      `LLM Router stream error: ${message}`,
      status,
      'code' in parsed ? parsed.code : undefined,
      'data' in parsed ? parsed.data : undefined
    );
  }
  return parsed;
}

/** Preserve the existing HTTP error DTO and display message, including non-JSON failures. */
function decodeHttpFailure(text: string, status: number): Error {
  const fallback = `LLM Router stream failed (HTTP ${status}): ${text.slice(0, 200)}`;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return makeLlmRouterError(fallback, status, undefined, undefined);
    const code = 'code' in value ? value.code : undefined;
    return makeLlmRouterError(
      'error' in value && typeof value.error === 'string' ? value.error : fallback,
      status,
      code,
      'data' in value ? value.data : undefined,
      code
    );
  } catch {
    // Non-JSON HTTP failures retain the owner-typed status and bounded response text.
    return makeLlmRouterError(fallback, status, undefined, undefined);
  }
}

/** Replacement for the legacy inline reader; closing iteration closes its unread HTTP body. */
export async function* streamCompletionFrames(
  input: CompletionStreamInput
): AsyncGenerator<unknown> {
  input.signal?.throwIfAborted();
  const response = await fetch(input.url, {
    method: 'POST',
    headers: {
      ...input.headers,
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    },
    body: input.body,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) throw decodeHttpFailure(await response.text(), response.status);
  if (!response.body) throw new Error('LLM Router stream: response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // Exception: these are per-connection IO framing state, never shared domain state.
  let buffer = '';
  let complete = false;
  try {
    for (;;) {
      input.signal?.throwIfAborted();
      const next = await reader.read();
      if (next.done) {
        complete = true;
        buffer += decoder.decode();
        break;
      }
      const lines = (buffer + decoder.decode(next.value, { stream: true })).split('\n');
      buffer = lines.at(-1) ?? '';
      for (const line of lines.slice(0, -1)) {
        if (line.trim()) {
          input.signal?.throwIfAborted();
          yield decodeFrame(line, response.status);
        }
      }
    }
    if (buffer.trim()) {
      input.signal?.throwIfAborted();
      yield decodeFrame(buffer, response.status);
    }
  } finally {
    try {
      if (!complete) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
