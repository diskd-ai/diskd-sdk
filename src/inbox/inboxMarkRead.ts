import { Err, Ok, type Result } from './inboxSearchQuery.js';

type RawObject = { readonly [key: string]: unknown };
type EmailFlagTarget = { readonly account: string; readonly mailbox: string; readonly uid: number };

/** Narrow untrusted provider and Drive payloads before reading their fields. */
const isObject = (value: unknown): value is RawObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Resolve the provider mutation from persisted mailbox identity, never from a guessed account alias. */
export const resolveEmailFlagTarget = (
  raw: unknown,
  folderId: string
): Result<string, EmailFlagTarget> => {
  if (!isObject(raw)) return Err('Missing provider message identity');
  const account = typeof raw.accountId === 'string' ? raw.accountId.trim() : '';
  const mailbox = typeof raw.mailbox === 'string' ? raw.mailbox.trim() : folderId;
  const uid = raw.uid;
  if (!account || !mailbox || typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid <= 0) {
    return Err('Incomplete provider account, mailbox or uid for markRead');
  }
  return Ok({ account, mailbox, uid });
};

/** Require the exact provider UID, requested Seen state and acknowledged Drive mirror mutation. */
export const validateEmailFlagOutcome = (
  raw: unknown,
  uid: number,
  isRead: boolean
): Result<string, true> => {
  if (
    !isObject(raw) ||
    !isObject(raw.imap) ||
    !Array.isArray(raw.messages) ||
    !isObject(raw.mirrorPatch)
  ) {
    return Err('set_email_attributes returned an incomplete provider result');
  }
  if (
    raw.imap.succeeded !== 1 ||
    !Array.isArray(raw.imap.failedUids) ||
    raw.imap.failedUids.includes(uid)
  ) {
    return Err(`set_email_attributes failed for provider uid ${uid}`);
  }
  const message = raw.messages.find((value) => isObject(value) && value.uid === uid);
  if (
    !isObject(message) ||
    !Array.isArray(message.flags) ||
    !message.flags.every((flag) => typeof flag === 'string')
  ) {
    return Err(`set_email_attributes omitted flags for uid ${uid}`);
  }
  const seen = message.flags.some((flag) => flag.toLowerCase() === '\\seen');
  if (seen !== isRead)
    return Err('set_email_attributes did not apply the requested provider read state');
  if (raw.mirrorPatch.tag !== 'patched')
    return Err('set_email_attributes did not persist the Drive mirror');
  return Ok(true);
};
