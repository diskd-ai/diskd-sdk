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
  DriveIndexerListParams,
  DriveIndexerListResult,
  DriveIndexerStartParams,
  DriveIndexerStartResult,
  DriveIndexerStatusBatchParams,
  DriveIndexerStatusBatchResult,
  DriveIndexerStatusParams,
  DriveIndexerStatusResult,
  DriveIndexerStopParams,
  DriveIndexerStopResult,
  DrivePathEntry,
  DrivePathMutationResult,
  DriveReadFileResult,
  DriveRenameParams,
  DriveResolveParams,
  DriveToolsApplyPatchParams,
  DriveToolsBiQueryParams,
  DriveToolsGlobParams,
  DriveToolsGrepParams,
  DriveToolsInodeLsParams,
  DriveToolsInodesQueryParams,
  DriveToolsLsParams,
  DriveToolsReadFileParams,
  DriveToolsResult,
  DriveToolsTgSearchParams,
  DriveToolsVsearchParams,
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
  DriveUploadTgEntityParams,
  DriveUploadTgEntityResult,
  DriveUploadWebUrlParams,
  DriveUploadWebUrlResult,
} from './driveTypes.js';
import type { DriveSessionManager } from './sessionObject.js';

export type { DrivePathEntry, DrivePathType } from './driveTypes.js';

export type DriveClient = {
  readonly init: () => Promise<void>;

  // Path operations
  readonly list: (params?: {
    readonly path?: string;
  }) => Promise<readonly DrivePathEntry[]>;
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
    readonly webUrl: (params: DriveUploadWebUrlParams) => Promise<DriveUploadWebUrlResult>;
    readonly tgEntity: (params: DriveUploadTgEntityParams) => Promise<DriveUploadTgEntityResult>;
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
    readonly ls: (params?: DriveToolsLsParams) => Promise<DriveToolsResult>;
    readonly glob: (params: DriveToolsGlobParams) => Promise<DriveToolsResult>;
    readonly grep: (params: DriveToolsGrepParams) => Promise<DriveToolsResult>;
    readonly vsearch: (params: DriveToolsVsearchParams) => Promise<DriveToolsResult>;
    readonly readFile: (params: DriveToolsReadFileParams) => Promise<DriveReadFileResult>;
    readonly writeFile: (params: DriveToolsWriteFileParams) => Promise<DriveToolsWriteResult>;
    readonly applyPatch: (params: DriveToolsApplyPatchParams) => Promise<DriveToolsWriteResult>;
    readonly biQuery: (params: DriveToolsBiQueryParams) => Promise<DriveToolsResult>;
    readonly inodesQuery: (params: DriveToolsInodesQueryParams) => Promise<DriveToolsResult>;
    readonly tgSearch: (params: DriveToolsTgSearchParams) => Promise<DriveToolsResult>;
    readonly inodeLs: (params: DriveToolsInodeLsParams) => Promise<DriveToolsResult>;
  };

  // Indexer operations
  readonly indexer: {
    readonly start: (params: DriveIndexerStartParams) => Promise<DriveIndexerStartResult>;
    readonly stop: (params: DriveIndexerStopParams) => Promise<DriveIndexerStopResult>;
    readonly status: (params: DriveIndexerStatusParams) => Promise<DriveIndexerStatusResult>;
    readonly statusBatch: (
      params: DriveIndexerStatusBatchParams
    ) => Promise<DriveIndexerStatusBatchResult>;
    readonly list: (params?: DriveIndexerListParams) => Promise<DriveIndexerListResult>;
  };

  // Database operations (Drive DB -- SQLite via JSON-RPC)
  readonly db: DriveDbClient;

  // Crontab scheduler management
  readonly crontab: DriveCrontabClient;

  // Session management
  readonly session: DriveSessionManager;
};
