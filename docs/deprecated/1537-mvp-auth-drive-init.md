Platform SDK MVP Subtask: Google-style Auth + DriveClient.init
=============================================================

Status: ready for implementation (minimal v1)
Parent: Redmine #1537 (Preliminary SDK)
Last updated: 2026-02-07

Context and motivation
----------------------

Redmine #1537 defines the target “Platform SDK” shape (auth + service clients behind `apis.upgraide.dev`).

This subtask specifies the smallest MVP slice that proves (with a Google-style SDK surface):

- OAuth2/OIDC Authorization Code + PKCE can be executed by a consumer app.
- A Drive client can be initialized against the unified API entrypoint (Drive routed under `/drive`) by calling `drive/init`.
- A user can download `credentials.json` from the app UI and use it for non-interactive API authorization.

Goals
-----

- Provide an MVP TypeScript SDK surface with:
  - `createAuth(...)` that returns an `auth` client usable by service clients.
  - `diskd.drive({ version, auth })` that returns a Drive client with minimal methods:
    - `init()`
    - `list(...)`
- Keep implementation minimal (use built-in `fetch` + Web Crypto APIs; avoid extra dependencies).
- Keep auth state encapsulated by the returned `auth` instance (no module-level globals; browser uses `sessionStorage` only for redirect-bound PKCE state).

Non-goals for this MVP
----------------------

- No typed error model (`Result`, `SdkError`) and no explicit error handling/exception handling logic (no retries, no mapping, no recovery UX).
- No refresh token support and no token persistence helpers.
- No Drive API methods beyond `init` and `list`.
- No LLM Router or MCP Hub clients.
- No gateway/Caddy changes in this subtask (assumes `/drive/*` routing already exists or will be handled elsewhere).

Implementation considerations
-----------------------------

- Runtime targets: modern browsers and Node.js 24+ (global `fetch`, `TextEncoder`, `crypto.subtle`).
- Keep side effects contained to `init` and auth network calls; pure helpers remain pure (PKCE challenge, URL building).
- Avoid module-level singletons/global variables.
- Drive API base URL is resolved from `DISKD_BASE_URL` (default `https://apis.upgraide.dev:8080`):
  - Node: read from `process.env.DISKD_BASE_URL`
  - Browser: read from `globalThis.DISKD_BASE_URL` (injected by app/build)
- Browser PKCE must survive redirects:
  - `createAuth(...)` stores PKCE `verifier` + `state` in `sessionStorage` using a namespaced key.
  - `handleRedirectCallback()` reads and clears that state after exchanging the code.

High-level behavior
-------------------

1. Consumer creates an auth client:
   - `const auth = await createAuth({...})`
2. Consumer creates a Drive client:
   - `const drive = diskd.drive({ version: 'v1', auth })`
3. Consumer completes login (web PKCE redirect + callback handled by `auth`).
4. Consumer initializes Drive:
   - `await drive.init()` performs a single JSON-RPC request:
     - `POST {DISKD_BASE_URL}/drive/api/v1` with method `drive/init`
     - `Authorization: Bearer <accessToken>`
5. Consumer lists files:
   - `await drive.list({ path: '/' })` calls JSON-RPC `drive/paths/list` and returns entries.

API design (MVP)
----------------

### Google-style entrypoint

```ts
export type DiskD = {
  readonly drive: (params: { readonly version: 'v1'; readonly auth: AuthModule }) => DriveClient;
};

export const diskd: DiskD;
```

### Auth

```ts
export type SdkCreateParams =
  | {
      readonly issuer: string;
      readonly clientId: string;
      readonly redirectUri: string;
      readonly scopes: readonly string[];
      readonly audience: string;
    }
  | {
      readonly scopes: readonly string[];
      readonly keyfilePath: string;
    };

export type AuthModule = {
  readonly signIn: () => Promise<void>;
  readonly signOut: () => void;
  readonly handleRedirectCallback: () => Promise<void>;
  readonly getAccessToken: () => Promise<string>;
  readonly getToken: () => { readonly accessToken: string } | null;
};

export function createAuth(params: SdkCreateParams): Promise<AuthModule>;
```

Notes (MVP):

- `createAuth(...)` returns a small client (similar in spirit to Google’s `auth` objects).
- Browser PKCE mode:
  - `signIn()` starts Authorization Code + PKCE by redirecting to the issuer `authorization_endpoint`.
  - `handleRedirectCallback()` exchanges the current page’s `?code=...&state=...` for an access token.
- Keyfile mode:
  - `getAccessToken()` fetches an access token via Client Credentials on demand and caches it in-memory.
  - `handleRedirectCallback()` is a no-op.
- `getAccessToken()` returns the current token. No refresh in this minimal version.
- `getToken()` returns the current in-memory token (or `null`), similar to `gapi.client.getToken()`.

Keyfile format (Client Credentials)
-----------------------------------

`keyfilePath` points to a JSON file with at least:

```json
{
  "issuer": "https://oauth2.upgraide.dev:8080",
  "clientId": "diskd-agent",
  "clientSecret": "diskd-agent-secret",
  "audience": "diskd-api"
}
```

`createAuth({ keyfilePath, scopes })` loads this file and uses OIDC discovery from `issuer` to locate `token_endpoint`.

Source of `credentials.json` (end-user)
---------------------------------------

For this MVP, the primary way for end users to obtain a valid `credentials.json` is the app UI:

- `app.upgraide.dev` → user profile → tab `API Credentials Keys` → download `credentials.json`

Implementation detail (assumption for minimal v1):

- `clientId` is derived from the current user/workspace id.
- `clientSecret` is a per-user/per-workspace secret managed server-side and rotatable.

### `drive` client

```ts
export type DriveClient = {
  readonly init: () => Promise<void>;
  readonly list: (params?: { readonly path?: string; readonly parentInode?: string }) => Promise<readonly DrivePathEntry[]>;
};

export type DrivePathEntry = {
  readonly inode: string;
  readonly name: string;
  readonly type: 'file' | 'dir';
  readonly parentInode?: string;
  readonly fullPath?: string;
};
```

Notes (MVP):

- `diskd.drive({ version: 'v1', auth })` returns a client that uses `auth.getAccessToken()` for requests.
- Drive base URL is resolved from `DISKD_BASE_URL` (default `https://apis.upgraide.dev:8080`).
- `init()` calls `POST {DISKD_BASE_URL}/drive/api/v1` with JSON-RPC method `drive/init` and `Authorization: Bearer <accessToken>`.
- The response body is ignored in MVP; `init()` only verifies the token can reach Drive through `apis.upgraide.dev`.
- `list(...)` calls JSON-RPC `drive/paths/list` and maps the returned `items[]` to `DrivePathEntry[]` (snake_case to camelCase where applicable).

Usage (Node-like)
-----------------

Target: Node.js 24+ scripts (non-interactive) using Client Credentials (Google-style `keyfilePath`).

```ts
// Set DISKD_BASE_URL, e.g.: https://apis.upgraide.dev:8080
const auth = await createAuth({
  scopes: SCOPES,
  keyfilePath: CREDENTIALS_PATH,
});

const drive = diskd.drive({ version: 'v1', auth });

await drive.init();
const entries = await drive.list({ path: '/' });
console.log(entries);
```

Usage (Web quickstart via Vite)
-------------------------------

A runnable web quickstart is implemented as a Vite + TypeScript app:

- `mono/platform-api/examples/web/`

It uses the browser entrypoint:

```ts
import { createAuth, diskd } from '@diskd-ai/sdk/browser';
```

Error handling and UX
---------------------

This MVP intentionally does not define explicit error handling or exception handling behavior. Any failures (non-2xx HTTP, network errors, missing Web Crypto) are allowed to surface as default runtime errors/rejected promises in the consumer.

Future-proofing
---------------

- Keep module boundaries (`auth`, `drive`) aligned with Redmine #1537 so typed `Result` and a shared transport can be introduced without changing the public shape.
- `drive.init` is the placeholder seam where a real Drive transport and method surface can be added in follow-up subtasks.

Existing client references (app-service / agent-hub)
----------------------------------------------------

This MVP intentionally diverges from current legacy-header clients by using OAuth2 Bearer tokens and by targeting the unified host + path prefix routing.

Reference implementations for `drive/init`:

- `app-service/app-service/src/externalApi/driveClientApi.ts`:
  - `DriveAPIClient.initDrive()` calls JSON-RPC `drive/init` at `POST /api/v1` using legacy headers (`X-Api-Key`, `X-Workspace-Id`, etc.).
- `agent-hub/packages/sdk/src/drive/driveClientApi.ts`:
  - `DriveAPIClient.initDrive()` calls JSON-RPC `drive/init` at `POST /api/v1` using legacy headers (`X-Api-Key`, `X-User-Id`, `X-Organization-Id`).

Important routing note:

- Many existing axios-based clients call `POST '/api/v1'` (leading slash), which does not work with an `apis.upgraide.dev` path prefix like `/drive`. This MVP uses explicit URL construction (`{DISKD_BASE_URL}/drive/api/v1`) so it works behind the unified host.

Example SDK usage in agents (agent-hub)
---------------------------------------

Current consumers that instantiate Drive/LLM clients:

- `agent-hub/packages/agent-upgraide/src/UpgraideAgent.ts` (creates `GradientSdk` and requests `drive-client`, `drive-tools`, `llm`)
- `agent-hub/packages/agent-research/src/ResearchAgent.ts` (creates `GradientSdk` and requests `drive-client`, `drive-tools`, `llm`)

These are good reference points for how the MVP SDK should be used from long-running Node services (env-based config + client construction).

Note: `GradientSdk` is a deprecated temporary name for the current internal facade; follow-up work should migrate agents to the new `diskd.*` entrypoints once this MVP is implemented.

Implementation outline
----------------------

1. Add an MVP package skeleton (folder + build config) for the SDK.
2. Implement pure PKCE helpers (verifier/challenge/state) and OIDC discovery fetch.
3. Implement `createAuth(...)`:
   - Browser PKCE: redirect + callback exchange
   - Keyfile: Client Credentials token request
4. Implement `diskd.drive({ version: 'v1', auth })`.
5. Implement `drive.init()` performing `POST {DISKD_BASE_URL}/drive/api/v1` with method `drive/init`.
6. Add a tiny web quickstart page that demonstrates the flow end-to-end.

Testing approach
----------------

- Manual:
  - Web (interactive):
    - Open the quickstart page.
    - Click `Authorize` and complete the OAuth flow.
    - Verify the app obtains an access token and can call `drive.list(...)`.
  - Go to `app.upgraide.dev` and open user profile.
  - Open tab on user profile: `API Credentials Keys`.
  - Click download `credentials.json`.
  - Use the downloaded `credentials.json` in `createAuth({ keyfilePath, scopes })`.
  - Call `drive.list(...)` to list user files.

Acceptance criteria
-------------------

- `createAuth(...)` returns an `auth` client with `signIn()`, `handleRedirectCallback()`, and `getAccessToken()`.
- `diskd.drive({ version: 'v1', auth })` returns a client with `init()` and `list(...)`.
- `drive.init()` performs `POST {DISKD_BASE_URL}/drive/api/v1` with method `drive/init` and resolves on success.
- Successful scenario (end-to-end):
  1. Go to `app.upgraide.dev` and open user profile.
  2. Open tab on user profile: `API Credentials Keys`.
  3. Click download `credentials.json`.
  4. Use `credentials.json` in `createAuth({ keyfilePath, scopes })`.
  5. Call `drive.list(...)` to list user files with creds.
- Successful scenario (web OAuth):
  1. Open a web page using the SDK quickstart skeleton.
  2. Click `Authorize` to start OAuth2 Authorization Code + PKCE.
  3. After redirect back, `handleRedirectCallback()` stores the access token.
  4. Call `drive.list(...)` successfully using the token.
