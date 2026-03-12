// ---------------------------------------------------------------------------
// DriveDatabase + DriveRepository
// ---------------------------------------------------------------------------
//
// DriveDatabase -- database lifecycle (create, commit, drop, raw SQL, metadata)
// DriveRepository -- table-scoped CRUD (insert, find, findOne, count, update, delete)
//
// Usage:
//   const db = diskd.database({
//     auth,
//     dbName: 'shop.workspace-123.main',
//     schema: {
//       users:  { id: { type: 'TEXT', primaryKey: true }, name: { type: 'TEXT', notNull: true } },
//       orders: { id: { type: 'TEXT', primaryKey: true }, user_id: { type: 'TEXT' } },
//     },
//   });
//
//   await db.ensureCreated();
//
//   const users = db.repository('users');
//   await users.insert([{ id: 'u1', name: 'Alice' }]);
//   const alice = await users.findOne({ id: 'u1' });
//
//   await db.commit();
// ---------------------------------------------------------------------------

import type { DriveDbClient, DriveDbSchema, DriveDbType } from './driveDbTypes.js';

// ---------------------------------------------------------------------------
// Types -- Repository (table-scoped CRUD)
// ---------------------------------------------------------------------------

export type WhereClause = {
  readonly [column: string]: unknown;
};

export type OrderByClause = {
  readonly column: string;
  readonly direction?: 'ASC' | 'DESC';
};

export type FindOptions = {
  readonly where?: WhereClause;
  readonly orderBy?: OrderByClause | readonly OrderByClause[];
  readonly limit?: number;
  readonly offset?: number;
};

export type UpdateOptions = {
  readonly where: WhereClause;
  readonly set: Readonly<Record<string, unknown>>;
};

export type DriveRepository = {
  /** Table name this repository operates on. */
  readonly table: string;

  /** Insert one or more rows. */
  readonly insert: (
    rows: readonly Readonly<Record<string, unknown>>[],
  ) => Promise<{ readonly inserted: number }>;

  /** Find rows matching criteria. */
  readonly find: (options?: FindOptions) => Promise<readonly Readonly<Record<string, unknown>>[]>;

  /** Find a single row matching criteria, or null. */
  readonly findOne: (where: WhereClause) => Promise<Readonly<Record<string, unknown>> | null>;

  /** Count rows matching criteria. */
  readonly count: (where?: WhereClause) => Promise<number>;

  /** Update rows matching criteria. */
  readonly update: (options: UpdateOptions) => Promise<void>;

  /** Delete rows matching criteria. */
  readonly deleteRows: (where: WhereClause) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Types -- Database (lifecycle + raw operations)
// ---------------------------------------------------------------------------

export type DriveDatabaseParams = {
  readonly dbName: string;
  readonly dbType?: DriveDbType;
  readonly schema?: DriveDbSchema;
};

export type DriveDatabaseConfig = {
  readonly db: DriveDbClient;
  readonly dbName: string;
  readonly dbType?: DriveDbType;
  readonly schema?: DriveDbSchema;
};

export type DriveDatabase = {
  /** Database name. */
  readonly dbName: string;

  /** Create the database (idempotent -- checkExists: true). */
  readonly ensureCreated: () => Promise<{ readonly dbInode: string; readonly fileId: string }>;

  /** Recreate the database (drops if exists). */
  readonly recreate: () => Promise<{ readonly dbInode: string; readonly fileId: string }>;

  /** Get a table-scoped repository with CRUD operations. */
  readonly repository: (table: string) => DriveRepository;

  /** Execute a raw SQL query with optional parameters. */
  readonly query: (
    sql: string,
    parameters?: readonly unknown[],
  ) => Promise<readonly Readonly<Record<string, unknown>>[]>;

  /** Commit pending changes (flush WAL to S3). */
  readonly commit: () => Promise<{ readonly commitId: string }>;

  /** Get database metadata. */
  readonly metadata: () => Promise<{
    readonly inode: string;
    readonly displayName: string;
    readonly recordCount: number;
    readonly sizeBytes: number;
  }>;

  /** Set external processing status. */
  readonly setStatus: (status: string, error?: string) => Promise<void>;

  /** Drop the database entirely. */
  readonly drop: () => Promise<{ readonly deletedFromMetadata: boolean }>;

  /** Access the underlying DriveDbClient for advanced operations. */
  readonly raw: DriveDbClient;
};

// ---------------------------------------------------------------------------
// SQL builder helpers (pure functions)
// ---------------------------------------------------------------------------

const buildWhereClause = (
  where: WhereClause,
): { readonly sql: string; readonly params: readonly unknown[] } => {
  const keys = Object.keys(where);
  if (keys.length === 0) return { sql: '', params: [] };

  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const key of keys) {
    const value = where[key];
    if (value === null) {
      conditions.push(`${key} IS NULL`);
    } else {
      conditions.push(`${key} = ?`);
      params.push(value);
    }
  }

  return { sql: ` WHERE ${conditions.join(' AND ')}`, params };
};

const buildOrderByClause = (
  orderBy: OrderByClause | readonly OrderByClause[],
): string => {
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  if (clauses.length === 0) return '';
  const parts = clauses.map((c) => `${c.column} ${c.direction ?? 'ASC'}`);
  return ` ORDER BY ${parts.join(', ')}`;
};

const buildLimitOffset = (limit?: number, offset?: number): string => {
  let sql = '';
  if (limit !== undefined) sql += ` LIMIT ${limit}`;
  if (offset !== undefined) sql += ` OFFSET ${offset}`;
  return sql;
};

// ---------------------------------------------------------------------------
// Repository factory (table-scoped)
// ---------------------------------------------------------------------------

const createRepository = (deps: {
  readonly table: string;
  readonly dbName: string;
  readonly dbType: DriveDbType | undefined;
  readonly db: DriveDbClient;
  readonly execQuery: (sql: string, params?: readonly unknown[]) => Promise<readonly Readonly<Record<string, unknown>>[]>;
}): DriveRepository => {
  const { table, db, dbName, dbType, execQuery } = deps;

  return {
    table,

    insert: async (rows) => {
      const result = await db.insert({ name: dbName, table, rows, dbType });
      return { inserted: result.inserted };
    },

    find: async (options) => {
      const { where, orderBy, limit, offset } = options ?? {};
      const w = where ? buildWhereClause(where) : { sql: '', params: [] };
      const sql = `SELECT * FROM ${table}${w.sql}${orderBy ? buildOrderByClause(orderBy) : ''}${buildLimitOffset(limit, offset)}`;
      return execQuery(sql, w.params.length > 0 ? w.params : undefined);
    },

    findOne: async (where) => {
      const w = buildWhereClause(where);
      const sql = `SELECT * FROM ${table}${w.sql} LIMIT 1`;
      const rows = await execQuery(sql, w.params.length > 0 ? w.params : undefined);
      return rows.length > 0 ? rows[0] : null;
    },

    count: async (where) => {
      const w = where ? buildWhereClause(where) : { sql: '', params: [] };
      const sql = `SELECT COUNT(*) AS cnt FROM ${table}${w.sql}`;
      const rows = await execQuery(sql, w.params.length > 0 ? w.params : undefined);
      return Number(rows[0]?.cnt ?? 0);
    },

    update: async (options) => {
      const { where, set } = options;
      const setCols = Object.keys(set);
      if (setCols.length === 0) return;
      const setParts = setCols.map((col) => `${col} = ?`);
      const setParams = setCols.map((col) => set[col]);
      const w = buildWhereClause(where);
      const sql = `UPDATE ${table} SET ${setParts.join(', ')}${w.sql}`;
      await execQuery(sql, [...setParams, ...w.params]);
    },

    deleteRows: async (where) => {
      const w = buildWhereClause(where);
      const sql = `DELETE FROM ${table}${w.sql}`;
      await execQuery(sql, w.params.length > 0 ? w.params : undefined);
    },
  };
};

// ---------------------------------------------------------------------------
// Database factory
// ---------------------------------------------------------------------------

export const createDriveDatabase = (config: DriveDatabaseConfig): DriveDatabase => {
  const { db, dbName, dbType, schema } = config;

  const execQuery = async (
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly Readonly<Record<string, unknown>>[]> => {
    const result = await db.query({ name: dbName, sql, parameters, dbType });
    return result.rows;
  };

  return {
    dbName,

    ensureCreated: async () => {
      const result = await db.create({ name: dbName, schema, checkExists: true, dbType });
      return { dbInode: result.dbInode, fileId: result.fileId };
    },

    recreate: async () => {
      const result = await db.create({ name: dbName, schema, recreate: true, dbType });
      return { dbInode: result.dbInode, fileId: result.fileId };
    },

    repository: (table) => createRepository({ table, dbName, dbType, db, execQuery }),

    query: execQuery,

    commit: async () => {
      const result = await db.commit({ name: dbName, dbType });
      return { commitId: result.commitId };
    },

    metadata: async () => {
      const result = await db.metadata({ name: dbName, dbType });
      return {
        inode: result.inode,
        displayName: result.displayName,
        recordCount: result.recordCount,
        sizeBytes: result.sizeBytes,
      };
    },

    setStatus: async (status, error) => {
      await db.setStatus({ name: dbName, status, error, dbType });
    },

    drop: async () => {
      const result = await db.drop({ name: dbName, dbType });
      return { deletedFromMetadata: result.deletedFromMetadata };
    },

    raw: db,
  };
};
