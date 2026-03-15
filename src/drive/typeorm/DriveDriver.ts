// ---------------------------------------------------------------------------
// DriveDriver -- TypeORM driver that routes SQL through Drive DB JSON-RPC
// ---------------------------------------------------------------------------

import type { DataSource, QueryRunner, ReplicationMode } from 'typeorm';
import { AbstractSqliteDriver } from 'typeorm/driver/sqlite-abstract/AbstractSqliteDriver.js';
import type { AuthModule } from '../../auth/types.js';
import { createDriveDbClient } from '../driveDb.js';
import type { DriveDbClient, DriveDbSchema, DriveDbType } from '../driveDbTypes.js';
import { jsonRpcCall } from '../rpc.js';
import { DriveQueryRunner } from './DriveQueryRunner.js';

// ---------------------------------------------------------------------------
// Internal options stashed on DataSource.options by diskd.os.datasource()
// ---------------------------------------------------------------------------

export type DriveConnectionOptions = {
  readonly auth: AuthModule;
  readonly dbName: string;
  readonly dbType?: DriveDbType;
  readonly schema?: DriveDbSchema;
  readonly url: string;
};

// ---------------------------------------------------------------------------
// RPC call factory (same pattern as drive.ts)
// ---------------------------------------------------------------------------

const createCallFn = (
  auth: AuthModule,
  rpcUrl: string
): ((method: string, rpcParams: unknown) => Promise<unknown>) => {
  let nextId = 1;

  return async (method, rpcParams) => {
    const id = nextId;
    nextId += 1;

    if (auth.getRequestHeaders) {
      const headers = await auth.getRequestHeaders();
      return jsonRpcCall({ url: rpcUrl, headers, method, rpcParams, id });
    }

    const bearerToken = await auth.getAccessToken();
    return jsonRpcCall({ url: rpcUrl, bearerToken, method, rpcParams, id });
  };
};

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export class DriveDriver extends AbstractSqliteDriver {
  readonly driveOptions: DriveConnectionOptions;

  constructor(connection: DataSource) {
    super(connection);

    const opts = (connection.options as unknown as Record<string, unknown>)._driveOptions as
      | DriveConnectionOptions
      | undefined;
    if (!opts) {
      throw new Error(
        '@diskd/sdk: missing Drive options. Use diskd.os.datasource() to create the DataSource.'
      );
    }

    this.driveOptions = opts;
    this.database = opts.dbName;
    this.treeSupport = true;
    (this as unknown as Record<string, unknown>).transactionSupport = 'simple';
  }

  protected loadDependencies(): void {
    (this as unknown as Record<string, unknown>).sqlite = {};
  }

  protected async createDatabaseConnection(): Promise<DriveDbClient> {
    const rpcUrl = this.driveOptions.url.replace(/\/+$/, '');
    const call = createCallFn(this.driveOptions.auth, rpcUrl);
    const db = createDriveDbClient({ call });

    if (this.driveOptions.schema) {
      await db.create({
        name: this.driveOptions.dbName,
        schema: this.driveOptions.schema,
        checkExists: true,
        dbType: this.driveOptions.dbType,
      });
    }

    return db;
  }

  async afterConnect(): Promise<void> {}

  async disconnect(): Promise<void> {
    (this as unknown as Record<string, unknown>).queryRunner = undefined;
    (this as unknown as Record<string, unknown>).databaseConnection = undefined;
  }

  createQueryRunner(_mode: ReplicationMode): QueryRunner {
    if (!(this as unknown as Record<string, unknown>).queryRunner) {
      (this as unknown as Record<string, unknown>).queryRunner = new DriveQueryRunner(this);
    }
    return (this as unknown as Record<string, unknown>).queryRunner as QueryRunner;
  }

  /** Flush WAL to S3. */
  async commit(): Promise<{ readonly commitId: string }> {
    const db = this.databaseConnection as DriveDbClient;
    const result = await db.commit({
      name: this.driveOptions.dbName,
      dbType: this.driveOptions.dbType,
    });
    return { commitId: result.commitId };
  }

  /** Discard uncommitted WAL changes. */
  async driveRollback(): Promise<void> {
    const db = this.databaseConnection as DriveDbClient;
    await db.rollback({
      name: this.driveOptions.dbName,
      dbType: this.driveOptions.dbType,
    });
  }
}
