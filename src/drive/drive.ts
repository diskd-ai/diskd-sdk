import type { AuthModule } from '../auth/types.js';
import { resolveDiskdBaseUrl } from '../env/baseUrl.js';
import { jsonRpcCall } from './rpc.js';
import type { DriveClient, DrivePathEntry, DrivePathType } from './types.js';

type ListParams = { readonly path?: string; readonly parentInode?: string };

type ListResult = { readonly items?: readonly unknown[] };

const isObject = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null;

const readOptionalString = (
  obj: { readonly [key: string]: unknown },
  key: string,
): string | undefined => {
  const value = obj[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const readOptionalNumber = (
  obj: { readonly [key: string]: unknown },
  key: string,
): number | undefined => {
  const value = obj[key];
  return typeof value === 'number' ? value : undefined;
};

const readRequiredString = (obj: { readonly [key: string]: unknown }, key: string): string => {
  const value = readOptionalString(obj, key);
  if (!value) {
    throw new Error(`Invalid Drive item: '${key}' must be a non-empty string`);
  }
  return value;
};

const isDrivePathType = (value: unknown): value is DrivePathType => {
  return (
    value === 'file' ||
    value === 'dir' ||
    value === 'symlink' ||
    value === 'index' ||
    value === 'capsule' ||
    value === 'note' ||
    value === 'chat'
  );
};

const mapItem = (raw: unknown): DrivePathEntry => {
  if (!isObject(raw)) {
    throw new Error('Invalid Drive item: expected object');
  }
  const inode = readRequiredString(raw, 'inode');
  const name = readRequiredString(raw, 'name');
  const typeRaw = raw.type;
  if (!isDrivePathType(typeRaw)) {
    throw new Error('Invalid Drive item: type is invalid');
  }

  return {
    inode,
    name,
    type: typeRaw,
    parentInode: readOptionalString(raw, 'parent_inode') ?? readOptionalString(raw, 'parentInode'),
    mimeType: readOptionalString(raw, 'mime_type') ?? readOptionalString(raw, 'mimeType'),
    fileId: readOptionalString(raw, 'file_id') ?? readOptionalString(raw, 'fileId'),
    etag: readOptionalString(raw, 'etag'),
    size: readOptionalNumber(raw, 'size'),
    createdAt: readOptionalNumber(raw, 'created_at') ?? readOptionalNumber(raw, 'createdAt'),
    updatedAt: readOptionalNumber(raw, 'updated_at') ?? readOptionalNumber(raw, 'updatedAt'),
    indexingStatus: readOptionalString(raw, 'indexing_status') ?? readOptionalString(raw, 'indexingStatus'),
    processingStatus: readOptionalString(raw, 'processing_status') ?? readOptionalString(raw, 'processingStatus'),
    processingError: readOptionalString(raw, 'processing_error') ?? readOptionalString(raw, 'processingError'),
    externalStatus: readOptionalString(raw, 'external_status') ?? readOptionalString(raw, 'externalStatus'),
    externalError: readOptionalString(raw, 'external_error') ?? readOptionalString(raw, 'externalError'),
    fullPath: readOptionalString(raw, 'full_path') ?? readOptionalString(raw, 'fullPath'),
  };
};

export const createDriveClient = (params: { readonly version: 'v1'; readonly auth: AuthModule }): DriveClient => {
  const baseUrl = resolveDiskdBaseUrl().replace(/\/+$/, '');
  const rpcUrl = `${baseUrl}/drive/api/v1`;
  let nextId = 1;

  const call = async (method: string, rpcParams: unknown): Promise<unknown> => {
    const bearerToken = await params.auth.getAccessToken();
    const id = nextId;
    nextId += 1;
    return jsonRpcCall({ url: rpcUrl, bearerToken, method, rpcParams, id });
  };

  return {
    init: async () => {
      await call('drive/init', {});
    },
    list: async (listParams?: ListParams) => {
      const result = await call('drive/paths/list', {
        ...(listParams?.path ? { path: listParams.path } : {}),
        ...(listParams?.parentInode ? { parent_inode: listParams.parentInode } : {}),
      });
      if (!isObject(result)) {
        throw new Error('Invalid drive/paths/list result');
      }
      const itemsRaw = (result as ListResult).items ?? [];
      if (!Array.isArray(itemsRaw)) {
        throw new Error('Invalid drive/paths/list result: items must be array');
      }
      return itemsRaw.map(mapItem);
    },
  };
};

