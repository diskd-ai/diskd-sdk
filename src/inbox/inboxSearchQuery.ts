import type { InboxEmailEnvelope } from './inboxTypes.js';

export type Result<E, T> =
  | { readonly tag: 'Ok'; readonly value: T }
  | { readonly tag: 'Err'; readonly error: E };

export type Option<T> = { readonly tag: 'Some'; readonly value: T } | { readonly tag: 'None' };

export type InboxSearchQueryError =
  | { readonly tag: 'EmptyQuery' }
  | { readonly tag: 'EmptyFrom' }
  | { readonly tag: 'DuplicateFrom' }
  | { readonly tag: 'DuplicateAfter' }
  | { readonly tag: 'InvalidAfterDate'; readonly value: string }
  | { readonly tag: 'UnsupportedOperator'; readonly operator: string };

export type InboxSearchAfterDate = {
  readonly value: string;
  readonly timestampMs: number;
};

export type InboxSearchQuery = {
  readonly textTerms: readonly string[];
  readonly sender: Option<string>;
  readonly after: Option<InboxSearchAfterDate>;
};

const OPERATOR_TOKEN = /^([A-Za-z][A-Za-z0-9_-]*):/;
const AFTER_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Build an Ok result for pure inbox search parsing outcomes. */
export const Ok = <E, T>(value: T): Result<E, T> => ({ tag: 'Ok', value });

/** Build an Err result for pure inbox search parsing failures. */
export const Err = <E, T>(error: E): Result<E, T> => ({ tag: 'Err', error });

/** Represent an explicitly present optional inbox search criterion. */
const Some = <T>(value: T): Option<T> => ({ tag: 'Some', value });

/** Represent an absent optional inbox search criterion without nulls. */
const None = <T>(): Option<T> => ({ tag: 'None' });

/** Parse a strict YYYY-MM-DD date into the UTC boundary used by Gmail-style after:. */
const parseAfterDate = (value: string): Result<InboxSearchQueryError, InboxSearchAfterDate> => {
  const match = AFTER_DATE.exec(value);
  if (!match) return Err({ tag: 'InvalidAfterDate', value });
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestampMs = Date.UTC(year, month - 1, day);
  const normalized = new Date(timestampMs).toISOString().slice(0, 10);
  if (normalized !== value) return Err({ tag: 'InvalidAfterDate', value });
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
  let after: Option<InboxSearchAfterDate> = None();

  for (const token of tokens) {
    const operatorMatch = OPERATOR_TOKEN.exec(token);
    const operator = operatorMatch?.[1]?.toLowerCase();
    if (operator === 'from') {
      if (sender.tag === 'Some') return Err({ tag: 'DuplicateFrom' });
      const value = token.slice('from:'.length).trim();
      if (value.length === 0) return Err({ tag: 'EmptyFrom' });
      sender = Some(value.toLowerCase());
      continue;
    }
    if (operator === 'after') {
      if (after.tag === 'Some') return Err({ tag: 'DuplicateAfter' });
      const parsed = parseAfterDate(token.slice('after:'.length).trim());
      if (parsed.tag === 'Err') return parsed;
      after = Some(parsed.value);
      continue;
    }
    if (operator !== undefined) return Err({ tag: 'UnsupportedOperator', operator });
    textTerms.push(token.toLowerCase());
  }

  return Ok({ textTerms, sender, after });
};

/** Format parser failures as a stable SDK error message for tool adapters. */
export const formatInboxSearchQueryError = (error: InboxSearchQueryError): string => {
  switch (error.tag) {
    case 'EmptyQuery':
      return 'INVALID_INBOX_SEARCH_QUERY: query must contain at least one term or operator';
    case 'EmptyFrom':
      return 'INVALID_INBOX_SEARCH_QUERY: from: requires a sender name, address, or domain';
    case 'DuplicateFrom':
      return 'INVALID_INBOX_SEARCH_QUERY: from: can appear only once';
    case 'DuplicateAfter':
      return 'INVALID_INBOX_SEARCH_QUERY: after: can appear only once';
    case 'InvalidAfterDate':
      return `INVALID_INBOX_SEARCH_QUERY: after: requires YYYY-MM-DD, got ${JSON.stringify(error.value)}`;
    case 'UnsupportedOperator':
      return `INVALID_INBOX_SEARCH_QUERY: unsupported operator ${JSON.stringify(error.operator)}; supported operators are from: and after:`;
  }
};

/** Test whether one normalized email envelope satisfies parsed Gmail-style criteria. */
export const matchesInboxSearchQuery = (
  envelope: InboxEmailEnvelope,
  search: InboxSearchQuery
): boolean => {
  const senderText = [envelope.from.name, envelope.from.address].join(' ').toLowerCase();
  if (search.sender.tag === 'Some' && !senderText.includes(search.sender.value)) return false;

  if (search.after.tag === 'Some') {
    const timestampMs = Date.parse(envelope.date);
    if (!Number.isFinite(timestampMs) || timestampMs < search.after.value.timestampMs) return false;
  }

  const searchable = [envelope.subject, envelope.from.name, envelope.from.address, envelope.snippet]
    .join(' ')
    .toLowerCase();
  return search.textTerms.every((term) => searchable.includes(term));
};
