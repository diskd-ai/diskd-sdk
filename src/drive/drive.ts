import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { createDriveCrontabClient } from './crontab.js';
import { createDriveDbClient } from './driveDb.js';
import type {
  DriveDeleteResult,
  DriveDiskUsageResult,
  DriveDownloadFileResult,
  DriveDownloadUrlResult,
  DriveFileMetadata,
  DrivePathEntry,
  DrivePathMutationResult,
  DrivePathType,
  DriveReadFilePart,
  DriveReadFileResult,
  DriveToolsResult,
  DriveToolsWriteResult,
  DriveUploadCommitResult,
  DriveUploadFileResult,
  DriveUploadStartResult,
} from './driveTypes.js';
import { jsonRpcCall } from './rpc.js';
import { createDriveSessionClient } from './session.js';
import { createDriveSessionManager } from './sessionObject.js';
import type { DriveClient } from './types.js';

// ---------------------------------------------------------------------------
// Decode helpers (wire -> domain)
// ---------------------------------------------------------------------------

type RawObject = { readonly [key: string]: unknown };

const isObject = (value: unknown): value is RawObject =>
  typeof value === 'object' && value !== null;

const str = (obj: RawObject, key: string): string | null => {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
};

const strRequired = (obj: RawObject, key: string): string => {
  const v = str(obj, key);
  if (!v) throw new Error(`Invalid Drive response: '${key}' must be a non-empty string`);
  return v;
};

const num = (obj: RawObject, key: string): number | null => {
  const v = obj[key];
  return typeof v === 'number' ? v : null;
};

const numRequired = (obj: RawObject, key: string): number => {
  const v = num(obj, key);
  if (v === null) throw new Error(`Invalid Drive response: '${key}' must be a number`);
  return v;
};

const bool = (obj: RawObject, key: string, fallback: boolean): boolean => {
  const v = obj[key];
  return typeof v === 'boolean' ? v : fallback;
};

const metadata = (obj: RawObject, key: string): Readonly<Record<string, unknown>> => {
  const v = obj[key];
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return v as Readonly<Record<string, unknown>>;
  }
  return {};
};

const attrs = (obj: RawObject, key: string): readonly string[] => {
  const v = obj[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};

const items = (result: unknown): readonly unknown[] => {
  if (!isObject(result)) throw new Error('Invalid Drive response: expected object');
  const arr = (result as { items?: unknown }).items;
  if (!Array.isArray(arr)) throw new Error('Invalid Drive response: items must be array');
  return arr;
};

const raw = (result: unknown): RawObject => {
  if (!isObject(result)) throw new Error('Invalid Drive response: expected object');
  return result;
};

const isDrivePathType = (v: unknown): v is DrivePathType =>
  v === 'file' ||
  v === 'dir' ||
  v === 'symlink' ||
  v === 'index' ||
  v === 'capsule' ||
  v === 'note' ||
  v === 'chat';

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

const decodePathEntry = (o: unknown): DrivePathEntry => {
  const r = raw(o);
  const t = r.type;
  if (!isDrivePathType(t)) throw new Error('Invalid Drive item: type is invalid');
  return {
    id: strRequired(r, 'inode'),
    name: strRequired(r, 'name'),
    type: t,
    parentId: str(r, 'parent_inode') ?? str(r, 'parentInode'),
    mimeType: str(r, 'mime_type') ?? str(r, 'mimeType'),
    fileId: str(r, 'file_id') ?? str(r, 'fileId'),
    etag: str(r, 'etag'),
    size: num(r, 'size'),
    metadata: metadata(r, 'metadata'),
    attributes: attrs(r, 'attributes'),
    createdAt: num(r, 'created_at') ?? num(r, 'createdAt'),
    updatedAt: num(r, 'updated_at') ?? num(r, 'updatedAt'),
    indexingStatus: str(r, 'indexing_status') ?? str(r, 'indexingStatus'),
    processingStatus: str(r, 'processing_status') ?? str(r, 'processingStatus'),
    processingError: str(r, 'processing_error') ?? str(r, 'processingError'),
    externalStatus: str(r, 'external_status') ?? str(r, 'externalStatus'),
    externalError: str(r, 'external_error') ?? str(r, 'externalError'),
    fullPath: str(r, 'full_path') ?? str(r, 'fullPath'),
  };
};

const decodeMutationResult = (o: unknown): DrivePathMutationResult => {
  const r = raw(o);
  const t = r.type;
  if (!isDrivePathType(t)) throw new Error('Invalid Drive mutation result: type is invalid');
  return {
    id: strRequired(r, 'inode'),
    parentId: str(r, 'parent_inode') ?? str(r, 'parentInode'),
    name: strRequired(r, 'name'),
    type: t,
    fileId: str(r, 'file_id') ?? str(r, 'fileId'),
    etag: str(r, 'etag'),
    metadata: metadata(r, 'metadata'),
    attributes: attrs(r, 'attributes'),
    updatedAt: numRequired(r, 'updated_at'),
  };
};

const decodeDeleteResult = (o: unknown): DriveDeleteResult => {
  const r = raw(o);
  return {
    success: bool(r, 'success', false),
    ids: Array.isArray(r.inodes)
      ? r.inodes.filter((x): x is string => typeof x === 'string')
      : [],
    size: numRequired(r, 'size'),
  };
};

const decodeUploadStart = (o: unknown): DriveUploadStartResult => {
  const r = raw(o);
  return {
    intentId: strRequired(r, 'intent_id'),
    id: strRequired(r, 'inode'),
    uploadUrl: strRequired(r, 'upload_url'),
    expiresIn: numRequired(r, 'expires_in'),
    multipart: bool(r, 'multipart', false),
  };
};

const decodeUploadCommit = (o: unknown): DriveUploadCommitResult => {
  const r = raw(o);
  return {
    id: strRequired(r, 'inode'),
    etag: strRequired(r, 'etag'),
    version: numRequired(r, 'version'),
    committedAt: strRequired(r, 'committed_at'),
  };
};

const decodeFileMetadata = (o: unknown): DriveFileMetadata => {
  const r = raw(o);
  return {
    id: strRequired(r, 'inode'),
    name: strRequired(r, 'name'),
    size: numRequired(r, 'size'),
    etag: str(r, 'etag'),
    versions: numRequired(r, 'versions'),
    createdAt: strRequired(r, 'created_at'),
    updatedAt: strRequired(r, 'updated_at'),
    metadata: metadata(r, 'metadata'),
    attributes: attrs(r, 'attributes'),
  };
};

const decodeDownloadUrl = (o: unknown): DriveDownloadUrlResult => {
  const r = raw(o);
  return {
    url: strRequired(r, 'url'),
    expiresIn: numRequired(r, 'expires_in'),
  };
};

const decodeDiskUsage = (o: unknown): DriveDiskUsageResult => {
  const r = raw(o);
  return { used: numRequired(r, 'used') };
};

const decodeToolsResult = (o: unknown): DriveToolsResult => {
  const r = raw(o);
  const arr = r.items;
  if (Array.isArray(arr)) {
    return { items: arr.filter(isObject) };
  }
  // Some tools return results at the top level
  return { items: [r] };
};

const decodeReadFilePart = (o: unknown): DriveReadFilePart => {
  const r = raw(o);
  const t = strRequired(r, 'type');
  return {
    type: t as DriveReadFilePart['type'],
    content: strRequired(r, 'content'),
    title: str(r, 'title') ?? undefined,
    pageNumber: num(r, 'page_number') ?? num(r, 'pageNumber') ?? undefined,
    confidence: num(r, 'confidence') ?? undefined,
  };
};

const decodeReadFileResult = (o: unknown): DriveReadFileResult => {
  const r = raw(o);
  const arr = r.parts;
  if (!Array.isArray(arr)) throw new Error('Invalid Drive response: parts must be array');
  return { parts: arr.map(decodeReadFilePart) };
};

const decodeWriteResult = (o: unknown): DriveToolsWriteResult => {
  const r = raw(o);
  return {
    id: strRequired(r, 'inode'),
    path: strRequired(r, 'path'),
  };
};

// ---------------------------------------------------------------------------
// Encode helpers (domain params -> wire snake_case)
// ---------------------------------------------------------------------------

const optional = <T>(key: string, value: T | undefined): Record<string, T> =>
  value !== undefined ? { [key]: value } : {};

// ---------------------------------------------------------------------------
// SHA256 helper (Web Crypto -- works in Node 18+ and browsers)
// ---------------------------------------------------------------------------

const toArrayBuffer = (data: Uint8Array | ArrayBuffer): ArrayBuffer =>
  data instanceof ArrayBuffer ? data : (new Uint8Array(data).buffer as ArrayBuffer);

const sha256hex = async (data: Uint8Array | ArrayBuffer): Promise<string> => {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', toArrayBuffer(data));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
};

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export const createDriveClient = (params: {
  readonly version: 'v1';
  readonly auth: AuthModule;
  readonly url?: string;
}): DriveClient => {
  const rpcUrl = params.url
    ? params.url.replace(/\/+$/, '')
    : `${resolveDiskdGatewayUrl('os/drive')}/api/v1`;
  let nextId = 1;

  const call = async (method: string, rpcParams: unknown): Promise<unknown> => {
    const id = nextId;
    nextId += 1;

    if (params.auth.getRequestHeaders) {
      const headers = await params.auth.getRequestHeaders();
      return jsonRpcCall({ url: rpcUrl, headers, method, rpcParams, id });
    }

    const bearerToken = await params.auth.getAccessToken();
    return jsonRpcCall({ url: rpcUrl, bearerToken, method, rpcParams, id });
  };

  const db = createDriveDbClient({ call });
  const crontab = createDriveCrontabClient({ call });
  const sessionRpc = createDriveSessionClient({ call });
  const session = createDriveSessionManager({ rpc: sessionRpc });

  return {
    // -- Init --
    init: async () => {
      await call('drive/init', {});
    },

    // -- Path operations --
    list: async (listParams) => {
      const result = await call('drive/paths/list', {
        ...optional('path', listParams?.path),
      });
      return items(result).map(decodePathEntry);
    },

    create: async (p) => {
      const result = await call('drive/paths/create', {
        dir_name: p.dirName,
        ...optional('parent_path', p.parentPath),
      });
      return decodeMutationResult(result);
    },

    rename: async (p) => {
      const result = await call('drive/paths/rename', {
        path: p.path,
        new_name: p.newName,
        ...optional('new_parent_path', p.newParentPath),
      });
      return decodeMutationResult(result);
    },

    delete: async (p) => {
      const result = await call('drive/paths/delete', {
        paths: [...p.paths],
        ...optional('recursive', p.recursive),
      });
      return decodeDeleteResult(result);
    },

    resolve: async (p) => {
      const result = await call('drive/paths/resolve', {
        paths: [...p.paths],
      });
      return items(result).map(decodePathEntry);
    },

    updateMetadata: async (p) => {
      const result = await call('drive/paths/update-metadata', {
        path: p.path,
        metadata: { ...p.metadata },
      });
      return decodeMutationResult(result);
    },

    updateAttributes: async (p) => {
      const result = await call('drive/paths/update-attributes', {
        path: p.path,
        attributes: [...p.attributes],
      });
      return decodeMutationResult(result);
    },

    // -- Upload --
    upload: {
      file: async (p) => {
        // Resolve size, hash, and body based on input type (buffer vs stream)
        const isStream = p.stream !== undefined;
        const fileSize = isStream
          ? p.size
          : p.data instanceof Uint8Array
            ? p.data.byteLength
            : p.data.byteLength;
        const hash = isStream ? p.sha256Root : await sha256hex(p.data);
        const body: ArrayBuffer | ReadableStream<Uint8Array> = isStream
          ? p.stream
          : toArrayBuffer(p.data instanceof Uint8Array ? p.data : new Uint8Array(p.data));

        // 1. Start upload intent
        const intent = await (async () => {
          const result = await call('drive/upload/start', {
            name: p.name,
            size: fileSize,
            sha256_root: hash,
            ...optional('parent_path', p.parentPath),
            ...optional('mime_type', p.mimeType),
            ...optional('force', p.force),
          });
          return decodeUploadStart(result);
        })();

        p.onProgress?.(0, fileSize);

        // 2. PUT the file data to the upload proxy
        const uploadUrl = rpcUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '') + intent.uploadUrl;
        const authHeaders: Record<string, string> = params.auth.getRequestHeaders
          ? await params.auth.getRequestHeaders()
          : { Authorization: `Bearer ${await params.auth.getAccessToken()}` };

        const putResponse = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            ...authHeaders,
            'Content-Type': p.mimeType ?? 'application/octet-stream',
            'X-Upload-Intent-Id': intent.intentId,
          },
          body,
          ...(isStream ? { duplex: 'half' } : {}),
        });

        if (!putResponse.ok) {
          const text = await putResponse.text();
          throw new Error(`Upload PUT failed (HTTP ${putResponse.status}): ${text.slice(0, 200)}`);
        }

        const putBody = (await putResponse.json()) as { etag?: string };
        const etag = putBody.etag ?? putResponse.headers.get('etag') ?? '';
        if (!etag) {
          throw new Error('Upload PUT response missing etag');
        }

        p.onProgress?.(fileSize, fileSize);

        // 3. Commit
        const commitResult = await (async () => {
          const result = await call('drive/upload/commit', {
            intent_id: intent.intentId,
            etag,
          });
          return decodeUploadCommit(result);
        })();

        return {
          id: commitResult.id,
          etag: commitResult.etag,
          version: commitResult.version,
          committedAt: commitResult.committedAt,
          intentId: intent.intentId,
        } satisfies DriveUploadFileResult;
      },

      start: async (p) => {
        const result = await call('drive/upload/start', {
          name: p.name,
          size: p.size,
          sha256_root: p.sha256Root,
          ...optional('parent_path', p.parentPath),
          ...optional('mime_type', p.mimeType),
          ...optional('force', p.force),
        });
        return decodeUploadStart(result);
      },

      commit: async (p) => {
        const result = await call('drive/upload/commit', {
          intent_id: p.intentId,
          etag: p.etag,
        });
        return decodeUploadCommit(result);
      },
    },

    // -- Download --
    download: {
      file: async (p) => {
        // 1. Get signed download URL
        const dlResult = await call('drive/files/download-url', {
          path: p.path,
          ...optional('version', p.version),
        });
        const { url } = decodeDownloadUrl(dlResult);

        // 2. Fetch the file -- stream body, do not buffer
        const authHeaders: Record<string, string> = params.auth.getRequestHeaders
          ? await params.auth.getRequestHeaders()
          : { Authorization: `Bearer ${await params.auth.getAccessToken()}` };

        const response = await fetch(url, { headers: authHeaders });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Download failed (HTTP ${response.status}): ${text.slice(0, 200)}`);
        }

        const size = Number(response.headers.get('content-length') ?? '0');
        const mimeType = response.headers.get('content-type');
        const body = response.body;
        if (!body) throw new Error('Download response has no body');

        // 3. Wrap stream with progress tracking if callback provided
        const stream: ReadableStream<Uint8Array> = p.onProgress
          ? (() => {
              let downloaded = 0;
              const reader = body.getReader();
              p.onProgress?.(0, size);
              return new ReadableStream<Uint8Array>({
                async pull(controller) {
                  const { done, value } = await reader.read();
                  if (done) {
                    controller.close();
                    return;
                  }
                  downloaded += value.byteLength;
                  p.onProgress?.(downloaded, size);
                  controller.enqueue(value);
                },
                cancel(reason) {
                  reader.cancel(reason);
                },
              });
            })()
          : (body as ReadableStream<Uint8Array>);

        return { stream, size, mimeType } satisfies DriveDownloadFileResult;
      },
    },

    // -- Files --
    files: {
      metadata: async (p) => {
        const result = await call('drive/files/metadata', { path: p.path });
        return decodeFileMetadata(result);
      },

      metadataBatch: async (p) => {
        const result = await call('drive/files/metadata/batch', {
          paths: [...p.paths],
        });
        return items(result).map(decodePathEntry);
      },

      downloadUrl: async (p) => {
        const result = await call('drive/files/download-url', {
          path: p.path,
          ...optional('version', p.version),
        });
        return decodeDownloadUrl(result);
      },
    },

    // -- Disk usage --
    diskUsage: async () => {
      const result = await call('drive/disk-usage', {});
      return decodeDiskUsage(result);
    },

    // -- Tools (path-based query operations) --
    tools: {
      ls: async (p) => {
        const result = await call('paths/tools/ls', {
          ...optional('path', p?.path),
          ...optional('recursive', p?.recursive),
        });
        return decodeToolsResult(result);
      },

      glob: async (p) => {
        const result = await call('paths/tools/glob', {
          pattern: p.pattern,
          ...optional('path', p.path),
        });
        return decodeToolsResult(result);
      },

      grep: async (p) => {
        const result = await call('paths/tools/grep', {
          query: p.query,
          paths: [...p.paths],
        });
        return decodeToolsResult(result);
      },

      vsearch: async (p) => {
        const result = await call('paths/tools/vsearch', {
          query: p.query,
          ...optional('top_k', p.topK),
          ...optional('path', p.path),
        });
        return decodeToolsResult(result);
      },

      readFile: async (p) => {
        const result = await call('paths/tools/read', {
          path: p.path,
          ...optional('parts_limit', p.partsLimit),
          ...optional('parts_offset', p.partsOffset),
        });
        return decodeReadFileResult(result);
      },

      writeFile: async (p) => {
        const result = await call('paths/tools/write', {
          path: p.path,
          content: p.content,
        });
        return decodeWriteResult(result);
      },

      applyPatch: async (p) => {
        const result = await call('paths/tools/apply-patch', {
          path: p.path,
          patch: p.patch,
        });
        return decodeWriteResult(result);
      },
    },

    // -- Database --
    db,

    // -- Crontab --
    crontab,

    // -- Session --
    session,
  };
};
