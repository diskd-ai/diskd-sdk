// ---------------------------------------------------------------------------
// DriveQueryRunner -- routes SQL through Drive DB JSON-RPC
// ---------------------------------------------------------------------------

import { QueryResult } from 'typeorm';
import { AbstractSqliteQueryRunner } from 'typeorm/driver/sqlite-abstract/AbstractSqliteQueryRunner.js';
import type { DriveDbClient } from '../driveDbTypes.js';
import type { DriveDriver } from './DriveDriver.js';

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

  private get db(): DriveDbClient {
    return this.driver.databaseConnection as DriveDbClient;
  }

  private get dbName(): string {
    return this.driver.driveOptions.dbName;
  }

  private get dbType() {
    return this.driver.driveOptions.dbType;
  }

  async connect(): Promise<void> {}
  async release(): Promise<void> {}

  async query(
    sql: string,
    parameters?: unknown[],
    useStructuredResult?: boolean
  ): Promise<unknown> {
    const trimmed = sql.trim();

    if (TRANSACTION_BEGIN.test(trimmed)) {
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
      if (isDml) {
        result.affected = 0;
      }
      return result;
    }

    if (isDml) {
      return { changes: 0, lastInsertRowid: 0 };
    }

    return rows;
  }

  async beforeMigration(): Promise<void> {}
  async afterMigration(): Promise<void> {}
}
