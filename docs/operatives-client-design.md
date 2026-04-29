@diskd-ai/sdk OperativesClient Design Doc
=======================================

Context and motivation
----------------------

The operatives CRUD API is implemented in app-service (`/api/operatives`). Operatives are project-scoped platform domain entities representing AI agents with configurable brain models, orders (system prompts), intel sources, and equipment (skills + MCP tools). Cross-service callers (crontab execution runtime, agent-hub, routine runners) need to look up and manage operatives without raw HTTP calls.

The `@diskd-ai/sdk` needs a corresponding `OperativesClient` so these callers can work through the canonical `diskd.platform.operatives(...)` namespace, following the pattern established by `routines`, `sessions`, and `crontab`.

Goals:
- Typed SDK client covering core operative CRUD (list, get, create, update, delete)
- Sub-resource management for intel and equipment
- Project-scoped access via `projectId` query param
- Consistent with the routines client pattern (REST, camelCase wire, same httpRequest helper)

Non-goals for first implementation (v1):
- `setPrimary` and `duplicate` commands (can be added later as needed)
- Workspace-level listing (operatives are always project-scoped)
- MCP registry enrichment for equipment (the client returns raw equipment; enrichment is a server concern)


Implementation considerations
------------------------------

Key constraints:

- The app-service REST API uses camelCase on the wire -- no snake_case conversion needed.
- Operatives are project-scoped: `projectId` is a required query param for list/create, and operativeId-based routes use guards that validate project ownership server-side.
- The app-service gateway routes `/api/*` on `app.*.upgraide.dev`, separate from `apis.*.upgraide.dev`. The SDK uses `resolveDiskdGatewayUrl('platform/app')` as the default base URL (same as routines).
- Auth follows the standard SDK dual-mode pattern: `getRequestHeaders()` for API key, `getAccessToken()` for Bearer token.
- Equipment is a discriminated union (`'skill' | 'mcp_tool'`) -- modeled as a sum type in the SDK types.
- Equipment list endpoint returns a wrapped response `{ registryStatus, items }` -- the client preserves this wrapper since `registryStatus` is operationally useful.

Design principles:

- Follow the routines client pattern exactly: `<module>Types.ts` (pure types) + `<module>.ts` (factory) + wired into `diskd.platform`.
- All type fields `readonly`.
- No `any`.
- Response unwrapping where the server wraps (single entities have no wrapper in the operatives API -- they are returned directly).


High-level behavior
-------------------

The client provides three sub-namespaces reflecting the API structure:

```ts
const ops = diskd.platform.operatives({ auth, url? });

// Core CRUD
ops.list({ projectId })                    // GET  /api/operatives?projectId=...
ops.get(operativeId)                       // GET  /api/operatives/:operativeId
ops.getBySlug({ projectId, slug })         // GET  /api/operatives/by-slug?projectId=...&slug=...
ops.create({ projectId, name, ... })       // POST /api/operatives
ops.update(operativeId, { name?, ... })    // PATCH /api/operatives/:operativeId
ops.delete(operativeId)                    // DELETE /api/operatives/:operativeId

// Intel sub-resource
ops.intel.list(operativeId)                // GET    /api/operatives/:id/intel
ops.intel.add(operativeId, { sourceId })   // POST   /api/operatives/:id/intel
ops.intel.remove(operativeId, linkId)      // DELETE  /api/operatives/:id/intel/:linkId

// Equipment sub-resource
ops.equipment.list(operativeId)            // GET    /api/operatives/:id/equipment
ops.equipment.add(operativeId, input)      // POST   /api/operatives/:id/equipment
ops.equipment.remove(operativeId, linkId)  // DELETE  /api/operatives/:id/equipment/:linkId
```


API design
----------

### Response shapes (app-service)

| Endpoint | Response shape |
|----------|----------------|
| GET /api/operatives | `OperativeDto[]` (plain array) |
| POST /api/operatives | `OperativeDto` (direct) |
| GET /api/operatives/:id | `OperativeDto` (direct) |
| GET /api/operatives/by-slug | `OperativeDto` (direct) |
| PATCH /api/operatives/:id | `OperativeDto` (direct) |
| DELETE /api/operatives/:id | 204 No Content |
| GET .../intel | `OperativeIntelDto[]` (plain array) |
| POST .../intel | `OperativeIntelDto` (direct) |
| DELETE .../intel/:linkId | 204 No Content |
| GET .../equipment | `{ registryStatus, items }` (wrapped) |
| POST .../equipment | `OperativeEquipmentDto` (direct) |
| DELETE .../equipment/:linkId | 204 No Content |

Unlike routines (which wrap single entities in `{ routine: ... }`), operatives return entities directly. The SDK client passes them through without unwrapping.

### SDK domain types

```ts
type OperativeBrainMode = 'quick' | 'deep';
type OperativeIntelAccess = 'all' | 'selected';
type OperativeStatus = 'active' | 'standby';
type OperativeTrustLevel = 0 | 1 | 2 | 3;

type Operative = {
  readonly id: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly avatarUrl?: string;
  readonly brainProvider?: string;
  readonly brainModel?: string;
  readonly brainMode: OperativeBrainMode;
  readonly orders: string;
  readonly ordersUpdatedAt?: string;
  readonly intelAccess: OperativeIntelAccess;
  readonly trustLevel: OperativeTrustLevel;
  readonly isPrimary: boolean;
  readonly status: OperativeStatus;
  readonly sealGradient?: readonly [string, string];
  readonly createdBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type OperativeIntel = {
  readonly id: string;
  readonly operativeId: string;
  readonly sourceId: string;
  readonly createdAt: string;
};

// Equipment -- discriminated union
type OperativeSkillEquipment = {
  readonly id: string;
  readonly operativeId: string;
  readonly equipmentType: 'skill';
  readonly refId: string;
  readonly createdAt: string;
};

type OperativeMcpToolEquipment = {
  readonly id: string;
  readonly operativeId: string;
  readonly equipmentType: 'mcp_tool';
  readonly selector: string;
  readonly display?: {
    readonly serverName: string;
    readonly toolName: string;
  };
  readonly resolutionStatus?: 'valid' | 'disabled_globally' | 'unknown';
  readonly createdAt: string;
};

type OperativeEquipment = OperativeSkillEquipment | OperativeMcpToolEquipment;

type EquipmentListResult = {
  readonly registryStatus: 'ok' | 'unavailable';
  readonly items: readonly OperativeEquipment[];
};
```

### Params types

```ts
type OperativeListParams = {
  readonly projectId: string;
};

type OperativeGetBySlugParams = {
  readonly projectId: string;
  readonly slug: string;
};

type OperativeCreateParams = {
  readonly projectId: string;
  readonly name: string;
  readonly slug?: string;
  readonly orders?: string;
  readonly brainProvider?: string;
  readonly brainModel?: string;
  readonly brainMode?: OperativeBrainMode;
};

type OperativeUpdateParams = {
  readonly name?: string;
  readonly slug?: string;
  readonly avatarUrl?: string;
  readonly brainProvider?: string;
  readonly brainModel?: string;
  readonly brainMode?: OperativeBrainMode;
  readonly orders?: string;
  readonly ordersUpdatedAt?: string;
  readonly intelAccess?: OperativeIntelAccess;
  readonly trustLevel?: OperativeTrustLevel;
  readonly status?: OperativeStatus;
  readonly sealGradient?: readonly [string, string];
};

type OperativeAddIntelParams = {
  readonly sourceId: string;
};

type OperativeAddEquipmentParams =
  | { readonly equipmentType: 'skill'; readonly refId: string }
  | { readonly equipmentType: 'mcp_tool'; readonly selector: string };
```

### Client interface

```ts
type OperativesClient = {
  readonly list: (params: OperativeListParams) => Promise<readonly Operative[]>;
  readonly get: (operativeId: string) => Promise<Operative>;
  readonly getBySlug: (params: OperativeGetBySlugParams) => Promise<Operative>;
  readonly create: (params: OperativeCreateParams) => Promise<Operative>;
  readonly update: (operativeId: string, params: OperativeUpdateParams) => Promise<Operative>;
  readonly delete: (operativeId: string) => Promise<void>;

  readonly intel: {
    readonly list: (operativeId: string) => Promise<readonly OperativeIntel[]>;
    readonly add: (operativeId: string, params: OperativeAddIntelParams) => Promise<OperativeIntel>;
    readonly remove: (operativeId: string, linkId: string) => Promise<void>;
  };

  readonly equipment: {
    readonly list: (operativeId: string) => Promise<EquipmentListResult>;
    readonly add: (operativeId: string, params: OperativeAddEquipmentParams) => Promise<OperativeEquipment>;
    readonly remove: (operativeId: string, linkId: string) => Promise<void>;
  };
};
```


Error handling and UX
---------------------

Follows the same pattern as the routines client:

- HTTP errors throw `Error` with message `Operatives request failed (${status}): ${message}`.
- The error body is parsed to extract `message` or `error.message` fields.
- 204 responses return `undefined` (cast to `void` for delete operations).
- No retry logic -- callers handle retries at higher layers.

Error categories:
- 400 Bad Request: invalid input (e.g., missing projectId, duplicate slug)
- 404 Not Found: operative/intel/equipment link not found
- 403 Forbidden: project does not belong to user's workspace


Future-proofing
---------------

- `setPrimary(operativeId)` and `duplicate(operativeId)` can be added as top-level methods without breaking the existing interface.
- If the API adds pagination to list endpoints, `OperativeListParams` can be extended with `page`/`limit` fields and the return type can be widened to a result wrapper while maintaining backward compatibility via overloads.
- Equipment types may grow (e.g., `'datasource'`, `'workflow'`) -- the discriminated union pattern supports additive variants.


Implementation outline
----------------------

### Phase 1: Types (src/operatives/operativesTypes.ts)

1. Define union types: `OperativeBrainMode`, `OperativeIntelAccess`, `OperativeStatus`, `OperativeTrustLevel`
2. Define domain models: `Operative`, `OperativeIntel`, `OperativeSkillEquipment`, `OperativeMcpToolEquipment`, `OperativeEquipment`, `EquipmentListResult`
3. Define param types: `OperativeListParams`, `OperativeGetBySlugParams`, `OperativeCreateParams`, `OperativeUpdateParams`, `OperativeAddIntelParams`, `OperativeAddEquipmentParams`
4. Define `OperativesClient` interface with `intel` and `equipment` sub-namespaces

### Phase 2: Client factory (src/operatives/operatives.ts)

1. Copy the routines client structure (httpRequest, getAuthHeaders, request helper)
2. Implement core CRUD methods mapping to `/api/operatives` endpoints
3. Implement `intel` sub-namespace (list, add, remove) mapping to `/api/operatives/:id/intel`
4. Implement `equipment` sub-namespace (list, add, remove) mapping to `/api/operatives/:id/equipment`
5. Query param builder for `projectId` and `slug` on list/getBySlug endpoints

### Phase 3: SDK wiring

1. Add `OperativesClient` import to `src/sdk/types.ts`
2. Add `operatives` to `DiskD.platform` type definition
3. Add `createOperativesClient` import and wiring to `src/sdk/diskd.ts`
4. Add exports to `src/index.ts`

### Phase 4: Unit tests (src/__tests__/operativesClient.test.ts)

1. Test list with projectId query param
2. Test get by operativeId
3. Test getBySlug with projectId + slug query params
4. Test create with body
5. Test update with operativeId and body
6. Test delete (204 response)
7. Test intel.list, intel.add, intel.remove
8. Test equipment.list (verify wrapped response preserved)
9. Test equipment.add with both skill and mcp_tool variants
10. Test equipment.remove
11. Test error handling (HTTP error parsing)
12. Test gateway URL default


Testing approach
----------------

Unit tests:
- Mock `globalThis.fetch` following the `withFetchMock` pattern from `routinesClient.test.ts`
- Verify URL construction, HTTP methods, auth headers, request bodies, and response unwrapping for all methods
- Test both sub-namespaces (intel, equipment)
- Test equipment discriminated union serialization
- Test error handling path

No integration tests needed for v1 -- the client is a thin HTTP adapter; integration testing happens at the app-service level.


Acceptance criteria
-------------------

- Given a valid auth and projectId, when `operatives.list({ projectId })` is called, then it sends `GET /api/operatives?projectId=<id>` with auth headers and returns the response array directly.
- Given a valid operativeId, when `operatives.get(id)` is called, then it sends `GET /api/operatives/<id>` and returns the operative directly.
- Given a valid projectId and slug, when `operatives.getBySlug({ projectId, slug })` is called, then it sends `GET /api/operatives/by-slug?projectId=<id>&slug=<slug>` and returns the operative.
- Given create params with projectId and name, when `operatives.create(params)` is called, then it sends `POST /api/operatives` with the params as JSON body and returns the created operative.
- Given an operativeId and update params, when `operatives.update(id, params)` is called, then it sends `PATCH /api/operatives/<id>` with the params as JSON body and returns the updated operative.
- Given an operativeId, when `operatives.delete(id)` is called, then it sends `DELETE /api/operatives/<id>` and returns void.
- Given an operativeId, when `operatives.intel.list(id)` is called, then it sends `GET /api/operatives/<id>/intel` and returns the intel array.
- Given an operativeId and sourceId, when `operatives.intel.add(id, { sourceId })` is called, then it sends `POST /api/operatives/<id>/intel` and returns the created intel link.
- Given an operativeId and linkId, when `operatives.intel.remove(id, linkId)` is called, then it sends `DELETE /api/operatives/<id>/intel/<linkId>` and returns void.
- Given an operativeId, when `operatives.equipment.list(id)` is called, then it sends `GET /api/operatives/<id>/equipment` and returns `{ registryStatus, items }` directly.
- Given equipment add params with `equipmentType: 'skill'`, when `operatives.equipment.add(id, params)` is called, then it sends `POST /api/operatives/<id>/equipment` with the discriminated body.
- Given equipment add params with `equipmentType: 'mcp_tool'`, when `operatives.equipment.add(id, params)` is called, then it sends `POST /api/operatives/<id>/equipment` with the `selector` field.
- Given an operativeId and linkId, when `operatives.equipment.remove(id, linkId)` is called, then it sends `DELETE /api/operatives/<id>/equipment/<linkId>` and returns void.
- Given a server error response, when any method is called, then it throws an Error containing the status code and parsed error message.
- Given no `url` override, when any method is called, then URLs are prefixed with `resolveDiskdGatewayUrl('platform/app')`.
- `diskd.platform.operatives({ auth })` returns an `OperativesClient` with all methods accessible.
- All types are exported from `src/index.ts`.
- `npm run typecheck` passes.
- `npm test` passes including the new operatives tests.


Files to create
---------------

| File | What |
|------|------|
| `src/operatives/operativesTypes.ts` | Pure domain types + client interface |
| `src/operatives/operatives.ts` | `createOperativesClient` factory |
| `src/__tests__/operativesClient.test.ts` | Unit tests |


Files to modify
---------------

| File | Change |
|------|--------|
| `src/sdk/types.ts` | Import `OperativesClient`, add `operatives` to `DiskD.platform` |
| `src/sdk/diskd.ts` | Import `createOperativesClient`, add wiring |
| `src/index.ts` | Add exports for operatives module |
