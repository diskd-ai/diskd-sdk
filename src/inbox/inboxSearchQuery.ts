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
  | { readonly tag: 'InvalidQuotedValue'; readonly operator: string; readonly value: string }
  | { readonly tag: 'InvalidDate'; readonly operator: string; readonly value: string }
  | { readonly tag: 'InvalidFilterValue'; readonly operator: string; readonly value: string }
  | {
      readonly tag: 'MissingOperatorDependency';
      readonly operator: string;
      readonly required: string;
    }
  | { readonly tag: 'UnsupportedOperator'; readonly operator: string };

export type InboxSearchAfterDate = {
  readonly value: string;
  readonly timestampMs: number;
};

/** Folder selection is either mailbox-wide or a named tree with explicit recursion semantics. */
export type InboxFolderScope =
  | { readonly tag: 'AllFolders' }
  | {
      readonly tag: 'FolderTree';
      readonly selector: string;
      readonly recursive: boolean;
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
  readonly folderScope: InboxFolderScope;
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
  readonly bodyText: string;
  readonly date: string;
  readonly isRead: boolean;
  readonly isFlagged: boolean;
  readonly hasAttachments: boolean;
};

const OPERATOR_TOKEN = /^([A-Za-z][A-Za-z0-9_-]*):/;
const QUERY_TOKEN = /[A-Za-z][A-Za-z0-9_-]*:"[^"]*"|[^\s]+/g;
const BOUNDARY_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Build an Ok result for pure inbox search parsing outcomes. */
export const Ok = <E, T>(value: T): Result<E, T> => ({ tag: 'Ok', value });

/** Build an Err result for pure inbox search parsing failures. */
export const Err = <E, T>(error: E): Result<E, T> => ({ tag: 'Err', error });

/** Represent an explicitly present optional inbox search criterion. */
const Some = <T>(value: T): Option<T> => ({ tag: 'Some', value });

/** Represent an absent optional inbox search criterion without nulls. */
const None = <T>(): Option<T> => ({ tag: 'None' });

/** Split operator tokens while preserving a quoted value such as folder:"Aix Centre". */
const tokenizeInboxSearchQuery = (query: string): readonly string[] =>
  query.match(QUERY_TOKEN) ?? [];

/** Decode one optional quoted operator value without introducing a general query language. */
const parseOperatorValue = (
  operator: string,
  rawValue: string
): Result<InboxSearchQueryError, string> => {
  if (rawValue.length === 0) return Err({ tag: 'EmptyOperator', operator });
  const startsQuoted = rawValue.startsWith('"');
  const endsQuoted = rawValue.endsWith('"');
  if (startsQuoted !== endsQuoted || (!startsQuoted && rawValue.includes('"'))) {
    return Err({ tag: 'InvalidQuotedValue', operator, value: rawValue });
  }
  const value = startsQuoted ? rawValue.slice(1, -1) : rawValue;
  if (value.length === 0) return Err({ tag: 'EmptyOperator', operator });
  if (value.includes('"')) return Err({ tag: 'InvalidQuotedValue', operator, value: rawValue });
  return Ok(value);
};

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
  const tokens = tokenizeInboxSearchQuery(query.trim());
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
  let folderSelector: Option<string> = None();
  let recursive: Option<boolean> = None();

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
      const parsedValue = parseOperatorValue(operator, rawValue);
      if (parsedValue.tag === 'Err') return parsedValue;
      const value = parsedValue.value.toLowerCase();
      if (operator === 'from') sender = Some(value);
      else if (operator === 'to') recipient = Some(value);
      else if (operator === 'cc') cc = Some(value);
      else subject = Some(value);
      continue;
    }

    if (operator === 'after' || operator === 'before') {
      const current = operator === 'after' ? after : before;
      if (current.tag === 'Some') return Err({ tag: 'DuplicateOperator', operator });
      const parsedValue = parseOperatorValue(operator, rawValue);
      if (parsedValue.tag === 'Err') return parsedValue;
      const parsed = parseBoundaryDate(operator, parsedValue.value);
      if (parsed.tag === 'Err') return parsed;
      if (operator === 'after') after = Some(parsed.value);
      else before = Some(parsed.value);
      continue;
    }

    if (operator === 'is') {
      const parsedValue = parseOperatorValue(operator, rawValue);
      if (parsedValue.tag === 'Err') return parsedValue;
      const value = parsedValue.value.toLowerCase();
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
      const parsedValue = parseOperatorValue(operator, rawValue);
      if (parsedValue.tag === 'Err') return parsedValue;
      const value = parsedValue.value.toLowerCase();
      if (value === 'attachment' || value === 'attachments') {
        if (hasAttachment.tag === 'Some') return Err({ tag: 'DuplicateOperator', operator });
        hasAttachment = Some(true);
        continue;
      }
      return Err({ tag: 'InvalidFilterValue', operator, value });
    }

    if (operator === 'folder') {
      if (folderSelector.tag === 'Some') return Err({ tag: 'DuplicateOperator', operator });
      const parsedValue = parseOperatorValue(operator, rawValue);
      if (parsedValue.tag === 'Err') return parsedValue;
      folderSelector = Some(parsedValue.value);
      continue;
    }

    if (operator === 'recursive') {
      if (recursive.tag === 'Some') return Err({ tag: 'DuplicateOperator', operator });
      const parsedValue = parseOperatorValue(operator, rawValue);
      if (parsedValue.tag === 'Err') return parsedValue;
      const value = parsedValue.value.toLowerCase();
      if (value !== 'true' && value !== 'false') {
        return Err({ tag: 'InvalidFilterValue', operator, value });
      }
      recursive = Some(value === 'true');
      continue;
    }

    if (operator !== undefined) return Err({ tag: 'UnsupportedOperator', operator });
    textTerms.push(token.toLowerCase());
  }

  if (recursive.tag === 'Some' && folderSelector.tag === 'None') {
    return Err({ tag: 'MissingOperatorDependency', operator: 'recursive', required: 'folder' });
  }

  const folderScope: InboxFolderScope =
    folderSelector.tag === 'Some'
      ? {
          tag: 'FolderTree',
          selector: folderSelector.value,
          recursive: recursive.tag === 'Some' ? recursive.value : true,
        }
      : { tag: 'AllFolders' };

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
    folderScope,
  });
};

/** Quote a normalized operator value only when its whitespace requires it. */
const formatOperatorValue = (value: string): string => (/\s/.test(value) ? `"${value}"` : value);

/** Build the Drive message-query subset after folder routing has been resolved locally. */
export const formatInboxMessageSearchQuery = (search: InboxSearchQuery): Option<string> => {
  const tokens = [...search.textTerms];
  if (search.sender.tag === 'Some') tokens.push(`from:${formatOperatorValue(search.sender.value)}`);
  if (search.recipient.tag === 'Some')
    tokens.push(`to:${formatOperatorValue(search.recipient.value)}`);
  if (search.cc.tag === 'Some') tokens.push(`cc:${formatOperatorValue(search.cc.value)}`);
  if (search.subject.tag === 'Some')
    tokens.push(`subject:${formatOperatorValue(search.subject.value)}`);
  if (search.after.tag === 'Some') tokens.push(`after:${search.after.value.value}`);
  if (search.before.tag === 'Some') tokens.push(`before:${search.before.value.value}`);
  if (search.isRead.tag === 'Some') tokens.push(`is:${search.isRead.value ? 'read' : 'unread'}`);
  if (search.isFlagged.tag === 'Some')
    tokens.push(`is:${search.isFlagged.value ? 'starred' : 'unstarred'}`);
  if (search.hasAttachment.tag === 'Some') tokens.push('has:attachment');
  return tokens.length === 0 ? None() : Some(tokens.join(' '));
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
    case 'InvalidQuotedValue':
      return `INVALID_INBOX_SEARCH_QUERY: ${error.operator}: has malformed quoted value ${JSON.stringify(error.value)}`;
    case 'InvalidDate':
      return `INVALID_INBOX_SEARCH_QUERY: ${error.operator}: requires YYYY-MM-DD, got ${JSON.stringify(error.value)}`;
    case 'InvalidFilterValue':
      return `INVALID_INBOX_SEARCH_QUERY: ${error.operator}: does not support value ${JSON.stringify(error.value)}`;
    case 'MissingOperatorDependency':
      return `INVALID_INBOX_SEARCH_QUERY: ${error.operator}: requires ${error.required}:`;
    case 'UnsupportedOperator':
      return `INVALID_INBOX_SEARCH_QUERY: unsupported operator ${JSON.stringify(error.operator)}; supported operators are from:, to:, cc:, subject:, after:, before:, is:, has:, folder:, and recursive:`;
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

  const searchable = [
    message.subject,
    message.from.name,
    message.from.address,
    message.snippet,
    message.bodyText,
  ]
    .join(' ')
    .toLowerCase();
  return search.textTerms.every((term) => searchable.includes(term));
};
