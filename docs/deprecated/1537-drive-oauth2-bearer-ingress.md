Drive: OAuth2 Bearer Auth + `apis.upgraide.dev` Ingress (Prereq for SDK MVP) Design Doc
=====================================================================================

Status: ready for implementation (happy-path MVP)
Parent: Redmine #1537 (Preliminary SDK)
Task: Redmine #1540
Blocks: Redmine #1538 (SDK MVP: Auth + Drive init/list)
Last updated: 2026-02-07

Context and motivation
----------------------

Redmine #1538 defines a Google-style SDK surface that calls Drive through a unified public base URL (`DISKD_BASE_URL`) using `Authorization: Bearer <access_token>`.

Today:

- Drive is not reachable via a unified `apis.upgraide.dev` entrypoint (Caddy has no such host yet).
- Drive authentication supports legacy headers (`X-Api-Key`, `X-User-Id`, etc.) and (optionally) Kratos cookie → IAM `/internal/authorize`, but **does not** accept OAuth2 Bearer tokens.

This task adds the smallest set of changes to make the SDK happy-path implementable end-to-end.

Goals
-----

- Expose Drive JSON-RPC via a stable public URL:
  - `https://apis.upgraide.dev:8080/drive/api/v1` → Drive service `/api/v1`
- Allow Drive JSON-RPC calls authenticated by OAuth2 access tokens:
  - Accept `Authorization: Bearer <JWT>`
  - Verify Hydra JWT access tokens via JWKS + `iss` + `aud`
- Preserve existing legacy auth modes (no breaking changes):
  - `X-Api-Key` header mode
  - Kratos cookie mode (if configured)

Non-goals for first implementation (v1)
---------------------------------------

- No scope enforcement in Drive (v1 validates token correctness only).
- No auth refactors in app-service/agent-hub legacy clients.
- No full gateway enforcement (Oathkeeper) or centralized proxy enforcement.
- No refresh token storage/rotation strategy (handled by SDK tasks).

Implementation considerations
-----------------------------

- Hydra issues **JWT access tokens** (`STRATEGIES_ACCESS_TOKEN: jwt` in `iam-service/.k8s/base/iam-hydra/configmap.yaml`).
- IAM already contains a correct reference verifier (TypeScript) using JWKS + `iss` + `aud`:
  - `iam-service/iam-service/src/oauth2/oauth2.service.ts`
- Drive is Python + aiohttp; implement Bearer verification in `drive/modules/main/iam_auth.py` and keep the rest of Drive unchanged.
- Keep code additive and isolate IO to the auth adapter:
  - JWT verification core is pure (input token + jwks + expected `iss/aud` → claims).
  - JWKS fetching is cached in-memory with a short TTL.

High-level behavior
-------------------

1. Client obtains an OAuth2 access token from Hydra (PKCE or client credentials).
2. Client calls Drive JSON-RPC through ingress:
   - `POST https://apis.upgraide.dev:8080/drive/api/v1`
   - `Authorization: Bearer <access_token>`
3. Drive verifies JWT:
   - signature (RS256)
   - `iss == HYDRA_ISSUER_URL`
   - `aud` contains `OAUTH2_AUDIENCE`
   - `exp` is in the future (if present)
4. Drive derives auth context for existing handlers:
   - `user_id = sub`
   - `org_id/workspace_id` come from token claims if present; otherwise minimal deterministic conventions (v1).
5. Drive executes the requested JSON-RPC method (`drive/init`, `drive/paths/list`, etc.).

Ingress / public API design
---------------------------

### Caddy routing

Update the **local overlay** for Caddy (keep `upgraide.dev` hostnames local-only):

- `platform-infra/.k8s/overlays/local` patch for `common-caddy` ConfigMap (`data.Caddyfile`)

- Add a new hostname:
  - `https://apis.upgraide.dev:8080`
- Add path routing for Drive only (v1):
  - `handle /drive* { uri strip_prefix /drive; reverse_proxy drive-service.drive.svc.cluster.local:8000 }`
- For any other path:
  - return a simple 404 response

Update `platform-infra/README.md` “Local Domains (Caddy)”:

- Add host entry: `127.0.0.1 apis.upgraide.dev`
- Add “Open” URL: `https://apis.upgraide.dev:8080`
- Add route description for `/drive` prefix.

Drive auth design
-----------------

### Supported auth modes (ordered)

Update `drive/modules/main/iam_auth.py:get_user_and_org_iam(...)`:

1. If `Authorization: Bearer <token>` is present:
   - Verify the token (JWT + JWKS).
   - Return `{ USER_ID, ORGANIZATION_ID, WORKSPACE_ID }`.
2. Else if `X-Api-Key` is present:
   - Keep existing legacy-header behavior.
3. Else:
   - Keep existing Kratos cookie → IAM `/internal/authorize` behavior.

### Drive configuration (env)

Add non-secret env vars for Bearer verification:

- `HYDRA_ISSUER_URL` (example: `https://oauth2.upgraide.dev:8080`)
- `HYDRA_JWKS_URL` (example: `http://iam-hydra.iam-service.svc.cluster.local:4444/.well-known/jwks.json`)
- `OAUTH2_AUDIENCE` (example: `diskd-api`)

Token claims mapping (v1)
-------------------------

Drive needs `user_id`, `org_id`, `workspace_id`.

- `user_id` = JWT `sub`
- `org_id`:
  - Prefer claim `org_id` if present and non-empty
  - Else: `organization_{user_id}` (v1 convention, matches existing header-mode fallback)
- `workspace_id`:
  - Prefer claim `workspace_id` if present and non-empty
  - Else: `workspace_{org_id}_{user_id}` (v1 convention, matches existing header-mode fallback)

Future-proofing note: in follow-ups, standardize and enforce org/workspace claims in tokens to remove conventions.

Error handling and UX
---------------------

This is a happy-path MVP. Invalid Bearer tokens may surface as existing Drive JSON-RPC errors (no new public error model is introduced here).

Future-proofing
---------------

- Introduce Drive scopes (`upgraide:drive:read`, `upgraide:drive:write`) and enforce them in Drive.
- Implement “each module registers its own consent scopes” in IAM by replacing the hardcoded scope list:
  - Current: `iam-service/iam-service/src/oauth2/oauth2.scopes.ts`

Implementation outline
----------------------

1. Ingress
   - Add `apis.upgraide.dev` site block and `/drive` reverse proxy.
   - Update `platform-infra/README.md` local domains list.
2. Drive Bearer auth
   - Implement RS256 JWT verification from JWKS.
   - Cache JWKS in-memory with TTL.
   - Map claims to Drive auth context and return auth dict.
3. Docs
   - Update `drive/modules/drive/API.md` authentication section to mention Bearer support.
4. Tests
   - Add unit tests for JWT verification + claim mapping in `modules/main/tests/`.

Testing approach
----------------

### Happy-path manual test (Tilt)

1. Add hosts entry:
   - `127.0.0.1 apis.upgraide.dev`
2. Obtain a client-credentials access token (local dev defaults created by `iam-hydra-client-init`):

```bash
TOKEN=$(
  curl -k -s -u oauth2-client-node:oauth2-client-node-secret \\
    -H 'Content-Type: application/x-www-form-urlencoded' \\
    -d 'grant_type=client_credentials&scope=openid&audience=diskd-api' \\
    https://oauth2.upgraide.dev:8080/oauth2/token | \\
  jq -r '.access_token'
)
```

3. Call Drive init via ingress:

```bash
curl -k -s https://apis.upgraide.dev:8080/drive/api/v1 \\
  -H 'Content-Type: application/json' \\
  -H \"Authorization: Bearer ${TOKEN}\" \\
  -d '{\"jsonrpc\":\"2.0\",\"method\":\"drive/init\",\"params\":{},\"id\":1}'
```

4. Call Drive list via ingress:

```bash
curl -k -s https://apis.upgraide.dev:8080/drive/api/v1 \\
  -H 'Content-Type: application/json' \\
  -H \"Authorization: Bearer ${TOKEN}\" \\
  -d '{\"jsonrpc\":\"2.0\",\"method\":\"drive/paths/list\",\"params\":{\"path\":\"/\"},\"id\":2}'
```

Acceptance criteria
-------------------

- `https://apis.upgraide.dev:8080/drive/api/v1` routes to Drive service and responds to JSON-RPC requests.
- With a valid Hydra access token, `drive/init` and `drive/paths/list` succeed using `Authorization: Bearer`.
- Existing legacy auth modes (API key header mode and cookie mode) continue to work.
