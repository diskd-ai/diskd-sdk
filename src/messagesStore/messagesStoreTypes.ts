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
  readonly metadata: Readonly<Record<string, unknown>>;
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
export type SearchMessagesOrderBy = 'message_date_desc' | 'message_date_asc';

/** Cursor-paginated message-list parameters. */
export type ListMessagesParams = {
  readonly limit?: number;
  readonly cursor?: string;
  readonly orderBy?: ListMessagesOrderBy;
};

/** Drive-owned query page parameters; pageSize counts scanned messages. */
export type SearchMessagesParams = {
  readonly query: string;
  readonly pageSize: number;
  readonly cursor?: string;
  /** Chronological index order used before Drive applies the bounded page size. */
  readonly orderBy?: SearchMessagesOrderBy;
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

/** Cursor-paginated mailbox sender aggregation parameters. */
export type ListSendersParams = {
  readonly folderId?: string;
  readonly limit?: number;
  readonly cursor?: string;
};

/** One unique sender summary computed from compact message metadata. */
export type SenderSummary = {
  readonly name: string | null;
  readonly address: string;
  readonly count: number;
  readonly firstDate: string | null;
  readonly lastDate: string | null;
};

/** One bounded sender page with mailbox-wide aggregate counts. */
export type ListSendersResult = {
  readonly mailboxId: string;
  readonly folderId: string | null;
  readonly totalMessages: number;
  readonly uniqueSenderCount: number;
  readonly senders: readonly SenderSummary[];
  readonly nextCursor: string | null;
};

// -- Boundary 3b: canonical outbound Exchange item --

/** One email address carried by the provider-neutral outbound email contract. */
export type EmailOutboxContact = {
  readonly name: string;
  readonly address: string;
};

/** One immutable Drive artifact referenced by an outbound email payload. */
export type EmailOutboxAttachment = {
  readonly path: string;
  readonly filename: string;
  readonly contentType: string;
};

type EmailOutboxPayloadFields = {
  readonly messageId: string;
  readonly account: string;
  readonly threadId: string | null;
  readonly inReplyTo: string | null;
  readonly from: EmailOutboxContact;
  readonly to: readonly EmailOutboxContact[];
  readonly cc: readonly EmailOutboxContact[];
  readonly bcc: readonly EmailOutboxContact[];
  readonly subject: string;
  readonly bodyText: string;
  readonly bodyHtml: string;
};

/**
 * Current outbound email payload shared by Review producers and the email
 * delivery adapter. Drive stores this object opaquely and never interprets it.
 * The attachment variants prevent the flag and non-empty reference list from
 * disagreeing at compile time.
 */
export type EmailOutboxPayload = EmailOutboxPayloadFields &
  (
    | {
        readonly hasAttachments: false;
        readonly attachments: readonly [];
      }
    | {
        readonly hasAttachments: true;
        readonly attachments: readonly [EmailOutboxAttachment, ...EmailOutboxAttachment[]];
      }
  );

/** Storage lifecycle state for one canonical outbound item. */
export type ExchangeState = 'review' | 'outbox' | 'sent' | 'failed' | 'reconciliation_required';

/** One canonical outbound item stored by Drive. */
export type ExchangeItem = {
  readonly externalId: string;
  readonly account: string;
  readonly mailboxId: string;
  readonly state: ExchangeState;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly revision: string;
  readonly deliveryAttempts: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** Create one canonical item directly in Outbox state. */
export type CreateOutboxItemParams = {
  readonly externalId: string;
  readonly account: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

/** Cursor-paginated available Outbox work. */
export type ListPendingOutboxParams = {
  readonly limit?: number;
  readonly cursor?: string;
};

/** One page of Outbox items whose lease is absent or expired. */
export type ListPendingOutboxResult = {
  readonly items: readonly ExchangeItem[];
  readonly nextCursor: string | null;
};

/** Cursor-paginated query for one canonical Exchange lifecycle state. */
export type ListExchangeItemsParams = {
  readonly state: ExchangeState;
  readonly limit?: number;
  readonly cursor?: string;
};

/** One persisted lifecycle page used by reload-safe projections. */
export type ListExchangeItemsResult = {
  readonly items: readonly ExchangeItem[];
  readonly nextCursor: string | null;
};

/** Common optimistic lease mutation parameters. */
export type OutboxLeaseParams = {
  readonly externalId: string;
  readonly expectedRevision: string;
  readonly leaseOwner: string;
  readonly leaseSeconds: number;
};

/** Provider outcome persisted without interpreting provider-specific fields. */
export type OutboxTerminalOutcome =
  | {
      readonly state: 'sent';
      readonly providerResponse: Readonly<Record<string, unknown>>;
    }
  | {
      readonly state: 'failed';
      readonly reason: string;
    };

/** Lease-guarded terminal-state write parameters. */
export type WriteOutboxTerminalParams = {
  readonly externalId: string;
  readonly expectedRevision: string;
  readonly leaseOwner: string;
  readonly outcome: OutboxTerminalOutcome;
};

/** Fields that a lifecycle owner may persist with a revision guard. */
export type ExchangePatch = {
  readonly state?: ExchangeState;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly result?: Readonly<Record<string, unknown>>;
};

/** Apply one idempotent compare-and-set update to a canonical item. */
export type UpdateExchangeItemParams = {
  readonly externalId: string;
  readonly expectedRevision: string;
  readonly patch: ExchangePatch;
};

/** One message waiting for review before send. */
export type ReviewItem = {
  readonly reviewId: string;
  readonly account: string;
  readonly mailboxId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** Create one item in the single workspace review box. */
export type CreateReviewItemParams = {
  readonly reviewId: string;
  readonly account: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

/** Cursor-paginated review box listing parameters. */
export type ListReviewItemsParams = {
  readonly limit?: number;
  readonly cursor?: string;
};

/** One page of review items from the single workspace review box. */
export type ListReviewItemsResult = {
  readonly items: readonly ReviewItem[];
  readonly nextCursor: string | null;
};

/** Delete one review item from the review box. */
export type DeleteReviewItemResult = {
  readonly reviewId: string;
  readonly deleted: boolean;
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
  readonly listMessages: (
    params?: ListMessagesParams,
    signal?: AbortSignal
  ) => Promise<ListMessagesResult>;
  /** Search one bounded Drive page and return matches plus its continuation cursor. */
  readonly searchMessages: (
    params: SearchMessagesParams,
    signal?: AbortSignal
  ) => Promise<ListMessagesResult>;
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
  readonly listFolders: (signal?: AbortSignal) => Promise<readonly FolderSummary[]>;
  /** Return one bounded page of unique senders without reading message bodies. */
  readonly listSenders: (
    params?: ListSendersParams,
    signal?: AbortSignal
  ) => Promise<ListSendersResult>;
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
  /** Single workspace review box for outbound messages awaiting manual review. */
  readonly review: {
    /** Create one review item. */
    readonly create: (params: CreateReviewItemParams) => Promise<ReviewItem>;
    /** Cursor-paginated listing of review items. */
    readonly list: (params?: ListReviewItemsParams) => Promise<ListReviewItemsResult>;
    /** Read one review item by reviewId. */
    readonly get: (params: { readonly reviewId: string }) => Promise<ReviewItem>;
    /** Delete one review item by reviewId. */
    readonly delete: (params: { readonly reviewId: string }) => Promise<DeleteReviewItemResult>;
    /** Atomically move Review to Outbox and return the same canonical item. */
    readonly approve: (params: { readonly reviewId: string }) => Promise<ExchangeItem>;
  };
  /** Create, read, lease, and complete canonical provider work. */
  readonly outbox: {
    readonly create: (params: CreateOutboxItemParams) => Promise<ExchangeItem>;
    readonly get: (params: { readonly externalId: string }) => Promise<ExchangeItem>;
    readonly listPending: (params?: ListPendingOutboxParams) => Promise<ListPendingOutboxResult>;
    readonly claim: (params: OutboxLeaseParams) => Promise<ExchangeItem>;
    readonly renewLease: (params: OutboxLeaseParams) => Promise<ExchangeItem>;
    readonly writeTerminal: (params: WriteOutboxTerminalParams) => Promise<ExchangeItem>;
  };
  /** Persist lifecycle changes owned by a provider or reconciliation process. */
  readonly exchange: {
    /** List one persisted lifecycle state across workspace mailboxes. */
    readonly list: (params: ListExchangeItemsParams) => Promise<ListExchangeItemsResult>;
    readonly update: (params: UpdateExchangeItemParams) => Promise<ExchangeItem>;
  };
  /**
   * Bind a mailbox-scoped client over `mailboxId`. The returned
   * client exposes mailbox CRUD plus folder/message operations.
   */
  readonly mailbox: (params: { readonly mailboxId: string }) => MailboxScopedClient;
};
