import type { StoredEmailContact } from './inboxTypes.js';

export type Result<E, T> =
  | { readonly tag: 'Ok'; readonly value: T }
  | { readonly tag: 'Err'; readonly error: E };

export type Option<T> = { readonly tag: 'Some'; readonly value: T } | { readonly tag: 'None' };

/**
 * Typed parser failures for the Gmail-style inbox query. Operator-bearing
 * variants keep the operator token so {@link formatInboxSearchQueryError} can
 * render a single stable `INVALID_INBOX_SEARCH_QUERY: ...` contract string that
 * tool adapters match on (e.g. "from: can appear only once").
 */
export type InboxSearchQueryError =
  | { readonly tag: 'EmptyQuery' }
  | { readonly tag: 'EmptyOperator'; readonly operator: string }
  | { readonly tag: 'DuplicateOperator'; readonly operator: string }
  | { readonly tag: 'InvalidDate'; readonly operator: string; readonly value: string }
  | { readonly tag: 'InvalidFilterValue'; readonly operator: string; readonly value: string }
  | { readonly tag: 'UnsupportedOperator'; readonly operator: string };

export type InboxSearchAfterDate = {
  readonly value: string;
  readonly timestampMs: number;
};

/**
 * Parsed Gmail-style criteria. Every operator the agent can type maps to one
 * field here; absent operators stay `None` so the matcher applies AND semantics
 * over only the criteria that were actually supplied.
 */
export type InboxSearchQuery = {
  readonly textTerms: readonly string[];
  readonly sender: Option<string>;
  readonly recipient: Option<string>;
  readonly cc: Option<string>;
  readonly subject: Option<string>;
  readonly after: Option<InboxSearchAfterDate>;
  readonly before: Option<InboxSearchAfterDate>;
  readonly isRead: Option<boolean>;
  readonly isFlagged: Option<boolean>;
  readonly hasAttachment: Option<boolean>;
};

/**
 * Minimal message shape the matcher needs. A full {@link import('./inboxTypes.js').StoredEmail}
 * is structurally assignable, so callers pass the parsed stored email directly
 * (the envelope drops recipients/flags and cannot satisfy to:/cc:/is:/has:).
 */
export type InboxSearchableMessage = {
  readonly from: StoredEmailContact;
  readonly to: readonly StoredEmailContact[];
  readonly cc: readonly StoredEmailContact[];
  readonly subject: string;
  readonly snippet: string;
  readonly date: string;
  readonly isRead: boolean;
  readonly isFlagged: boolean;
  readonly hasAttachments: boolean;
};

const OPERATOR_TOKEN = /^([A-Za-z][A-Za-z0-9_-]*):/;
const BOUNDARY_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Build an Ok result for pure inbox search parsing outcomes. */
export const Ok = <E, T>(value: T): Result<E, T> => ({ tag: 'Ok', value });

/** Build an Err result for pure inbox search parsing failures. */
export const Err = <E, T>(error: E): Result<E, T> => ({ tag: 'Err', error });

/** Represent an explicitly present optional inbox search criterion. */
const Some = <T>(value: T): Option<T> => ({ tag: 'Some', value });

/** Represent an absent optional inbox search criterion without nulls. */
const None = <T>(): Option<T> => ({ tag: 'None' });

/** Parse a strict YYYY-MM-DD date into the UTC day boundary used by after:/before:. */
const parseBoundaryDate = (
  operator: string,
  value: string
): Result<InboxSearchQueryError, InboxSearchAfterDate> => {
  const match = BOUNDARY_DATE.exec(value);
  if (!match) return Err({ tag: 'InvalidDate', operator, value });
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestampMs = Date.UTC(year, month - 1, day);
  const normalized = new Date(timestampMs).toISOString().slice(0, 10);
  if (normalized !== value) return Err({ tag: 'InvalidDate', operator, value });
  return Ok({ value, timestampMs });
};

/** Parse the model-facing Gmail-style inbox query string into typed search criteria. */
export const parseInboxSearchQuery = (
  query: string
): Result<InboxSearchQueryError, InboxSearchQuery> => {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return Err({ tag: 'EmptyQuery' });

  const textTerms: string[] = [];
  let sender: Option<string> = None();
  let recipient: Option<string> = None();
  let cc: Option<string> = None();
  let subject: Option<string> = None();
  let after: Option<InboxSearchAfterDate> = None();
  let before: Option<InboxSearchAfterDate> = None();
  let isRead: Option<boolean> = None();
  let isFlagged: Option<boolean> = None();
  let hasAttachment: Option<boolean> = None();

  for (const token of tokens) {
    const operatorMatch = OPERATOR_TOKEN.exec(token);
    const operator = operatorMatch?.[1]?.toLowerCase();
    const rawValue = operator ? token.slice(operator.length + 1).trim() : '';

    if (operator === 'from' || operator === 'to' || operator === 'cc' || operator === 'subject') {
      const current =
        operator === 'from'
          ? sender
          : operator === 'to'
            ? recipient
            : operator === 'cc'
              ? cc
              : subject;
      if (current.tag === 'Some') return Err({ tag: 'DuplicateOperator', operator });
      if (rawValue.length === 0) return Err({ tag: 'EmptyOperator', operator });
      const value = rawValue.toLowerCase();
      if (operator === 'from') sender = Some(value);
      else if (operator === 'to') recipient = Some(value);
      else if (operator === 'cc') cc = Some(value);
      else subject = Some(value);
      continue;
    }

    if (operator === 'after' || operator === 'before') {
      const current = operator === 'after' ? after : before;
      if (current.tag === 'Some') return Err({ tag: 'DuplicateOperator', operator });
      if (rawValue.length === 0) return Err({ tag: 'EmptyOperator', operator });
      const parsed = parseBoundaryDate(operator, rawValue);
      if (parsed.tag === 'Err') return parsed;
      if (operator === 'after') after = Some(parsed.value);
      else before = Some(parsed.value);
      continue;
    }

    if (operator === 'is') {
      if (rawValue.length === 0) return Err({ tag: 'EmptyOperator', operator });
      const value = rawValue.toLowerCase();
      if (value === 'read' || value === 'unread') {
        if (isRead.tag === 'Some') return Err({ tag: 'DuplicateOperator', operator });
        isRead = Some(value === 'read');
        continue;
      }
      if (
        value === 'starred' ||
        value === 'flagged' ||
        value === 'unstarred' ||
        value === 'unflagged'
      ) {
        if (isFlagged.tag === 'Some') return Err({ tag: 'DuplicateOperator', operator });
        isFlagged = Some(value === 'starred' || value === 'flagged');
        continue;
      }
      return Err({ tag: 'InvalidFilterValue', operator, value });
    }

    if (operator === 'has') {
      if (rawValue.length === 0) return Err({ tag: 'EmptyOperator', operator });
      const value = rawValue.toLowerCase();
      if (value === 'attachment' || value === 'attachments') {
        if (hasAttachment.tag === 'Some') return Err({ tag: 'DuplicateOperator', operator });
        hasAttachment = Some(true);
        continue;
      }
      return Err({ tag: 'InvalidFilterValue', operator, value });
    }

    if (operator !== undefined) return Err({ tag: 'UnsupportedOperator', operator });
    textTerms.push(token.toLowerCase());
  }

  return Ok({
    textTerms,
    sender,
    recipient,
    cc,
    subject,
    after,
    before,
    isRead,
    isFlagged,
    hasAttachment,
  });
};

/** Format parser failures as a stable SDK error message for tool adapters. */
export const formatInboxSearchQueryError = (error: InboxSearchQueryError): string => {
  switch (error.tag) {
    case 'EmptyQuery':
      return 'INVALID_INBOX_SEARCH_QUERY: query must contain at least one term or operator';
    case 'EmptyOperator':
      return `INVALID_INBOX_SEARCH_QUERY: ${error.operator}: requires a value`;
    case 'DuplicateOperator':
      return `INVALID_INBOX_SEARCH_QUERY: ${error.operator}: can appear only once`;
    case 'InvalidDate':
      return `INVALID_INBOX_SEARCH_QUERY: ${error.operator}: requires YYYY-MM-DD, got ${JSON.stringify(error.value)}`;
    case 'InvalidFilterValue':
      return `INVALID_INBOX_SEARCH_QUERY: ${error.operator}: does not support value ${JSON.stringify(error.value)}`;
    case 'UnsupportedOperator':
      return `INVALID_INBOX_SEARCH_QUERY: unsupported operator ${JSON.stringify(error.operator)}; supported operators are from:, to:, cc:, subject:, after:, before:, is:, and has:`;
  }
};

/** Join a contact list into a lowercased "name address" haystack for to:/cc: matching. */
const contactsText = (contacts: readonly StoredEmailContact[]): string =>
  contacts
    .map((contact) => `${contact.name} ${contact.address}`)
    .join(' ')
    .toLowerCase();

/** Test whether one normalized stored email satisfies parsed Gmail-style criteria. */
export const matchesInboxSearchQuery = (
  message: InboxSearchableMessage,
  search: InboxSearchQuery
): boolean => {
  const senderText = `${message.from.name} ${message.from.address}`.toLowerCase();
  if (search.sender.tag === 'Some' && !senderText.includes(search.sender.value)) return false;
  if (search.recipient.tag === 'Some' && !contactsText(message.to).includes(search.recipient.value))
    return false;
  if (search.cc.tag === 'Some' && !contactsText(message.cc).includes(search.cc.value)) return false;
  if (
    search.subject.tag === 'Some' &&
    !message.subject.toLowerCase().includes(search.subject.value)
  )
    return false;

  if (search.after.tag === 'Some' || search.before.tag === 'Some') {
    const timestampMs = Date.parse(message.date);
    if (!Number.isFinite(timestampMs)) return false;
    if (search.after.tag === 'Some' && timestampMs < search.after.value.timestampMs) return false;
    // before: is exclusive of the named day, matching Gmail's "received before this date".
    if (search.before.tag === 'Some' && timestampMs >= search.before.value.timestampMs)
      return false;
  }

  if (search.isRead.tag === 'Some' && message.isRead !== search.isRead.value) return false;
  if (search.isFlagged.tag === 'Some' && message.isFlagged !== search.isFlagged.value) return false;
  if (search.hasAttachment.tag === 'Some' && message.hasAttachments !== search.hasAttachment.value)
    return false;

  const searchable = [message.subject, message.from.name, message.from.address, message.snippet]
    .join(' ')
    .toLowerCase();
  return search.textTerms.every((term) => searchable.includes(term));
};
