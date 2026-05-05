// ---------------------------------------------------------------------------
// Drive Messages Store client -- JSON-RPC 2.0 (snake_case wire format)
//
// Concept: thin functional wrapper over `messages_store/*` methods
// served by drive's RPC endpoint. Each scope (mailbox -> folder ->
// message) is a closure that captures its identifiers, eliminating
// repetitive ID-passing on every call.
// ---------------------------------------------------------------------------

import type { AuthModule } from '../auth/types.js';
import { jsonRpcCall } from '../drive/rpc.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import type {
  AttachmentDeleteParams,
  AttachmentDeleteResult,
  AttachmentDownloadUrlParams,
  AttachmentDownloadUrlResult,
  AttachmentSavedDriveEntry,
  AttachmentSaveToDriveParams,
  AttachmentSaveToDriveResult,
  AttachmentSummary,
  AttachmentUploadCommitParams,
  AttachmentUploadCommitResult,
  AttachmentUploadStartParams,
  AttachmentUploadStartResult,
  CreateMailboxParams,
  CreateMailboxResult,
  DeleteBatchParams,
  DeleteBatchResult,
  DeleteFolderResult,
  DeleteMailboxResult,
  FolderScopedClient,
  FolderSummary,
  IncomingMessage,
  InitMailboxResult,
  ListMessagesParams,
  ListMessagesResult,
  MailboxScopedClient,
  MailboxSummary,
  MessageScopedClient,
  MessagesStoreClient,
  StoredMessage,
  UpsertBatchParams,
  UpsertBatchResult,
  UpsertFolderParams,
  UpsertFolderResult,
} from './messagesStoreTypes.js';

// ---------------------------------------------------------------------------
// Decode helpers (wire snake_case -> domain camelCase)
// ---------------------------------------------------------------------------

type RawObject = { readonly [key: string]: unknown };

const isObject = (value: unknown): value is RawObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const raw = (result: unknown): RawObject => {
  if (!isObject(result)) {
    throw new Error('Invalid messages_store response: expected object');
  }
  return result;
};

const str = (obj: RawObject, key: string): string | null => {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
};

const legacyStorageString = (obj: RawObject, key: string): string | null => {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
};

const strRequired = (obj: RawObject, key: string): string => {
  const v = str(obj, key);
  if (v === null) {
    throw new Error(`Invalid messages_store response: '${key}' must be a string`);
  }
  return v;
};

const num = (obj: RawObject, key: string): number => {
  const v = obj[key];
  if (typeof v !== 'number') {
    throw new Error(`Invalid messages_store response: '${key}' must be a number`);
  }
  return v;
};

const bool = (obj: RawObject, key: string): boolean => {
  const v = obj[key];
  return typeof v === 'boolean' ? v : false;
};

const metadataObj = (obj: RawObject, key: string): Readonly<Record<string, unknown>> => {
  const v = obj[key];
  return isObject(v) ? v : {};
};

const payloadObj = (obj: RawObject, key: string): Readonly<Record<string, unknown>> => {
  const v = obj[key];
  return isObject(v) ? v : {};
};

const arr = (obj: RawObject, key: string): readonly unknown[] => {
  const v = obj[key];
  return Array.isArray(v) ? v : [];
};

// -- decoders --

const decodeCreateMailbox = (o: unknown): CreateMailboxResult => {
  const r = raw(o);
  return {
    mailboxId: strRequired(r, 'mailbox_id'),
    dbInode: legacyStorageString(r, 'db_inode'),
    drivePath: legacyStorageString(r, 'drive_path'),
  };
};

const decodeMailboxSummary = (o: unknown): MailboxSummary => {
  const r = raw(o);
  return {
    mailboxId: strRequired(r, 'mailbox_id'),
    displayName: strRequired(r, 'display_name'),
    dbInode: legacyStorageString(r, 'db_inode'),
    recordCount: num(r, 'record_count'),
    sizeBytes: num(r, 'size_bytes'),
    updatedAt: strRequired(r, 'updated_at'),
  };
};

const decodeInitMailbox = (o: unknown): InitMailboxResult => {
  const r = raw(o);
  return {
    mailboxId: strRequired(r, 'mailbox_id'),
    schemaVersion: num(r, 'schema_version'),
  };
};

const decodeDeleteMailbox = (o: unknown): DeleteMailboxResult => {
  const r = raw(o);
  return {
    mailboxId: strRequired(r, 'mailbox_id'),
    deleted: bool(r, 'deleted'),
  };
};

const decodeUpsertFolder = (o: unknown): UpsertFolderResult => {
  const r = raw(o);
  return {
    folderId: strRequired(r, 'folder_id'),
    created: bool(r, 'created'),
  };
};

const decodeFolderSummary = (o: unknown): FolderSummary => {
  const r = raw(o);
  return {
    folderId: strRequired(r, 'folder_id'),
    displayName: strRequired(r, 'display_name'),
    metadata: metadataObj(r, 'metadata'),
    messageCount: num(r, 'message_count'),
    updatedAt: strRequired(r, 'updated_at'),
  };
};

const decodeFolderGet = (o: unknown): FolderSummary => {
  const r = raw(o);
  const folder = r.folder;
  if (!isObject(folder)) {
    throw new Error("Invalid messages_store response: 'folder' must be an object");
  }
  return decodeFolderSummary(folder);
};

const decodeDeleteFolder = (o: unknown): DeleteFolderResult => {
  const r = raw(o);
  return {
    folderId: strRequired(r, 'folder_id'),
    deleted: bool(r, 'deleted'),
    deletedMessageCount: num(r, 'deleted_message_count'),
  };
};

const decodeUpsertBatch = (o: unknown): UpsertBatchResult => {
  const r = raw(o);
  return {
    inserted: num(r, 'inserted'),
    updated: num(r, 'updated'),
  };
};

const decodeDeleteBatch = (o: unknown): DeleteBatchResult => {
  const r = raw(o);
  return { deleted: num(r, 'deleted') };
};

const decodeStoredMessage = (o: unknown): StoredMessage => {
  const r = raw(o);
  return {
    externalId: strRequired(r, 'external_id'),
    payload: payloadObj(r, 'payload'),
    createdAt: strRequired(r, 'created_at'),
    updatedAt: strRequired(r, 'updated_at'),
  };
};

const decodeListMessages = (o: unknown): ListMessagesResult => {
  const r = raw(o);
  return {
    items: arr(r, 'items').map(decodeStoredMessage),
    nextCursor: str(r, 'next_cursor'),
  };
};

const decodeGetMessage = (o: unknown): StoredMessage => {
  const r = raw(o);
  const message = r.message;
  if (!isObject(message)) {
    throw new Error("Invalid messages_store response: 'message' must be an object");
  }
  return decodeStoredMessage(message);
};

const decodeAttachmentUploadStart = (o: unknown): AttachmentUploadStartResult => {
  const r = raw(o);
  return {
    intentId: strRequired(r, 'intent_id'),
    uploadUrl: strRequired(r, 'upload_url'),
  };
};

const decodeAttachmentUploadCommit = (o: unknown): AttachmentUploadCommitResult => {
  const r = raw(o);
  return {
    attachmentId: strRequired(r, 'attachment_id'),
    driveInode: strRequired(r, 'drive_inode'),
    sizeBytes: num(r, 'size_bytes'),
  };
};

const decodeAttachmentSummary = (o: unknown): AttachmentSummary => {
  const r = raw(o);
  return {
    attachmentId: strRequired(r, 'attachment_id'),
    filename: strRequired(r, 'filename'),
    contentType: strRequired(r, 'content_type'),
    sizeBytes: num(r, 'size_bytes'),
    driveInode: strRequired(r, 'drive_inode'),
    createdAt: strRequired(r, 'created_at'),
  };
};

const decodeAttachmentDownloadUrl = (o: unknown): AttachmentDownloadUrlResult => {
  const r = raw(o);
  return {
    url: strRequired(r, 'url'),
    expiresAt: strRequired(r, 'expires_at'),
  };
};

const decodeAttachmentSavedDriveEntry = (o: unknown): AttachmentSavedDriveEntry => {
  const r = raw(o);
  return {
    id: strRequired(r, 'inode'),
    name: strRequired(r, 'name'),
    type: strRequired(r, 'type'),
    parentId: str(r, 'parent_inode'),
    fileId: str(r, 'file_id'),
    etag: str(r, 'etag'),
    size: typeof r.size === 'number' ? r.size : null,
    mimeType: str(r, 'mime_type'),
    fullPath: str(r, 'full_path'),
  };
};

const decodeAttachmentSaveToDrive = (o: unknown): AttachmentSaveToDriveResult => {
  const r = raw(o);
  return {
    saved: bool(r, 'saved'),
    entry: decodeAttachmentSavedDriveEntry(r.entry),
  };
};

const decodeAttachmentDelete = (o: unknown): AttachmentDeleteResult => {
  const r = raw(o);
  return { deleted: bool(r, 'deleted') };
};

// ---------------------------------------------------------------------------
// Encode helpers (domain camelCase -> wire snake_case)
// ---------------------------------------------------------------------------

const optional = <T>(key: string, value: T | undefined): Record<string, T> =>
  value !== undefined ? { [key]: value } : {};

const encodeIncomingMessage = (m: IncomingMessage): Record<string, unknown> => ({
  external_id: m.externalId,
  payload: m.payload,
});

// ---------------------------------------------------------------------------
// Scoped factories (closures capture the path identifiers)
// ---------------------------------------------------------------------------

type CallFn = (method: string, params: unknown) => Promise<unknown>;

/** Build the message-scoped client (attachments only). */
const makeMessageScoped = (
  call: CallFn,
  mailboxId: string,
  folderId: string,
  externalId: string
): MessageScopedClient => ({
  attachments: {
    uploadStart: async (p: AttachmentUploadStartParams) => {
      const result = await call('messages_store/attachment/upload-start', {
        mailbox_id: mailboxId,
        folder_id: folderId,
        external_id: externalId,
        attachment_id: p.attachmentId,
        filename: p.filename,
        content_type: p.contentType,
        size_bytes: p.sizeBytes,
        ...optional('auto_commit', p.autoCommit),
      });
      return decodeAttachmentUploadStart(result);
    },

    uploadCommit: async (p: AttachmentUploadCommitParams) => {
      const result = await call('messages_store/attachment/upload-commit', {
        mailbox_id: mailboxId,
        folder_id: folderId,
        external_id: externalId,
        attachment_id: p.attachmentId,
        intent_id: p.intentId,
        etag: p.etag,
        ...optional('auto_commit', p.autoCommit),
      });
      return decodeAttachmentUploadCommit(result);
    },

    list: async () => {
      const result = await call('messages_store/attachment/list', {
        mailbox_id: mailboxId,
        folder_id: folderId,
        external_id: externalId,
      });
      const items = arr(raw(result), 'items');
      return items.map(decodeAttachmentSummary);
    },

    downloadUrl: async (p: AttachmentDownloadUrlParams) => {
      const result = await call('messages_store/attachment/download-url', {
        mailbox_id: mailboxId,
        folder_id: folderId,
        external_id: externalId,
        attachment_id: p.attachmentId,
      });
      return decodeAttachmentDownloadUrl(result);
    },

    saveToDrive: async (p: AttachmentSaveToDriveParams) => {
      const result = await call('messages_store/attachment/save-to-drive', {
        mailbox_id: mailboxId,
        folder_id: folderId,
        external_id: externalId,
        attachment_id: p.attachmentId,
        target_path: p.targetPath,
      });
      return decodeAttachmentSaveToDrive(result);
    },

    delete: async (p: AttachmentDeleteParams) => {
      const result = await call('messages_store/attachment/delete', {
        mailbox_id: mailboxId,
        folder_id: folderId,
        external_id: externalId,
        attachment_id: p.attachmentId,
        ...optional('auto_commit', p.autoCommit),
      });
      return decodeAttachmentDelete(result);
    },
  },
});

/** Build the folder-scoped client (folder CRUD + messages + .message()). */
const makeFolderScoped = (
  call: CallFn,
  mailboxId: string,
  folderId: string
): FolderScopedClient => ({
  upsert: async (p) => {
    const result = await call('messages_store/folder/upsert', {
      mailbox_id: mailboxId,
      folder_id: folderId,
      display_name: p.displayName,
      ...optional('metadata', p.metadata),
      ...optional('auto_commit', p.autoCommit),
    });
    return decodeUpsertFolder(result);
  },

  get: async () => {
    const result = await call('messages_store/folder/get', {
      mailbox_id: mailboxId,
      folder_id: folderId,
    });
    return decodeFolderGet(result);
  },

  delete: async (p) => {
    const result = await call('messages_store/folder/delete', {
      mailbox_id: mailboxId,
      folder_id: folderId,
      ...optional('auto_commit', p?.autoCommit),
    });
    return decodeDeleteFolder(result);
  },

  upsertBatch: async (p: UpsertBatchParams) => {
    const result = await call('messages_store/upsert-batch', {
      mailbox_id: mailboxId,
      folder_id: folderId,
      items: p.items.map(encodeIncomingMessage),
      ...optional('auto_commit', p.autoCommit),
    });
    return decodeUpsertBatch(result);
  },

  deleteBatch: async (p: DeleteBatchParams) => {
    const result = await call('messages_store/delete-batch', {
      mailbox_id: mailboxId,
      folder_id: folderId,
      external_ids: [...p.externalIds],
      ...optional('auto_commit', p.autoCommit),
    });
    return decodeDeleteBatch(result);
  },

  listMessages: async (p?: ListMessagesParams) => {
    const result = await call('messages_store/list', {
      mailbox_id: mailboxId,
      folder_id: folderId,
      ...optional('limit', p?.limit),
      ...optional('cursor', p?.cursor),
      ...optional('order_by', p?.orderBy),
    });
    return decodeListMessages(result);
  },

  getMessage: async (p) => {
    const result = await call('messages_store/get', {
      mailbox_id: mailboxId,
      folder_id: folderId,
      external_id: p.externalId,
    });
    return decodeGetMessage(result);
  },

  message: ({ externalId }) => makeMessageScoped(call, mailboxId, folderId, externalId),
});

/** Build the mailbox-scoped client (mailbox CRUD + folder helpers + .folder()). */
const makeMailboxScoped = (call: CallFn, mailboxId: string): MailboxScopedClient => ({
  init: async (p) => {
    const result = await call('messages_store/init', {
      mailbox_id: mailboxId,
      ...optional('auto_commit', p?.autoCommit),
    });
    return decodeInitMailbox(result);
  },

  delete: async () => {
    const result = await call('messages_store/delete_mailbox', { mailbox_id: mailboxId });
    return decodeDeleteMailbox(result);
  },

  upsertFolder: async (p: UpsertFolderParams) => {
    const result = await call('messages_store/folder/upsert', {
      mailbox_id: mailboxId,
      folder_id: p.folderId,
      display_name: p.displayName,
      ...optional('metadata', p.metadata),
      ...optional('auto_commit', p.autoCommit),
    });
    return decodeUpsertFolder(result);
  },

  listFolders: async () => {
    const result = await call('messages_store/folder/list', { mailbox_id: mailboxId });
    const items = arr(raw(result), 'folders');
    return items.map(decodeFolderSummary);
  },

  folder: ({ folderId }) => makeFolderScoped(call, mailboxId, folderId),
});

// ---------------------------------------------------------------------------
// Top-level client factory
// ---------------------------------------------------------------------------

/**
 * Creates a Messages Store client bound to a given auth module.
 *
 * The store's JSON-RPC methods are served by drive's RPC endpoint
 * (`os/drive/api/v1`); we resolve the same gateway URL here.
 *
 * Example:
 * ```ts
 * const messagesStore = diskd.os.messagesStore({ auth });
 * const mailbox = messagesStore.mailbox({ mailboxId: 'gmail-acme' });
 * await mailbox.init();
 * const folder = mailbox.folder({ folderId: 'INBOX' });
 * await folder.upsertBatch({ items: [...] });
 * ```
 */
export const createMessagesStoreClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
}): MessagesStoreClient => {
  const rpcUrl = params.url
    ? params.url.replace(/\/+$/, '')
    : `${resolveDiskdGatewayUrl('os/drive')}/api/v1`;
  let nextId = 1;

  const call: CallFn = async (method, rpcParams) => {
    const id = nextId;
    nextId += 1;

    if (params.auth.getRequestHeaders) {
      const headers = await params.auth.getRequestHeaders();
      return jsonRpcCall({ url: rpcUrl, headers, method, rpcParams, id });
    }

    const bearerToken = await params.auth.getAccessToken();
    return jsonRpcCall({ url: rpcUrl, bearerToken, method, rpcParams, id });
  };

  return {
    createMailbox: async (p: CreateMailboxParams) => {
      const result = await call('messages_store/create_mailbox', {
        mailbox_id: p.mailboxId,
        display_name: p.displayName,
        ...optional('metadata', p.metadata),
        ...optional('recreate', p.recreate),
        ...optional('storage_version', p.storageVersion),
      });
      return decodeCreateMailbox(result);
    },

    listMailboxes: async () => {
      const result = await call('messages_store/list_mailboxes', {});
      const items = arr(raw(result), 'mailboxes');
      return items.map(decodeMailboxSummary);
    },

    mailbox: ({ mailboxId }) => makeMailboxScoped(call, mailboxId),
  };
};
