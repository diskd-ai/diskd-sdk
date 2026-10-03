import type { AuthModule } from '../auth/types.js';

/** Workspace identity is obtained from auth; queue requests contain only provider account and message locators. */
export type EmailClientParams = { readonly auth: AuthModule; readonly url?: string };
export type EmailAccount = {
  readonly name: string;
  readonly email: string;
  readonly fullName: string;
  readonly authType: 'password' | 'oauth';
};
export type EmailMessageRef = {
  readonly mailboxId: string;
  readonly folderId: string;
  readonly externalId: string;
};
export type EmailBodyRequest = {
  readonly messages: readonly EmailMessageRef[];
  readonly refresh?: boolean;
  readonly maxMessages?: number;
};
export type EmailBodyResult = {
  readonly loaded: readonly EmailMessageRef[];
  readonly skipped: readonly EmailMessageRef[];
  readonly failedRetryable: readonly {
    readonly ref: EmailMessageRef;
    readonly error: string | null;
  }[];
  readonly failedPermanent: readonly {
    readonly ref: EmailMessageRef;
    readonly error: string | null;
  }[];
};
export type EmailAttachmentRequest = EmailMessageRef & {
  readonly attachmentId: string;
  readonly refresh?: boolean;
};
export type EmailAttachmentResult = EmailMessageRef & {
  readonly attachmentId: string;
  readonly status: 'loaded' | 'skipped' | 'failed_retryable' | 'failed_permanent';
  readonly error: string | null;
};
export type EmailAttributesRequest = {
  readonly account: string;
  readonly mailbox: string;
  readonly uids: readonly number[];
  readonly attributes: { readonly read?: boolean; readonly flagged?: boolean };
};
export type EmailAttributesResult = {
  readonly account: string;
  readonly mailbox: string;
  readonly uids: readonly number[];
  readonly applied: { readonly read?: boolean; readonly flagged?: boolean };
  readonly imap: { readonly succeeded: number; readonly failedUids: readonly number[] };
  readonly messages: readonly {
    readonly uid: number;
    readonly externalId: string;
    readonly flags: readonly string[];
    readonly labels: readonly string[];
  }[];
  readonly mirrorPatch:
    | {
        readonly tag: 'patched';
        readonly patched: number;
        readonly missingExternalIds: readonly string[];
      }
    | { readonly tag: 'skipped'; readonly reason: string }
    | { readonly tag: 'failed'; readonly error: string };
};
export type EmailDeleteRequest = {
  readonly account: string;
  readonly mailbox: string;
  readonly uids: readonly number[];
};
export type EmailDeleteResult = {
  readonly action: 'delete';
  readonly succeeded: number;
  readonly failedUids: readonly number[];
};
export type EmailProtocolStatus =
  | { readonly status: 'ok'; readonly latencyMs: number }
  | { readonly status: 'error'; readonly error: string };
export type EmailConnectionResult = {
  readonly imap: EmailProtocolStatus;
  readonly smtp: EmailProtocolStatus;
};
export type EmailSyncStatus = {
  readonly account: string;
  readonly enabled: boolean;
  readonly intervalMs: number;
  readonly nextDueAt: number | null;
  readonly running: boolean;
};
export type EmailAdmission = {
  readonly jobId: string;
  readonly status: 'queued';
  readonly requestId: string;
};
/** Account configuration queries stay read-only; provider operations use durable worker commands. */
export type EmailClient = {
  readonly listAccounts: () => Promise<{ readonly accounts: readonly EmailAccount[] }>;
  readonly sync: (params: { readonly account: string }) => Promise<EmailAdmission>;
  readonly stopSync: (params: { readonly account: string }) => Promise<void>;
  readonly syncStatus: (params: { readonly account: string }) => Promise<EmailSyncStatus>;
  readonly hydrateBodies: (params: EmailBodyRequest) => Promise<EmailBodyResult>;
  readonly hydrateAttachment: (params: EmailAttachmentRequest) => Promise<EmailAttachmentResult>;
  readonly setAttributes: (params: EmailAttributesRequest) => Promise<EmailAttributesResult>;
  readonly deleteMessages: (params: EmailDeleteRequest) => Promise<EmailDeleteResult>;
  readonly testConnection: (params: { readonly account: string }) => Promise<EmailConnectionResult>;
};
