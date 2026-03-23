import type { DriveCrontabClient } from './crontabTypes.js';
import type { DriveDbClient } from './driveDbTypes.js';
import type {
  DriveCreateParams,
  DriveDeleteParams,
  DriveDeleteResult,
  DriveDiskUsageResult,
  DriveDownloadFileParams,
  DriveDownloadFileResult,
  DriveDownloadUrlParams,
  DriveDownloadUrlResult,
  DriveFileMetadata,
  DriveFileMetadataBatchParams,
  DriveFileMetadataParams,
  DrivePathEntry,
  DrivePathMutationResult,
  DriveReadFileResult,
  DriveRenameParams,
  DriveResolveParams,
  DriveToolsApplyPatchParams,
  DriveToolsBiQueryParams,
  DriveToolsBiQueryResult,
  DriveToolsExcelWriteParams,
  DriveToolsGlobParams,
  DriveToolsGlobResult,
  DriveToolsGrepParams,
  DriveToolsGrepResult,
  DriveToolsInodesQueryParams,
  DriveToolsInodesQueryResult,
  DriveToolsLsParams,
  DriveToolsLsResult,
  DriveToolsReadFileParams,
  DriveToolsTgSearchParams,
  DriveToolsTgSearchResult,
  DriveToolsVsearchParams,
  DriveToolsVsearchResult,
  DriveToolsWriteFileParams,
  DriveToolsWriteResult,
  DriveUpdateAttributesParams,
  DriveUpdateMetadataParams,
  DriveUploadCommitParams,
  DriveUploadCommitResult,
  DriveUploadFileParams,
  DriveUploadFileResult,
  DriveUploadStartParams,
  DriveUploadStartResult,
} from './driveTypes.js';
import type { DriveSessionManager } from './sessionObject.js';

export type { DrivePathEntry, DrivePathType } from './driveTypes.js';

export type DriveClient = {
  readonly init: () => Promise<void>;

  // Path operations
  readonly list: (params?: { readonly path?: string }) => Promise<readonly DrivePathEntry[]>;
  readonly create: (params: DriveCreateParams) => Promise<DrivePathMutationResult>;
  readonly rename: (params: DriveRenameParams) => Promise<DrivePathMutationResult>;
  readonly delete: (params: DriveDeleteParams) => Promise<DriveDeleteResult>;
  readonly resolve: (params: DriveResolveParams) => Promise<readonly DrivePathEntry[]>;
  readonly updateMetadata: (params: DriveUpdateMetadataParams) => Promise<DrivePathMutationResult>;
  readonly updateAttributes: (
    params: DriveUpdateAttributesParams
  ) => Promise<DrivePathMutationResult>;

  // Upload operations
  readonly upload: {
    readonly file: (params: DriveUploadFileParams) => Promise<DriveUploadFileResult>;
    readonly start: (params: DriveUploadStartParams) => Promise<DriveUploadStartResult>;
    readonly commit: (params: DriveUploadCommitParams) => Promise<DriveUploadCommitResult>;
  };

  // Download operations
  readonly download: {
    readonly file: (params: DriveDownloadFileParams) => Promise<DriveDownloadFileResult>;
  };

  // File operations
  readonly files: {
    readonly metadata: (params: DriveFileMetadataParams) => Promise<DriveFileMetadata>;
    readonly metadataBatch: (
      params: DriveFileMetadataBatchParams
    ) => Promise<readonly DrivePathEntry[]>;
    readonly downloadUrl: (params: DriveDownloadUrlParams) => Promise<DriveDownloadUrlResult>;
  };

  // Disk usage
  readonly diskUsage: () => Promise<DriveDiskUsageResult>;

  // Tools (path-based query and file operations)
  readonly tools: {
    readonly ls: (params?: DriveToolsLsParams) => Promise<DriveToolsLsResult>;
    readonly glob: (params: DriveToolsGlobParams) => Promise<DriveToolsGlobResult>;
    readonly grep: (params: DriveToolsGrepParams) => Promise<DriveToolsGrepResult>;
    readonly vsearch: (params: DriveToolsVsearchParams) => Promise<DriveToolsVsearchResult>;
    readonly readFile: (params: DriveToolsReadFileParams) => Promise<DriveReadFileResult>;
    readonly writeFile: (params: DriveToolsWriteFileParams) => Promise<DriveToolsWriteResult>;
    readonly applyPatch: (params: DriveToolsApplyPatchParams) => Promise<DriveToolsWriteResult>;
    readonly biQuery: (params: DriveToolsBiQueryParams) => Promise<DriveToolsBiQueryResult>;
    readonly inodesQuery: (params: DriveToolsInodesQueryParams) => Promise<DriveToolsInodesQueryResult>;
    readonly tgSearch: (params: DriveToolsTgSearchParams) => Promise<DriveToolsTgSearchResult>;
    readonly excelWrite: (params: DriveToolsExcelWriteParams) => Promise<DriveToolsWriteResult>;
  };

  // Database operations (Drive DB -- SQLite via JSON-RPC)
  readonly db: DriveDbClient;

  // Crontab scheduler management
  readonly crontab: DriveCrontabClient;

  // Session management
  readonly session: DriveSessionManager;
};
