OAuth2 Credential Generation with workspace_id Claim
=====================================================

Context and motivation
----------------------

The `@diskd/sdk` allows external clients to access platform services (Drive, LLM, Agents)
through `apis.upgraide.dev` using OAuth2 bearer tokens. Authentication works, but every
Drive API call fails with `"Missing workspace_id claim"` because the JWT access token
does not contain the `workspace_id` claim.

**Root cause:** The IAM service injects `workspace_id` into tokens via the Hydra consent
flow (`buildTokenClaimsForSubject` in `oauth2.service.ts`). However, the `client_credentials`
grant used by SDK credentials **bypasses the consent flow entirely** -- Hydra issues the token
directly without calling the IAM consent endpoint. As a result, the token contains no custom
claims.

**Current state:**

- SDK credentials use `client_id = workspace_id` (in `sdk-credentials.service.ts:51`)
- The credential JSON contains `{ issuer, clientId, clientSecret, audience }` but no
  `workspace_id` or `apisUrl`
- Hydra's `client_credentials` grant does not trigger login/consent webhooks
- Drive's `iam_auth.py:363` reads `workspace_id` from JWT claims and rejects tokens without it
- The internal API key path works because it reads workspace from `X-Workspace-Id` header

**Trigger:** Deploying apis-service to the dev k8s cluster and running `@diskd/sdk` external
validation scripts against `apis.upgraide.dev` exposed this gap.

Goals:
- OAuth2 tokens issued via `client_credentials` grant contain `workspace_id` as a signed JWT claim
- The `credentials.json` file includes the `apisUrl` so clients don't need separate env config
- SDK validation scripts pass end-to-end against `apis.upgraide.dev` using `credentials.json`

Non-goals for first implementation (v1):
- Rotating workspace association for existing credentials (requires new credentials)
- Revoking workspace access independently of the OAuth2 client
- Multi-workspace credentials (one credential = one workspace)
- Per-scope workspace access control (all scopes get the same workspace_id)


Implementation considerations
------------------------------

**Hydra token customization for client_credentials grant:**

Ory Hydra supports a **token hook** for the `client_credentials` grant. This is a webhook
that Hydra calls before issuing the token, allowing the IAM service to inject custom claims
into the access token session. This is the standard Ory mechanism for enriching
`client_credentials` tokens.

Configuration: `OAUTH2_TOKEN_HOOK_URL` environment variable on Hydra, pointing to an
IAM service endpoint that returns the session claims.

**Alternative considered -- Hydra client metadata:**

Hydra allows storing arbitrary `metadata` on OAuth2 clients (already used for
`sdk_client_secret`). The token hook endpoint can read the client metadata to determine
which claims to inject, without needing a database lookup.

**Design principles:**
- The `workspace_id` must be a **signed claim** in the JWT -- never an unsigned header
- SDK credentials already use `client_id = workspace_id`, so the token hook can derive
  `workspace_id` from the client itself
- The `apisUrl` is not a claim -- it belongs in the credentials file as deployment config
- No changes to Drive's auth verification -- it already reads `workspace_id` from JWT claims


High-level behavior
-------------------

### Credential generation flow (existing + new)

1. User calls `POST /internal/sdk/credentials` with session cookie
2. IAM service resolves `user.workspaceId` from the session
3. IAM service creates/updates Hydra client with:
   - `client_id` = `workspace_id`
   - `metadata` = `{ sdk_client_secret, workspace_id }` (workspace_id added)
   - `grant_types` = `['client_credentials']`
   - `audience` = `['diskd-api']`
4. IAM service returns `credentials.json`:
   ```json
   {
     "issuer": "https://auth.upgraide.dev",
     "clientId": "<workspace_id>",
     "clientSecret": "<secret>",
     "audience": "diskd-api",
     "apisUrl": "https://apis.upgraide.dev"
   }
   ```

### Token acquisition flow (unchanged in SDK)

1. SDK reads `credentials.json`
2. SDK fetches OIDC discovery from `issuer`
3. SDK requests token from `token_endpoint` with `client_credentials` grant
4. **New:** Hydra calls the token hook at the IAM service before issuing token
5. IAM token hook reads `client_id` from the request, looks up workspace_id from
   client metadata, returns session claims: `{ access_token: { workspace_id } }`
6. Hydra issues JWT with `workspace_id` claim embedded
7. SDK sends `Authorization: Bearer <token>` to `apis.upgraide.dev`
8. apis-service proxies to Drive
9. Drive verifies JWT, reads `workspace_id` from claims -- succeeds

### Token hook request/response (Hydra -> IAM)

**Request** (POST from Hydra to IAM):
```json
{
  "session": {},
  "request": {
    "client_id": "<workspace_id>",
    "granted_scopes": ["openid"],
    "granted_audience": ["diskd-api"],
    "grant_types": ["client_credentials"]
  }
}
```

**Response** (IAM to Hydra):
```json
{
  "session": {
    "access_token": {
      "workspace_id": "<workspace_id>"
    }
  }
}
```

Hydra merges this session into the JWT access token as custom claims.


API design
----------

### Token hook endpoint (new)

**Endpoint:** `POST /internal/oauth2/token-hook`

**Purpose:** Called by Hydra before issuing `client_credentials` tokens. Returns custom
claims to embed in the JWT.

**Request body** (from Hydra):
```typescript
type TokenHookRequest = {
  readonly session: Record<string, unknown>;
  readonly request: {
    readonly client_id: string;
    readonly granted_scopes: readonly string[];
    readonly granted_audience: readonly string[];
    readonly grant_types: readonly string[];
  };
};
```

**Response body** (to Hydra):
```typescript
type TokenHookResponse = {
  readonly session: {
    readonly access_token: {
      readonly workspace_id: string;
    };
  };
};
```

**Error handling:**
- If `client_id` cannot be resolved to a workspace, return HTTP 403 (Hydra rejects the
  token issuance)
- If the hook endpoint is unreachable, Hydra rejects the token (fail-closed)

**Auth:** Internal-only endpoint, no external auth required (Hydra calls it within the
cluster via K8s ClusterIP DNS)

### Credential generation endpoint (updated)

**Endpoint:** `POST /internal/sdk/credentials` (existing)

**Changes:**
1. Store `workspace_id` in Hydra client metadata (alongside `sdk_client_secret`)
2. Add `apisUrl` to the response JSON (from config: `apis.externalUrl`)

**Updated response:**
```json
{
  "issuer": "https://auth.upgraide.dev",
  "clientId": "<workspace_id>",
  "clientSecret": "<base64url-secret>",
  "audience": "diskd-api",
  "apisUrl": "https://apis.upgraide.dev"
}
```


Configuration changes
---------------------

### Hydra (K8s ConfigMap)

Add to `iam-hydra` ConfigMap:
```yaml
OAUTH2_TOKEN_HOOK_URL: "http://iam-service.dev.svc.cluster.local:3001/internal/oauth2/token-hook"
```

### IAM service (config)

Add to `oauth2.config.ts`:
```typescript
apis.externalUrl    // Default: "https://apis.upgraide.dev"
```


SDK changes
-----------

### Keyfile format (additive)

Add optional `apisUrl` field to `keyfile.ts`:
```typescript
type KeyfileJson = {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly audience: string;
  readonly apisUrl?: string;   // new, optional for backward compat
};
```

### Gateway URL resolution

When `apisUrl` is present in credentials, use it as `DISKD_BASE_URL` default:
- `diskd.auth.credentials()` reads `apisUrl` from keyfile
- Sets it as the SDK-wide base URL if `DISKD_BASE_URL` env var is not set
- No changes needed in service clients -- they already read from `DISKD_BASE_URL`


Error handling and UX
---------------------

| Error | Source | User-facing message | Recovery |
|-------|--------|---------------------|----------|
| Token hook returns 403 | IAM -> Hydra | `invalid_client: token hook denied` | Re-generate credentials for a valid workspace |
| Token hook unreachable | Hydra -> IAM | `server_error: token hook failed` | Check IAM service health in cluster |
| workspace_id missing in token | Drive | `Missing workspace_id claim` (existing) | Re-generate credentials (stale client without metadata) |
| Old credentials without apisUrl | SDK | Falls back to `DISKD_BASE_URL` env | User sets env var or regenerates credentials |

Stale credentials (created before this change) continue to work with the internal API
key path. For the OAuth2 path, users must regenerate credentials to get the
`workspace_id` metadata attached to the Hydra client.


Future-proofing
---------------

- **Multi-workspace credentials**: The token hook can be extended to read a workspace list
  from client metadata and return multiple workspace claims. This would require a
  `X-Workspace-Id` header to select the active workspace at request time.
- **Scope-based access**: The token hook receives `granted_scopes`, enabling future
  per-scope claim injection (e.g., read-only workspace access).
- **Token hook for OAuth2 apps**: The same hook works for `client_credentials` grants from
  user-created OAuth2 apps (`oauth2-apps` table), not just SDK credentials. The hook reads
  `workspace_id` from client metadata regardless of how the client was created.
- **apisUrl per environment**: The credential generation endpoint reads `apisUrl` from config,
  so different environments (dev/stage/prod) automatically embed the correct URL.


Implementation outline
----------------------

### Phase 1: Token hook (IAM service)

1. Add `POST /internal/oauth2/token-hook` endpoint to `oauth2.controller.ts`
2. Handler reads `request.client_id` from the hook payload
3. Fetch client from Hydra Admin API: `hydraAdminService.getOAuth2Client(clientId)`
4. Read `workspace_id` from client metadata (or use `client_id` directly since
   SDK credentials set `client_id = workspace_id`)
5. Return `{ session: { access_token: { workspace_id } } }`
6. Return 403 if workspace_id cannot be resolved

### Phase 2: Hydra configuration

1. Add `OAUTH2_TOKEN_HOOK_URL` to iam-hydra ConfigMap in `.k8s/base/iam-hydra/configmap.yaml`
2. Set value to `http://iam-service.<namespace>.svc.cluster.local:3001/internal/oauth2/token-hook`
3. Restart Hydra to pick up the new config

### Phase 3: Credential generation update (IAM service)

1. Update `sdk-credentials.service.ts` to store `workspace_id` in Hydra client metadata
2. Add `apisUrl` to config (`apis.externalUrl`)
3. Return `apisUrl` in the credentials JSON response
4. Update `CredentialsJson` type

### Phase 4: SDK update (platform-api)

1. Add optional `apisUrl` to `KeyfileJson` type in `keyfile.ts`
2. When `apisUrl` is present, use it as default base URL
3. Update validation scripts to use credentials with `apisUrl`

### Phase 5: Deploy and verify

1. Deploy IAM service with token hook endpoint
2. Update Hydra ConfigMap and restart
3. Re-generate SDK credentials via `/internal/sdk/credentials`
4. Run `validate-drive-external.ts` against `apis.upgraide.dev`


Testing approach
----------------

### Unit tests (IAM service)

- Token hook returns `{ workspace_id }` when client has metadata
- Token hook returns `{ workspace_id: client_id }` when metadata is absent (SDK credentials
  use client_id = workspace_id)
- Token hook returns 403 for unknown client_id
- Credential generation includes `apisUrl` in response
- Credential generation stores `workspace_id` in client metadata

### Integration tests

- Create SDK credentials via `/internal/sdk/credentials`
- Request token via `client_credentials` grant
- Decode JWT and verify `workspace_id` claim is present
- Use token to call Drive API through `apis.upgraide.dev` -- verify 200 response

### E2E validation (existing scripts)

- Run `validate-drive-external.ts` with regenerated credentials
- All 15 drive operations pass (init, diskUsage, list, create, tools.*, delete)


Acceptance criteria
-------------------

1. Given a `client_credentials` token request for an SDK credential, when the token is
   issued, then the JWT access token contains a `workspace_id` claim matching the
   credential's workspace
2. Given a valid SDK credential, when the user runs `validate-drive-external.ts` against
   `apis.upgraide.dev`, then all drive operations succeed (no `Missing workspace_id claim`
   errors)
3. Given a newly generated `credentials.json`, when the file is read, then it contains
   `apisUrl` pointing to the correct apis gateway for that environment
4. Given a `credentials.json` without `apisUrl` (legacy), when the SDK loads it, then it
   falls back to `DISKD_BASE_URL` env var without error
5. Given an unknown `client_id` in a token request, when Hydra calls the token hook, then
   the hook returns 403 and Hydra rejects the token
6. Given the token hook endpoint is down, when a token is requested, then Hydra rejects
   the request (fail-closed, no unsigned tokens)
