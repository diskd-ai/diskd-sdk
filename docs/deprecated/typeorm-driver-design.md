Drive DB Rollback + TypeORM Driver Design
==========================================

Context and motivation
----------------------

Services built on the Upgraide platform (app-service, agent-hub) use Drive DB
as a SQLite-backed persistence layer accessed via JSON-RPC. Today the SDK
exposes 9 JSON-RPC methods (`create`, `insert`, `query`, `commit`, `metadata`,
`drop`, `set-status`, `resolve-by-inode`, `resolve-with-settings`) plus a
higher-level `DriveDatabase`/`DriveRepository` pattern with CRUD operations.

Two gaps remain:

1. **No rollback** -- once writes land in the local SQLite WAL, there is no way
   to discard them without committing or dropping the entire database. The
   backend already calls `connection.rollback()` internally on failure
   (`database_service.py:1716`) but does not expose it as a JSON-RPC method.

2. **No ORM integration** -- services that want TypeORM entities, relations,
   migrations, and decorated repositories must hand-write raw SQL or maintain
   a parallel persistence layer. A TypeORM driver that routes SQL through
   Drive DB would let teams use familiar ORM patterns while keeping Drive as
   the single storage backend.

Adding `drive/db/rollback` unblocks the TypeORM driver's transaction model and
is independently useful for any consumer that wants atomic write-then-discard
semantics.

Goals:
- Expose `drive/db/rollback` as a JSON-RPC method in the Drive backend
- Add `rollback()` to the SDK's `DriveDbClient` and `DriveDatabase`
- Ship `@diskd/typeorm-driver` as a separate npm package that lets TypeORM
  operate against any Drive DB database over JSON-RPC
- Map TypeORM's transaction lifecycle (`BEGIN`/`COMMIT`/`ROLLBACK`) to Drive DB's
  `commit`/`rollback` semantics

Non-goals for first implementation (v1):
- Nested transactions / savepoints (SQLite does support them, but Drive DB's
  per-request connection model makes them impractical over JSON-RPC)
- Replication or read replicas
- Schema introspection from live database (TypeORM's `synchronize: true` will
  generate DDL; reading back `sqlite_master` is deferred to v2)
- Migration CLI integration (manual `query()` execution is sufficient for v1)
- Browser support for the TypeORM driver (Node.js only)


Implementation considerations
------------------------------

**Drive DB connection model.** Each JSON-RPC call opens a SQLite connection,
executes, and closes. There is no persistent connection across calls. Writes
accumulate in the local WAL file on the NVMe cache until `commit` uploads to
S3. `rollback` discards the local WAL by re-downloading the last committed
version from S3 (or deleting the cached file so next access triggers a fresh
download).

**Transaction mapping.** TypeORM expects `startTransaction` / `commitTransaction` /
`rollbackTransaction`. Drive DB does not have SQL-level transactions across
requests. The mapping:

| TypeORM call          | Drive DB action                     |
|-----------------------|-------------------------------------|
| `startTransaction()`  | No-op (writes auto-accumulate)      |
| `commitTransaction()` | `drive/db/commit` (flush WAL to S3) |
| `rollbackTransaction()`| `drive/db/rollback` (discard WAL)  |

This means every write is visible to subsequent reads within the same database
immediately (SQLite WAL read-your-writes), but only becomes durable after
`commit`. A `rollback` discards all writes since the last `commit`.

**TypeORM driver architecture.** TypeORM's `better-sqlite3` driver extends
`AbstractSqliteDriver` and `AbstractSqliteQueryRunner`. The custom driver
follows the same inheritance chain but overrides the query execution path to
route through `drive.db.query()` instead of a local SQLite binding.

**Package boundaries.** `@diskd/typeorm-driver` depends on `@diskd/sdk` (for
`DriveDbClient`) and declares `typeorm` as a `peerDependency` to avoid version
conflicts. The core SDK remains lightweight with no TypeORM dependency.


API design
----------

### 1. Drive backend: `drive/db/rollback`

JSON-RPC method registered in `drive_db_api.py`:

```
method: "drive/db/rollback"
params: { name: string, db_type?: string }
result: { name: string, status: string }
```

Behavior:
- Acquires the per-database lock (same as `commit`)
- Deletes the cached local SQLite file from NVMe cache
- Next read/write will re-download the last committed version from S3
- If no cached file exists (nothing to rollback), returns success with
  `status: "clean"`
- If the database is in `committing` status, rejects with error
  `COMMIT_IN_PROGRESS`
- Updates database status back to `ready`

Response schema (Python dataclass):

```
@dataclass
class DriveDbRollbackResponse:
    name: str
    status: str  # "rolled_back" | "clean"
```

### 2. SDK: `DriveDbClient.rollback()`

New method on `DriveDbClient` interface:

```ts
// driveDbTypes.ts
type DriveDbRollbackParams = {
  readonly name: string;
  readonly dbType?: DriveDbType;
};

type DriveDbRollbackResult = {
  readonly name: string;
  readonly status: string;
};

// Added to DriveDbClient
readonly rollback: (params: DriveDbRollbackParams) => Promise<DriveDbRollbackResult>;
```

New method on `DriveDatabase`:

```ts
// DriveRepository.ts -- DriveDatabase type
readonly rollback: () => Promise<void>;
```

### 3. `@diskd/typeorm-driver` package

Package structure:

```
packages/typeorm-driver/
  package.json
  tsconfig.json
  src/
    index.ts                    -- public exports
    DriveDataSourceOptions.ts   -- options type
    DriveDriver.ts              -- extends AbstractSqliteDriver
    DriveQueryRunner.ts         -- extends AbstractSqliteQueryRunner
    createDriveDataSource.ts    -- convenience factory
```

**DriveDataSourceOptions:**

```ts
interface DriveDataSourceOptions extends BaseDataSourceOptions {
  readonly type: 'diskd';
  readonly auth: AuthModule;
  readonly dbName: string;
  readonly dbType?: DriveDbType;
  readonly schema?: DriveDbSchema;
  readonly url?: string;
}
```

**DriveDriver** extends `AbstractSqliteDriver`:
- `connect()` -- creates `DriveDbClient` via `createDriveClient`, calls
  `drive.db.create()` with `checkExists: true` if schema is provided
- `disconnect()` -- no-op (stateless JSON-RPC)
- `createQueryRunner(mode)` -- returns `DriveQueryRunner`
- Inherits SQLite type mappings, escape logic, parameter handling from
  `AbstractSqliteDriver`

**DriveQueryRunner** extends `AbstractSqliteQueryRunner`:
- `query(sql, parameters?)` -- calls `drive.db.query({ name, sql, parameters })`
  and returns rows in TypeORM's `QueryResult` format
- `startTransaction()` -- no-op, sets `isTransactionActive = true`
- `commitTransaction()` -- calls `drive.db.commit({ name })`, sets
  `isTransactionActive = false`
- `rollbackTransaction()` -- calls `drive.db.rollback({ name })`, sets
  `isTransactionActive = false`
- `connect()` / `release()` -- no-op (stateless)

**Factory:**

```ts
import { createDriveDataSource } from '@diskd/typeorm-driver';

const dataSource = createDriveDataSource({
  auth,
  dbName: 'shop.workspace-123.main',
  entities: [User, Order],
  synchronize: true,
});

await dataSource.initialize();

const userRepo = dataSource.getRepository(User);
await userRepo.save({ id: 'u1', name: 'Alice', email: 'alice@example.com' });

const alice = await userRepo.findOneBy({ id: 'u1' });
const users = await userRepo.find({ where: { name: 'Alice' }, order: { name: 'ASC' } });

await dataSource.query('SELECT u.name, COUNT(o.id) FROM users u JOIN orders o ...');

// Persist to S3
await dataSource.driver.commit();  // or exposed as dataSource method
```


Error handling and UX
---------------------

**Rollback errors:**

| Condition                     | JSON-RPC error code | Message                          |
|-------------------------------|---------------------|----------------------------------|
| Database not found            | -32000              | `DATABASE_NOT_FOUND`             |
| Database is committing        | -32000              | `COMMIT_IN_PROGRESS`             |
| Lock acquisition timeout      | -32000              | `LOCK_TIMEOUT`                   |
| Cache deletion fails          | -32000              | `ROLLBACK_FAILED`                |

The SDK surfaces these as thrown errors (same pattern as all other Drive DB
methods). The TypeORM driver catches them in `rollbackTransaction()` and
re-throws as TypeORM `QueryFailedError`.

**TypeORM driver errors:**

- SQL syntax errors from `drive.db.query()` are re-thrown as
  `QueryFailedError` with the original SQLite error message
- Connection errors (HTTP failures) surface as `ConnectionError`
- Schema sync failures surface as `TypeORMError` with context


Future-proofing
---------------

- **Savepoints (v2):** If Drive DB adds a persistent connection mode (e.g.,
  WebSocket), nested transactions via `SAVEPOINT`/`RELEASE` become viable.
  The driver's `transactionSupport` field can be changed from `"none"` to
  `"nested"` without breaking the public API.
- **Schema introspection (v2):** Adding a `drive/db/tables` method that returns
  `sqlite_master` data would let TypeORM's `synchronize` diff against the
  live schema instead of always generating CREATE TABLE IF NOT EXISTS.
- **Migration runner (v2):** A CLI wrapper that reads TypeORM migration files
  and executes them via `drive.db.query()` + `drive.db.commit()`.
- **Read replicas:** If Drive DB adds read-from-S3-directly support, the driver
  can implement `obtainSlaveConnection()` for read scaling.


Implementation outline
----------------------

### Phase 1: Drive backend -- `drive/db/rollback`

1. Add `DriveDbRollbackResponse` dataclass to `drive_db/schema.py`
2. Add `rollback()` method to `DatabaseService`:
   - Acquire per-database lock
   - Look up database record via `_lookup_database`
   - Check status is not `committing` (reject if so)
   - Delete the cached local SQLite file from NVMe cache
   - Update status to `ready`
   - Return `DriveDbRollbackResponse(name=name, status="rolled_back")`
   - If no cached file exists, return `status="clean"`
3. Add `drive_db_rollback` handler to `drive_db_api.py`
4. Register `drive/db/rollback` in `init_module` dispatcher
5. Add unit test in `drive_db/tests/`

### Phase 2: SDK -- rollback support

1. Add `DriveDbRollbackParams` and `DriveDbRollbackResult` to `driveDbTypes.ts`
2. Add `rollback` method to `DriveDbClient` interface
3. Add `decodeRollback` decoder and wire `rollback` in `driveDb.ts`
4. Add `rollback()` to `DriveDatabase` in `DriveRepository.ts`
5. Export new types from `index.ts`
6. Typecheck

### Phase 3: `@diskd/typeorm-driver` package

1. Create `packages/typeorm-driver/` directory with `package.json`:
   - `peerDependencies: { "typeorm": ">=0.3.0" }`
   - `dependencies: { "@diskd/sdk": ">=0.3.1" }`
2. Implement `DriveDriver` extending `AbstractSqliteDriver`
3. Implement `DriveQueryRunner` extending `AbstractSqliteQueryRunner`
   - Override `query()` to route through `drive.db.query()`
   - Override transaction methods to use `commit`/`rollback`
4. Implement `DriveDataSourceOptions` type
5. Implement `createDriveDataSource()` factory
6. Export public API from `index.ts`
7. Add example with `User` and `Order` entities
8. Typecheck and unit test


Testing approach
----------------

**Phase 1 (backend):**
- Unit test: `drive_db_rollback` handler with mocked service
- Unit test: `DatabaseService.rollback()` verifying cache file deletion
- Unit test: rollback rejected when status is `committing`
- Unit test: rollback when no cached file exists returns `clean`
- Integration test: write -> rollback -> read confirms data is gone
- Integration test: write -> commit -> rollback -> read confirms committed
  data survives

**Phase 2 (SDK):**
- Unit test: `decodeRollback` decoder with valid and malformed input
- Unit test: `DriveDatabase.rollback()` calls `drive.db.rollback()` with
  correct params
- Typecheck: all new types and methods compile

**Phase 3 (TypeORM driver):**
- Unit test: `DriveQueryRunner.query()` routes SQL to `drive.db.query()` and
  returns `QueryResult`
- Unit test: `commitTransaction()` calls `drive.db.commit()`
- Unit test: `rollbackTransaction()` calls `drive.db.rollback()`
- Unit test: `startTransaction()` is a no-op that sets `isTransactionActive`
- Integration test: TypeORM entity CRUD (save, find, findOneBy, update, remove)
- Integration test: `synchronize: true` creates tables via Drive DB
- Integration test: transaction rollback discards uncommitted writes


Acceptance criteria
-------------------

**Backend:**
- Given a database with uncommitted writes, when `drive/db/rollback` is called,
  then subsequent reads return the last committed state
- Given a database with no cached file, when `drive/db/rollback` is called,
  then the response has `status: "clean"` and no error
- Given a database in `committing` status, when `drive/db/rollback` is called,
  then the request is rejected with `COMMIT_IN_PROGRESS`

**SDK:**
- `drive.db.rollback({ name })` sends `drive/db/rollback` JSON-RPC and decodes
  the response
- `db.rollback()` on `DriveDatabase` calls `drive.db.rollback()` with the
  correct database name and type

**TypeORM driver:**
- `dataSource.initialize()` creates the Drive DB database if `synchronize: true`
- `repository.save(entity)` executes INSERT via `drive.db.query()`
- `repository.findOneBy({ id })` executes SELECT via `drive.db.query()`
- `commitTransaction()` persists writes to S3 via `drive.db.commit()`
- `rollbackTransaction()` discards writes via `drive.db.rollback()`
- The package declares `typeorm` as `peerDependency`, not a direct dependency
- The core `@diskd/sdk` package does not gain a TypeORM dependency
