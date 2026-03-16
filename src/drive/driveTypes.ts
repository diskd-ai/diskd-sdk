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
  readonly id: string;
  readonly name: string;
  readonly type: DrivePathType;
  readonly parentId: string | null;
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
  readonly id: string;
  readonly parentId: string | null;
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
  readonly parentPath?: string;
};

export type DriveRenameParams = {
  readonly path: string;
  readonly newName: string;
  readonly newParentPath?: string;
};

export type DriveDeleteParams = {
  readonly paths: readonly string[];
  readonly recursive?: boolean;
};

export type DriveDeleteResult = {
  readonly success: boolean;
  readonly ids: readonly string[];
  readonly size: number;
};

export type DriveResolveParams = {
  readonly paths: readonly string[];
};

export type DriveUpdateMetadataParams = {
  readonly path: string;
  readonly metadata: Readonly<Record<string, unknown>>;
};

export type DriveUpdateAttributesParams = {
  readonly path: string;
  readonly attributes: readonly string[];
};

// -- Upload operations --

export type DriveUploadStartParams = {
  readonly name: string;
  readonly size: number;
  readonly sha256Root: string;
  readonly parentPath?: string;
  readonly mimeType?: string;
  readonly force?: boolean;
};

export type DriveUploadStartResult = {
  readonly intentId: string;
  readonly id: string;
  readonly uploadUrl: string;
  readonly expiresIn: number;
  readonly multipart: boolean;
};

export type DriveUploadCommitParams = {
  readonly intentId: string;
  readonly etag: string;
};

export type DriveUploadCommitResult = {
  readonly id: string;
  readonly etag: string;
  readonly version: number;
  readonly committedAt: string;
};

// -- File operations --

export type DriveFileMetadataParams = {
  readonly path: string;
};

export type DriveFileMetadata = {
  readonly id: string;
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
  readonly paths: readonly string[];
};

export type DriveDownloadUrlParams = {
  readonly path: string;
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
  readonly recursive?: boolean;
};

export type DriveToolsGlobParams = {
  readonly pattern: string;
  readonly path?: string;
};

export type DriveToolsGrepParams = {
  readonly query: string;
  readonly paths: readonly string[];
};

export type DriveToolsVsearchParams = {
  readonly query: string;
  readonly topK?: number;
  readonly path?: string;
};

// -- Tools: file read / write / patch --

export type DriveToolsReadFileParams = {
  readonly path: string;
  readonly partsLimit?: number;
  readonly partsOffset?: number;
};

export type DriveReadFilePart = {
  readonly type: 'text' | 'image' | 'table' | 'diagram' | 'json' | 'code' | 'form';
  readonly content: string;
  readonly title?: string;
  readonly pageNumber?: number;
  readonly confidence?: number;
};

export type DriveReadFileResult = {
  readonly parts: readonly DriveReadFilePart[];
};

export type DriveToolsWriteFileParams = {
  readonly path: string;
  readonly content: string;
};

export type DriveToolsApplyPatchParams = {
  readonly path: string;
  readonly patch: string;
};

export type DriveToolsWriteResult = {
  readonly id: string;
  readonly path: string;
};

// -- Upload file (convenience) --

export type DriveUploadFileBaseParams = {
  readonly name: string;
  readonly parentPath?: string;
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
  readonly id: string;
  readonly etag: string;
  readonly version: number;
  readonly committedAt: string;
  readonly intentId: string;
};

// -- Download file (convenience) --

export type DriveDownloadFileParams = {
  readonly path: string;
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
