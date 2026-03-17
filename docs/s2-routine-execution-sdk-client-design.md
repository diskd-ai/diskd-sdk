S2: Routine Execution SDK Client Design Doc
=============================================

Context and motivation
----------------------

Routine execution is currently internal-only: the Drive crontab scheduler calls `POST /api/internal/routines/execute` with an `X-Api-Key` header, guarded by `InternalRouteGuard`. Execution history is persisted in the `routine_execution_runs` table, but there is no public REST API to query it and no SDK method to trigger or inspect runs.

External consumers (SDK scripts, frontend dashboards, monitoring tools) need to list execution history, check run status, and eventually trigger runs programmatically. This is gap **S2** from `docs/acceptance/email-to-project-pipeline-gaps-v3.md`.

Goals:
- Public REST endpoints in app-service for querying routine execution runs (`GET /api/routines/:routineSlug/executions`, `GET /api/routines/:routineSlug/executions/:executionId`)
- Typed SDK client `diskd.platform.routineRuns({ auth })` returning a `RoutineRunsClient`
- Consistent with the `routinesClient` / `operativesClient` patterns (same httpRequest helper, same auth model, same type conventions)

Non-goals for first implementation (v1):
- Programmatic trigger via SDK (execute is internal-only with API key guard; exposing it publicly requires separate security review)
- Pagination (list returns all runs for a routine; can be added later with `limit`/`offset` or cursor)
- Filtering by status or date range (can be added as optional query params later)
- WebSocket/SSE for live run status updates
- Cancel/abort a running execution


Implementation considerations
------------------------------

Key constraints:

- The `routine_execution_runs` table already exists (migration `1774000000000-AddRoutineExecutionRuns`). No DB migration needed.
- The entity uses `workspaceId` for access control. The public endpoints must verify that the requesting user's `workspaceId` matches the run's `workspaceId`. Since routines are workspace-scoped, this is enforced by filtering queries with `workspaceId`.
- The entity stores `routineSlug` (indexed), so listing by routine slug is efficient.
- Dates on the entity are TypeORM `Date` objects. The REST API serializes them as ISO 8601 strings.
- The entity stores nullable fields (`sessionId`, `summary`, `errorTag`, `errorMessage`, `durationMs`, `completedAt`). The SDK types use `string | null` and `number | null` to match.
- The app-service REST API uses camelCase -- no wire conversion needed in the SDK.

Design principles:

- Follow the routines client pattern exactly: `<module>Types.ts` (pure types) + `<module>.ts` (factory) + wired into `diskd.platform`.
- All type fields `readonly`.
- No `any`.
- The public controller reuses the existing `RoutineExecutionRun` entity and `runRepo`. No new service class needed for v1 (the controller queries the repository directly or via a thin read-only service method).
- The new controller is registered in `RoutinesModule` alongside the existing `RoutinesController` and `RoutineExecutionController`.


High-level behavior
-------------------

### App-service: public execution runs API

```
GET  /api/routines/:routineSlug/executions
  -> { items: RoutineRunDto[] }
  Query params: scope? (profile | project), projectName?

GET  /api/routines/:routineSlug/executions/:executionId
  -> { run: RoutineRunDto }
```

Both endpoints use standard auth (`@RequestUser()` decorator), not `InternalRouteGuard`. Access control: `workspaceId` from auth token is used to filter runs.

### SDK client

```ts
const runs = diskd.platform.routineRuns({ auth, url? });

// List runs for a routine
const list = await runs.list({
  routineSlug: 'intake-sorter',
  scope: 'project',
  projectName: 'OrgName',
});

// Get a single run by execution ID
const run = await runs.get({
  routineSlug: 'intake-sorter',
  executionId: '01JFXYZ...',
});
```


API design
----------

### App-service endpoints

| Endpoint | Method | Auth | Response |
|----------|--------|------|----------|
| `/api/routines/:routineSlug/executions` | GET | Standard (Bearer / session) | `{ items: RoutineRunDto[] }` |
| `/api/routines/:routineSlug/executions/:executionId` | GET | Standard (Bearer / session) | `{ run: RoutineRunDto }` |

Query params for list:
- `scope` (optional): `'workspace'` or `'project'` (default: no filter by scope)
- `projectName` (optional): filter by project name (only relevant when scope is `'project'`)

### RoutineRunDto (app-service response)

Serialized from `RoutineExecutionRun` entity:

```ts
{
  id: string;             // ULID (executionId)
  runId: string;          // idempotency key
  routineSlug: string;
  projectSlug: string;
  operativeSlug: string;
  sessionId: string | null;
  status: 'running' | 'completed' | 'failed';
  summary: string | null;
  errorTag: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;      // ISO 8601
  completedAt: string | null; // ISO 8601
}
```

`workspaceId` is NOT included in the response (it is the auth context, not a domain field for external consumers).

### SDK domain types

```ts
type RoutineRunStatus = 'running' | 'completed' | 'failed';

type RoutineRunErrorTag =
  | 'RoutineNotFound'
  | 'RoutineNotActive'
  | 'ProjectNotFound'
  | 'ProjectNotOwned'
  | 'OperativeNotFound'
  | 'ExecutionFailed'
  | 'AlreadyRunning';

type RoutineRun = {
  readonly id: string;
  readonly runId: string;
  readonly routineSlug: string;
  readonly projectSlug: string;
  readonly operativeSlug: string;
  readonly sessionId: string | null;
  readonly status: RoutineRunStatus;
  readonly summary: string | null;
  readonly errorTag: RoutineRunErrorTag | null;
  readonly errorMessage: string | null;
  readonly durationMs: number | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
};
```

### Params types

```ts
type RoutineRunListParams = {
  readonly routineSlug: string;
  readonly scope?: 'workspace' | 'project';
  readonly projectName?: string;
};

type RoutineRunGetParams = {
  readonly routineSlug: string;
  readonly executionId: string;
};
```

### Client interface

```ts
/**
 * Routine execution runs REST client.
 *
 * Obtain via `diskd.platform.routineRuns({ auth })`.
 * Maps to the app-service `/api/routines/:slug/executions` endpoints.
 */
type RoutineRunsClient = {
  /** GET /api/routines/:slug/executions -- list execution runs for a routine. */
  readonly list: (params: RoutineRunListParams) => Promise<readonly RoutineRun[]>;
  /** GET /api/routines/:slug/executions/:executionId -- get a single run. */
  readonly get: (params: RoutineRunGetParams) => Promise<RoutineRun>;
};
```


Error handling and UX
---------------------

Follows the same pattern as the routines client:

- HTTP errors throw `Error` with message `RoutineRuns request failed (${status}): ${message}`.
- The error body is parsed to extract `message` or `error.message` fields.
- No retry logic -- callers handle retries at higher layers.

Error categories (app-service):
- 404 Not Found: routine slug not found, or execution ID not found (within the workspace scope)
- 401/403: invalid auth or workspace mismatch (standard auth middleware)

The app-service controller does NOT expose `500` details -- internal errors return a generic message.


Future-proofing
---------------

- **Pagination**: `RoutineRunListParams` can be extended with `limit`/`offset` or `cursor` fields. The return type can be widened to `{ items, nextCursor? }` without breaking existing callers (via overloads or a result wrapper).
- **Status filter**: `RoutineRunListParams` can add `status?: RoutineRunStatus` for filtering.
- **Date range**: `createdAfter` / `createdBefore` params can narrow listing.
- **Trigger via SDK**: When security review permits exposing `execute` publicly, `RoutineRunsClient` can add a `trigger(params)` method. This requires a separate design doc for auth and rate-limiting decisions.
- **Live status**: WebSocket or SSE for run-in-progress updates can be added as a separate `subscribe(params)` method returning an async iterable.


Implementation outline
----------------------

### Phase 1: App-service -- public controller

1. Create `routine-execution-runs.controller.ts` in `app-service/app-service/src/routines/`
2. Controller uses `@Controller('routines')` prefix (shares prefix with `RoutinesController`)
3. Add `GET :routineSlug/executions` endpoint:
   - `@RequestUser()` for auth (gets `workspaceId`)
   - Parse query params with Zod (scope?, projectName?)
   - Query `runRepo.find({ where: { workspaceId, routineSlug }, order: { createdAt: 'DESC' } })`
   - Serialize entity to DTO (strip `workspaceId`, format dates)
4. Add `GET :routineSlug/executions/:executionId` endpoint:
   - Query `runRepo.findOne({ where: { id: executionId, workspaceId, routineSlug } })`
   - Return 404 if not found
5. Register controller in `routines.module.ts`

### Phase 2: SDK types (src/routineRuns/routineRunsTypes.ts)

1. Define `RoutineRunStatus`, `RoutineRunErrorTag` union types
2. Define `RoutineRun` domain model
3. Define `RoutineRunListParams`, `RoutineRunGetParams` param types
4. Define `RoutineRunsClient` interface

### Phase 3: SDK client factory (src/routineRuns/routineRuns.ts)

1. Copy routines client structure (httpRequest, resolveAuthHeaders, request helper)
2. Implement `list`: `GET /api/routines/${slug}/executions${query}`
3. Implement `get`: `GET /api/routines/${slug}/executions/${executionId}`
4. Default URL: `resolveDiskdGatewayUrl('platform/routineRuns')`

### Phase 4: SDK wiring

1. `sdk/types.ts`: Import `RoutineRunsClient`, add `routineRuns` to `DiskD.platform`
2. `sdk/diskd.ts`: Import `createRoutineRunsClient`, wire into `platform.routineRuns`
3. `src/index.ts`: Export types and factory

### Phase 5: Tests

1. App-service: unit test for the new controller (query building, workspace scoping, 404 handling)
2. SDK: unit test for `routineRunsClient` (URL construction, auth headers, response unwrapping)


Testing approach
----------------

App-service unit tests:
- Test that `GET /api/routines/:slug/executions` returns runs filtered by workspaceId and routineSlug
- Test that runs from other workspaces are not returned
- Test `GET /api/routines/:slug/executions/:executionId` returns a single run
- Test 404 when executionId does not exist or belongs to another workspace
- Test query param parsing (scope, projectName)

SDK unit tests:
- Mock `globalThis.fetch` following the pattern from existing tests
- Verify URL construction for both `list` and `get`
- Verify scope/projectName query params are appended correctly
- Verify auth headers are sent
- Verify response unwrapping (`{ items }` for list, `{ run }` for get)
- Test error handling (HTTP error parsing)
- Test gateway URL default

No integration tests needed for v1 -- the SDK client is a thin HTTP adapter.


Acceptance criteria
-------------------

App-service:
- Given a valid auth token, when `GET /api/routines/intake-sorter/executions` is called, then it returns `{ items: [...] }` containing only runs belonging to the caller's workspace with `routineSlug = 'intake-sorter'`, ordered by `createdAt` descending.
- Given a valid auth token and executionId, when `GET /api/routines/intake-sorter/executions/01JFXYZ` is called and the run exists in the caller's workspace, then it returns `{ run: { ... } }` with all fields serialized.
- Given an executionId that does not exist or belongs to another workspace, when `GET .../executions/:executionId` is called, then it returns HTTP 404.
- The response DTO does NOT include `workspaceId`.
- The endpoints use standard auth (not `InternalRouteGuard`).

SDK:
- Given a valid auth, when `routineRuns.list({ routineSlug: 'x' })` is called, then it sends `GET /api/routines/x/executions` with auth headers and returns the items array.
- Given scope and projectName params, when `routineRuns.list({ routineSlug: 'x', scope: 'project', projectName: 'Org' })` is called, then it appends `?scope=project&projectName=Org` to the URL.
- Given a valid auth and executionId, when `routineRuns.get({ routineSlug: 'x', executionId: '01J...' })` is called, then it sends `GET /api/routines/x/executions/01J...` and returns the run object.
- Given a server error response, when any method is called, then it throws an Error containing the status code and parsed error message.
- Given no `url` override, when any method is called, then URLs are prefixed with `resolveDiskdGatewayUrl('platform/routineRuns')`.
- `diskd.platform.routineRuns({ auth })` returns a `RoutineRunsClient` with `list` and `get` methods.
- All types are exported from `src/index.ts`.
- `bun run typecheck` passes.
- `bun test` passes including the new routineRuns tests.


Files to create
---------------

| File | Repo | What |
|------|------|------|
| `app-service/src/routines/routine-execution-runs.controller.ts` | app-service | Public REST controller for execution runs |
| `src/routineRuns/routineRunsTypes.ts` | platform-api | Pure domain types + client interface |
| `src/routineRuns/routineRuns.ts` | platform-api | `createRoutineRunsClient` factory |
| `src/__tests__/routineRunsClient.test.ts` | platform-api | SDK unit tests |


Files to modify
---------------

| File | Repo | Change |
|------|------|--------|
| `app-service/src/routines/routines.module.ts` | app-service | Register `RoutineExecutionRunsController` |
| `src/sdk/types.ts` | platform-api | Import `RoutineRunsClient`, add `routineRuns` to `DiskD.platform` |
| `src/sdk/diskd.ts` | platform-api | Import `createRoutineRunsClient`, wire into `platform.routineRuns` |
| `src/index.ts` | platform-api | Export routineRuns types and factory |


Cross-boundary dependencies
----------------------------

```
platform-api SDK                       app-service REST
  routineRunsTypes.ts   <---matches-->   RoutineRunDto (response shape)
  routineRuns.ts        ----HTTP GET-->  routine-execution-runs.controller.ts
                                           |
                                           v
                                         RoutineExecutionRun entity (existing, no changes)
                                           |
                                           v
                                         routine_execution_runs table (existing, no migration)
```

The SDK types are a read-only projection of the entity. The app-service controller is the source of truth for field serialization.
