# Structured router errors

REQ-3642-075. Boundary: enabling:runtime/llm-router -> enabling:dev/platform-api
-> end:ai/pi-agent-service/runtime.

Router failures now carry machine facts through the SDK on JSON-RPC invoke,
HTTP stream startup, and NDJSON error frames. Callers use the exported
`LlmRouterError` class and its fields to decide recovery. Its `message` and
`data.message` are for display, never error classification.

```ts
import { LlmRouterError } from '@diskd-ai/sdk';

try {
  await llm.completions.create(request);
} catch (error) {
  if (error instanceof LlmRouterError) {
    // Transport HTTP status, outer numeric JSON-RPC code, provider data are distinct.
    report(error.httpStatus, error.rpcCode, error.data);
  }
  throw error;
}
```

`LlmRouterErrorData` contains only the validated optional fields `reason`,
`status` (provider HTTP status), `type`, `code` (provider string or number),
`param`, and display-only `message`. Unknown fields, arrays, malformed values,
and inherited properties are discarded. Identifier strings are 1..128 ASCII
letters, digits, underscore, dot, colon, brackets or hyphen. The display-only
DTO message is at most 1000 characters; invalid values are omitted. Invalid fields never acquire meaning
from message text. No provider response body or failed generation is added to
this DTO; existing human-readable error messages are not a redaction boundary.

The generic JSON-RPC client exports `JsonRpcError(message, { code?, httpStatus,
data? })`. It preserves the outer numeric RPC code and raw error data; the LLM
client projects that data into its safe DTO. Non-router clients keep their
existing display messages and gain these transport facts.

`LlmRouterError(message, { rpcCode?, httpStatus?, data })` is available from the
Node and browser entrypoints. `ContextTooLargeError` extends it and retains its
one-message constructor, `reason: 'context_too_large'`, name and `instanceof`
behavior. The old stream-start `code: 'context_too_large'` remains an explicit
supported wire signal. Network and cancellation errors propagate unchanged.

Rollout order: deploy router structured fields, publish the SDK minor release,
verify the exact version on npmjs, then adopt that exact version in Pi. Older
router responses with no structured data produce an empty DTO; consumers must
not infer classification from their text. No routine data or saved program
migration is required.
