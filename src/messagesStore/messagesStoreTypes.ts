// ---------------------------------------------------------------------------
// Drive Messages Store API -- pure types (no classes, no I/O)
//
// Concept: opaque, protocol-agnostic message store served by drive's
// `messages_store/*` JSON-RPC namespace. Four boundaries (mailboxes,
// folders, messages, attachments) exposed as functionally-scoped
// clients so callers don't repeat (mailboxId, folderId, externalId)
// on every call.
// ---------------------------------------------------------------------------

// -- Boundary 1: mailboxes --

/** Caller-supplied parameters for creating a workspace mailbox. */
export type CreateMailboxParams = {
  readonly mailboxId: string;
  readonly displayName: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly recreate?: boolean;
};

/** Result of create_mailbox; carries the persisted Drive location. */
export type CreateMailboxResult = {
  readonly mailboxId: string;
  readonly dbInode: string;
  readonly drivePath: string;
};

/** Compact mailbox row returned by listMailboxes. */
export type MailboxSummary = {
  readonly mailboxId: string;
  readonly displayName: string;
  readonly dbInode: string;
  readonly recordCount: number;
  readonly sizeBytes: number;
  readonly updatedAt: string;
};

/** Idempotent mailbox-schema bootstrap result. */
export type InitMailboxResult = {
  readonly mailboxId: string;
  readonly schemaVersion: number;
};

/** Reports whether a mailbox existed prior to the delete. */
export type DeleteMailboxResult = {
  readonly mailboxId: string;
  readonly deleted: boolean;
};

// -- Boundary 2: folders --

/** Idempotent folder upsert parameters; metadata holds protocol-specific sync state. */
export type UpsertFolderParams = {
  readonly folderId: string;
  readonly displayName: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/** Reports whether the folder was created (true) or updated (false). */
export type UpsertFolderResult = {
  readonly folderId: string;
  readonly created: boolean;
};

/** Compact folder row returned by list/get. */
export type FolderSummary = {
  readonly folderId: string;
  readonly displayName: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly messageCount: number;
  readonly updatedAt: string;
};

/** Reports cascade size for caller telemetry. */
export type DeleteFolderResult = {
  readonly folderId: string;
  readonly deleted: boolean;
  readonly deletedMessageCount: number;
};

// -- Boundary 3: messages --

/** Caller-supplied message; payload is opaque JSON the store never inspects. */
export type IncomingMessage = {
  readonly externalId: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

/** Bulk-upsert parameters; folder is implied by the scoping client. */
export type UpsertBatchParams = {
  readonly items: readonly IncomingMessage[];
};

/** Counts split between insertions and updates; commit is implicit. */
export type UpsertBatchResult = {
  readonly inserted: number;
  readonly updated: number;
};

/** Bulk-delete parameters; folder is implied by the scoping client. */
export type DeleteBatchParams = {
  readonly externalIds: readonly string[];
};

/** Reports the count actually deleted (missing ids skipped). */
export type DeleteBatchResult = {
  readonly deleted: number;
};

/** Cursor-paginated message-list parameters. */
export type ListMessagesParams = {
  readonly limit?: number;
  readonly cursor?: string;
};

/** One stored message row, payload opaque. */
export type StoredMessage = {
  readonly externalId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** One page of messages plus the next cursor (null at end). */
export type ListMessagesResult = {
  readonly items: readonly StoredMessage[];
  readonly nextCursor: string | null;
};

// -- Boundary 4: attachments --

/** Begin per-attachment upload; mirrors drive/upload/start. */
export type AttachmentUploadStartParams = {
  readonly attachmentId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
};

/** Intent envelope; passes through Drive's upload-intent contract. */
export type AttachmentUploadStartResult = {
  readonly intentId: string;
  readonly uploadUrl: string;
};

/** Finalize an upload and register the attachment row. */
export type AttachmentUploadCommitParams = {
  readonly attachmentId: string;
  readonly intentId: string;
  readonly etag: string;
};

/** Reports the inode of the persisted file plus its size. */
export type AttachmentUploadCommitResult = {
  readonly attachmentId: string;
  readonly driveInode: string;
  readonly sizeBytes: number;
};

/** Compact attachment row returned by attachments.list. */
export type AttachmentSummary = {
  readonly attachmentId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly driveInode: string;
  readonly createdAt: string;
};

/** Single-attachment lookup parameters. */
export type AttachmentDownloadUrlParams = {
  readonly attachmentId: string;
};

/** Presigned URL with explicit expiry. */
export type AttachmentDownloadUrlResult = {
  readonly url: string;
  readonly expiresAt: string;
};

/** Identifier-only attachment delete; cascades the Drive file. */
export type AttachmentDeleteParams = {
  readonly attachmentId: string;
};

/** Reports whether the attachment existed prior to the call. */
export type AttachmentDeleteResult = {
  readonly deleted: boolean;
};

// ---------------------------------------------------------------------------
// Scoped client interfaces (functional scoping)
// ---------------------------------------------------------------------------

/**
 * Scoped to (mailboxId, folderId, externalId). Carries the
 * five attachment methods so callers don't repeat the triple.
 */
export type MessageScopedClient = {
  readonly attachments: {
    readonly uploadStart: (
      params: AttachmentUploadStartParams
    ) => Promise<AttachmentUploadStartResult>;
    readonly uploadCommit: (
      params: AttachmentUploadCommitParams
    ) => Promise<AttachmentUploadCommitResult>;
    readonly list: () => Promise<readonly AttachmentSummary[]>;
    readonly downloadUrl: (
      params: AttachmentDownloadUrlParams
    ) => Promise<AttachmentDownloadUrlResult>;
    readonly delete: (params: AttachmentDeleteParams) => Promise<AttachmentDeleteResult>;
  };
};

/**
 * Scoped to (mailboxId, folderId). Carries CRUD for the folder
 * itself plus the four message methods, and a `.message()`
 * factory that drills into the message-scoped client.
 */
export type FolderScopedClient = {
  readonly upsert: (params: Omit<UpsertFolderParams, 'folderId'>) => Promise<UpsertFolderResult>;
  readonly get: () => Promise<FolderSummary>;
  readonly delete: () => Promise<DeleteFolderResult>;
  readonly upsertBatch: (params: UpsertBatchParams) => Promise<UpsertBatchResult>;
  readonly deleteBatch: (params: DeleteBatchParams) => Promise<DeleteBatchResult>;
  readonly listMessages: (params?: ListMessagesParams) => Promise<ListMessagesResult>;
  readonly getMessage: (params: { readonly externalId: string }) => Promise<StoredMessage>;
  readonly message: (params: { readonly externalId: string }) => MessageScopedClient;
};

/**
 * Scoped to (mailboxId). Carries CRUD for the mailbox itself
 * plus folder-level helpers and a `.folder()` factory.
 */
export type MailboxScopedClient = {
  readonly init: () => Promise<InitMailboxResult>;
  readonly delete: () => Promise<DeleteMailboxResult>;
  readonly upsertFolder: (params: UpsertFolderParams) => Promise<UpsertFolderResult>;
  readonly listFolders: () => Promise<readonly FolderSummary[]>;
  readonly folder: (params: { readonly folderId: string }) => FolderScopedClient;
};

/**
 * Workspace-scoped messages-store client. Workspace identity
 * is auth-derived; callers never pass workspaceId on the wire.
 */
export type MessagesStoreClient = {
  readonly createMailbox: (params: CreateMailboxParams) => Promise<CreateMailboxResult>;
  readonly listMailboxes: () => Promise<readonly MailboxSummary[]>;
  readonly mailbox: (params: { readonly mailboxId: string }) => MailboxScopedClient;
};
