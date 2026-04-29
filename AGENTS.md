# @diskd-ai/sdk -- Agent Instructions

## Overview

This is `@diskd-ai/sdk`, the unified TypeScript SDK for the Upgraide platform.
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

## diskd namespace convention

Everything is accessed via the `diskd` namespace. No standalone `createX` imports.

```ts
import { diskd } from '@diskd-ai/sdk';

// Auth
const auth = diskd.auth.apiKey({ workspaceId });
const auth = await diskd.auth.credentials({ scopes, keyfilePath });

// Services
const drive    = diskd.os.drive({ version: 'v1', auth });
const db       = diskd.os.database({ auth, dbName, schema });
const ds       = diskd.os.datasource({ auth, dbName, entities });  // requires typeorm peer
const llm      = diskd.os.llm({ auth });
const agents   = diskd.os.agents({ auth, workspaceId });
const mcp      = diskd.os.mcp({ auth, workspaceId });
const sessions = diskd.platform.sessions({ auth, scope: { scopeType: 'project', projectId } });
const crontab  = diskd.platform.crontab({ auth, scope: { scopeType: 'project', projectId } });
const tg       = diskd.utils.tgUserBot({ auth, workspaceId });
const webNav   = diskd.utils.webNavigator({ auth, workspaceId });
```

When adding new functionality to the SDK, always wire it through the canonical
`diskd` namespaces in `sdk/types.ts` + `sdk/diskd.ts`:

- `diskd.os.*` for infrastructure and storage/runtime services
- `diskd.platform.*` for platform domain entities such as sessions and crontab
- `diskd.utils.*` for utility clients such as TG Userbot and Web Navigator
- `diskd.auth.*` for auth creation

Do not expose standalone factory functions as the primary API -- `createX`
functions may still be exported from `src/index.ts` for backward compatibility,
but the `diskd.*` namespace is the canonical interface.

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

## Publishing / Releasing a New Version

Semver `v*.*.*` tags trigger `.github/workflows/release.yml` which builds,
typechecks, lints, tests, and publishes to npmjs.com under `@diskd-ai/sdk`
with provenance attestation.

### Release checklist

1. **Verify locally**: `npm run build && npm run typecheck && npm test`
2. **Bump version** in `package.json` (e.g. `5.0.4` -> `5.0.5`). Follow semver:
   - **patch** (5.0.x): backward-compatible bug fixes, new optional fields on existing types
   - **minor** (5.x.0): new modules, new client methods, new exports
   - **major** (x.0.0): breaking changes to existing types, removed exports, renamed fields
3. **Commit**: `git add package.json && git commit -m "release: bump version to X.Y.Z"`
4. **Push to main**: `git push github main`
5. **Tag and push**: `git tag vX.Y.Z && git push github vX.Y.Z`
6. **Wait for CI**: the `v*.*.*` tag triggers the *Release* workflow on GitHub
   Actions. Monitor at https://github.com/diskd-ai/diskd-sdk/actions or via
   `gh run list --workflow=release.yml --limit 3`.
7. **Verify published**: `npm view @diskd-ai/sdk version` should show the new version.
8. **Update consumers**: bump `@diskd-ai/sdk` in each consumer's `package.json` to the exact
   new version (no `^`/`~`), run `npm install`, and verify typecheck + tests pass.
   Common consumers: `pi-agent-service`, `email-client-mcp`, `app-service`, `agent-hub`.

Alternative: open the *Release* workflow in the Actions tab and click *Run
workflow* with `bump = patch | minor | major` -- the job bumps the version,
commits, tags, pushes, and publishes in one step.

### Required repo secrets

| Secret | Purpose |
| --- | --- |
| `NPM_TOKEN` | npmjs.com granular token, scope `@diskd-ai/*`, **Bypass 2FA** enabled. |

### Rules

- Do NOT update consumer repos until npmjs shows the exact version as published.
- Use exact versions in consumers (e.g. `"5.0.5"` not `"^5.0.5"`).
- One version bump per release commit. Do not combine version bumps with feature code.
- If CI publish fails, fix the issue, do NOT re-tag. Bump to the next patch and re-release.
