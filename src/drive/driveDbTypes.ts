// ---------------------------------------------------------------------------
// Drive Database API -- pure types (no classes, no I/O)
// ---------------------------------------------------------------------------

// -- Database type discriminant --

export type DriveDbType = 'database' | 'telegram' | 'webarchive' | 'session';

// -- Schema definition for table creation --

export type DriveDbColumnDef = {
  readonly type: string;
  readonly primaryKey?: boolean;
  readonly notNull?: boolean;
  readonly defaultValue?: string | number | boolean | null;
};

export type DriveDbTableSchema = {
  readonly [column: string]: DriveDbColumnDef;
};

export type DriveDbSchema = {
  readonly [table: string]: DriveDbTableSchema;
};

// -- Params --

export type DriveDbCreateParams = {
  readonly name: string;
  readonly schema?: DriveDbSchema;
  readonly checkExists?: boolean;
  readonly recreate?: boolean;
  readonly directory?: string;
  readonly dbType?: DriveDbType;
};

export type DriveDbInsertParams = {
  readonly name: string;
  readonly table: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly dbType?: DriveDbType;
};

export type DriveDbQueryParams = {
  readonly name: string;
  readonly sql: string;
  readonly parameters?: readonly unknown[];
  readonly dbType?: DriveDbType;
};

export type DriveDbCommitParams = {
  readonly name: string;
  readonly dbType?: DriveDbType;
};

export type DriveDbMetadataParams = {
  readonly name: string;
  readonly dbType?: DriveDbType;
};

export type DriveDbDropParams = {
  readonly name: string;
  readonly dbType?: DriveDbType;
};

export type DriveDbSetStatusParams = {
  readonly name: string;
  readonly status: string;
  readonly error?: string;
  readonly dbType?: DriveDbType;
};

export type DriveDbResolveByInodeParams = {
  readonly dbInode: string;
  readonly dbType?: DriveDbType;
};

export type DriveDbResolveWithSettingsParams = {
  readonly dbInode: string;
  readonly dbType?: DriveDbType;
};

// -- Results --

export type DriveDbCreateResult = {
  readonly dbInode: string;
  readonly fileId: string;
  readonly name: string;
  readonly status: string;
};

export type DriveDbInsertResult = {
  readonly inserted: number;
  readonly pendingRows: number;
  readonly status: string;
};

export type DriveDbQueryResult = {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
};

export type DriveDbCommitResult = {
  readonly status: string;
  readonly commitId: string;
  readonly enqueuedAt: string;
  readonly completedAt: string | null;
};

export type DriveDbMetadataResult = {
  readonly inode: string;
  readonly displayName: string;
  readonly typeLabel: string;
  readonly recordCount: number;
  readonly indexed: string;
  readonly lastSyncAt: string;
  readonly sizeBytes: number;
  readonly owner: string;
};

export type DriveDbDropResult = {
  readonly name: string;
  readonly status: string;
  readonly deletedFromMetadata: boolean;
  readonly deletedFromS3: boolean;
  readonly deletedFromCache: boolean;
  readonly deletedFromDrive: boolean;
};

export type DriveDbSetStatusResult = {
  readonly name: string;
  readonly status: string;
  readonly error: string | null;
};

export type DriveDbResolveByInodeResult = {
  readonly name: string;
  readonly dbInode: string;
  readonly fileId: string;
  readonly status: string;
  readonly dbType: string;
};

export type DriveDbRollbackParams = {
  readonly name: string;
  readonly dbType?: DriveDbType;
};

export type DriveDbRollbackResult = {
  readonly name: string;
  readonly status: string;
};

export type DriveDbResolveWithSettingsResult = {
  readonly name: string;
  readonly dbInode: string;
  readonly fileId: string;
  readonly status: string;
  readonly dbType: string;
  readonly settings: Readonly<Record<string, string>>;
};

// -- Client interface --

export type DriveDbClient = {
  readonly create: (params: DriveDbCreateParams) => Promise<DriveDbCreateResult>;
  readonly insert: (params: DriveDbInsertParams) => Promise<DriveDbInsertResult>;
  readonly query: (params: DriveDbQueryParams) => Promise<DriveDbQueryResult>;
  readonly commit: (params: DriveDbCommitParams) => Promise<DriveDbCommitResult>;
  readonly rollback: (params: DriveDbRollbackParams) => Promise<DriveDbRollbackResult>;
  readonly metadata: (params: DriveDbMetadataParams) => Promise<DriveDbMetadataResult>;
  readonly drop: (params: DriveDbDropParams) => Promise<DriveDbDropResult>;
  readonly setStatus: (params: DriveDbSetStatusParams) => Promise<DriveDbSetStatusResult>;
  readonly resolveByInode: (
    params: DriveDbResolveByInodeParams
  ) => Promise<DriveDbResolveByInodeResult>;
  readonly resolveWithSettings: (
    params: DriveDbResolveWithSettingsParams
  ) => Promise<DriveDbResolveWithSettingsResult>;
};
