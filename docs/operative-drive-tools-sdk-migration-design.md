Operative Drive Tools -- Migration to @diskd-ai/sdk Design Doc
============================================================

Context and motivation
----------------------

Operative drive tools in `agent-service` use a self-contained JSON-RPC transport
layer (`createDriveAdapters()` in `@sdk/drive/driveAdapter.ts`) that duplicates
what `@diskd-ai/sdk` already provides through `DriveClient`.

Calendar tools were migrated to `@diskd-ai/sdk` previously (`calendarAdapter.ts`
uses `diskd.auth.apiKey -> diskd.platform.calendar`). Drive tools remain on the
custom adapters, creating two parallel RPC layers for the same backend.

Additionally, `DriveClient.tools` returns a single generic type
`DriveToolsResult { items: Record<string, unknown>[] }` for `ls`, `glob`,
`grep`, and `vsearch`. This violates the project coding conventions:

- "Do not use `Record` type to represent domain objects" (CLAUDE.md)
- "Model domain with ADTs" -- each tool returns a structurally different response
- `readFile` and `writeFile` already have dedicated typed results, but query
  tools do not -- an inconsistency within the SDK itself

This migration addresses both issues: eliminate the custom adapter layer and
type the SDK tools properly.

Goals:
- Type each `DriveClient.tools.*` method with a specific result type instead of
  generic `DriveToolsResult`
- Add missing tools to `DriveClient`: `biQuery`, `inodesQuery`, `tgSearch`,
  `excelWrite`
- Migrate `agent-service` operative drive tools from `createDriveAdapters()` to
  `@diskd-ai/sdk` `DriveClient`
- Remove `DriveQueryAdapter`, `DriveOpsAdapter`, and `createDriveAdapters()`
  from `agent-service` internal SDK

Non-goals for first implementation (v1):
- Migrating `TelegramAgent` and `ResearchAgent` (they use old
  `DriveToolsAPIClient` via `GradientSdk.getService('drive-tools')` -- separate
  task)
- Migrating 8 read-only tools in `packages/tools/src/drive/` (they also depend
  on `DriveToolsAPIClient` -- can be done after, since `BuiltInDriveToolClient`
  passes `ChrootedDriveToolsApi` to them via duck typing anyway)
- Removing `DriveToolsAPIClient` or `GradientSdk` (still used by other agents)
- Changing the Drive backend RPC methods (all methods already exist)


Implementation considerations
------------------------------

Key constraints:

- `@diskd-ai/sdk` uses JSON-RPC 2.0 via `jsonRpcCall()` with the same wire format
  as the custom adapters -- no backend changes needed.
- The `diskd` namespace convention requires wiring through `diskd.os.drive()`,
  not standalone factory functions.
- `DriveClient` is a plain object type (not a class), following the SDK pattern.
- Auth is handled via `AuthModule` (API key mode: `X-Api-Key` + `X-User-Id` +
  `X-Organization-Id` headers).
- The custom `DriveOpsAdapter.resolveInodes()` sends `{ inodes: string[] }` to
  `drive/paths/resolve`, while SDK `resolve()` sends `{ paths: string[] }`. The
  backend accepts both -- verified by checking that `drive/paths/resolve` is a
  path-or-inode resolver.

Design decisions:

- Each tools method gets its own result type. The generic `DriveToolsResult` is
  kept but deprecated -- existing callers that use it continue to compile.
- New result types follow the naming pattern `DriveTools<Op>Result`:
  `DriveToolsLsResult`, `DriveToolsGrepResult`, etc.
- `tools.ls` and `tools.glob` return typed `DrivePathEntry[]` (same decoder
  already exists in `drive.ts` as `decodePathEntry`).
- `tools.grep` and `tools.vsearch` return `DriveToolsDocumentResult` with typed
  documents (matching the `JsonDocWithId` / `Part` shapes from the wire format).
- Error results within document arrays (items with `error` field) are filtered
  out at the SDK level, matching current adapter behavior.


High-level behavior
-------------------

After migration, the operative drive tools initialization in `UpgraideAgent`
changes from:

```ts
// Before: custom adapters
import { createDriveAdapters } from '@sdk/drive/driveAdapter';
const adapters = createDriveAdapters({ orgId, userId, apiKey, baseUrl });
new BuiltInDriveToolClient({
  queryAdapter: adapters.query,
  opsAdapter: adapters.ops,
  pathAccess,
});
```

to:

```ts
// After: @diskd-ai/sdk
import { diskd } from '@diskd-ai/sdk';
const auth = diskd.auth.apiKey({ apiKey, workspaceId: orgId, orgId });
const drive = diskd.os.drive({ version: 'v1', auth, url: baseUrl });
new BuiltInDriveToolClient({ drive, pathAccess });
```

The `ChrootedDriveToolsApi` wraps `DriveClient` instead of `DriveQueryAdapter`,
calling `drive.tools.ls()`, `drive.tools.grep()`, etc. with chroot path
resolution applied before each call.

Write tools (`tool-write`, `tool-mkdir`, `tool-scaffold`, `tool-excel-write`)
call `drive.tools.writeFile()`, `drive.create()`, `drive.tools.excelWrite()`
directly via the same `DriveClient` instance.


SDK type changes (platform-api)
-------------------------------

### New result types in `driveTypes.ts`

```ts
// tools.ls / tools.glob -- return path entries
type DriveToolsLsResult = {
  readonly entries: readonly DrivePathEntry[];
};

type DriveToolsGlobResult = {
  readonly entries: readonly DrivePathEntry[];
};

// tools.grep / tools.vsearch -- return documents with parts
type DriveToolsDocumentPart = {
  readonly type: string;
  readonly title: string | null;
  readonly content: string;
  readonly pageNumber: number | null;
  readonly originUrl: string | null;
  readonly author: string | null;
  readonly timestamp: number | null;
};

type DriveToolsDocument = {
  readonly id: string;
  readonly parts: readonly DriveToolsDocumentPart[];
};

type DriveToolsGrepResult = {
  readonly documents: readonly DriveToolsDocument[];
};

type DriveToolsVsearchResult = {
  readonly documents: readonly DriveToolsDocument[];
};

// tools.biQuery -- return tables keyed by path/inode
type DriveToolsTableData = {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number | boolean | null)[])[];
};

type DriveToolsBiQueryResult = {
  readonly tables: Readonly<Record<string, DriveToolsTableData>>;
};

// tools.inodesQuery -- return documents + tables
type DriveToolsInodesQueryParams = {
  readonly query: string;
  readonly paths: readonly string[];
  readonly dateStart?: string;
  readonly dateEnd?: string;
  readonly orderBy?: string;
  readonly limit?: number;
  readonly offset?: number;
};

type DriveToolsInodesQueryResult = {
  readonly documents: readonly DriveToolsDocument[];
  readonly tables: Readonly<Record<string, DriveToolsTableData>>;
};

// tools.tgSearch
type DriveToolsTgMessage = {
  readonly messageId: number;
  readonly text: string;
  readonly senderName: string;
  readonly date: string;
  readonly timestamp: number;
  readonly replyToMessageId: number | null;
  readonly isForward: boolean;
  readonly views: number | null;
  readonly channelUsername: string | null;
  readonly originUrl: string | null;
};

type DriveToolsTgSearchParams = {
  readonly databasePath: string;
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly dateStart?: string;
  readonly dateEnd?: string;
  readonly orderBy?: 'relevance' | 'date_desc' | 'date_asc';
};

type DriveToolsTgSearchResult = {
  readonly messages: readonly {
    readonly message: DriveToolsTgMessage;
    readonly score: number | null;
    readonly replyContext: DriveToolsTgMessage | null;
  }[];
  readonly totalFound: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
};

// tools.excelWrite
type DriveToolsExcelWriteParams = {
  readonly path: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number | boolean | null)[])[];
  readonly sheetName?: string;
};
```

### Updated `DriveClient.tools` in `types.ts`

```ts
readonly tools: {
  readonly ls: (params?: DriveToolsLsParams) => Promise<DriveToolsLsResult>;
  readonly glob: (params: DriveToolsGlobParams) => Promise<DriveToolsGlobResult>;
  readonly grep: (params: DriveToolsGrepParams) => Promise<DriveToolsGrepResult>;
  readonly vsearch: (params: DriveToolsVsearchParams) => Promise<DriveToolsVsearchResult>;
  readonly readFile: (params: DriveToolsReadFileParams) => Promise<DriveReadFileResult>;
  readonly writeFile: (params: DriveToolsWriteFileParams) => Promise<DriveToolsWriteResult>;
  readonly applyPatch: (params: DriveToolsApplyPatchParams) => Promise<DriveToolsWriteResult>;
  readonly biQuery: (params: DriveToolsBiQueryParams) => Promise<DriveToolsBiQueryResult>;
  readonly inodesQuery: (params: DriveToolsInodesQueryParams) => Promise<DriveToolsInodesQueryResult>;
  readonly tgSearch: (params: DriveToolsTgSearchParams) => Promise<DriveToolsTgSearchResult>;
  readonly excelWrite: (params: DriveToolsExcelWriteParams) => Promise<DriveToolsWriteResult>;
};
```

Note: `DriveToolsResult` stays exported for backward compatibility but is no
longer returned by any tools method.


agent-service changes
---------------------

### New: `operativeDrive/driveAdapter.ts`

Thin factory (same pattern as `calendarAdapter.ts`):

```ts
import { diskd, type DriveClient } from '@diskd-ai/sdk';

interface OperativeDriveConfig {
  readonly apiKey: string;
  readonly userId: string;
  readonly orgId: string;
  readonly baseUrl: string;
}

const createOperativeDriveClient = (config: OperativeDriveConfig): DriveClient => {
  const auth = diskd.auth.apiKey({
    apiKey: config.apiKey,
    workspaceId: config.orgId,
    orgId: config.orgId,
  });
  return diskd.os.drive({ version: 'v1', auth, url: config.baseUrl });
};
```

### Updated: `BuiltInDriveToolClient`

```ts
// Before
interface BuiltInDriveToolClientInit {
  readonly queryAdapter: DriveQueryAdapter;
  readonly opsAdapter: DriveOpsAdapter;
  readonly pathAccess: OperativeDrivePathAccess;
  readonly enabledTools?: readonly string[];
}

// After
interface BuiltInDriveToolClientInit {
  readonly drive: DriveClient;
  readonly pathAccess: OperativeDrivePathAccess;
  readonly enabledTools?: readonly string[];
}
```

### Updated: `ChrootedDriveToolsApi`

Wraps `DriveClient` instead of `DriveQueryAdapter`. Each method applies chroot
path resolution then delegates to `drive.tools.*`:

```ts
class ChrootedDriveToolsApi {
  constructor(
    private readonly drive: DriveClient,
    private readonly pathAccess: OperativeDrivePathAccess
  ) {}

  async ls(options: { path: string; recursive?: boolean }) {
    const resolved = await this.pathAccess.resolveExistingPath(options.path);
    return this.drive.tools.ls({ path: resolved.path, recursive: options.recursive });
  }
  // ... same pattern for glob, grep, vsearch, biQuery, inodesQuery, tgSearch
}
```

### Updated: `OperativeDrivePathAccess`

Replace `DriveOpsAdapter` dependency with `DriveClient`:
- `listPaths(options)` -> `drive.list(options)`
- `resolveInodes(inodes)` -> `drive.resolve({ paths: inodes })`

### Updated: write tools

Each write tool replaces `DriveOpsAdapter` with `DriveClient` in context:
- `tool-write`: `driveClient.writeFile()` -> `drive.tools.writeFile()`
- `tool-mkdir`: `driveClient.createDir()` -> `drive.create()`
- `tool-scaffold`: `driveClient.createDir()` -> `drive.create()`
- `tool-excel-write`: `driveClient.writeExcel()` -> `drive.tools.excelWrite()`

### Updated: `UpgraideAgent.ts`

Replace `createDriveAdapters()` with `createOperativeDriveClient()`:
- Line 317: `createDriveAdapters(config)` -> `createOperativeDriveClient(config)`
- Line 460: same for RAG context
- `buildContext` / `getQueryResults`: accept `DriveClient` instead of
  duck-typed `{ inodesQueryPath }` / `{ resolveInodes }`

### Removed

- `DriveQueryAdapter` class
- `DriveOpsAdapter` class
- `createDriveAdapters()` factory
- `createRpcCaller()` inline transport
- `mapRawToPathEntry()` helper (SDK handles decoding)


Error handling and UX
---------------------

No user-facing changes. Error handling behavior is preserved:

- SDK `jsonRpcCall` throws on HTTP errors and RPC errors, same as the current
  `createRpcCaller`.
- Write tools catch errors from `DriveClient` and surface them as tool error
  messages to the LLM.
- `ChrootedDriveToolsApi` path resolution errors propagate unchanged.
- `BuiltInDriveToolClient.callTool` wraps unknown tool names with descriptive
  error messages -- no change.


Implementation stages
---------------------

Each stage is independently verifiable: typecheck passes, tests pass, nothing
is broken. The next stage builds on the previous one.

### Stage 1: Type existing tools in SDK (platform-api)

Scope: change return types of `tools.ls`, `tools.glob`, `tools.grep`,
`tools.vsearch` from generic `DriveToolsResult` to specific typed results.
No new methods yet.

Files changed:
- `src/drive/driveTypes.ts` -- add `DriveToolsLsResult`, `DriveToolsGlobResult`,
  `DriveToolsDocumentPart`, `DriveToolsDocument`, `DriveToolsGrepResult`,
  `DriveToolsVsearchResult`
- `src/drive/drive.ts` -- add decoders (`decodeDocumentPart`, `decodeDocument`,
  `decodeLsResult`, `decodeGlobResult`, `decodeGrepResult`,
  `decodeVsearchResult`), update `tools.ls/glob/grep/vsearch` implementations
- `src/drive/types.ts` -- update `DriveClient.tools` method signatures
- `src/index.ts` -- export new types
- Deprecate `DriveToolsResult` with `@deprecated` JSDoc (keep exported)

Verify:
- `npm run typecheck`
- `npm test`
- Existing callers using `DriveToolsResult` still compile (deprecated, not removed)

### Stage 2: Add missing tools to SDK (platform-api)

Scope: add `tools.biQuery`, `tools.inodesQuery`, `tools.tgSearch`,
`tools.excelWrite`. Additive only -- no changes to existing methods.

Files changed:
- `src/drive/driveTypes.ts` -- add param + result types:
  `DriveToolsBiQueryParams`, `DriveToolsBiQueryResult`,
  `DriveToolsTableData`, `DriveToolsInodesQueryParams`,
  `DriveToolsInodesQueryResult`, `DriveToolsTgSearchParams`,
  `DriveToolsTgSearchResult`, `DriveToolsTgMessage`,
  `DriveToolsExcelWriteParams`
- `src/drive/drive.ts` -- add decoders + implementations for 4 new methods
- `src/drive/types.ts` -- add 4 methods to `DriveClient.tools`
- `src/index.ts` -- export new types

Verify:
- `npm run typecheck`
- `npm test`
- Bump version, publish

### Stage 3: Create drive adapter in agent-service

Scope: add `createOperativeDriveClient()` factory using `@diskd-ai/sdk`. Additive
only -- old adapters untouched, nothing uses the new factory yet.

Files changed:
- `agent-service/package.json` -- bump `@diskd-ai/sdk` version
- `agent-service/packages/agent-upgraide/src/operativeDrive/driveAdapter.ts` --
  new file, thin factory: `diskd.auth.apiKey -> diskd.os.drive`

Verify:
- `npm run typecheck`

### Stage 4: Migrate `OperativeDrivePathAccess`

Scope: switch `pathAccess.ts` from `DriveOpsAdapter` to `DriveClient`.
This is the lowest-level dependency -- write tools and `toolClient` depend on
it, but `pathAccess` itself depends only on the drive client.

What changes:
- `pathAccess.ts` constructor: `DriveOpsAdapter` -> `DriveClient`
- `create()` static: `driveClient.resolveInodes([inode])` ->
  `driveClient.resolve({ paths: [inode] })`
- `listPaths()` call: `driveClient.listPaths({ path, recursive })` ->
  `driveClient.list({ path })`
- Return type mapping: `DrivePathEntry` (SDK) has `id` field where old
  `PathEntry` has `inode` -- need mapping or type alias

Files changed:
- `operativeDrive/pathAccess.ts`
- `operativeDrive/__tests__/pathAccess.test.ts` -- update mock shape

Verify:
- `npm run typecheck`
- `npx jest pathAccess.test.ts`

### Stage 5: Migrate write tools

Scope: switch 5 write tools from `DriveOpsAdapter` to `DriveClient` in their
context type.

Each tool's `OperativeDriveToolContext` changes:
- `driveClient: DriveOpsAdapter` -> `drive: DriveClient`

Method mapping per tool:
- `tool-write`: `driveClient.writeFile(path, content)` ->
  `drive.tools.writeFile({ path, content })`
- `tool-mkdir`: `driveClient.createDir(name, parentPath)` ->
  `drive.create({ dirName: name, parentPath })`
- `tool-scaffold`: same as mkdir
- `tool-excel-write`: `driveClient.writeExcel(path, headers, rows, sheet)` ->
  `drive.tools.excelWrite({ path, headers, rows, sheetName: sheet })`
- `tool-create`: delegates to `tool-mkdir` and `tool-write` -- updates
  automatically if it uses their execute() functions; otherwise update context

Files changed:
- `tool-write.ts`, `tool-mkdir.ts`, `tool-scaffold.ts`, `tool-excel-write.ts`,
  `tool-create.ts`
- `__tests__/tool-write.test.ts`, `__tests__/tool-scaffold.test.ts`,
  `__tests__/tool-create.test.ts`, `__tests__/tool-mkdir.test.ts`

Verify:
- `npm run typecheck`
- `npx jest tool-write.test.ts tool-mkdir.test.ts tool-scaffold.test.ts
  tool-excel-write.test.ts tool-create.test.ts`

### Stage 6: Migrate `ChrootedDriveToolsApi` and `BuiltInDriveToolClient`

Scope: the core wiring in `toolClient.ts`.

`ChrootedDriveToolsApi`:
- Constructor: `DriveQueryAdapter` -> `DriveClient`
- Each method delegates to `drive.tools.*` after chroot path resolution

`BuiltInDriveToolClient`:
- `BuiltInDriveToolClientInit`: `{ queryAdapter, opsAdapter }` ->
  `{ drive: DriveClient }`
- Context construction: creates `ChrootedDriveToolsApi` from `drive` instead
  of `queryAdapter`
- Write tools context: passes `drive` instead of `opsAdapter`

Files changed:
- `operativeDrive/toolClient.ts`
- `operativeDrive/__tests__/toolClient.test.ts`

Verify:
- `npm run typecheck`
- `npx jest toolClient.test.ts`

### Stage 7: Wire into `UpgraideAgent` and clean up

Scope: replace `createDriveAdapters()` with `createOperativeDriveClient()` in
`UpgraideAgent.ts`. Remove old adapter code.

Changes in `UpgraideAgent.ts`:
- Import `createOperativeDriveClient` instead of `createDriveAdapters`
- Line ~317: `createDriveAdapters(config)` -> `createOperativeDriveClient(config)`
- Line ~460: same for RAG adapters
- `buildContext` / `getQueryResults` signatures: accept `DriveClient` instead
  of duck-typed inline shapes
- `BuiltInDriveToolClient` init: `{ drive, pathAccess }` instead of
  `{ queryAdapter: adapters.query, opsAdapter: adapters.ops, pathAccess }`

Clean up:
- Delete or empty `@sdk/drive/driveAdapter.ts` (remove `DriveQueryAdapter`,
  `DriveOpsAdapter`, `createDriveAdapters`, `createRpcCaller`,
  `mapRawToPathEntry`)
- Remove unused imports across the codebase

Files changed:
- `UpgraideAgent.ts`
- `@sdk/drive/driveAdapter.ts` (delete content or file)

Verify:
- `npm run typecheck`
- `npm run validate`
- Full test suite via Tilt
- No remaining imports of `DriveQueryAdapter`, `DriveOpsAdapter`,
  `createDriveAdapters` in agent-service


Testing approach
----------------

Each stage has its own verify step (see above). Summary:

### Unit tests per stage

| Stage | Tests |
|-------|-------|
| 1 | `platform-api`: `npm test` (existing decoder tests + new typed results) |
| 2 | `platform-api`: `npm test` (new decoder tests for biQuery, inodesQuery, tgSearch, excelWrite) |
| 3 | `agent-service`: `npm run typecheck` (no runtime tests -- factory only) |
| 4 | `agent-service`: `npx jest pathAccess.test.ts` |
| 5 | `agent-service`: `npx jest tool-*.test.ts` |
| 6 | `agent-service`: `npx jest toolClient.test.ts` |
| 7 | `agent-service`: `npm run validate` + full integration via Tilt |

### Integration tests (after Stage 7)

- Run all operative drive tools end-to-end via Tilt against real Drive backend
- Cover: ls, glob, grep, vsearch, read, write, mkdir, scaffold, excel-write,
  biQuery, inodesQuery, tgSearch


Acceptance criteria
-------------------

1. `DriveClient.tools.ls()` returns `DriveToolsLsResult { entries: DrivePathEntry[] }` -- not generic `DriveToolsResult`
2. `DriveClient.tools.grep()` returns `DriveToolsGrepResult { documents: DriveToolsDocument[] }` -- not generic `DriveToolsResult`
3. `DriveClient.tools.biQuery()`, `.inodesQuery()`, `.tgSearch()`, `.excelWrite()` exist and are typed
4. `DriveToolsResult` is still exported (deprecated) -- no compile errors for existing callers
5. `agent-service` has zero imports from `@sdk/drive/driveAdapter` (the file with `DriveQueryAdapter` / `DriveOpsAdapter` -- not the new `operativeDrive/driveAdapter.ts`)
6. `agent-service` has zero references to `DriveQueryAdapter` or `DriveOpsAdapter`
7. `UpgraideAgent` creates `DriveClient` via `diskd.auth.apiKey` + `diskd.os.drive`
8. All operative drive tools (ls, glob, grep, vsearch, read, write, mkdir, scaffold, excel-write, biQuery, inodesQuery, tgSearch) pass integration tests via Tilt
9. `npm run typecheck` passes in both `platform-api` and `agent-service` after each stage
10. No `Record<string, unknown>` used as domain return type in new code
