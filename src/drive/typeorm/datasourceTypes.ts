// ---------------------------------------------------------------------------
// diskd.datasource() -- types
// ---------------------------------------------------------------------------

import type { AuthModule } from '../../auth/types.js';
import type { DriveDbType, DriveDbSchema } from '../driveDbTypes.js';

// ---------------------------------------------------------------------------
// Input params
// ---------------------------------------------------------------------------

export type DriveDataSourceParams = {
  /** Auth module for Drive API requests. */
  readonly auth: AuthModule;

  /** Drive DB database name (e.g., 'shop.workspace-123.main'). */
  readonly dbName: string;

  /** Optional database type (passed to all JSON-RPC calls). */
  readonly dbType?: DriveDbType;

  /** Optional schema for auto-creation on connect. */
  readonly schema?: DriveDbSchema;

  /** Drive API JSON-RPC endpoint URL. */
  readonly url: string;

  /** TypeORM entity classes to register. */
  readonly entities?: ReadonlyArray<Function | string>;

  /** Auto-synchronize schema on connect. */
  readonly synchronize?: boolean;

  /** TypeORM logging configuration. */
  readonly logging?: boolean | 'all' | ReadonlyArray<string>;
};

// ---------------------------------------------------------------------------
// Structural return types (avoids hard dependency on typeorm for consumers)
// ---------------------------------------------------------------------------

export type DriveDataSourceDriver = {
  /** Flush WAL to S3. */
  readonly commit: () => Promise<{ readonly commitId: string }>;
  /** Discard uncommitted WAL changes (revert to last commit). */
  readonly driveRollback: () => Promise<void>;
  /** Drive connection options. */
  readonly driveOptions: { readonly dbName: string };
};

export type DriveDataSourceRepository<T> = {
  readonly save: (entity: Partial<T> | ReadonlyArray<Partial<T>>) => Promise<T>;
  readonly find: (options?: Record<string, unknown>) => Promise<readonly T[]>;
  readonly findBy: (where: Record<string, unknown>) => Promise<readonly T[]>;
  readonly findOneBy: (where: Record<string, unknown>) => Promise<T | null>;
  readonly count: (options?: Record<string, unknown>) => Promise<number>;
  readonly update: (criteria: Record<string, unknown>, partial: Partial<T>) => Promise<unknown>;
  readonly remove: (entity: T) => Promise<T>;
};

export type DriveDataSource = {
  /** Connect to Drive DB and sync schema if configured. */
  readonly initialize: () => Promise<unknown>;
  /** Disconnect. */
  readonly destroy: () => Promise<void>;
  /** Execute raw SQL. */
  readonly query: (query: string, parameters?: unknown[]) => Promise<unknown>;
  /** Get a typed repository for an entity class. */
  readonly getRepository: <T>(target: { new (): T }) => DriveDataSourceRepository<T>;
  /** The underlying DriveDriver with commit/rollback. */
  readonly driver: DriveDataSourceDriver;
};
