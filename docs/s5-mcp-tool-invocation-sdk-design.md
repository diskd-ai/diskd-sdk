S5: MCP Tool Invocation SDK Client -- Design Doc
=================================================

Status: **IMPLEMENTED** (2026-03-16)

Architecture decision: ADR-003 (`docs/adr/ADR-003-mcp-tools-separate-client.md`)

Context and motivation
----------------------

The `diskd.os.mcp()` SDK client provides registry management (install, configure, toggle tools) and catalog browsing, but has no way to invoke MCP tools directly. Tool execution requires going through Agent Hub's `McpHubGatewayClient`, which is an internal agent-hub component -- not accessible to SDK consumers.

External consumers (SDK scripts, routine templates, pipeline orchestrators, debugging/testing tools) need to list available tools and call them programmatically without spinning up an agent session. This is gap **S5** from `docs/acceptance/email-to-project-pipeline-gaps-v4.md`.

The MCP Hub already exposes a fully functional upstream JSON-RPC gateway at `POST /v1/mcp` supporting `initialize`, `tools/list`, and `tools/call`. Through APIS, the SDK defaults to the versioned public route `POST /v1/os/mcp`. No new MCP Hub routes are needed -- S5 is a pure SDK-layer addition.

Goals:
- Provide a dedicated `McpToolsClient` at `diskd.os.mcpTools({ auth })` for tool invocation
- Transparent JSON-RPC protocol handling (consumers work with typed params/results, not raw JSON-RPC)
- Automatic MCP session lifecycle (initialize on first use, reuse session ID across calls)
- Client-side tool filtering via regex (`find()`)
- Namespaced tool name construction helper (`mcpToolName`)
- Consistent with existing SDK patterns (same auth model, readonly types)

Non-goals for v1:
- Streaming tool responses (the MCP Gateway returns complete results; streaming can be added later)
- Tool discovery metadata enrichment beyond what `tools/list` returns (G13 is a separate gap)
- MCP resource access (resources/read, resources/list -- separate MCP protocol methods)
- MCP prompt access (prompts/get, prompts/list)
- Reconnect/retry on session expiry (sessions auto-create; callers handle retries)
- ProfileId management API (profiles are implicit -- derived from auth context or passed as param)


Design decision: Separate client (Option C)
---------------------------------------------

The original design proposed extending `McpHubClient` with a nested `tools` sub-namespace. This was rejected in favor of a **separate `McpToolsClient`** for the following reasons:

1. **Protocol separation**: `McpHubClient` uses REST; tool invocation uses JSON-RPC. Mixing two protocols in one client complicates transport and URL derivation.
2. **Client size**: `McpHubClient` already has 38 types and 22 methods across 3 namespaces. Adding session-stateful JSON-RPC increases complexity further.
3. **Separation of concerns**: Management (install/configure servers) is fundamentally different from execution (call tools). Consumers who only need tool execution should not carry the registry API surface.
4. **Session state**: Tool invocation requires MCP protocol session management (initialize handshake, `mcp-session-id` header). This does not apply to any existing `McpHubClient` method.

See ADR-003 for the full decision record.


SDK usage
---------

```ts
import { diskd, mcpToolName } from '@diskd/sdk';

const auth = diskd.auth.apiKey({ workspaceId });
const tools = diskd.os.mcpTools({ auth });

// List all available tools across installed MCP servers
const all = await tools.list();
// => readonly McpGatewayTool[]

// Find tools matching a regex pattern (client-side filter on name + description)
const found = await tools.find('github');
// => readonly McpGatewayTool[]

// Call a tool by its fully-qualified name
const result = await tools.call('github__list_repos', { username: 'octocat' });
// => McpToolCallResult { content, isError? }

// Construct namespaced name from parts
const result2 = await tools.call(
  mcpToolName('web-search', 'google'),
  { query: 'TypeScript ADT patterns' }
);

// With explicit profileId (for multi-profile workspaces)
const profileTools = diskd.os.mcpTools({ auth, profileId: 'agent-1' });
const tools2 = await profileTools.list();
```


Types
-----

```ts
// src/mcpTools/mcpToolsTypes.ts

type McpGatewayToolInputSchema = {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly [key: string]: unknown;
};

type McpGatewayTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: McpGatewayToolInputSchema;
};

type McpToolCallContentItem =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string }
  | { readonly type: 'resource'; readonly resource: { readonly uri: string; readonly text?: string; readonly blob?: string } };

type McpToolCallResult = {
  readonly content: readonly McpToolCallContentItem[];
  readonly isError?: boolean;
};

type McpToolsClient = {
  readonly list: () => Promise<readonly McpGatewayTool[]>;
  readonly find: (pattern: string) => Promise<readonly McpGatewayTool[]>;
  readonly call: (name: string, args?: Readonly<Record<string, unknown>>) => Promise<McpToolCallResult>;
};
```


Session lifecycle
-----------------

The MCP protocol requires an `initialize` handshake before calling methods. The SDK handles this transparently:

1. **Lazy initialization**: No network call on client creation. The first `list()`, `find()`, or `call()` triggers initialization.
2. **Initialize request**: default APIS route `POST /v1/os/mcp`; direct host override `POST /v1/mcp`, with `{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities, clientInfo } }`.
3. **Session capture**: The response includes an `mcp-session-id` header. Stored in the client closure.
4. **Session reuse**: All subsequent requests include `mcp-session-id: {storedId}` header.
5. **No explicit disconnect**: Sessions have a server-side TTL (30 minutes). The SDK does not send explicit disconnect requests.


Error handling
--------------

| Source | Condition | SDK behavior |
|--------|-----------|-------------|
| JSON-RPC error | `{ error: { code, message } }` | Throw `Error('MCP Tools JSON-RPC error ({code}): {message}')` |
| HTTP non-200 | Gateway returns HTTP 401, 500, etc. | Throw `Error('MCP Tools request failed ({status}): {message}')` |
| Network error | Connection refused, timeout | Throw native `fetch` error (no wrapping) |

JSON-RPC error code semantics (from MCP Hub gateway):

| Code | Meaning | Typical cause |
|------|---------|---------------|
| -32600 | Invalid request | Malformed JSON-RPC body |
| -32601 | Method not found | Unsupported JSON-RPC method |
| -32602 | Invalid params | Missing or invalid tool name/arguments |
| -32000 | Unauthorized | Auth failure |
| -32001 | Conflict | Server disabled, runtime not running |
| -32003 | Network error | Remote MCP server unreachable |
| -32004 | Server error | Internal execution failure |

The SDK does not retry -- callers handle retries at higher layers (consistent with all other SDK clients).


Implementation
--------------

| File | Change |
|------|--------|
| `src/mcpTools/mcpToolsTypes.ts` | **NEW** -- `McpGatewayTool`, `McpToolCallResult`, `McpToolsClient` types |
| `src/mcpTools/mcpTools.ts` | **NEW** -- `createMcpToolsClient` factory + `mcpToolName` helper |
| `src/__tests__/mcpToolsClient.test.ts` | **NEW** -- 11 unit tests (session lifecycle, JSON-RPC, errors, URL derivation) |
| `src/sdk/types.ts` | Added `mcpTools` to `diskd.os` namespace |
| `src/sdk/diskd.ts` | Wired `createMcpToolsClient` factory |
| `src/index.ts` | Exported new types, factory, and `mcpToolName` helper |


Cross-boundary dependencies
-----------------------------

```
platform-api SDK                        MCP Hub (no changes)
  mcpToolsTypes.ts                        mcp-gateway.controller.ts
    McpGatewayTool   <---matches-->         tools/list response shape
    McpToolCallResult <---matches-->        tools/call response shape
  mcpTools.ts        ----JSON-RPC-->      POST /v1/os/mcp (default)
                           or            POST /v1/mcp (direct override)
    initialize       ------>                handleRpc (initialize)
    tools/list       ------>                handleRpc (tools/list)
    tools/call       ------>                handleRpc (tools/call)
                                              |
                                              v
                                            McpRouter.resolveTarget()
                                            McpExecutor.execute*()
                                              |
                                              v
                                            MCP server pods (stdio/http/remote)
```


Future-proofing
---------------

- **Streaming tool calls**: `call()` return type can be widened to support an async iterable variant (`callStream()`) when the gateway adds SSE.
- **Resources and prompts**: Additional MCP protocol methods can be added as new methods on `McpToolsClient` or as a separate client.
- **Tool discovery enrichment (G13)**: When the gateway returns additional metadata, `McpGatewayTool` type can be extended without breaking callers.
- **Session persistence**: Session ID can be extracted from the client closure for external storage if long-lived sessions become important.


Acceptance criteria
-------------------

All criteria verified via unit tests (`src/__tests__/mcpToolsClient.test.ts`, 11/11 passing):

- `list()` sends `initialize` + `tools/list` JSON-RPC, captures `mcp-session-id`, returns `McpGatewayTool[]`
- Second `list()` reuses session (no re-initialize)
- `find('github')` filters by regex on name + description
- `call(name, args)` sends `tools/call` with correct params, returns `McpToolCallResult`
- `call(name)` without args sends empty arguments object
- JSON-RPC error throws with code + message
- HTTP error throws with status
- `profileId` included in gateway URL when provided
- Gateway URL derived from env var when no url override
- `mcpToolName('ns', 'tool')` returns `'ns__tool'`
- `diskd.os.mcpTools({ auth })` factory returns client with `list`, `find`, `call`
