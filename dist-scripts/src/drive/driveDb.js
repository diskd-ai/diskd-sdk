// ---------------------------------------------------------------------------
// Drive Database client -- JSON-RPC 2.0 (snake_case wire format)
// ---------------------------------------------------------------------------
const raw = (result) => {
    if (typeof result !== 'object' || result === null) {
        throw new Error('Invalid Drive DB response: expected object');
    }
    return result;
};
const str = (obj, key) => {
    const v = obj[key];
    return typeof v === 'string' ? v : null;
};
const strRequired = (obj, key) => {
    const v = str(obj, key);
    if (v === null)
        throw new Error(`Invalid Drive DB response: '${key}' must be a string`);
    return v;
};
const num = (obj, key) => {
    const v = obj[key];
    if (typeof v !== 'number')
        throw new Error(`Invalid Drive DB response: '${key}' must be a number`);
    return v;
};
const bool = (obj, key) => {
    const v = obj[key];
    return typeof v === 'boolean' ? v : false;
};
// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------
const decodeCreate = (o) => {
    const r = raw(o);
    return {
        dbInode: strRequired(r, 'db_inode'),
        fileId: strRequired(r, 'file_id'),
        name: strRequired(r, 'name'),
        status: strRequired(r, 'status'),
    };
};
const decodeInsert = (o) => {
    const r = raw(o);
    return {
        inserted: num(r, 'inserted'),
        pendingRows: num(r, 'pending_rows'),
        status: strRequired(r, 'status'),
    };
};
const decodeQuery = (o) => {
    const r = raw(o);
    const rows = r.rows;
    if (!Array.isArray(rows))
        throw new Error('Invalid Drive DB response: rows must be array');
    return { rows: rows };
};
const decodeCommit = (o) => {
    const r = raw(o);
    return {
        status: strRequired(r, 'status'),
        commitId: strRequired(r, 'commit_id'),
        enqueuedAt: strRequired(r, 'enqueued_at'),
        completedAt: str(r, 'completed_at'),
    };
};
const decodeRollback = (o) => {
    const r = raw(o);
    return {
        name: strRequired(r, 'name'),
        status: strRequired(r, 'status'),
    };
};
const decodeMetadata = (o) => {
    const r = raw(o);
    return {
        inode: strRequired(r, 'inode'),
        displayName: strRequired(r, 'display_name'),
        typeLabel: strRequired(r, 'type_label'),
        recordCount: num(r, 'record_count'),
        indexed: strRequired(r, 'indexed'),
        lastSyncAt: strRequired(r, 'last_sync_at'),
        sizeBytes: num(r, 'size_bytes'),
        owner: strRequired(r, 'owner'),
    };
};
const decodeDrop = (o) => {
    const r = raw(o);
    return {
        name: strRequired(r, 'name'),
        status: strRequired(r, 'status'),
        deletedFromMetadata: bool(r, 'deleted_from_metadata'),
        deletedFromS3: bool(r, 'deleted_from_s3'),
        deletedFromCache: bool(r, 'deleted_from_cache'),
        deletedFromDrive: bool(r, 'deleted_from_drive'),
    };
};
const decodeSetStatus = (o) => {
    const r = raw(o);
    return {
        name: strRequired(r, 'name'),
        status: strRequired(r, 'status'),
        error: str(r, 'error'),
    };
};
const decodeResolveByInode = (o) => {
    const r = raw(o);
    return {
        name: strRequired(r, 'name'),
        dbInode: strRequired(r, 'db_inode'),
        fileId: strRequired(r, 'file_id'),
        status: strRequired(r, 'status'),
        dbType: strRequired(r, 'db_type'),
    };
};
const decodeResolveWithSettings = (o) => {
    const r = raw(o);
    const settings = r.settings;
    const settingsMap = {};
    if (typeof settings === 'object' && settings !== null) {
        for (const [k, v] of Object.entries(settings)) {
            if (typeof v === 'string')
                settingsMap[k] = v;
        }
    }
    return {
        name: strRequired(r, 'name'),
        dbInode: strRequired(r, 'db_inode'),
        fileId: strRequired(r, 'file_id'),
        status: strRequired(r, 'status'),
        dbType: strRequired(r, 'db_type'),
        settings: settingsMap,
    };
};
// ---------------------------------------------------------------------------
// Encode helpers (domain camelCase -> wire snake_case)
// ---------------------------------------------------------------------------
const optional = (key, value) => value !== undefined ? { [key]: value } : {};
export const createDriveDbClient = (deps) => ({
    create: async (p) => {
        const result = await deps.call('drive/db/create', {
            name: p.name,
            ...optional('schema', p.schema),
            ...optional('check_exists', p.checkExists),
            ...optional('recreate', p.recreate),
            ...optional('directory', p.directory),
            ...optional('db_type', p.dbType),
        });
        return decodeCreate(result);
    },
    insert: async (p) => {
        const result = await deps.call('drive/db/insert', {
            name: p.name,
            table: p.table,
            rows: [...p.rows],
            ...optional('db_type', p.dbType),
        });
        return decodeInsert(result);
    },
    query: async (p) => {
        const result = await deps.call('drive/db/query', {
            name: p.name,
            sql: p.sql,
            ...optional('parameters', p.parameters ? [...p.parameters] : undefined),
            ...optional('db_type', p.dbType),
        });
        return decodeQuery(result);
    },
    commit: async (p) => {
        const result = await deps.call('drive/db/commit', {
            name: p.name,
            ...optional('db_type', p.dbType),
        });
        return decodeCommit(result);
    },
    rollback: async (p) => {
        const result = await deps.call('drive/db/rollback', {
            name: p.name,
            ...optional('db_type', p.dbType),
        });
        return decodeRollback(result);
    },
    metadata: async (p) => {
        const result = await deps.call('drive/db/metadata', {
            name: p.name,
            ...optional('db_type', p.dbType),
        });
        return decodeMetadata(result);
    },
    drop: async (p) => {
        const result = await deps.call('drive/db/drop', {
            name: p.name,
            ...optional('db_type', p.dbType),
        });
        return decodeDrop(result);
    },
    setStatus: async (p) => {
        const result = await deps.call('drive/db/set-status', {
            name: p.name,
            status: p.status,
            ...optional('error', p.error),
            ...optional('db_type', p.dbType),
        });
        return decodeSetStatus(result);
    },
    resolveByInode: async (p) => {
        const result = await deps.call('drive/db/resolve-by-inode', {
            db_inode: p.dbInode,
            ...optional('db_type', p.dbType),
        });
        return decodeResolveByInode(result);
    },
    resolveWithSettings: async (p) => {
        const result = await deps.call('drive/db/resolve-with-settings', {
            db_inode: p.dbInode,
            ...optional('db_type', p.dbType),
        });
        return decodeResolveWithSettings(result);
    },
});
