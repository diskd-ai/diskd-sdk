// ---------------------------------------------------------------------------
// DriveDataSourceOptions -- configuration for the Drive DB TypeORM driver
// ---------------------------------------------------------------------------

import type { AuthModule, DriveDbType, DriveDbSchema } from '@diskd-ai/sdk';

/**
 * Options for creating a Drive DB-backed TypeORM DataSource.
 *
 * Standard TypeORM options (entities, synchronize, logging, etc.) are passed
 * through to the underlying DataSource. Drive-specific options control the
 * JSON-RPC connection to the Drive DB backend.
 */
export type DriveDataSourceOptions = {
  /** Auth module for Drive API requests. */
  readonly auth: AuthModule;

  /** Drive DB database name (e.g., 'shop.workspace-123.main'). */
  readonly dbName: string;

  /** Optional database type (passed to all JSON-RPC calls). */
  readonly dbType?: DriveDbType;

  /** Optional schema for auto-creation on connect. */
  readonly schema?: DriveDbSchema;

  /** Drive API JSON-RPC endpoint URL (e.g., 'https://apis.upgraide.me/drive/api/v1'). */
  readonly url: string;

  /** TypeORM entity classes to register. */
  readonly entities?: ReadonlyArray<Function | string>;

  /** Auto-synchronize schema on connect (sends DDL via drive.db.query). */
  readonly synchronize?: boolean;

  /** TypeORM logging configuration. */
  readonly logging?: boolean | 'all' | ReadonlyArray<string>;
};
