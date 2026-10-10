import type {
  EmailAccount,
  EmailAdmission,
  EmailAttachmentResult,
  EmailAttributesResult,
  EmailBodyResult,
  EmailConnectionResult,
  EmailDeleteResult,
  EmailMessageRef,
  EmailProtocolStatus,
  EmailSyncStatus,
} from './emailTypes.js';

/** Validate untyped wire objects before reading their fields. */
export function object(value: unknown): { readonly [key: string]: unknown } {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('InvalidEmailResponse');
  return value as { readonly [key: string]: unknown };
}
/** Require a string at the SDK wire boundary. */
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('InvalidEmailResponse');
  return value;
}
/** Require a finite number at the SDK wire boundary. */
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('InvalidEmailResponse');
  return value;
}
/** Require a boolean at the SDK wire boundary. */
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('InvalidEmailResponse');
  return value;
}
/** Decode arrays item by item so malformed server responses cannot enter SDK types. */
function list<T>(value: unknown, decode: (item: unknown) => T): readonly T[] {
  if (!Array.isArray(value)) throw new Error('InvalidEmailResponse');
  return value.map(decode);
}
/** Decode a canonical mailbox locator. */
function ref(value: unknown): EmailMessageRef {
  const row = object(value);
  return {
    mailboxId: text(row.mailboxId),
    folderId: text(row.folderId),
    externalId: text(row.externalId),
  };
}
/** Decode credential-free account identities. */
export function accounts(value: unknown): { readonly accounts: readonly EmailAccount[] } {
  return {
    accounts: list(object(value).accounts, (item) => {
      const row = object(item);
      const authType = row.authType;
      if (authType !== 'password' && authType !== 'oauth') throw new Error('InvalidEmailResponse');
      return {
        name: text(row.name),
        email: text(row.email),
        fullName: text(row.fullName),
        authType,
      };
    }),
  };
}
/** Decode persisted admission without assuming the operation has finished. */
export function admission(value: unknown): EmailAdmission {
  const row = object(value);
  if (row.status !== 'queued') throw new Error('InvalidEmailAdmission');
  return { jobId: text(row.jobId), requestId: text(row.requestId), status: 'queued' };
}
/** Require the worker's completed outcome, preserving actionable failure semantics. */
function syncOutcome(value: unknown): EmailSyncStatus['lastSync'] {
  if (value === null) return null;
  const row = object(value);
  const completedAt = number(row.completedAt);
  if (completedAt < 0) throw new Error('InvalidEmailResponse');
  if (row.status === 'succeeded') return { status: 'succeeded', completedAt };
  if (row.status === 'failed')
    return {
      status: 'failed',
      completedAt,
      errorCode: text(row.errorCode),
      requiresReconnect: boolean(row.requiresReconnect),
    };
  throw new Error('InvalidEmailResponse');
}
/** Decode scheduling and the latest actual completion independently. */
export function syncStatus(value: unknown): EmailSyncStatus {
  const row = object(value);
  return {
    account: text(row.account),
    enabled: boolean(row.enabled),
    intervalMs: number(row.intervalMs),
    nextDueAt: row.nextDueAt === null ? null : number(row.nextDueAt),
    running: boolean(row.running),
    lastSync: syncOutcome(row.lastSync),
  };
}
/** Decode hydration metadata while content remains in canonical Drive storage. */
export function bodies(value: unknown): EmailBodyResult {
  const row = object(value);
  const failure = (item: unknown) => {
    const entry = object(item);
    return { ref: ref(entry.ref), error: entry.error === null ? null : text(entry.error) };
  };
  return {
    loaded: list(row.loaded, ref),
    skipped: list(row.skipped, ref),
    failedRetryable: list(row.failedRetryable, failure),
    failedPermanent: list(row.failedPermanent, failure),
  };
}
/** Decode one attachment load result without exposing its provider payload. */
export function attachment(value: unknown): EmailAttachmentResult {
  const row = object(value);
  const status = row.status;
  if (
    status !== 'loaded' &&
    status !== 'skipped' &&
    status !== 'failed_retryable' &&
    status !== 'failed_permanent'
  )
    throw new Error('InvalidEmailResponse');
  return {
    ...ref(row),
    attachmentId: text(row.attachmentId),
    status,
    error: row.error === null ? null : text(row.error),
  };
}
/** Decode authoritative IMAP flags and the Drive mirror confirmation. */
export function attributes(value: unknown): EmailAttributesResult {
  const row = object(value),
    applied = object(row.applied),
    imap = object(row.imap),
    patch = object(row.mirrorPatch);
  let mirrorPatch: EmailAttributesResult['mirrorPatch'];
  if (patch.tag === 'patched')
    mirrorPatch = {
      tag: 'patched',
      patched: number(patch.patched),
      missingExternalIds: list(patch.missingExternalIds, text),
    };
  else if (patch.tag === 'skipped') mirrorPatch = { tag: 'skipped', reason: text(patch.reason) };
  else if (patch.tag === 'failed') mirrorPatch = { tag: 'failed', error: text(patch.error) };
  else throw new Error('InvalidEmailResponse');
  return {
    account: text(row.account),
    mailbox: text(row.mailbox),
    uids: list(row.uids, number),
    applied: {
      ...(applied.read === undefined ? {} : { read: boolean(applied.read) }),
      ...(applied.flagged === undefined ? {} : { flagged: boolean(applied.flagged) }),
    },
    imap: { succeeded: number(imap.succeeded), failedUids: list(imap.failedUids, number) },
    messages: list(row.messages, (item) => {
      const message = object(item);
      return {
        uid: number(message.uid),
        externalId: text(message.externalId),
        flags: list(message.flags, text),
        labels: list(message.labels, text),
      };
    }),
    mirrorPatch,
  };
}
/** Decode per-message deletion outcomes. */
export function deletion(value: unknown): EmailDeleteResult {
  const row = object(value);
  if (row.action !== 'delete') throw new Error('InvalidEmailResponse');
  return {
    action: 'delete',
    succeeded: number(row.succeeded),
    failedUids: list(row.failedUids, number),
  };
}
/** Decode independent SMTP and IMAP probes. */
export function connection(value: unknown): EmailConnectionResult {
  const row = object(value);
  const protocol = (value: unknown): EmailProtocolStatus => {
    const entry = object(value);
    if (entry.status === 'ok') return { status: 'ok', latencyMs: number(entry.latencyMs) };
    if (entry.status === 'error') return { status: 'error', error: text(entry.error) };
    throw new Error('InvalidEmailResponse');
  };
  return { imap: protocol(row.imap), smtp: protocol(row.smtp) };
}
