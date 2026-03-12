Drive Session SDK Design Doc
=============================

Status: Draft

Affected projects: `platform-api`, `drive`

Context and motivation
----------------------
The Drive backend exposes eight `drive/session/*` JSON-RPC methods (see `drive/docs/drive-session-design.md`). The current SDK exposes them as a flat method namespace where every call repeats `projectId` and `sessionId`, holds no state, and has no resource lifecycle.

This design replaces the namespace with two API layers:
- **Session object** -- for active chat runtime (open, read state, mutate, close).
- **Stateless operations** -- for migration/import, listing, and deletion.

Consumer profiles
-----------------

| | Chat runtime | Migration / import |
|---|---|---|
| Creates sessions | Simple: title + first message | Full document with all fields |
| Adds messages | One turn at a time | Bulk in initial save |
| Needs session object | Yes -- holds state | No -- fire and forget |
| ID generation | SDK handles it | Provides existing IDs |
| Message fields | Uses 3-5 fields | Maps all 24 fields |
| Volume | 1 session at a time | Hundreds/thousands |

Both profiles use the same backend endpoints. The SDK provides convenience for chat runtime developers and raw access for migration scripts.

Consumer API
------------

### Chat runtime: start a new conversation

```ts
const session = await drive.session.start({ projectId: 'proj-1', title: 'New chat' });

// SDK generates session ID, fills defaults, sends drive/session/save
console.log(session.sessionId);     // auto-generated
console.log(session.messageCount);  // 0

await session.append([
  drive.session.message({ role: 'user', content: 'Hello, how can I deploy to production?' }),
]);

// After getting AI response from your chat backend:
await session.append([
  drive.session.message({ role: 'assistant', content: 'Here are the steps...' }),
]);

session.dispose();
```

### Chat runtime: resume existing conversation

```ts
const session = await drive.session.open({ projectId: 'proj-1', sessionId: 'sess-1', limit: 20 });

// Yields state
console.log(session.document.title);
console.log(session.messages);       // newest 20
console.log(session.messageCount);   // total count

// User scrolls up
const older = await session.loadMore({ limit: 20 });
// older.messages + session.messages = full loaded history

await session.append([
  drive.session.message({ role: 'user', content: 'What about rollback?' }),
]);

session.dispose();
```

### Chat runtime: undo last turn

```ts
const session = await drive.session.open({ projectId: 'proj-1', sessionId: 'sess-1' });

await session.rollback('msg-5');  // soft-deletes msg-5 and everything after

session.dispose();
```

### Chat runtime: remove specific messages

```ts
const session = await drive.session.open({ projectId: 'proj-1', sessionId: 'sess-1' });

await session.remove(['msg-2', 'msg-3']);

session.dispose();
```

### Chat runtime: fork conversation

```ts
const session = await drive.session.open({ projectId: 'proj-1', sessionId: 'sess-1' });

// Fork at msg-5: new session with messages up to msg-5
const forked = await session.fork({ atMessageId: 'msg-5' });

// SDK generates new session ID, sets fork lineage fields
console.log(forked.sessionId);                     // auto-generated
console.log(forked.document.forkSourceSessionId);  // 'sess-1'
console.log(forked.document.forkSourceMessageId);  // 'msg-5'

await forked.append([
  drive.session.message({ role: 'user', content: 'Let me try a different approach...' }),
]);

forked.dispose();
session.dispose();
```

### Chat runtime: list and delete

```ts
const items = await drive.session.list({ projectId: 'proj-1' });
// items[0].sessionId, .title, .messageCount, .updatedAt, .provider, .model

await drive.session.delete({ projectId: 'proj-1', sessionId: 'sess-1' });
```

### Migration: import existing chats

```ts
const oldChats = await loadLegacyChats();

for (const chat of oldChats) {
  await drive.session.save({
    projectId: chat.projectId,
    session: {
      id: chat.id,                    // preserve original ID
      workspaceId: chat.workspaceId,
      projectId: chat.projectId,
      title: chat.title,
      config: mapConfig(chat),
      exchanges: mapExchanges(chat),
      participants: mapParticipants(chat),
      messages: chat.messages.map(mapMessage),
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      sourceOrigin: 'api',
      forkSourceSessionId: chat.forkedFrom ?? null,
      forkSourceMessageId: chat.forkPoint ?? null,
    },
  });
}
```

`save()` is stateless -- returns `{ sessionId, messageCount, updatedAt }`, no session object. Use it for import, bulk migration, and full-document replacement.

### Migration: overwrite / re-import

```ts
// Same call -- save is idempotent on session ID. Preserves inode, replaces content.
await drive.session.save({ projectId, session: updatedDocument });
```

Types
-----

### DriveSessionManager (on `DriveClient.session`)

```ts
type DriveSessionManager = {
  // Session object lifecycle
  start(params: { projectId: string; title?: string }): Promise<DriveSession>;
  open(params: { projectId: string; sessionId: string; limit?: number }): Promise<DriveSession>;

  // Stateless operations
  save(params: DriveSessionSaveParams): Promise<DriveSessionSaveResult>;
  list(params: { projectId: string }): Promise<DriveSessionListResult>;
  delete(params: { projectId: string; sessionId: string }): Promise<DriveSessionDeleteResult>;

  // Message builder (pure, no RPC)
  message(params: MessageParams): DriveSessionMessage;
};
```

### DriveSession (the object)

```ts
type DriveSession = {
  // Identity (immutable)
  readonly projectId: string;
  readonly sessionId: string;

  // State (updated after open, append, rollback, remove, refresh)
  readonly document: DriveSessionDocument;
  readonly messages: readonly DriveSessionMessage[];
  readonly messageCount: number;

  // Write
  append(messages: readonly DriveSessionMessage[]): Promise<void>;
  rollback(afterMessageId: string): Promise<void>;
  remove(messageIds: readonly string[]): Promise<void>;
  fork(params: { atMessageId: string }): Promise<DriveSession>;

  // Read
  refresh(): Promise<void>;
  loadMore(params: { limit: number }): Promise<DriveSessionGetMessageRangeResult>;

  // Cleanup
  dispose(): void;
};
```

### MessageParams (convenience builder)

```ts
type MessageParams = {
  readonly role: string;                   // 'user' | 'assistant' | 'system' | custom
  readonly content: string;
  readonly id?: string;                    // auto-generated ULID if omitted
  readonly participantKind?: string;       // default: 'human' for user, 'ai' for assistant, 'system' for system
  readonly participantId?: string;
  readonly participantName?: string;
  readonly contentBlocksJson?: string;
  readonly sourceOrigin?: string;
  readonly metadata?: JsonObject;
  readonly attachments?: readonly string[];
  readonly parentMessageId?: string;
  readonly isSidechain?: boolean;
};
```

`message()` fills all 24 `DriveSessionMessage` fields from `role` + `content` + optional overrides:
- `id` -- auto-generated ULID if not provided.
- `participantKind` -- inferred from `role` (`'human'`, `'ai'`, `'system'`) unless overridden.
- `createdAt` -- current ISO timestamp.
- All other fields -- `null` / `false` / `0` as appropriate.

**Method semantics:**
- `start({ projectId, title })` -- generates a session ID, builds a minimal `DriveSessionDocument`, sends `drive/session/save`, returns a session object.
- `open({ projectId, sessionId, limit })` -- sends `drive/session/get-preview` (or `get` if no limit), returns a session object with loaded state.
- `save(params)` -- stateless, sends `drive/session/save`, returns `{ sessionId, messageCount, updatedAt }`. For migration and import.
- `append(messages)` -- sends `drive/session/append-messages`, updates local state.
- `rollback(afterMessageId)` -- sends `drive/session/delete-messages` (rollback mode), updates local state.
- `remove(messageIds)` -- sends `drive/session/delete-messages` (by-IDs mode), updates local state.
- `fork({ atMessageId })` -- generates a new session ID, copies messages up to the fork point, sets `forkSourceSessionId` + `forkSourceMessageId`, sends `drive/session/save`, returns a new session object.
- `refresh()` -- re-fetches from backend, replaces local state.
- `loadMore({ limit })` -- loads the next page of older messages using `before` cursor from the oldest currently loaded message. Returns the page. Appends to `session.messages` so the caller does not need to merge manually.
- `dispose()` -- sync, marks the object as done.

Wire protocol mapping
---------------------

| SDK method | JSON-RPC method |
|---|---|
| `manager.start()` | `drive/session/save` |
| `manager.open()` | `drive/session/get-preview` or `drive/session/get` |
| `manager.save()` | `drive/session/save` |
| `manager.list()` | `drive/session/list` |
| `manager.delete()` | `drive/session/delete` |
| `session.append()` | `drive/session/append-messages` |
| `session.rollback()` | `drive/session/delete-messages` (rollback mode) |
| `session.remove()` | `drive/session/delete-messages` (by-IDs mode) |
| `session.fork()` | `drive/session/get` + `drive/session/save` |
| `session.refresh()` | `drive/session/get` |
| `session.loadMore()` | `drive/session/get-message-range` |

No new backend endpoints. `message()` builder is a pure function, no RPC.

Session storage format
----------------------

Each session is persisted as a SQLite file at `/Projects/{projectId}/.sessions/{sessionId}.session` in the Drive file system (S3-backed). The file uses `application/x-session-database` MIME type and has `["session", "hidden"]` attributes.

### SQLite schema

Two tables:

**`settings`** -- key-value metadata store for session document fields.

| Key | Example value |
|---|---|
| `session.id` | `01KKHR811R7A1CRSZ6V6KF5VRV` |
| `session.workspace_id` | `dev-org-id` |
| `session.project_id` | `sdk-test` |
| `session.title` | `SDK Integration Test` |
| `session.created_at` | `2026-03-12T19:26:45.833Z` |
| `session.updated_at` | `2026-03-12T19:27:43.501Z` |
| `session.exchanges_json` | `[]` |
| `session.participants_json` | `[]` |
| `session.source_origin` | `` |
| `config.operative_id` | `` |
| `config.provider` | `openai` |
| `config.model` | `gpt-4` |
| `config.prompt_text` | `` |
| `config.drive_sources_muted` | `false` |
| `stats.message_count` | `4` |
| `fork.source_session_id` | `01KKHR811R...` (or empty) |
| `fork.source_message_id` | `01KKHR8M4N...` (or empty) |

**`messages`** -- one row per message, soft-deleted rows retained with `deleted_at` set.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | ULID, e.g., `01KKHR8GA58YW9E6MXNB4RVAJB` |
| `role` | TEXT NOT NULL | `user`, `assistant`, `system` |
| `participant_kind` | TEXT NOT NULL | `human`, `ai`, `system` |
| `participant_id` | TEXT | nullable |
| `participant_name` | TEXT | nullable |
| `participant_slug` | TEXT | nullable |
| `content` | TEXT NOT NULL | message body |
| `content_blocks_json` | TEXT | nullable, structured blocks |
| `source_origin` | TEXT | nullable |
| `turn_correlation_id` | TEXT | nullable |
| `turn_context_json` | TEXT | nullable |
| `function_call_json` | TEXT | nullable |
| `tool_calls_json` | TEXT | nullable |
| `tool_call_id` | TEXT | nullable |
| `context_json` | TEXT | nullable |
| `metadata_json` | TEXT | nullable |
| `attachments_json` | TEXT | nullable |
| `subtype` | TEXT | nullable |
| `parent_message_id` | TEXT | nullable, for threading |
| `is_sidechain` | INTEGER | 0 or 1 |
| `token_count` | INTEGER | nullable |
| `created_at` | TEXT NOT NULL | ISO 8601 |
| `updated_at` | TEXT | nullable |
| `deleted_at` | TEXT | nullable, soft-delete marker |

Indexes: `idx_messages_created_at(created_at, id)`, `idx_messages_participant(participant_kind, participant_id, created_at, id)`, `idx_messages_deleted_at(deleted_at)`, `idx_messages_parent(parent_message_id)`.

### Drive file metadata

The `.session` file's Drive metadata (on the `drive_paths` row) includes:

```json
{
  "session_id": "01KKHR811R7A1CRSZ6V6KF5VRV",
  "session_title": "SDK Integration Test",
  "message_count": 4,
  "provider": "openai",
  "model": "gpt-4",
  "updated_at": "2026-03-12T19:27:43.501667Z"
}
```

This allows listing sessions without opening the SQLite file.

Error handling
--------------
- Each async method propagates RPC errors directly. No wrapping, no retry.
- Methods throw `Error('DriveSession is disposed')` after `dispose()`.
- Decode errors throw with descriptive messages.
- `start()` and `fork()` generate IDs internally -- no ID collision handling in v1 (ULIDs are practically unique).

File structure
--------------
```
src/drive/
  sessionTypes.ts    -- domain types, DriveSession, DriveSessionManager, MessageParams
  session.ts         -- encode/decode + internal RPC wrappers (existing pure functions)
  sessionObject.ts   -- DriveSession implementation + createDriveSessionManager factory
  sessionBuilder.ts  -- message() builder + ID generation
  drive.ts           -- DriveClient wires session as DriveSessionManager
  rpc.ts             -- JSON-RPC transport (unchanged)
```

Testing
-------
- Unit: `message()` builder fills defaults from role, ID generation produces valid ULIDs, encode/decode round-trips, dispose-then-call throws, rollback vs remove encode to correct wire params, loadMore appends to messages array.
- Integration (Tilt): start + append + open round-trip, save (migration) + list, fork + verify lineage, rollback + verify exclusion, loadMore pagination, delete.

Acceptance criteria
-------------------
- `start({ projectId, title: 'Test' })` creates a session with auto-generated ID and returns a session object with `messageCount: 0`.
- `message({ role: 'user', content: 'Hello' })` returns a full `DriveSessionMessage` with auto-generated ID, participantKind `'human'`, and all other fields defaulted.
- `message({ role: 'assistant', content: 'Hi' })` returns participantKind `'ai'`.
- `message({ role: 'user', content: 'Hi', participantKind: 'custom' })` uses the override instead of the default.
- `append([msg])` sends one RPC and updates `messageCount` on the object.
- `rollback('msg-5')` sends `delete-messages` with `rollback_after_message_id`.
- `fork({ atMessageId: 'msg-5' })` creates a new session with auto-generated ID, messages up to `msg-5`, and correct fork lineage fields.
- `loadMore({ limit: 20 })` appends older messages to `session.messages` and returns the page.
- `save(fullDocument)` is stateless, returns `{ sessionId, messageCount, updatedAt }`, no session object.
- `open({ limit: 20 })` returns a session with newest 20 messages and total `messageCount`.
- `dispose()` is sync. Methods throw after dispose.
