Platform API Multi-Language SDK -- Design Doc
==============================================

Status: Draft

Affected projects: `platform-api`, `drive`, `app-service`, `agent-hub`

Context and motivation
----------------------
The platform-api (`@diskd/sdk`) currently provides a TypeScript-only SDK with Drive client support. The routine execution epic (see `docs/routine-execution-design.md`) introduces new cross-service contracts (Drive scheduler -> app-service, app-service -> agent-hub) that require SDK client libraries in both TypeScript and Python.

Today, each service implements its own ad-hoc HTTP clients:
- `agent-hub/packages/sdk/` has an internal `GradientSdk` with `DriveAPIClient` (axios, org_id/user_id headers -- deprecated identity model).
- `drive/clients/python/` has a standalone `DriveSDK` (httpx, workspace_id headers) that lives inside the Drive repo and is not published as a package.
- The crontab scheduler (Drive, Python) needs to call app-service's routine execution endpoint -- currently a stub with no client.

This fragmentation means: duplicated transport code, inconsistent header conventions, no single source of truth for API contracts, and no reusable client for new service integrations.

The goal is to evolve `platform-api` into a **multi-language SDK monorepo** that is the single source of truth for all platform API contracts and client libraries, installable via `npm` (TypeScript) and `pip` (Python) from the GitLab private registry.

Goals:
- Define all cross-service API contracts (types, request/response shapes, error tags) in `platform-api` as the authoritative source.
- Provide TypeScript and Python client implementations for each contract, following the existing SDK patterns (`diskd.drive()` for TS, `DriveSDK` facade for Python).
- Add a `RoutinesClient` (TypeScript) and `RoutinesClient` (Python) for the routine execution contract (Drive scheduler -> app-service).
- Publish the TypeScript SDK to GitLab npm registry (`@diskd/sdk`) and the Python SDK to GitLab PyPI registry (`diskd-sdk`) so consumers install via `npm install @diskd/sdk` and `pip install diskd-sdk`.
- Migrate `drive/clients/python/` into `platform-api` as the canonical Python SDK. The Drive repo consumes it as a dependency.
- Ensure `agent-hub` can migrate from its internal `GradientSdk` Drive client to `@diskd/sdk` incrementally (non-blocking for V1).

Non-goals (v1):
- Migrating `agent-hub/packages/sdk/` to `@diskd/sdk` in this iteration. Agent-hub's internal SDK (`GradientSdk`) continues to work. Migration is a follow-up task.
- Generating SDK code from OpenAPI/Protobuf specs. V1 hand-writes clients aligned with the contract types. Code generation is a future improvement.
- Publishing to public npm/PyPI registries. V1 publishes to GitLab private registries only.
- Python browser/PKCE auth flows. Python SDK supports internal service auth (API key + workspace headers) only.
- Streaming response helpers. V1 handles the routine execution contract (request/response, not streaming). Streaming for agent-hub invocations stays in app-service's own code.

Implementation considerations
-----------------------------

### Repository structure

`platform-api` becomes a polyglot monorepo with two independently publishable packages sharing the same contract definitions:

```
platform-api/
  ts/                          # TypeScript SDK (was src/)
    src/
      index.ts
      auth/                    # OAuth2/PKCE (existing)
      drive/                   # Drive client (existing)
      routines/                # NEW: routine execution client
        types.ts               # Contract types (authoritative)
        client.ts              # RoutinesClient implementation
        index.ts               # Module exports
      sdk/
        diskd.ts               # DiskD factory (extended)
        types.ts               # DiskD interface (extended)
      env/
      node/
      browser/
    package.json               # @diskd/sdk
    tsconfig.json
  py/                          # Python SDK (new, absorbs drive/clients/python/)
    src/
      diskd_sdk/
        __init__.py
        drive/                 # Drive client (migrated from drive/clients/python/)
          __init__.py
          client.py            # DriveAPIClient
          db_client.py         # DriveDbClient
          tools_client.py      # ToolsAPIClient
          types.py             # PathEntry, etc.
          rpc.py               # JsonRpcClient
        routines/              # NEW: routine execution client
          __init__.py
          types.py             # Contract types (mirrors ts/src/routines/types.ts)
          client.py            # RoutinesClient implementation
        sdk.py                 # DiskdSDK facade (extended)
        types.py               # Shared types (Result, etc.)
        internal_auth.py       # Internal service auth (X-Api-Key, X-Workspace-Id)
    tests/
    pyproject.toml             # diskd-sdk
  docs/                        # Design docs (existing, stays at root)
  .gitlab-ci.yml               # Updated: builds + publishes both packages
```

### Design principles

1. **Contracts are the source of truth.** TypeScript types in `ts/src/routines/types.ts` define the canonical shapes. Python types in `py/src/diskd_sdk/routines/types.py` mirror them exactly. Any contract change starts in `platform-api`.

2. **Clients are thin transport wrappers.** Each client method validates input, makes an HTTP call, and maps the response to typed domain objects. No business logic in SDK clients.

3. **Internal service auth is distinct from external auth.** External clients use OAuth2/PKCE (existing `AuthModule`). Internal service clients use `X-Api-Key` + `X-Workspace-Id` headers (new `InternalAuth`). Both auth strategies are injected into the same client interface.

4. **Result-based error handling.** SDK methods return `Result<T, E>` (TypeScript) or `Result` union (Python) -- never throw for domain errors. Transport errors (connection failure, HTTP 5xx) are the only exceptions that propagate.

5. **Additive changes only.** The existing `@diskd/sdk` API (`diskd.drive()`, `createAuth()`) is unchanged. New modules (`routines/`) and the factory extension (`diskd.routines()`) are purely additive.

### Auth model for internal clients

External SDK consumers authenticate via OAuth2/PKCE (`createAuth()`). Internal service-to-service calls use a different mechanism:

```
InternalAuth:
  apiKey: string            # Shared secret from K8s Secret
  workspaceId: string       # From the execution context (X-Workspace-Id)
```

The SDK provides a `createInternalAuth()` factory that produces an `AuthModule`-compatible object. This lets `RoutinesClient` accept the same `auth` parameter as `DriveClient`, but the underlying transport injects `X-Api-Key` and `X-Workspace-Id` headers instead of `Authorization: Bearer`.

TypeScript:
```
const auth = createInternalAuth({ apiKey, workspaceId });
const routines = diskd.routines({ version: 'v1', auth });
```

Python:
```
auth = InternalAuth(api_key=api_key, workspace_id=workspace_id)
async with DiskdSDK(auth=auth, base_url=base_url) as sdk:
    result = await sdk.routines.execute(params)
```

High-level behavior
-------------------

### TypeScript SDK consumer flow (app-service)

App-service's `RoutineExecutionController` receives a request from the Drive scheduler. It does not use the SDK to receive the request (the controller uses NestJS decorators). However, the **contract types** from `@diskd/sdk` are used to validate the request body and construct the response:

```
import { ExecuteRoutineRequest, RoutineExecutionResult, RoutineExecutionError } from '@diskd/sdk';
```

### Python SDK consumer flow (Drive scheduler)

The Drive crontab scheduler uses the Python SDK to call app-service:

```
from diskd_sdk import DiskdSDK, InternalAuth
from diskd_sdk.routines import ExecuteRoutineParams

auth = InternalAuth(api_key=config.internal_api_key, workspace_id=job.workspace_id)
async with DiskdSDK(auth=auth, base_url=config.app_service_base_url) as sdk:
    result = await sdk.routines.execute(ExecuteRoutineParams(
        run_id=run.id,
        routine_slug=payload.routine_slug,
        operative_slug=payload.operative_slug,
        project_slug=payload.project_slug,
        chroot=chroot,
        trigger_context=trigger_context,
    ))
    match result:
        case Ok(value): ...  # succeeded
        case Err(error): ... # domain error
```

### TypeScript SDK consumer flow (external / future UI)

External consumers (e.g., a dashboard or CLI tool) use OAuth2 auth and the `diskd` factory:

```
import { createAuth, diskd } from '@diskd/sdk';

const auth = await createAuth({ scopes: ['routines:execute'], keyfilePath: '...' });
const routines = diskd.routines({ version: 'v1', auth });
const result = await routines.execute({ routineSlug: 'daily-briefing', ... });
```

API contracts
-------------

### Contract 1: Routine Execution (Drive scheduler -> App-service)

This contract is defined in full in `docs/routine-execution-design.md`, section "Contract 1". The SDK types mirror it exactly.

**TypeScript types** (`ts/src/routines/types.ts`):

```ts
// -- Request --

type ChrootContext = {
  readonly scopeType: 'project' | 'profile';
  readonly scopeInode: string;
  readonly workingDirectoryInode: string;
  readonly allowedRootInode: string;
};

type TriggerContext = {
  readonly source: 'crontab' | 'manual' | 'signal';
  readonly scheduledFor?: string;
  readonly timezone?: string;
  readonly jobId?: string;
  readonly scheduleExpression?: string;
  readonly metadata?: Readonly<Record<string, string>>;
};

type ExecuteRoutineParams = {
  readonly runId: string;
  readonly routineSlug: string;
  readonly operativeSlug: string;
  readonly projectSlug: string;
  readonly chroot: ChrootContext;
  readonly triggerContext: TriggerContext;
};

// -- Response --

type RoutineExecutionResult = {
  readonly executionId: string;
  readonly sessionId: string;
  readonly status: 'completed';
  readonly stepsCompleted: number;
  readonly stepsTotal: number;
  readonly durationMs: number;
  readonly summary: string;
};

type RoutineExecutionErrorTag =
  | 'RoutineNotFound'
  | 'OperativeNotFound'
  | 'ProjectNotFound'
  | 'ProjectNotOwned'
  | 'RoutineNotActive'
  | 'ExecutionFailed'
  | 'AlreadyRunning'
  | 'Timeout';

type RoutineExecutionError = {
  readonly tag: RoutineExecutionErrorTag;
  readonly message: string;
};

// -- Result envelope --

type ExecuteRoutineResponse =
  | { readonly ok: true; readonly value: RoutineExecutionResult }
  | { readonly ok: false; readonly error: RoutineExecutionError };
```

**Python types** (`py/src/diskd_sdk/routines/types.py`):

```python
@dataclass(frozen=True)
class ChrootContext:
    scope_type: Literal['project', 'profile']
    scope_inode: str
    working_directory_inode: str
    allowed_root_inode: str

@dataclass(frozen=True)
class TriggerContext:
    source: Literal['crontab', 'manual', 'signal']
    scheduled_for: Optional[str] = None
    timezone: Optional[str] = None
    job_id: Optional[str] = None
    schedule_expression: Optional[str] = None
    metadata: Optional[Dict[str, str]] = None

@dataclass(frozen=True)
class ExecuteRoutineParams:
    run_id: str
    routine_slug: str
    operative_slug: str
    project_slug: str
    chroot: ChrootContext
    trigger_context: TriggerContext

@dataclass(frozen=True)
class RoutineExecutionResult:
    execution_id: str
    session_id: str
    status: Literal['completed']
    steps_completed: int
    steps_total: int
    duration_ms: int
    summary: str

RoutineExecutionErrorTag = Literal[
    'RoutineNotFound', 'OperativeNotFound', 'ProjectNotFound',
    'ProjectNotOwned', 'RoutineNotActive', 'ExecutionFailed',
    'AlreadyRunning', 'Timeout',
]

@dataclass(frozen=True)
class RoutineExecutionError:
    tag: RoutineExecutionErrorTag
    message: str

# Result ADT
Result = Union[Ok[RoutineExecutionResult], Err[RoutineExecutionError]]
```

### Contract 2: Routine Sessions (external API)

Session browsing endpoints for the UI. Contract types only (client implementation deferred to when the UI needs it).

```ts
type RoutineSession = {
  readonly id: string;
  readonly runId: string;
  readonly routineId: string;
  readonly operativeId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly status: 'running' | 'completed' | 'failed';
  readonly summary?: string;
  readonly errorTag?: string;
  readonly errorMessage?: string;
  readonly durationMs?: number;
  readonly createdAt: string;
  readonly completedAt?: string;
};
```

Client methods (TypeScript, future):
- `routines.sessions.list({ routineId, page, pageSize })` -> paginated `RoutineSession[]`
- `routines.sessions.get({ sessionId })` -> `RoutineSession`
- `routines.sessions.messages({ sessionId })` -> `Message[]`
- `routines.sessions.cloneToChat({ sessionId })` -> `{ chatId: string }`

### Drive client contract (existing, migrated)

The existing `drive/clients/python/` types and client methods migrate into the Python SDK without API changes. TypeScript Drive client is unchanged.

Client implementations
----------------------

### TypeScript RoutinesClient (`ts/src/routines/client.ts`)

Transport: `fetch` (consistent with existing `drive/rpc.ts`).
Protocol: REST (not JSON-RPC) -- the routine execution endpoint is a standard REST POST.

```ts
type RoutinesClientParams = {
  readonly version: 'v1';
  readonly auth: AuthModule;
  readonly baseUrl?: string;  // defaults to resolveDiskdBaseUrl()
};

type RoutinesClient = {
  readonly execute: (params: ExecuteRoutineParams) => Promise<ExecuteRoutineResponse>;
};
```

Implementation:
1. Resolve base URL from `auth.baseUrl` or `DISKD_BASE_URL` env var.
2. Serialize `ExecuteRoutineParams` to JSON (camelCase).
3. POST to `{baseUrl}/api/internal/routines/execute`.
4. Inject auth headers via `auth.getHeaders()` (Bearer token for external, X-Api-Key + X-Workspace-Id for internal).
5. Parse response JSON. If HTTP 2xx, return the parsed `ExecuteRoutineResponse` (which contains `ok: true | false`).
6. If HTTP 5xx or connection error, throw `TransportError` (retryable by caller).

### Python RoutinesClient (`py/src/diskd_sdk/routines/client.py`)

Transport: `httpx.AsyncClient` (consistent with existing Drive Python SDK).
Protocol: REST POST.

```python
class RoutinesClient:
    def __init__(self, http_client: httpx.AsyncClient) -> None: ...

    async def execute(self, params: ExecuteRoutineParams) -> Result:
        """Execute a routine via app-service. Returns Ok or Err, never raises for domain errors."""
```

Implementation:
1. Serialize `ExecuteRoutineParams` to dict (snake_case -> camelCase for JSON body).
2. POST to `/api/internal/routines/execute`.
3. On HTTP 2xx, parse response JSON into `Ok(RoutineExecutionResult)` or `Err(RoutineExecutionError)`.
4. On HTTP 5xx or `httpx.TransportError`, raise `TransportError` (caller handles retries).
5. On HTTP 4xx (unexpected), raise `SdkError` with status code and body.

### DiskD factory extension

TypeScript (`ts/src/sdk/diskd.ts`):
```ts
export const diskd: DiskD = {
  drive: ({ version, auth }) => { ... },  // existing
  routines: ({ version, auth, baseUrl }) => {  // NEW
    if (version !== 'v1') throw new Error('Unsupported Routines API version');
    return createRoutinesClient({ version, auth, baseUrl });
  },
};
```

Python (`py/src/diskd_sdk/sdk.py`):
```python
class DiskdSDK:
    """Facade bundling Drive and Routines clients on one HTTP stack."""

    @property
    def drive(self) -> DriveAPIClient: ...      # migrated from drive/clients/python/

    @property
    def routines(self) -> RoutinesClient: ...   # NEW
```

Auth abstraction
----------------

### AuthModule interface (TypeScript, extended)

The existing `AuthModule` provides `getAccessToken()`. For internal auth, we add `getHeaders()`:

```ts
type AuthModule = {
  readonly getAccessToken: () => Promise<string>;
  readonly getHeaders: () => Promise<Readonly<Record<string, string>>>;
  // ... existing signIn/signOut/handleRedirectCallback
};
```

For OAuth2 auth, `getHeaders()` returns `{ Authorization: 'Bearer <token>' }`.
For internal auth, `getHeaders()` returns `{ 'X-Api-Key': '<key>', 'X-Workspace-Id': '<id>' }`.

### InternalAuth (new)

TypeScript (`ts/src/auth/internalAuth.ts`):
```ts
type InternalAuthParams = {
  readonly apiKey: string;
  readonly workspaceId: string;
};

const createInternalAuth = (params: InternalAuthParams): AuthModule => ({
  getAccessToken: async () => params.apiKey,
  getHeaders: async () => ({
    'X-Api-Key': params.apiKey,
    'X-Workspace-Id': params.workspaceId,
  }),
  signIn: async () => {},
  signOut: async () => {},
  handleRedirectCallback: async () => ({ isAuthenticated: true }),
});
```

Python (`py/src/diskd_sdk/internal_auth.py`):
```python
@dataclass(frozen=True)
class InternalAuth:
    api_key: str
    workspace_id: str

    def get_headers(self) -> Dict[str, str]:
        return {
            'X-Api-Key': self.api_key,
            'X-Workspace-Id': self.workspace_id,
        }
```

Field naming conventions
------------------------

| Context | Convention | Example |
|---------|-----------|---------|
| TypeScript types | camelCase | `routineSlug`, `sessionId` |
| Python types | snake_case | `routine_slug`, `session_id` |
| JSON wire format (REST) | camelCase | `{ "routineSlug": "..." }` |
| JSON wire format (JSON-RPC / Drive) | snake_case | `{ "parent_inode": "..." }` |

The SDK handles conversion:
- Python client serializes `snake_case` dataclass fields to `camelCase` JSON for REST endpoints.
- Python client keeps `snake_case` JSON for JSON-RPC endpoints (Drive).
- TypeScript client uses `camelCase` throughout (no conversion needed for REST).

Publishing and installation
---------------------------

### TypeScript (`@diskd/sdk`)

Registry: GitLab npm Package Registry (existing).
Install: `npm install @diskd/sdk --registry=https://gitlab.iosya.com/api/v4/projects/80/packages/npm/`
(or configure `.npmrc` with `@diskd:registry=...`).

CI trigger: version tag `v*.*.*` on push (existing pipeline, unchanged).

Package exports (extended):
```json
{
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./browser": { "types": "./dist/browser/index.d.ts", "default": "./dist/browser/index.js" },
  "./routines": { "types": "./dist/routines/index.d.ts", "default": "./dist/routines/index.js" }
}
```

### Python (`diskd-sdk`)

Registry: GitLab PyPI Package Registry.
Install: `pip install diskd-sdk --index-url https://gitlab.iosya.com/api/v4/projects/80/packages/pypi/simple`
(or configure `pip.conf` / `~/.config/pip/pip.conf`).

`pyproject.toml`:
```toml
[project]
name = "diskd-sdk"
version = "0.1.0"
description = "Python SDK for the DiskD platform"
requires-python = ">=3.11"
dependencies = ["httpx>=0.27,<1.0"]

[build-system]
requires = ["setuptools>=75.0"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]
```

CI trigger: version tag `v*.*.*` on push. The `.gitlab-ci.yml` gains a `publish:python` job:

```yaml
publish:python:
  stage: publish
  script:
    - cd py
    - pip install build twine
    - python -m build
    - twine upload --repository-url https://gitlab.iosya.com/api/v4/projects/${CI_PROJECT_ID}/packages/pypi dist/*
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+/
```

### Version alignment

Both packages share the same version number, bumped together. The version tag `v0.2.0` publishes `@diskd/sdk@0.2.0` (npm) and `diskd-sdk==0.2.0` (PyPI) in the same pipeline.

Migration path for drive/clients/python/
-----------------------------------------

The existing `drive/clients/python/` code moves into `platform-api/py/src/diskd_sdk/drive/`. The migration is mechanical:

1. Copy `drive/clients/python/sdk/*.py` into `platform-api/py/src/diskd_sdk/drive/`.
2. Update import paths (`from .drive_client import ...` -> `from .client import ...`).
3. Add `diskd-sdk` as a dependency in `drive/requirements.txt` (or `pyproject.toml`).
4. Update Drive crontab imports: `from drive.clients.python.sdk import DriveSDK` -> `from diskd_sdk import DiskdSDK`.
5. Keep a thin compatibility shim in `drive/clients/python/` that re-exports from `diskd_sdk` during the transition period.
6. Remove the shim after all Drive code migrates to direct `diskd_sdk` imports.

The `DriveSDK` class is renamed to `DiskdSDK` to reflect its expanded scope (Drive + Routines). The `DriveSDKConfig` fields fold into `DiskdSDK` constructor parameters.

Error handling
--------------

### Domain errors (Result-based)

SDK methods return typed `Result` values for all expected failure cases. The caller pattern-matches on success/failure:

TypeScript:
```ts
const response = await routines.execute(params);
if (response.ok) {
  // response.value: RoutineExecutionResult
} else {
  // response.error: RoutineExecutionError (tag + message)
}
```

Python:
```python
result = await sdk.routines.execute(params)
match result:
    case Ok(value):  # value: RoutineExecutionResult
    case Err(error): # error: RoutineExecutionError
```

### Transport errors (exceptions)

Connection failures, HTTP 5xx, and timeouts raise typed exceptions:

| Exception | When | Retryable? |
|-----------|------|------------|
| `TransportError` | Connection refused, DNS failure, HTTP 5xx | Yes |
| `TimeoutError` | Request exceeds configured timeout | Yes |
| `SdkError` | Unexpected HTTP 4xx, malformed response | No |

The SDK does NOT retry automatically. Retry logic belongs to the caller (e.g., Drive scheduler's 3-retry exponential backoff). This keeps the SDK simple and predictable.

### Validation errors

`ExecuteRoutineParams` fields are validated at construction time (TypeScript: Zod schema or runtime checks; Python: `__post_init__` on frozen dataclass). Invalid params raise immediately rather than producing a network call with a malformed body.

Future-proofing
---------------

- **New service clients**: adding a new service (e.g., `sdk.billing`, `sdk.agents`) follows the same pattern: define types in `routines/types.ts`, implement client, extend the `DiskD` factory. The polyglot structure scales to any number of services.
- **Code generation**: once contracts stabilize, an OpenAPI spec can be generated from the TypeScript types, and Python/TS clients auto-generated. The current hand-written clients are compatible with this future.
- **gRPC/Protobuf**: if the platform adopts gRPC, contract definitions move to `.proto` files and the SDK generates language-specific stubs. The facade pattern (`diskd.routines()`) stays the same.
- **Additional languages**: Rust, Go, or other SDK flavors can be added as new directories (`rs/`, `go/`) following the same contract-first approach.
- **Streaming**: when routine execution gains streaming (SSE/WebSocket), the `RoutinesClient` gains a `executeStreaming()` method returning an async iterator. The non-streaming `execute()` stays for backward compatibility.

Implementation outline
----------------------

**Phase 1: Repository restructure**
1. Move `platform-api/src/` to `platform-api/ts/src/`.
2. Update `package.json` paths, `tsconfig.json` paths, `.gitlab-ci.yml` build paths.
3. Verify existing TypeScript tests pass with the new layout.
4. Create `platform-api/py/` directory with `pyproject.toml`, `src/diskd_sdk/__init__.py`.

**Phase 2: Python SDK migration**
5. Copy `drive/clients/python/sdk/*.py` into `platform-api/py/src/diskd_sdk/drive/`.
6. Rename and adjust imports. Add `DiskdSDK` facade in `py/src/diskd_sdk/sdk.py`.
7. Add `InternalAuth` in `py/src/diskd_sdk/internal_auth.py`.
8. Port existing Drive Python SDK tests into `platform-api/py/tests/`.
9. Add compatibility shim in `drive/clients/python/` that re-exports from `diskd_sdk`.

**Phase 3: Routines contract types**
10. Define `ts/src/routines/types.ts` with all contract types.
11. Define `py/src/diskd_sdk/routines/types.py` mirroring the TypeScript types.
12. Export from both package entry points.

**Phase 4: Routines client implementations**
13. Implement `ts/src/routines/client.ts` (RoutinesClient, fetch-based).
14. Implement `py/src/diskd_sdk/routines/client.py` (RoutinesClient, httpx-based).
15. Extend `diskd` factory with `routines()` method (TypeScript).
16. Extend `DiskdSDK` facade with `routines` property (Python).
17. Add `createInternalAuth()` (TypeScript).

**Phase 5: CI and publishing**
18. Update `.gitlab-ci.yml`: add Python build, test, and publish jobs.
19. Add `publish:python` job targeting GitLab PyPI registry.
20. Update `publish` (TypeScript) job to build from `ts/` directory.
21. Verify both packages publish on version tag.

**Phase 6: Consumer integration**
22. Update `drive/requirements.txt` to add `diskd-sdk` dependency.
23. Update Drive crontab execution module to use `diskd_sdk.routines.RoutinesClient`.
24. Update app-service to import contract types from `@diskd/sdk/routines`.

Testing approach
----------------

### Unit tests (per language)

TypeScript (`ts/src/__tests__/`):
- `routines-types.test.ts`: type validation, serialization round-trip.
- `routines-client.test.ts`: mock fetch, verify request shape (URL, headers, body), verify response parsing for success and each error tag.
- `internal-auth.test.ts`: verify `getHeaders()` returns correct headers.

Python (`py/tests/`):
- `test_routines_types.py`: dataclass construction, validation, serialization (snake_case -> camelCase).
- `test_routines_client.py`: mock httpx, verify request shape, verify `Ok`/`Err` result mapping for each response variant.
- `test_internal_auth.py`: verify header construction.
- `test_drive_migration.py`: verify migrated Drive client methods produce identical requests to the original `drive/clients/python/` implementation.

### Integration tests

- TypeScript: `execute()` against a local app-service stub (httpbin-style mock returning canned responses).
- Python: same, using `pytest-httpx` for async HTTP mocking.

### Contract conformance

- A shared `fixtures/` directory contains JSON request/response fixtures. Both TypeScript and Python tests deserialize the same fixtures, ensuring the two implementations agree on the wire format.

Acceptance criteria
-------------------

- Given a `pyproject.toml` in `platform-api/py/`, when `pip install -e .` runs, then `import diskd_sdk` succeeds and `diskd_sdk.__version__` matches `pyproject.toml`.
- Given a version tag `v0.2.0` pushed to GitLab, when CI completes, then both `@diskd/sdk@0.2.0` (npm) and `diskd-sdk==0.2.0` (PyPI) are available in the GitLab package registry.
- Given `ExecuteRoutineParams` with valid fields, when `RoutinesClient.execute()` is called (TypeScript), then the HTTP request is `POST /api/internal/routines/execute` with `camelCase` JSON body and auth headers from `AuthModule.getHeaders()`.
- Given `ExecuteRoutineParams` with valid fields, when `RoutinesClient.execute()` is called (Python), then the HTTP request is `POST /api/internal/routines/execute` with `camelCase` JSON body and `X-Api-Key` + `X-Workspace-Id` headers from `InternalAuth`.
- Given app-service returns `{ "ok": true, "value": { ... } }`, when the Python client parses it, then the result is `Ok(RoutineExecutionResult(...))` with all fields correctly mapped from camelCase JSON to snake_case dataclass.
- Given app-service returns `{ "ok": false, "error": { "tag": "RoutineNotFound", "message": "..." } }`, when the Python client parses it, then the result is `Err(RoutineExecutionError(tag='RoutineNotFound', message='...'))`.
- Given a connection error (app-service unreachable), when `RoutinesClient.execute()` is called, then a `TransportError` exception is raised (not caught internally, caller handles retries).
- Given the Drive crontab scheduler uses `diskd_sdk.routines.RoutinesClient`, when it executes a routine job, the request matches the contract defined in `docs/routine-execution-design.md` section "Contract 1" exactly.
- Given `drive/clients/python/` is replaced by `diskd-sdk` dependency, when existing Drive SDK tests run, then all pass without modification (API-compatible migration).
- Given `diskd.routines({ version: 'v1', auth })` is called in TypeScript, then a `RoutinesClient` instance is returned with an `execute()` method.
- Given `createInternalAuth({ apiKey: 'key', workspaceId: 'ws' })` is called, then `getHeaders()` returns `{ 'X-Api-Key': 'key', 'X-Workspace-Id': 'ws' }` and `getAccessToken()` returns `'key'`.
- Given shared JSON fixtures in `fixtures/`, when both TypeScript and Python test suites deserialize them, then the resulting typed objects have identical field values (cross-language contract conformance).
