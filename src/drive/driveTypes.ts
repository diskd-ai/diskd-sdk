// Domain types for the Drive API methods.
// These are pure data types only -- no classes, no I/O, no side effects.
// snake_case <-> camelCase conversion happens at the wire level (rpc.ts / drive.ts).

// -- Shared vocabulary --

export type DrivePathType = 'file' | 'dir' | 'symlink' | 'index' | 'capsule' | 'note' | 'chat';

// -- Path representations --

/**
 * Full path entry returned by list, resolve, and metadata-batch operations.
 * All optional wire fields are normalised to `string | null` (never `undefined`).
 */
export type DrivePathEntry = {
  readonly inode: string;
  readonly name: string;
  readonly type: DrivePathType;
  readonly parentInode: string | null;
  readonly mimeType: string | null;
  readonly fileId: string | null;
  readonly etag: string | null;
  readonly size: number | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly attributes: readonly string[];
  readonly createdAt: number | null;
  readonly updatedAt: number | null;
  readonly indexingStatus: string | null;
  readonly processingStatus: string | null;
  readonly processingError: string | null;
  readonly externalStatus: string | null;
  readonly externalError: string | null;
  readonly fullPath: string | null;
};

/**
 * Slim path entry returned by mutating operations: create, rename,
 * updateMetadata, updateAttributes.
 */
export type DrivePathMutationResult = {
  readonly inode: string;
  readonly parentInode: string | null;
  readonly name: string;
  readonly type: DrivePathType;
  readonly fileId: string | null;
  readonly etag: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly attributes: readonly string[];
  readonly updatedAt: number;
};

// -- Path operation params --

export type DriveCreateParams = {
  readonly dirName: string;
  readonly parentInode?: string;
};

export type DriveRenameParams = {
  readonly inode: string;
  readonly newName: string;
  readonly newParentInode?: string;
};

export type DriveDeleteParams = {
  readonly inodes: readonly string[];
  readonly recursive?: boolean;
};

export type DriveDeleteResult = {
  readonly success: boolean;
  readonly inodes: readonly string[];
  readonly size: number;
};

export type DriveResolveParams = {
  readonly inodes: readonly string[];
};

export type DriveUpdateMetadataParams = {
  readonly inode: string;
  readonly metadata: Readonly<Record<string, unknown>>;
};

export type DriveUpdateAttributesParams = {
  readonly inode: string;
  readonly attributes: readonly string[];
};

// -- Upload operations --

export type DriveUploadStartParams = {
  readonly name: string;
  readonly size: number;
  readonly sha256Root: string;
  readonly parentInode?: string;
  readonly mimeType?: string;
  readonly force?: boolean;
};

export type DriveUploadStartResult = {
  readonly intentId: string;
  readonly inode: string;
  readonly uploadUrl: string;
  readonly expiresIn: number;
  readonly multipart: boolean;
};

export type DriveUploadCommitParams = {
  readonly intentId: string;
  readonly etag: string;
};

export type DriveUploadCommitResult = {
  readonly inode: string;
  readonly etag: string;
  readonly version: number;
  readonly committedAt: string;
};

// -- File operations --

export type DriveFileMetadataParams = {
  readonly inode: string;
};

export type DriveFileMetadata = {
  readonly inode: string;
  readonly name: string;
  readonly size: number;
  readonly etag: string | null;
  readonly versions: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly attributes: readonly string[];
};

export type DriveFileMetadataBatchParams = {
  readonly inodes: readonly string[];
};

export type DriveDownloadUrlParams = {
  readonly inode: string;
  readonly version?: number;
};

export type DriveDownloadUrlResult = {
  readonly url: string;
  readonly expiresIn: number;
};

// -- Disk usage --

export type DriveDiskUsageResult = {
  readonly used: number;
};

// -- Tools (path-based operations) --

export type DriveToolsLsParams = {
  readonly path?: string;
  readonly parentInode?: string;
  readonly recursive?: boolean;
};

export type DriveToolsGlobParams = {
  readonly pattern: string;
  readonly parentInode?: string;
};

export type DriveToolsGrepParams = {
  readonly pattern: string;
  readonly parentInode?: string;
  readonly path?: string;
};

export type DriveToolsVsearchParams = {
  readonly query: string;
  readonly topK?: number;
  readonly parentInode?: string;
  readonly path?: string;
};

// -- Upload file (convenience) --

export type DriveUploadFileBaseParams = {
  readonly name: string;
  readonly parentInode?: string;
  readonly mimeType?: string;
  readonly force?: boolean;
  readonly onProgress?: (uploaded: number, total: number) => void;
};

export type DriveUploadFileBufferParams = DriveUploadFileBaseParams & {
  readonly data: Uint8Array | ArrayBuffer;
  readonly stream?: undefined;
  readonly size?: undefined;
  readonly sha256Root?: undefined;
};

export type DriveUploadFileStreamParams = DriveUploadFileBaseParams & {
  readonly stream: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly sha256Root: string;
  readonly data?: undefined;
};

export type DriveUploadFileParams = DriveUploadFileBufferParams | DriveUploadFileStreamParams;

export type DriveUploadFileResult = {
  readonly inode: string;
  readonly etag: string;
  readonly version: number;
  readonly committedAt: string;
  readonly intentId: string;
};

// -- Download file (convenience) --

export type DriveDownloadFileParams = {
  readonly inode: string;
  readonly version?: number;
  readonly onProgress?: (downloaded: number, total: number) => void;
};

export type DriveDownloadFileResult = {
  readonly stream: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly mimeType: string | null;
};

/**
 * Generic tools result. The item schema varies per operation; callers should
 * narrow the shape of each item using type guards against the specific tool's
 * documented response fields. `unknown` is used deliberately -- no `any`.
 */
export type DriveToolsResult = {
  readonly items: readonly Readonly<Record<string, unknown>>[];
};
