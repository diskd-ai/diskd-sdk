// ---------------------------------------------------------------------------
// DriveDatabase + DriveRepository
// ---------------------------------------------------------------------------
//
// DriveDatabase -- database lifecycle (create, commit, drop, raw SQL, metadata)
// DriveRepository -- table-scoped CRUD (insert, find, findOne, count, update, delete)
//
// Usage:
//   const db = diskd.os.database({
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
// ---------------------------------------------------------------------------
// SQL builder helpers (pure functions)
// ---------------------------------------------------------------------------
const buildWhereClause = (where) => {
    const keys = Object.keys(where);
    if (keys.length === 0)
        return { sql: '', params: [] };
    const conditions = [];
    const params = [];
    for (const key of keys) {
        const value = where[key];
        if (value === null) {
            conditions.push(`${key} IS NULL`);
        }
        else {
            conditions.push(`${key} = ?`);
            params.push(value);
        }
    }
    return { sql: ` WHERE ${conditions.join(' AND ')}`, params };
};
const buildOrderByClause = (orderBy) => {
    const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
    if (clauses.length === 0)
        return '';
    const parts = clauses.map((c) => `${c.column} ${c.direction ?? 'ASC'}`);
    return ` ORDER BY ${parts.join(', ')}`;
};
const buildLimitOffset = (limit, offset) => {
    let sql = '';
    if (limit !== undefined)
        sql += ` LIMIT ${limit}`;
    if (offset !== undefined)
        sql += ` OFFSET ${offset}`;
    return sql;
};
// ---------------------------------------------------------------------------
// Repository factory (table-scoped)
// ---------------------------------------------------------------------------
const createRepository = (deps) => {
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
            if (setCols.length === 0)
                return;
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
export const createDriveDatabase = (config) => {
    const { db, dbName, dbType, schema } = config;
    const execQuery = async (sql, parameters) => {
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
        rollback: async () => {
            await db.rollback({ name: dbName, dbType });
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
