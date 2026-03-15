Drive Tools File Operations Design Doc
=======================================

Context and motivation
----------------------

The Drive tools API currently provides read-only query operations (ls, glob, grep, vsearch). The `paths/tools/read` RPC method exists on the backend and returns parsed file content as `Part[]`, but the SDK has no client method for it.

AI agents (via agent-hub, crontab execution runtime) need to read, write, and patch files in Drive as part of automated workflows. Without SDK methods, callers must either use raw JSON-RPC or go through the multi-step upload flow for simple text writes.

Goals:
- Expose `paths/tools/read` (already implemented in Drive backend) via `drive.tools.readFile()`
- Define SDK-side types and methods for `drive.tools.writeFile()` and `drive.tools.applyPatch()` that will call corresponding backend RPC methods once implemented
- Follow existing Drive tools patterns (JSON-RPC, snake_case wire, DriveToolsResult)

Non-goals for first implementation (v1):
- Implementing the backend RPC handlers for write_file and apply_patch (separate Drive service task)
- Binary file write support (text-only for v1)
- Conflict detection or optimistic locking (deferred)
- Streaming read/write (use existing upload/download for large files)


Implementation considerations
------------------------------

Key constraints:

- The Drive API uses JSON-RPC 2.0 over `POST /api/v1` with snake_case params.
- `paths/tools/read` is already implemented on the backend. It returns `DriveReadResponse { parts: Part[] }` where each Part has `type`, `content`, `title`, `page_number`, `confidence`.
- `paths/tools/write` and `paths/tools/apply-patch` do not yet exist on the backend. The SDK types and methods should be defined now so the interface is ready when the backend is implemented. The SDK will throw a clear error if the backend returns `method not found`.
- All Drive tools methods use the `call()` helper (JSON-RPC wrapper) bound at client creation time.
- Existing tools return `DriveToolsResult { items: Record<string, unknown>[] }` -- but readFile needs a more specific type since the response shape is well-defined.

Design decisions:

- `readFile` returns a typed `DriveReadFileResult` (not generic `DriveToolsResult`) since the Part structure is well-defined and useful for callers.
- `writeFile` accepts `content: string` and `path: string`. Returns void (success) or throws on error. The backend will handle creating or overwriting the file.
- `applyPatch` accepts `path: string` and `patch: string` (unified diff format). Returns void or throws. The backend applies the patch to the existing file content.
- All three methods use path-based addressing (`paths/tools/*`), not inode-based.


High-level behavior
-------------------

```ts
const drive = diskd.os.drive({ version: 'v1', auth });

// Read file content (parsed into parts)
const result = await drive.tools.readFile({ path: '/docs/readme.md' });
for (const part of result.parts) {
  console.log(part.type, part.content);
}

// Write file content (create or overwrite)
await drive.tools.writeFile({
  path: '/docs/readme.md',
  content: '# Hello World\n\nThis is a readme.',
});

// Apply unified diff patch
await drive.tools.applyPatch({
  path: '/docs/readme.md',
  patch: `--- a/docs/readme.md
+++ b/docs/readme.md
@@ -1,3 +1,3 @@
 # Hello World

-This is a readme.
+This is an updated readme.`,
});
```


API design
----------

### RPC method mapping

| SDK method | JSON-RPC method | Status |
|------------|----------------|--------|
| `drive.tools.readFile(params)` | `paths/tools/read` | Backend implemented |
| `drive.tools.writeFile(params)` | `paths/tools/write` | Backend TBD |
| `drive.tools.applyPatch(params)` | `paths/tools/apply-patch` | Backend TBD |

### SDK types

```ts
// -- Read --

type DriveToolsReadFileParams = {
  readonly path: string;
  readonly partsLimit?: number;
  readonly partsOffset?: number;
};

type DriveReadFilePart = {
  readonly type: 'text' | 'image' | 'table' | 'diagram' | 'json' | 'code' | 'form';
  readonly content: string;
  readonly title?: string;
  readonly pageNumber?: number;
  readonly confidence?: number;
};

type DriveReadFileResult = {
  readonly parts: readonly DriveReadFilePart[];
};

// -- Write --

type DriveToolsWriteFileParams = {
  readonly path: string;
  readonly content: string;
};

// -- Patch --

type DriveToolsApplyPatchParams = {
  readonly path: string;
  readonly patch: string;
};
```

### Wire format (snake_case)

**readFile request:**
```json
{ "method": "paths/tools/read", "params": { "path": "/docs/readme.md", "parts_limit": 1, "parts_offset": 0 } }
```

**readFile response:**
```json
{ "parts": [{ "type": "text", "content": "...", "title": null, "page_number": 1, "confidence": 0.95 }] }
```

**writeFile request:**
```json
{ "method": "paths/tools/write", "params": { "path": "/docs/readme.md", "content": "..." } }
```

**applyPatch request:**
```json
{ "method": "paths/tools/apply-patch", "params": { "path": "/docs/readme.md", "patch": "..." } }
```


Error handling and UX
---------------------

- `readFile`: throws on `PATH_NOT_FOUND`, `NOT_INDEXED` (with guidance to index first), or internal errors. These are standard JSON-RPC errors already handled by the Drive backend.
- `writeFile` and `applyPatch`: will throw `METHOD_NOT_FOUND` until the backend implements these methods. The error message from JSON-RPC is clear enough.
- `applyPatch`: backend should return a specific error if the patch cannot be applied (e.g., hunk mismatch). The SDK passes through whatever error the backend returns.


Future-proofing
---------------

- `readFile` pagination via `partsLimit`/`partsOffset` is already supported by the backend.
- `writeFile` could later accept `mimeType` or `encoding` params without breaking the existing interface.
- `applyPatch` format could be extended to support other patch formats via an optional `format` param.
- Inode-based variants (`drive/tools/read`, `drive/tools/write`) can be added later as separate methods if needed.


Implementation outline
----------------------

### Phase 1: Types (src/drive/driveTypes.ts)

1. Add `DriveToolsReadFileParams` with `path`, `partsLimit?`, `partsOffset?`
2. Add `DriveReadFilePart` with `type`, `content`, `title?`, `pageNumber?`, `confidence?`
3. Add `DriveReadFileResult` with `parts: readonly DriveReadFilePart[]`
4. Add `DriveToolsWriteFileParams` with `path`, `content`
5. Add `DriveToolsApplyPatchParams` with `path`, `patch`

### Phase 2: Client (src/drive/types.ts + src/drive/drive.ts)

1. Add `readFile`, `writeFile`, `applyPatch` to `DriveClient.tools` type
2. Add decode function `decodeReadFileResult` for the read response
3. Implement `readFile` calling `paths/tools/read` with snake_case params
4. Implement `writeFile` calling `paths/tools/write`
5. Implement `applyPatch` calling `paths/tools/apply-patch`

### Phase 3: Exports (src/index.ts)

1. Add new type exports

### Phase 4: Tests (src/__tests__/driveClient.test.ts)

1. Test `readFile` -- verify RPC method, params encoding, response decoding
2. Test `writeFile` -- verify RPC method, params encoding
3. Test `applyPatch` -- verify RPC method, params encoding


Testing approach
----------------

Unit tests:
- Mock JSON-RPC via the existing `fetchMock` pattern in `driveClient.test.ts`
- Verify `readFile` sends correct method and params, decodes `parts` with snake_case -> camelCase mapping
- Verify `writeFile` sends correct method and params, returns void
- Verify `applyPatch` sends correct method and params, returns void


Acceptance criteria
-------------------

- Given a valid path, when `drive.tools.readFile({ path })` is called, then it sends `paths/tools/read` RPC with `{ path, parts_limit, parts_offset }` and returns `{ parts: DriveReadFilePart[] }` with camelCase fields.
- Given `partsLimit` and `partsOffset` params, when `readFile` is called, then they are sent as `parts_limit` and `parts_offset` on the wire.
- Given a valid path and content, when `drive.tools.writeFile({ path, content })` is called, then it sends `paths/tools/write` RPC with `{ path, content }`.
- Given a valid path and patch string, when `drive.tools.applyPatch({ path, patch })` is called, then it sends `paths/tools/apply-patch` RPC with `{ path, patch }`.
- All new types are exported from `src/index.ts`.
- `bun run typecheck` passes.
- `bun test` passes including new tests.


Files to create
---------------

None (all changes in existing files).


Files to modify
---------------

| File | Change |
|------|--------|
| `src/drive/driveTypes.ts` | Add ReadFile, WriteFile, ApplyPatch param and result types |
| `src/drive/types.ts` | Add `readFile`, `writeFile`, `applyPatch` to `DriveClient.tools` |
| `src/drive/drive.ts` | Implement methods + decode function |
| `src/index.ts` | Export new types |
| `src/__tests__/driveClient.test.ts` | Add unit tests |
