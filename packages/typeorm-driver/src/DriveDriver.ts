// ---------------------------------------------------------------------------
// DriveDriver -- TypeORM driver that routes SQL through Drive DB JSON-RPC
// ---------------------------------------------------------------------------
//
// Extends AbstractSqliteDriver to inherit all SQLite type mappings, schema
// builder, and parameter handling. Overrides the connection layer to use
// DriveDbClient instead of a local SQLite binding.
// ---------------------------------------------------------------------------

import { AbstractSqliteDriver } from 'typeorm/driver/sqlite-abstract/AbstractSqliteDriver';
import type { DataSource, QueryRunner, ReplicationMode } from 'typeorm';
import { createDriveDbClient, jsonRpcCall } from '@diskd-ai/sdk';
import type { AuthModule, DriveDbClient, DriveDbType, DriveDbSchema } from '@diskd-ai/sdk';
import { DriveQueryRunner } from './DriveQueryRunner';

// ---------------------------------------------------------------------------
// Internal options stashed on DataSource.options by createDriveDataSource
// ---------------------------------------------------------------------------

export type DriveConnectionOptions = {
  readonly auth: AuthModule;
  readonly dbName: string;
  readonly dbType?: DriveDbType;
  readonly schema?: DriveDbSchema;
  readonly url: string;
};

// ---------------------------------------------------------------------------
// RPC call factory (same pattern as sdk/drive.ts)
// ---------------------------------------------------------------------------

const createCallFn = (
  auth: AuthModule,
  rpcUrl: string,
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

    const opts = (connection.options as unknown as Record<string, unknown>)
      ._driveOptions as DriveConnectionOptions | undefined;
    if (!opts) {
      throw new Error(
        '@diskd/typeorm-driver: missing Drive options. ' +
          'Use createDriveDataSource() to create the DataSource.',
      );
    }

    this.driveOptions = opts;
    this.database = opts.dbName;

    // SQLite supports WITH RECURSIVE
    this.treeSupport = true;

    // "simple" tells TypeORM to send BEGIN/COMMIT/ROLLBACK through query()
    // where DriveQueryRunner intercepts them.
    (this as unknown as Record<string, unknown>).transactionSupport = 'simple';
  }

  // -- No native SQLite library to load ---------------------------------- //

  protected loadDependencies(): void {
    // AbstractSqliteDriver stores the native library on this.sqlite.
    // We set an empty stub since all SQL goes through JSON-RPC.
    (this as unknown as Record<string, unknown>).sqlite = {};
  }

  // -- Connection lifecycle ---------------------------------------------- //

  protected async createDatabaseConnection(): Promise<DriveDbClient> {
    const rpcUrl = this.driveOptions.url.replace(/\/+$/, '');
    const call = createCallFn(this.driveOptions.auth, rpcUrl);
    const db = createDriveDbClient({ call });

    // Ensure the database exists when a schema is provided.
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

  async afterConnect(): Promise<void> {
    // No PRAGMAs needed -- journal mode and cache are managed by Drive backend.
  }

  async disconnect(): Promise<void> {
    (this as unknown as Record<string, unknown>).queryRunner = undefined;
    (this as unknown as Record<string, unknown>).databaseConnection = undefined;
  }

  // -- QueryRunner factory ----------------------------------------------- //

  createQueryRunner(_mode: ReplicationMode): QueryRunner {
    if (!(this as unknown as Record<string, unknown>).queryRunner) {
      (this as unknown as Record<string, unknown>).queryRunner =
        new DriveQueryRunner(this);
    }
    return (this as unknown as Record<string, unknown>).queryRunner as QueryRunner;
  }

  // -- Drive DB persistence ---------------------------------------------- //

  /** Flush WAL to S3 (call after a batch of writes to persist durably). */
  async commit(): Promise<{ readonly commitId: string }> {
    const db = this.databaseConnection as DriveDbClient;
    const result = await db.commit({
      name: this.driveOptions.dbName,
      dbType: this.driveOptions.dbType,
    });
    return { commitId: result.commitId };
  }

  /** Discard uncommitted WAL changes (revert to last S3 commit). */
  async driveRollback(): Promise<void> {
    const db = this.databaseConnection as DriveDbClient;
    await db.rollback({
      name: this.driveOptions.dbName,
      dbType: this.driveOptions.dbType,
    });
  }
}
