// Stored email types and platform inbox client contracts.
// Legacy JSON mail lives at /.profile/mail/<account>/inbox/.
// Exchange mail lives in Drive messagesStore mailboxes named exchange-<account-slug>.

// -- Contact --

export type StoredEmailContact = {
  readonly name: string;
  readonly address: string;
};

// -- Attachment --

export type StoredEmailAttachment = {
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  /** Legacy Drive path. Empty for messagesStore attachments; use attachmentId there. */
  readonly drivePath: string;
  /** Messages Store public attachment handle. Never exposes driveInode. */
  readonly attachmentId?: string;
  readonly storageState?: string;
  readonly storedSizeBytes?: number;
  readonly storedAt?: string;
  readonly lastLoadError?: string;
};

// -- Full stored email --

export type StoredEmail = {
  /** Opaque handle returned by list/search; preferred input for read/mark-read. */
  readonly messageRef?: string;
  readonly folderId?: string;
  readonly messageId: string;
  readonly uid: number | null;
  readonly account: string;
  readonly folder: string;
  readonly from: StoredEmailContact;
  readonly to: readonly StoredEmailContact[];
  readonly cc: readonly StoredEmailContact[];
  readonly subject: string;
  readonly date: string;
  readonly receivedAt: string;
  readonly snippet: string;
  readonly bodyText: string;
  readonly bodyHtml: string;
  readonly hasAttachments: boolean;
  readonly attachments: readonly StoredEmailAttachment[];
  readonly labels: readonly string[];
  readonly isRead: boolean;
  readonly isFlagged: boolean;
  readonly priority: string;
  readonly webhookEvent: string;
  readonly rule: string | null;
};

export type InboxEmailEnvelope = {
  readonly messageRef?: string;
  readonly folderId?: string;
  readonly account: string;
  readonly messageId: string;
  readonly from: StoredEmailContact;
  readonly subject: string;
  readonly snippet: string;
  readonly date: string;
  readonly hasAttachments: boolean;
  readonly isRead: boolean;
  readonly isFlagged: boolean;
  readonly priority: string;
  readonly labels: readonly string[];
  readonly drivePath: string;
};

export type InboxPage = {
  readonly items: readonly InboxEmailEnvelope[];
  readonly nextCursor: string | null;
  readonly total: number;
};

export type InboxAccountItem = {
  readonly account: string;
  readonly displayName: string;
  readonly folders?: readonly {
    readonly folderId: string;
    readonly displayName: string;
  }[];
};

export type InboxAccountList = {
  readonly accounts: readonly string[];
  readonly items: readonly InboxAccountItem[];
};

export type InboxReadParams = {
  readonly account?: string;
  readonly messageId?: string;
  readonly messageRef?: string;
  readonly folderId?: string;
};

export type InboxListParams = {
  readonly account: string;
  readonly folderId?: string;
  readonly limit?: number;
  readonly cursor?: string;
};

export type InboxSearchParams = {
  readonly account: string;
  readonly query: string;
  readonly folderId?: string;
  readonly limit?: number;
};

export type InboxMarkReadParams = InboxReadParams & {
  readonly isRead: boolean;
};

export type InboxSaveAttachmentParams = InboxReadParams & {
  /** Preferred Exchange attachment handle returned by read(). */
  readonly attachmentId?: string;
  /** Attachment filename fallback. Required for legacy JSON mail; also supports Exchange UID lookup. */
  readonly filename?: string;
  /** Absolute Drive path resolved by caller policy/chroot. */
  readonly targetPath: string;
};

export type InboxSaveAttachmentResult = {
  readonly saved: true;
  readonly entry: {
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly fileId: string | null;
  };
};

export type InboxClient = {
  readonly listAccounts: () => Promise<InboxAccountList>;
  readonly list: (params: InboxListParams) => Promise<InboxPage>;
  readonly read: (params: InboxReadParams) => Promise<StoredEmail>;
  readonly search: (
    params: InboxSearchParams
  ) => Promise<{ readonly results: readonly InboxEmailEnvelope[] }>;
  readonly markRead: (params: InboxMarkReadParams) => Promise<StoredEmail>;
  readonly saveAttachment: (
    params: InboxSaveAttachmentParams
  ) => Promise<InboxSaveAttachmentResult>;
};
