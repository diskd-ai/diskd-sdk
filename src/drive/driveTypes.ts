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

export type DriveCreateParams =
  | {
      readonly dirName: string;
      readonly parentPath?: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
      readonly fileId?: string;
      readonly type?: Extract<DrivePathType, 'dir'>;
    }
  | {
      readonly name: string;
      readonly type: DrivePathType;
      readonly parentPath?: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
      readonly fileId?: string;
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
  readonly showHidden?: boolean;
  readonly showSystem?: boolean;
};

export type DriveToolsGlobParams = {
  readonly pattern: string;
  readonly path?: string;
  readonly showHidden?: boolean;
  readonly showSystem?: boolean;
};

export type DriveToolsGrepParams = {
  readonly query: string;
  readonly paths: readonly string[];
};

export type DriveToolsVsearchParams = {
  readonly query: string;
  readonly topK?: number;
  readonly paths: readonly string[];
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
  readonly totalParts?: number;
  readonly partsOffset?: number;
  readonly nextOffset?: number;
  readonly eof?: boolean;
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
 * Generic tools result.
 * @deprecated Use the specific result type for each tool method instead
 * (DriveToolsLsResult, DriveToolsGlobResult, DriveToolsGrepResult, etc.).
 */
export type DriveToolsResult = {
  readonly items: readonly Readonly<Record<string, unknown>>[];
};

// -- Typed tools results --

export type DriveToolsLsResult = {
  readonly entries: readonly DrivePathEntry[];
};

export type DriveToolsGlobResult = {
  readonly entries: readonly DrivePathEntry[];
};

export type DriveToolsDocumentPart = {
  readonly type: string;
  readonly title: string | null;
  readonly content: string;
  readonly pageNumber: number | null;
  readonly originUrl: string | null;
  readonly author: string | null;
  readonly timestamp: number | null;
};

export type DriveToolsDocument = {
  readonly id: string;
  readonly parts: readonly DriveToolsDocumentPart[];
};

export type DriveToolsWarning = {
  readonly code: string;
  readonly message: string;
  readonly inodes: readonly string[];
};

export type DriveToolsGrepResult = {
  readonly documents: readonly DriveToolsDocument[];
  readonly warnings?: readonly DriveToolsWarning[];
};

export type DriveToolsVsearchResult = {
  readonly documents: readonly DriveToolsDocument[];
};

export type DriveToolsTableData = {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number | boolean | null)[])[];
};

export type DriveToolsBiQueryParams = {
  readonly query: string;
  readonly paths: readonly string[];
};

export type DriveToolsBiQueryResult = {
  readonly tables: Readonly<Record<string, DriveToolsTableData>>;
};

export type DriveToolsInodesQueryParams = {
  readonly query: string;
  readonly paths: readonly string[];
  readonly dateStart?: string;
  readonly dateEnd?: string;
  readonly orderBy?: string;
  readonly limit?: number;
  readonly offset?: number;
  /** First file of the queried window (files sorted by path after folder expansion); default 0. */
  readonly fileOffset?: number;
  /** Files per window, 1..200; default 200. */
  readonly fileLimit?: number;
};

/** One coverage gap Drive reports instead of dropping it silently (Redmine #3186). */
export type DriveToolsQueryWarning = {
  /** FILES_WINDOWED, RESULTS_TRUNCATED, FILES_NOT_SEARCHED or PATHS_NOT_RESOLVED. */
  readonly code: string;
  readonly message: string;
  /** RESULTS_TRUNCATED: documents that matched; otherwise null. */
  readonly matched: number | null;
  /** RESULTS_TRUNCATED: documents returned; otherwise null. */
  readonly returned: number | null;
  /** FILES_NOT_SEARCHED: files of the window that could not be searched; otherwise null. */
  readonly count: number | null;
  /** PATHS_NOT_RESOLVED: the inodes that did not resolve; otherwise empty. */
  readonly inodes: readonly string[];
  /** PATHS_NOT_RESOLVED: the requested paths that did not resolve; otherwise empty. */
  readonly paths: readonly string[];
};

export type DriveToolsInodesQueryResult = {
  readonly documents: readonly DriveToolsDocument[];
  readonly tables: Readonly<Record<string, DriveToolsTableData>>;
  /** Files the whole request covers; null from a Drive that does not report coverage. */
  readonly total: number | null;
  /** fileOffset of the next window, or null when this window was the last. */
  readonly nextOffset: number | null;
  readonly warnings: readonly DriveToolsQueryWarning[];
};

export type DriveToolsTgMessage = {
  readonly messageId: number;
  readonly text: string;
  readonly senderName: string;
  readonly date: string;
  readonly timestamp: number;
  readonly replyToMessageId: number | null;
  readonly isForward: boolean;
  readonly views: number | null;
  readonly channelUsername: string | null;
  readonly originUrl: string | null;
};

export type DriveToolsTgSearchParams = {
  readonly databasePath: string;
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly dateStart?: string;
  readonly dateEnd?: string;
  readonly orderBy?: 'relevance' | 'date_desc' | 'date_asc';
};

export type DriveToolsTgSearchResultMessage = {
  readonly message: DriveToolsTgMessage;
  readonly score: number | null;
  readonly replyContext: DriveToolsTgMessage | null;
};

export type DriveToolsTgTopic = {
  readonly topicId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly messageCount: number;
  readonly dateRange: readonly [string, string];
  readonly sampleMessages: readonly DriveToolsTgMessage[];
};

export type DriveToolsTgSearchResult = {
  readonly queryType: 'discovery' | 'search' | 'recent';
  readonly topics: readonly DriveToolsTgTopic[] | null;
  readonly messages: readonly DriveToolsTgSearchResultMessage[] | null;
  readonly totalFound: number;
  readonly dateRangeApplied: readonly [string, string] | null;
  readonly databasePath: string;
};

export type DriveToolsExcelWriteParams = {
  readonly path: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number | boolean | null)[])[];
  readonly sheetName?: string;
};
