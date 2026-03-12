# @diskd/sdk -- Agent Instructions

## Overview

This is `@diskd/sdk`, the unified TypeScript SDK for the Upgraide platform.
It provides typed clients for all platform services via a single `diskd` factory.

## Project structure

```
src/
  auth/           -- AuthModule (OAuth2 + API key)
  sdk/            -- diskd factory (types.ts + diskd.ts)
  drive/          -- Drive API client (JSON-RPC 2.0, upload/download, sessions)
  llmRouter/      -- LLM Router client (JSON-RPC 2.0 + NDJSON streaming)
  agentHub/       -- Agent Hub client (REST + SSE streaming via StreamProtocol)
  mcpHub/         -- MCP Hub client (REST)
  tgUserbot/      -- Telegram Userbot client (REST, snake_case wire format)
  webNavigator/   -- Web Navigator client (REST)
  node/           -- Node.js-specific entrypoints (fast DNS)
  browser/        -- Browser-specific entrypoints
  env/            -- Environment resolution helpers
examples/
  node/           -- Example scripts for each module
  web/            -- Browser PKCE example
docs/             -- Design docs and quickstart guides
```

## Module conventions

Each service module follows the same pattern:

1. `<module>Types.ts` -- pure data types only (no classes, no I/O)
2. `<module>.ts` -- `create<Module>Client` factory (HTTP transport, encode/decode)
3. Wired into `sdk/diskd.ts` via `diskd.<module>()`
4. Exported from `src/index.ts`

### Type conventions

- All type fields are `readonly`
- No `any` type anywhere
- Discriminated unions for sum types
- `Result`/`Option` patterns where appropriate
- Wire format decoding is explicit per-field (no generic converters)

### Wire format

| Module       | Protocol      | Wire case   |
|-------------|---------------|-------------|
| Drive        | JSON-RPC 2.0  | snake_case  |
| LLM Router   | JSON-RPC 2.0 + NDJSON | snake_case |
| Agent Hub    | REST + SSE    | camelCase (mostly) |
| MCP Hub      | REST          | camelCase   |
| TG Userbot   | REST          | snake_case  |
| Web Navigator | REST         | camelCase   |

### Auth pattern

All clients accept an `AuthModule` with either:
- `getRequestHeaders()` (API key mode -- returns X-Api-Key + X-User-Id headers)
- `getAccessToken()` (OAuth2 mode -- returns Bearer token)

Workspace-scoped services also take `workspaceId` which is sent as `X-Workspace-Id`.

## Agent Hub streaming

The Agent Hub uses the StreamProtocol pattern from `@agent-hub/sdk`:

- `StreamProtocolMap` -- typed event map (30+ event types)
- `StreamProtocolHandler` -- fluent `.on(type, handler)` for routing events
- `StreamProtocolFetcher` -- SSE stream consumer returning `StreamProtocolStream`
- `StreamProtocolStream` -- fluent `.map()/.stop()/.catch()/.success()/.close()`

## Commands

```bash
npm run build           # compile TypeScript
npm run typecheck       # type-check only (no emit)
npm test                # build + run unit tests
npm run examples:build  # build examples
```

## Testing

- Unit tests: `src/__tests__/*.test.ts` (run with `node --test`)
- Integration tests: `src/__integration_tests__/*.test.ts`
- Only run unit tests affected by changes (never run all tests by default)

## Publishing

Version bumps and tag pushes trigger GitLab CI which builds, tests, and publishes
to the GitLab Package Registry. See README.md for details.
