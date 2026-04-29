Diskd Platform SDK (Preliminary) Design Doc
============================================

Status: preliminary (v0)
Last updated: 2026-02-07

Context and motivation
----------------------

The monorepo currently contains multiple service-specific clients and SDK-like facades (Drive clients, LLM Router clients, MCP Hub client) with inconsistent:

- Base URLs (service-by-service; sometimes direct pod/service URLs, sometimes Caddy hostnames)
- Authentication (API keys + custom headers; workspace headers; cookie sessions; Bearer API keys)
- Error handling (throws vs typed errors; inconsistent status mapping)
- Cross-service composition (ad-hoc “SDK” facades exist but are not a platform-wide, stable developer surface)

We want a single “Google-style” Platform SDK that:

- Exposes a consistent developer experience across services
- Uses OAuth2/OIDC as the platform auth mechanism for all service APIs
- Targets a single public API entrypoint `apis.upgraide.dev` (via Caddy routing)
- Remains strongly typed and follows functional-architecture constraints (errors as values, no hidden global state)

Goals
-----

- Provide a TypeScript SDK with modules:
  - `auth`: OAuth2/OIDC token acquisition and refreshing for other modules
  - `drive`: Drive API (files, upload/download, indexing, Drive DB, Drive Tools where applicable)
  - `llm`: LLM Router API (completions, streaming, embeddings, models, OCR/images/audio where applicable)
  - `mcpHub`: MCP Hub API (catalog, registry, runtime env, logs, tool toggles)
- Standardize external access via **one** public API hostname: `https://apis.upgraide.dev` (local dev uses `:8080` via `common-caddy`).
- Standardize authorization via OAuth2/OIDC (Ory Hydra) access tokens:
  - Authorization Code + PKCE (interactive apps)
  - Client Credentials (service-to-service / CLIs with secrets)
- Make SDK error handling explicit and typed (no “surprise throws” for expected failures):
  - SDK public methods return `Promise<Result<..., ...>>` (and streaming methods return async generators that yield typed events and can end with typed errors).
- Keep the SDK additive and modular (modules are independently usable; shared transport/auth is injected).

Non-goals for first implementation (v1)
---------------------------------------

- Migrating every internal service immediately away from API-key/custom-header auth (SDK may need a compatibility mode while services migrate).
- Providing full multi-language parity (Python/Rust/Go) in v1; TypeScript is the v1 target.
- Building a developer portal / dynamic OAuth2 client registration UI.
- Implementing a full gateway enforcement layer (e.g., Oathkeeper) in front of all services (documented as a future hardening step).

Implementation considerations
-----------------------------

- **Ingress reality today**: local ingress is already Caddy-based with host routing under `*.upgraide.dev:8080` (see `platform-infra/.k8s/base/common/caddy.yaml`). The new `apis.upgraide.dev` entrypoint should be implemented as an additional Caddy site block that routes by path prefix.
- **OAuth2 reality today**: OAuth2/OIDC via Ory Hydra exists (or is planned) with issuer at `https://oauth2.upgraide.dev:8080` (see `iam-service/docs/oauth2-hydra.md`). That doc explicitly recommends a dedicated hostname for Hydra to avoid sub-path complications.
- **Therefore** (assumption for v1):
  - Resource APIs are exposed at `apis.upgraide.dev`.
  - OAuth2 issuer remains `oauth2.upgraide.dev` (SDK uses this for discovery/JWKS/token exchange).
  - If “everything including OAuth2” must be reachable at `apis.upgraide.dev`, we treat that as a future milestone after validating Hydra sub-path support and discovery URL correctness.
- **Functional-architecture constraints** (SDK-side):
  - Do not use `any` as an escape hatch in SDK code.
  - Model errors as ADTs (`Result`), avoid throwing across module boundaries as normal control flow.
  - Keep side effects (network I/O) isolated behind a small transport abstraction.

High-level behavior
-------------------

1. Developer constructs the SDK with:
   - `apiBaseUrl` (defaults to `https://apis.upgraide.dev`)
   - `auth` configuration (issuer, client id, redirect uri, etc.) or a custom token provider.
2. Developer obtains an access token through `sdk.auth` (interactive PKCE or client credentials).
3. Service modules (`drive`, `llm`, `mcpHub`) call their endpoints through a shared HTTP transport that automatically attaches:
   - `Authorization: Bearer <access_token>`
   - A stable request id header (for correlation)
   - Optional workspace context (preferably derived from token claims; see “Workspace context”)
4. Methods return typed `Result`s. Errors are mapped consistently across modules.

SDK architecture (TypeScript)
-----------------------------

### Package shape

- Single package: `@diskd-ai/sdk` (name placeholder; align with publishing conventions)
- Internal module layout:
  - `src/common/` (Result, error ADTs, transport interfaces, retry/backoff helpers)
  - `src/auth/` (OAuth2/OIDC)
  - `src/drive/` (Drive client)
  - `src/llm/` (LLM Router client)
  - `src/mcp-hub/` (MCP Hub client)
  - `src/index.ts` exports a top-level facade

### Top-level facade

The “Google-style” entrypoint is a small orchestrator that wires shared dependencies and exposes modules:

```ts
export type DiskdSdk = {
  readonly auth: AuthModule;
  readonly drive: DriveModule;
  readonly llm: LlmModule;
  readonly mcpHub: McpHubModule;
};
```

Transport and error model
-------------------------

### Result ADT (SDK-wide)

All SDK methods (except pure helpers) return a `Result`:

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

### SDK error taxonomy

Define a shared `SdkError` ADT and allow module-specific error payloads to embed into it:

- `NetworkError` (DNS, connect, TLS, timeouts)
- `HttpError` (non-2xx; includes status, endpoint, optional response body parsed into a safe shape)
- `AuthError` (token expired/invalid, missing scopes, discovery/JWKS failures)
- `DecodeError` (invalid JSON / schema mismatch)
- `ValidationError` (client-side input validation failed)

Rationale: Consumers can switch on `kind` to implement retry vs user feedback deterministically.

OAuth2/OIDC (auth module)
-------------------------

### Supported flows (v1)

- Authorization Code + PKCE (interactive; no client secret required)
- Client Credentials (confidential clients; requires secret)
- Refresh token usage (only when `offline_access` is granted and client is allowed)

### Discovery and endpoints

SDK uses OIDC discovery from:

- Issuer: `https://oauth2.upgraide.dev:8080` (local dev default)
- Discovery: `/.well-known/openid-configuration`
- JWKS: from discovery (`jwks_uri`)

### Scopes and audience

Use `audience=diskd-api` (already used in the OAuth2 examples) to ensure tokens are valid for calling resource APIs.

Proposed v1 scopes (names can be finalized later; keep stable once released):

- `upgraide:drive:read`, `upgraide:drive:write`
- `upgraide:llm:invoke`
- `upgraide:mcp-hub:read`, `upgraide:mcp-hub:write`

### Workspace context

Many services currently require `X-Workspace-Id` and/or `X-User-Id` headers. For OAuth2 unification:

- Add a stable claim in Hydra access tokens (via IAM consent handler):
  - `workspace_id` (string)
  - `org_id` (string, optional)
  - `role` (string, optional)
- SDK derives workspace context from token claims and attaches headers only if a target API still requires them during migration.

API host and routing (Caddy)
----------------------------

### Requirement

All resource APIs are reachable under one hostname:

- `https://apis.upgraide.dev:8080` (local dev)

### Proposed path routing

- `/drive/*` → Drive service (`drive-service:<8000>`)
- `/llm/*` → LLM Router (`llm-router:<3000>`)
- `/mcp-hub/*` → MCP Hub (`mcp-hub:<3000>`)

For each route, Caddy strips the prefix and reverse-proxies to the in-cluster service so that internal services keep their existing paths:

- External: `GET https://apis.upgraide.dev:8080/llm/api/v1/models`
- Internal forwarded: `GET http://llm-router.llm-router.svc.cluster.local:3000/api/v1/models`

Notes:

- Drive service currently exposes JSON-RPC at `/api/v1` and uploads at `/api/v1/drive/upload`.
- LLM Router exposes JSON-RPC at `/api/v1/invoke` and streaming at `/api/v1/stream`.
- MCP Hub exposes REST under `/api/*`.

### OAuth2 under `apis.upgraide.dev` (open question)

Hydra currently uses `oauth2.upgraide.dev` as issuer and is recommended to remain on a dedicated hostname for protocol correctness.

If strict single-host (`apis.upgraide.dev`) is required for OAuth2 endpoints too, we must validate:

- Hydra public base URL support for a sub-path issuer (for discovery URL correctness)
- Redirect URI and issuer consistency for all clients

Until that is validated, v1 SDK uses `oauth2.upgraide.dev` for auth and `apis.upgraide.dev` for resource APIs.

Drive module (drive)
--------------------

### Target base path

- External base path: `/drive`
- Drive internal API remains unchanged (SDK calls `/api/v1/...` under that prefix).

### Capability surface (v1)

Minimum set aligned with existing Drive clients:

- Paths
  - list directory
  - create directory
  - delete (recursive option)
- Upload/download
  - upload file
  - download file
- Indexing
  - start indexer job
  - stop job
  - job status and batch status
- Drive DB (if exposed through Drive service)
  - create db source
  - insert rows
  - query
  - commit
  - typeorm protocol adapter
- Drive Tools (optional in v1 if already stable)
  - ls/glob/grep/read/vsearch/biquery/iquery

### Auth migration

Existing clients use `X-Api-Key` + `X-Workspace-Id` headers. The SDK should:

- Prefer OAuth2 access token (`Authorization: Bearer ...`) when Drive service supports it.
- Provide a temporary compatibility auth provider that can attach legacy headers when configured.

LLM module (llm)
----------------

### Target base path

- External base path: `/llm`

### Capability surface (v1)

- Models: list models
- Completions: create completion (JSON-RPC)
- Streaming completions: JSONL stream
- Embeddings: create embedding (JSON-RPC)

### Auth migration

Existing clients use `Authorization: Bearer <routerApiKey>` (API key). The SDK should:

- Prefer OAuth2 access tokens once LLM Router validates Hydra JWTs.
- Optionally support API-key bearer tokens during transition.

MCP Hub module (mcp-hub)
------------------------

### Target base path

- External base path: `/mcp-hub`

### Capability surface (v1)

Based on existing MCP Hub routes:

- Registry (workspace-installed servers)
  - list registry servers
  - toggle tool
  - toggle server  
  - registry tools list
  - call tool
  - server tools list
- Catalog (public)
  - list catalog
  - server details

### Auth migration

Current MCP Hub implementation requires `X-Workspace-Id` header and does not enforce bearer auth.

To meet the platform requirement (“OAuth2 authorizes all APIs”):

- Add OAuth2 JWT validation in MCP Hub (resource-server middleware).
- Derive `workspaceId` from token claims; accept explicit header only as a transitional fallback (or disallow entirely once migrated).

Existing reusable clients (codebase scan)
-----------------------------------------

The following code can be reused or used as reference when implementing the Platform SDK:

Drive
~~~~~

- Drive Node SDK facade (shared Axios stack, Drive/DB/Tools):
  - `drive/clients/nodejs-sdk/src/driveSdk.ts`
  - `drive/clients/nodejs-sdk/src/driveClient.ts`
  - `drive/clients/nodejs-sdk/src/driveDbClient.ts`
  - `drive/clients/nodejs-sdk/src/driveToolsClient.ts`
- Drive Python SDK facade (Drive/DB/Tools):
  - `drive/clients/python/sdk/drive_sdk.py`
  - `drive/clients/python/sdk/drive_client.py`
  - `drive/clients/python/sdk/drive_db_client.py`
  - `drive/clients/python/sdk/drive_tools_client.py`
- App-service Drive client (backend) with JSON-RPC helpers and upload flows:
  - `app-service/app-service/src/externalApi/driveClientApi.ts`
- App-service web Drive client (UI; calls app-service `/drive/*` endpoints, not Drive service directly):
  - `app-service/web/src/drive-module/api/drive.client.ts`
- Web-navigator Drive DB usage (consumes `drive-sdk` package):
  - `web-navigator/packages/worker/src/infrastructure/drive-db/client.ts`

LLM Router
~~~~~~~~~~

- LLM Router remote client (JSON-RPC + streaming):
  - `llm-router/src/client/llmClientRemote.ts`
- App-service LLM client wrapper:
  - `app-service/app-service/src/sdk/llm/llmClientApi.ts`
- Agent-hub SDK wrapper used by multiple agents:
  - `agent-hub/packages/sdk/src/llm/llmClientApi.ts`
  - `agent-hub/packages/sdk/src/gradientSdk.ts` (already a “Google-style” facade for drive+llm)

MCP Hub
~~~~~~~

- App-service MCP Hub client (fetch + Result):
  - `app-service/app-service/src/mcp/infrastructure/mcpHubClient.ts`
- MCP Hub Node client reference/spec (types + Result helpers):
  - `mcp-hub/clients/nodejs/mcpHubClient.ts`
- MCP Hub actual API routes (for endpoint truth):
  - `mcp-hub/packages/hub/src/controllers/mcp-hub.controller.ts`

Auth / OAuth2
~~~~~~~~~~~~~

- OAuth2/OIDC design and issuer conventions:
  - `iam-service/docs/oauth2-hydra.md`
- OAuth2 client examples (PKCE + client credentials):
  - `iam-service/examples/oauth2-client-node/src/index.ts`
  - `iam-service/examples/oauth2-client-browser/app.js`

Error handling and UX
---------------------

- SDK returns typed errors that callers can map to UX:
  - `Unauthorized` / `AuthError`: prompt re-login
  - `Forbidden` / missing scope: show “insufficient permissions”
  - `ValidationError`: show actionable input error
  - `NetworkError`: retry/backoff suggestion and offline messaging
- SDK includes a stable request id (UUID) header per request and returns it in error payloads when available.

Future-proofing
---------------

- Add a shared OpenAPI/JSON schema source of truth per service and generate:
  - request/response types
  - client method stubs
  - stable error mappings
- Add optional gateway enforcement (Oathkeeper or similar) to centralize auth verification and rate limits.
- Add multi-language SDKs:
  - Python SDK using the same module boundaries and Result/ADT patterns
  - Rust SDK for internal services and CLIs

Implementation outline
----------------------

1. Define SDK package boundary and naming (`@diskd-ai/sdk`), and establish common types:
   - `Result`, `SdkError`, `HttpTransport`, `TokenProvider`
2. Implement `auth` module:
   - OIDC discovery cache
   - PKCE helpers
   - token exchange + refresh
   - token storage strategy per environment (Node vs browser)
3. Implement `drive` module:
   - start with a minimal subset (list/upload/download)
   - integrate Drive DB + Tools once stable
   - add legacy-header compatibility mode if needed
4. Implement `llm` module:
   - completions + embeddings + models
   - streaming via async generator (JSONL)
5. Implement `mcp-hub` module:
   - catalog + registry + runtime env
6. Add Caddy routing for `apis.upgraide.dev`:
   - path-prefix routing to Drive/LLM/MCP Hub services
   - document local hosts entry requirements
7. Add tests:
   - unit tests for pure helpers (PKCE, URL building, error mapping)
   - integration tests against local test HTTP servers for each module

Testing approach
----------------

- Unit tests (pure):
  - PKCE verifier/challenge generation
  - URL/path construction with prefix stripping
  - error mapping (status → error kind)
- Integration tests:
  - run against local test servers for Drive/LLM/MCP Hub
  - verify headers attached and payload parsing
- End-to-end (environment):
  - run through Tilt with `common-caddy`:
    - obtain token from Hydra issuer
    - call at least one endpoint from each module via `apis.upgraide.dev`

Acceptance criteria
-------------------

- A single SDK entrypoint exposes `auth`, `drive`, `llm`, `mcpHub` modules with stable, typed APIs.
- All non-happy-path outcomes are surfaced as typed `Result` errors (no uncaught exceptions for expected failures).
- SDK is configurable for local dev:
  - `apiBaseUrl=https://apis.upgraide.dev:8080`
  - `issuer=https://oauth2.upgraide.dev:8080`
- A Caddy route exists (or is specified) so `apis.upgraide.dev` can reach Drive/LLM/MCP Hub services via path prefixes.
- At least one integration test demonstrates:
  - token acquisition (PKCE or client credentials)
  - a successful call to each module through `apis.upgraide.dev`
  - a deterministic 401/403 behavior when token is missing or scope is absent
