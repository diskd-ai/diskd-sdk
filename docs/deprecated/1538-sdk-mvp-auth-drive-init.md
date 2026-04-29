Platform SDK MVP: Google-style Auth + DriveClient.init (Task #1538) Design Doc
==============================================================================

Status: ready for implementation (minimal v1, happy-path)
Parent: Redmine #1537
Depends on: Redmine #1540 (Drive Bearer auth + `apis.upgraide.dev` ingress)
Related: Redmine #1539 (App UI: download `credentials.json`)
Last updated: 2026-02-08

Context and motivation
----------------------

We want a minimal “Google-style” SDK surface to let:

- Third-party apps perform OAuth2 Authorization Code + PKCE and call Diskd APIs with `Authorization: Bearer <token>`.
- Internal Node.js apps (agents, CLIs, backend workers) authenticate non-interactively using a downloaded `credentials.json`.
- Drive be the first consumer, with the smallest method surface that proves end-to-end routing and auth:
  - `drive.init()`
  - `drive.list(...)` (required by acceptance flow to list user files)

This task intentionally ships a minimal happy-path implementation: no typed error model and no retries.

Goals
-----

- Provide a TypeScript package `@diskd-ai/sdk` with a Google-like usage shape:

```ts
const auth = await createAuth({ scopes: SCOPES, keyfilePath: CREDENTIALS_PATH });
const drive = diskd.drive({ version: 'v1', auth });
await drive.init();
const entries = await drive.list({ path: '/' });
```

- Support two auth modes behind one `createAuth(...)` function:
  - Browser: Authorization Code + PKCE (redirect-based)
  - Node: Client Credentials (via `credentials.json` keyfile)
- Use a unified API entrypoint via `DISKD_BASE_URL` (env/global), defaulting to `https://apis.upgraide.dev:8080`:
  - Drive endpoint: `POST ${DISKD_BASE_URL}/drive/api/v1` (JSON-RPC)

Non-goals for first implementation (v1)
---------------------------------------

- No typed `Result`/`SdkError` model and no explicit error mapping/recovery UX.
- No refresh token support or automatic token rotation.
- No Drive methods beyond `init` + `list`.
- No scope enforcement logic in the SDK (Drive validates the token; scope enforcement is a follow-up).
- No publishing pipeline; the package is implemented in-repo first and can be extracted/published later.

Implementation considerations
-----------------------------

- TypeScript strict mode; no `any`, no lint-ignore comments.
- Keep side effects localized:
  - Auth network calls (discovery + token)
  - Drive JSON-RPC calls
  - Browser redirect + `sessionStorage` PKCE state
- `DISKD_BASE_URL` resolution (no `baseUrl` param):
  - Node: `process.env.DISKD_BASE_URL`
  - Browser: `globalThis.DISKD_BASE_URL`
  - Default: `https://apis.upgraide.dev:8080`
- Local TLS:
  - `*.upgraide.dev` uses a self-signed cert; Node callers may need `NODE_TLS_REJECT_UNAUTHORIZED=0` for local testing, or a trusted CA setup.

High-level behavior
-------------------

1. App creates `auth` via `createAuth(...)`.
2. App creates Drive client via `diskd.drive({ version: 'v1', auth })`.
3. Browser flow (PKCE):
   - `auth.signIn()` redirects user to Hydra `/oauth2/auth` with PKCE params.
   - After redirect back, `auth.handleRedirectCallback()` exchanges `code` for `access_token`.
4. Node flow (keyfile):
   - `auth.getAccessToken()` performs client-credentials token request using `clientId/clientSecret/audience` from `credentials.json`.
5. Drive flow:
   - `drive.init()` sends JSON-RPC `drive/init` to `${DISKD_BASE_URL}/drive/api/v1` with `Authorization: Bearer ...`.
   - `drive.list({ path: '/' })` sends JSON-RPC `drive/paths/list` and returns entries.

API design (MVP)
----------------

### Top-level entrypoint

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

### Drive

```ts
export type DrivePathType =
  | 'file'
  | 'dir'
  | 'symlink'
  | 'index'
  | 'capsule'
  | 'note'
  | 'chat';

export type DrivePathEntry = {
  readonly inode: string;
  readonly name: string;
  readonly type: DrivePathType;
  readonly parentInode?: string;
  readonly mimeType?: string;
  readonly fileId?: string;
  readonly etag?: string;
  readonly size?: number;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly indexingStatus?: string;
  readonly processingStatus?: string;
  readonly processingError?: string;
  readonly externalStatus?: string;
  readonly externalError?: string;
  readonly fullPath?: string;
};

export type DriveClient = {
  readonly init: () => Promise<void>;
  readonly list: (params?: { readonly path?: string; readonly parentInode?: string }) => Promise<readonly DrivePathEntry[]>;
};
```

Implementation location (repo alignment)
----------------------------------------

Implement `@diskd-ai/sdk` in `mono/platform-api/` (this repo), keeping it self-contained and extractable:

- `platform-api/package.json` (package config + exports)
- `platform-api/src/index.ts` (Node entrypoint)
- `platform-api/src/browser/index.ts` (browser entrypoint for bundlers)
- `platform-api/src/auth/*` (PKCE + keyfile auth)
- `platform-api/src/drive/*` (JSON-RPC client)
- `platform-api/src/sdk/*` (Google-style `diskd.*` facade)
- `platform-api/src/env/*` (`DISKD_BASE_URL` resolver)
- `platform-api/src/__tests__/*` (Node `node:test` unit tests that stub `fetch`)
- `platform-api/examples/*` (3rd-party runnable quickstarts)

Rationale:
- Keeps the SDK near the platform routing/auth assumptions it depends on (`apis.upgraide.dev` + `/drive` path prefix).
- Agent-hub can later consume `@diskd-ai/sdk` without duplicating auth/transport logic; `GradientSdk` remains unchanged (deprecated name).

Testing approach
----------------

### Unit tests (Node `node:test`)

- `createAuth` keyfile flow:
  - Reads `credentials.json`
  - Fetches discovery
  - Calls token endpoint with correct body and Basic auth header
- `createAuth` PKCE flow:
  - Stores verifier/state in `sessionStorage`
  - Builds correct authorization URL with PKCE params
  - Exchanges `code` at token endpoint and stores `access_token`
- Drive client:
  - Sends JSON-RPC payloads to `${DISKD_BASE_URL}/drive/api/v1`
  - Attaches `Authorization: Bearer <token>`

Run:

```bash
cd mono/platform-api
npm test
```

### Examples smoke test (real DiskD)

```bash
cd mono/platform-api
export DISKD_BASE_URL='https://apis.upgraide.dev:8080'
export DISKD_CREDENTIALS_PATH='/absolute/path/to/credentials.json'
npm run examples:smoke
```

### Manual happy-path (Tilt / local)

Pre-req: #1540 implemented (Drive accepts Bearer + `apis.upgraide.dev` routes `/drive`).

1. Obtain token (client credentials) and call Drive:

```bash
TOKEN=$(
  curl -k -s -u oauth2-client-node:oauth2-client-node-secret \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d 'grant_type=client_credentials&scope=openid&audience=diskd-api' \
    https://oauth2.upgraide.dev:8080/oauth2/token | jq -r '.access_token'
)

curl -k -s https://apis.upgraide.dev:8080/drive/api/v1 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"jsonrpc":"2.0","method":"drive/init","params":{},"id":1}'
```

2. Verify SDK Node script can do the same (requires trusting local TLS cert or local-only `NODE_TLS_REJECT_UNAUTHORIZED=0`).

Acceptance criteria
-------------------

- `createAuth(...)` exists and returns an `AuthModule` with:
  - `signIn()`, `handleRedirectCallback()`, `getAccessToken()`, `getToken()`, `signOut()`.
- `diskd.drive({ version: 'v1', auth })` exists and returns a `DriveClient` with:
  - `init()`, `list(...)`.
- `drive.init()` performs `POST ${DISKD_BASE_URL}/drive/api/v1` with JSON-RPC method `drive/init` and `Authorization: Bearer <token>`.
- Successful scenario (end-to-end with keyfile):
  1. Go to `app.upgraide.dev` and open user profile.
  2. Open tab: `API Credentials Keys`.
  3. Download `credentials.json`.
  4. Use `credentials.json` in `createAuth({ scopes, keyfilePath })`.
  5. Call `drive.list({ path: '/' })` successfully.
- Successful scenario (web OAuth):
  1. Open a web quickstart page using the SDK.
  2. Click `Authorize` to start OAuth2 Authorization Code + PKCE.
  3. After redirect back, `handleRedirectCallback()` stores the access token.
  4. Call `drive.list({ path: '/' })` successfully using the token.
