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

/** Optional S3 flush control for mailbox SQLite mutations. */
export type AutoCommitParams = {
  readonly autoCommit?: boolean | null;
};

/** Caller-supplied parameters for creating a workspace mailbox. */
export type CreateMailboxParams = {
  readonly mailboxId: string;
  readonly displayName: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly recreate?: boolean;
  readonly storageVersion?: 'sqlite-v1' | 'segments-v1';
};

/** Result of create_mailbox; legacy Drive location fields are null for segment-backed mailboxes. */
export type CreateMailboxResult = {
  readonly mailboxId: string;
  readonly dbInode: string | null;
  readonly drivePath: string | null;
};

/** Compact mailbox row returned by listMailboxes. */
export type MailboxSummary = {
  readonly mailboxId: string;
  readonly displayName: string;
  readonly dbInode: string | null;
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
  readonly autoCommit?: boolean | null;
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
  readonly autoCommit?: boolean | null;
};

/** Counts split between insertions and updates; commit is implicit. */
export type UpsertBatchResult = {
  readonly inserted: number;
  readonly updated: number;
};

/** Bulk-delete parameters; folder is implied by the scoping client. */
export type DeleteBatchParams = {
  readonly externalIds: readonly string[];
  readonly autoCommit?: boolean | null;
};

/** Reports the count actually deleted (missing ids skipped). */
export type DeleteBatchResult = {
  readonly deleted: number;
};

export type ListMessagesOrderBy = 'message_date_desc' | 'store_updated_desc';

/** Cursor-paginated message-list parameters. */
export type ListMessagesParams = {
  readonly limit?: number;
  readonly cursor?: string;
  readonly orderBy?: ListMessagesOrderBy;
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
  readonly autoCommit?: boolean | null;
};

/** Intent envelope for a new upload, or existing attachment ref for idempotent retry. */
export type AttachmentUploadStartResult =
  | {
      readonly alreadyUploaded: false;
      readonly intentId: string;
      readonly uploadUrl: string;
    }
  | {
      readonly alreadyUploaded: true;
      readonly intentId: null;
      readonly uploadUrl: null;
      readonly attachmentId: string;
      readonly sizeBytes: number;
      readonly createdAt: string;
    };

/** Finalize an upload and register the attachment row. */
export type AttachmentUploadCommitParams = {
  readonly attachmentId: string;
  readonly intentId: string;
  readonly etag: string;
  readonly autoCommit?: boolean | null;
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

/** Create a Drive file link for an existing attachment. */
export type AttachmentSaveToDriveParams = {
  readonly attachmentId: string;
  /** Absolute target Drive path. Parent must already exist. */
  readonly targetPath: string;
};

/** Target Drive entry created by attachment save-to-drive. */
export type AttachmentSavedDriveEntry = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly parentId: string | null;
  readonly fileId: string | null;
  readonly etag: string | null;
  readonly size: number | null;
  readonly mimeType: string | null;
  readonly fullPath: string | null;
};

/** Reports the target Drive entry only; source driveInode is never exposed. */
export type AttachmentSaveToDriveResult = {
  readonly saved: boolean;
  readonly entry: AttachmentSavedDriveEntry;
};

/** Identifier-only attachment delete; cascades the Drive file. */
export type AttachmentDeleteParams = {
  readonly attachmentId: string;
  readonly autoCommit?: boolean | null;
};

/** Reports whether the attachment existed prior to the call. */
export type AttachmentDeleteResult = {
  readonly deleted: boolean;
};

// ---------------------------------------------------------------------------
// Scoped client interfaces (functional scoping)
// ---------------------------------------------------------------------------

/**
 * Scoped to a single message identified by `(mailboxId, folderId,
 * externalId)`. Returned by {@link FolderScopedClient.message}.
 *
 * Carries the five attachment methods so callers don't repeat the
 * triple on every call. Attachments live in Drive under
 * `/Mailboxes/<mailboxId>/<per-message-folder>/`; the per-message
 * folder is created lazily on the first
 * {@link MessageScopedClient.attachments.uploadStart} call.
 */
export type MessageScopedClient = {
  readonly attachments: {
    /**
     * Begin a per-attachment upload. Returns an upload intent
     * (`intentId` + `uploadUrl`). PUT the bytes to the upload URL
     * with header `X-Upload-Intent-Id: <intentId>`, then call
     * {@link MessageScopedClient.attachments.uploadCommit}.
     */
    readonly uploadStart: (
      params: AttachmentUploadStartParams
    ) => Promise<AttachmentUploadStartResult>;
    /**
     * Finalize a previously-started upload. Registers the
     * attachment row in the mailbox SQLite and returns the
     * persisted Drive inode + size.
     */
    readonly uploadCommit: (
      params: AttachmentUploadCommitParams
    ) => Promise<AttachmentUploadCommitResult>;
    /** Enumerate all attachments owned by this message. */
    readonly list: () => Promise<readonly AttachmentSummary[]>;
    /**
     * Return a presigned URL for one attachment with explicit
     * `expiresAt`. Use this for client-side downloads without
     * exposing storage credentials.
     */
    readonly downloadUrl: (
      params: AttachmentDownloadUrlParams
    ) => Promise<AttachmentDownloadUrlResult>;
    /** Create a Drive file link for an existing attachment without exposing source driveInode. */
    readonly saveToDrive: (
      params: AttachmentSaveToDriveParams
    ) => Promise<AttachmentSaveToDriveResult>;
    /** Remove the attachment row and cascade-delete the Drive file. */
    readonly delete: (params: AttachmentDeleteParams) => Promise<AttachmentDeleteResult>;
  };
};

/**
 * Scoped to a single folder identified by `(mailboxId, folderId)`.
 * Returned by {@link MailboxScopedClient.folder}.
 *
 * Carries CRUD for the folder itself plus the four message
 * methods, and a {@link FolderScopedClient.message} factory that
 * drills into per-message attachment operations.
 */
export type FolderScopedClient = {
  /**
   * Idempotent folder upsert; mirrors
   * {@link MailboxScopedClient.upsertFolder} but the `folderId`
   * is implicit. Use this to update folder display name or
   * metadata (e.g. IMAP `UIDVALIDITY`/`UIDNEXT`).
   */
  readonly upsert: (params: Omit<UpsertFolderParams, 'folderId'>) => Promise<UpsertFolderResult>;
  /** Fetch the {@link FolderSummary} for this folder. */
  readonly get: () => Promise<FolderSummary>;
  /**
   * Cascade-delete the folder, all messages it owns, and any
   * per-message attachment Drive subtrees. Returns the count of
   * deleted messages so callers can report telemetry.
   */
  readonly delete: (params?: AutoCommitParams) => Promise<DeleteFolderResult>;
  /**
   * Bulk insert-or-update messages keyed by `externalId`. The
   * batch is committed before this method returns by default; pass
   * `autoCommit: false` to defer the S3 flush.
   */
  readonly upsertBatch: (params: UpsertBatchParams) => Promise<UpsertBatchResult>;
  /**
   * Bulk-delete messages by `externalId` list. Missing ids are
   * silently skipped; the response reports the count actually
   * deleted. Cascades attachment Drive files.
   */
  readonly deleteBatch: (params: DeleteBatchParams) => Promise<DeleteBatchResult>;
  /**
   * Cursor-paginated message listing. Pass the previous response's
   * `nextCursor` to continue; `null` means end of stream. Default
   * page size is server-defined (currently 100, max 1000).
   */
  readonly listMessages: (params?: ListMessagesParams) => Promise<ListMessagesResult>;
  /**
   * Read one message by `externalId`. Throws when the message
   * does not exist (server returns a `MESSAGE_NOT_FOUND` failure).
   */
  readonly getMessage: (params: { readonly externalId: string }) => Promise<StoredMessage>;
  /**
   * Bind a message-scoped client over `(mailboxId, folderId,
   * externalId)`. The returned client exposes attachment operations
   * for that message.
   */
  readonly message: (params: { readonly externalId: string }) => MessageScopedClient;
};

/**
 * Scoped to a single mailbox identified by `mailboxId`. Returned
 * by {@link MessagesStoreClient.mailbox}.
 *
 * Carries CRUD for the mailbox itself plus folder-level helpers
 * and a {@link MailboxScopedClient.folder} factory.
 */
export type MailboxScopedClient = {
  /**
   * Idempotent SQLite-schema bootstrap. Creates `mailbox_meta`,
   * `folders`, `messages`, and `attachments` tables on first call
   * and is safe to re-run. Required before any folder/message ops.
   */
  readonly init: (params?: AutoCommitParams) => Promise<InitMailboxResult>;
  /**
   * Delete the mailbox file and the per-mailbox attachment Drive
   * subtree (`/Mailboxes/<mailboxId>/`). Reports whether the
   * mailbox existed prior to the call.
   */
  readonly delete: () => Promise<DeleteMailboxResult>;
  /**
   * Idempotent folder upsert. `folderId` is opaque (caller-chosen,
   * e.g. the IMAP folder name). `metadata` is opaque JSON the
   * store never inspects -- ideal for protocol-specific sync state.
   */
  readonly upsertFolder: (params: UpsertFolderParams) => Promise<UpsertFolderResult>;
  /** Enumerate all folders in this mailbox. */
  readonly listFolders: () => Promise<readonly FolderSummary[]>;
  /**
   * Bind a folder-scoped client over `(mailboxId, folderId)`. The
   * returned client exposes folder CRUD plus message operations.
   */
  readonly folder: (params: { readonly folderId: string }) => FolderScopedClient;
};

/**
 * Workspace-scoped messages-store client. Returned by
 * `diskd.os.messagesStore({ auth })`.
 *
 * Workspace identity is auth-derived (X-Workspace-Id from API key
 * or `ext.workspace_id` from OAuth JWT); callers never pass
 * `workspaceId` on the wire.
 *
 * Functional scoping pattern -- drill into a single mailbox,
 * folder, or message to skip repeating identifiers:
 *
 * ```ts
 * const messagesStore = diskd.os.messagesStore({ auth });
 * const mailbox = messagesStore.mailbox({ mailboxId: 'gmail-acme' });
 * const folder  = mailbox.folder({ folderId: 'INBOX' });
 * const message = folder.message({ externalId: 'imap-uid-1001' });
 * ```
 */
export type MessagesStoreClient = {
  /**
   * Allocate a new mailbox SQLite file at
   * `/Mailboxes/<mailboxId>.mailbox`. `mailboxId` is a workspace-
   * unique slug (`[a-z0-9-]{1,64}`). `metadata` is opaque JSON
   * stashed on the underlying drive_databases record.
   *
   * The mailbox SQLite schema is bootstrapped lazily by
   * {@link MailboxScopedClient.init}, not by this call.
   */
  readonly createMailbox: (params: CreateMailboxParams) => Promise<CreateMailboxResult>;
  /** Workspace-scoped mailbox enumeration. Read-only. */
  readonly listMailboxes: () => Promise<readonly MailboxSummary[]>;
  /**
   * Bind a mailbox-scoped client over `mailboxId`. The returned
   * client exposes mailbox CRUD plus folder/message operations.
   */
  readonly mailbox: (params: { readonly mailboxId: string }) => MailboxScopedClient;
};
