// ---------------------------------------------------------------------------
// DriveQueryRunner -- routes SQL through Drive DB JSON-RPC
// ---------------------------------------------------------------------------
//
// Extends AbstractSqliteQueryRunner. The key override is query() which sends
// all SQL to drive.db.query() and intercepts transaction control statements
// (BEGIN/COMMIT/ROLLBACK) to map them to Drive DB's commit/rollback semantics.
//
// Transaction mapping:
//   BEGIN TRANSACTION  -> no-op (writes auto-accumulate in WAL)
//   COMMIT             -> drive.db.commit (flush WAL to S3)
//   ROLLBACK           -> drive.db.rollback (discard WAL, revert to last commit)
//   SAVEPOINT / RELEASE -> no-op (nested transactions deferred to v2)
// ---------------------------------------------------------------------------

import { AbstractSqliteQueryRunner } from 'typeorm/driver/sqlite-abstract/AbstractSqliteQueryRunner';
import { QueryResult } from 'typeorm';
import type { DriveDbClient } from '@diskd/sdk';
import type { DriveDriver } from './DriveDriver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRANSACTION_BEGIN = /^(BEGIN(\s+TRANSACTION)?|SAVEPOINT\s)/i;
const TRANSACTION_COMMIT = /^(COMMIT|RELEASE\s)/i;
const TRANSACTION_ROLLBACK = /^(ROLLBACK(\s+TO)?)\b/i;
const DML_PREFIX = /^\s*(INSERT|UPDATE|DELETE)\b/i;

const emptyQueryResult = (): QueryResult => {
  const r = new QueryResult();
  r.raw = [];
  r.records = [];
  return r;
};

// ---------------------------------------------------------------------------
// QueryRunner
// ---------------------------------------------------------------------------

export class DriveQueryRunner extends AbstractSqliteQueryRunner {
  declare driver: DriveDriver;

  constructor(driver: DriveDriver) {
    super();
    this.driver = driver;
  }

  // -- Accessors --------------------------------------------------------- //

  private get db(): DriveDbClient {
    return this.driver.databaseConnection as DriveDbClient;
  }

  private get dbName(): string {
    return this.driver.driveOptions.dbName;
  }

  private get dbType() {
    return this.driver.driveOptions.dbType;
  }

  // -- Connection lifecycle (stateless JSON-RPC) ------------------------- //

  async connect(): Promise<void> {
    // No-op: Drive DB is stateless, no connection to reserve.
  }

  async release(): Promise<void> {
    // No-op: nothing to release.
  }

  // -- Query execution --------------------------------------------------- //

  async query(
    sql: string,
    parameters?: unknown[],
    useStructuredResult?: boolean,
  ): Promise<unknown> {
    const trimmed = sql.trim();

    // -- Transaction control interception -------------------------------- //

    if (TRANSACTION_BEGIN.test(trimmed)) {
      // No-op: writes auto-accumulate in Drive DB WAL.
      return useStructuredResult ? emptyQueryResult() : [];
    }

    if (TRANSACTION_COMMIT.test(trimmed)) {
      await this.db.commit({ name: this.dbName, dbType: this.dbType });
      return useStructuredResult ? emptyQueryResult() : [];
    }

    if (TRANSACTION_ROLLBACK.test(trimmed)) {
      await this.db.rollback({ name: this.dbName, dbType: this.dbType });
      return useStructuredResult ? emptyQueryResult() : [];
    }

    // -- Regular SQL ------------------------------------------------------ //

    const queryResult = await this.db.query({
      name: this.dbName,
      sql,
      parameters: parameters && parameters.length > 0 ? parameters : undefined,
      dbType: this.dbType,
    });

    const rows = queryResult.rows as Record<string, unknown>[];
    const isDml = DML_PREFIX.test(trimmed);

    if (useStructuredResult) {
      const result = new QueryResult();
      result.records = rows;
      result.raw = isDml ? 0 : rows;
      // Affected row count is not available in v1 (each JSON-RPC call is a
      // separate SQLite connection, so changes() returns 0). TypeORM handles
      // this gracefully for explicit-PK entities (ULIDs).
      if (isDml) {
        result.affected = 0;
      }
      return result;
    }

    // Non-structured result: mimic better-sqlite3 return shape.
    if (isDml) {
      return { changes: 0, lastInsertRowid: 0 };
    }

    return rows;
  }

  // -- Migration hooks --------------------------------------------------- //

  async beforeMigration(): Promise<void> {
    // No-op: no PRAGMA changes needed.
  }

  async afterMigration(): Promise<void> {
    // No-op.
  }
}
