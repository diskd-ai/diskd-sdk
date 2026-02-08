export type DrivePathType =
  | 'file'
  | 'dir'
  | 'symlink'
  | 'index'
  | 'capsule'
  | 'note'
  | 'chat';

export type DrivePathEntry = {
  readonly inode: string;
  readonly name: string;
  readonly type: DrivePathType;
  readonly parentInode?: string;
  readonly mimeType?: string;
  readonly fileId?: string;
  readonly etag?: string;
  readonly size?: number;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly indexingStatus?: string;
  readonly processingStatus?: string;
  readonly processingError?: string;
  readonly externalStatus?: string;
  readonly externalError?: string;
  readonly fullPath?: string;
};

export type DriveClient = {
  readonly init: () => Promise<void>;
  readonly list: (params?: { readonly path?: string; readonly parentInode?: string }) => Promise<readonly DrivePathEntry[]>;
};

