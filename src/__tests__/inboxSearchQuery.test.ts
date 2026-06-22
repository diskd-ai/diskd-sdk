import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatInboxSearchQueryError,
  type InboxSearchableMessage,
  matchesInboxSearchQuery,
  parseInboxSearchQuery,
} from '../inbox/inboxSearchQuery.js';

const message: InboxSearchableMessage = {
  from: { name: 'Alice Sender', address: 'alice@gmail.com' },
  to: [{ name: 'Estelle Roy', address: 'estelle@aileron.fr' }],
  cc: [{ name: 'Bob Cc', address: 'bob@example.com' }],
  subject: 'Invoice ready',
  snippet: 'May invoice from finance',
  date: '2025-05-18T10:00:00.000Z',
  isRead: false,
  isFlagged: false,
  hasAttachments: false,
};

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: Inbox search parses Gmail-style from and after operators. */
test('inbox search query parser accepts from and after operators with free text', () => {
  const parsed = parseInboxSearchQuery('invoice from:gmail.com after:2025-05-17');

  assert.equal(parsed.tag, 'Ok');
  if (parsed.tag !== 'Ok') return;
  assert.deepEqual(parsed.value.textTerms, ['invoice']);
  assert.deepEqual(parsed.value.sender, { tag: 'Some', value: 'gmail.com' });
  assert.deepEqual(parsed.value.after, {
    tag: 'Some',
    value: { value: '2025-05-17', timestampMs: Date.UTC(2025, 4, 17) },
  });
});

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: Inbox search parses to, cc, and subject operators. */
test('inbox search query parser accepts to, cc, and subject operators', () => {
  const parsed = parseInboxSearchQuery('to:estelle cc:bob subject:invoice');

  assert.equal(parsed.tag, 'Ok');
  if (parsed.tag !== 'Ok') return;
  assert.deepEqual(parsed.value.recipient, { tag: 'Some', value: 'estelle' });
  assert.deepEqual(parsed.value.cc, { tag: 'Some', value: 'bob' });
  assert.deepEqual(parsed.value.subject, { tag: 'Some', value: 'invoice' });
  assert.deepEqual(parsed.value.textTerms, []);
});

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: Inbox search parses before and a bounded date window. */
test('inbox search query parser accepts before and date-range windows', () => {
  const parsed = parseInboxSearchQuery('after:2025-05-17 before:2025-05-19');

  assert.equal(parsed.tag, 'Ok');
  if (parsed.tag !== 'Ok') return;
  assert.deepEqual(parsed.value.after, {
    tag: 'Some',
    value: { value: '2025-05-17', timestampMs: Date.UTC(2025, 4, 17) },
  });
  assert.deepEqual(parsed.value.before, {
    tag: 'Some',
    value: { value: '2025-05-19', timestampMs: Date.UTC(2025, 4, 19) },
  });
});

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: Inbox search parses is and has flag operators. */
test('inbox search query parser accepts is and has flag operators', () => {
  const parsed = parseInboxSearchQuery('is:unread is:starred has:attachment');

  assert.equal(parsed.tag, 'Ok');
  if (parsed.tag !== 'Ok') return;
  assert.deepEqual(parsed.value.isRead, { tag: 'Some', value: false });
  assert.deepEqual(parsed.value.isFlagged, { tag: 'Some', value: true });
  assert.deepEqual(parsed.value.hasAttachment, { tag: 'Some', value: true });
});

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: Inbox search rejects unsupported and malformed Gmail-style syntax visibly. */
test('inbox search query parser rejects unsupported and malformed syntax', () => {
  const unsupported = parseInboxSearchQuery('category:promotions');
  const invalidDate = parseInboxSearchQuery('after:2025-02-30');
  const duplicateFrom = parseInboxSearchQuery('from:gmail.com from:example.com');
  const conflictingFlag = parseInboxSearchQuery('is:read is:unread');
  const invalidFlag = parseInboxSearchQuery('is:bogus');
  const emptyOperator = parseInboxSearchQuery('from:');

  assert.deepEqual(unsupported, {
    tag: 'Err',
    error: { tag: 'UnsupportedOperator', operator: 'category' },
  });
  assert.deepEqual(invalidDate, {
    tag: 'Err',
    error: { tag: 'InvalidDate', operator: 'after', value: '2025-02-30' },
  });
  assert.deepEqual(duplicateFrom, {
    tag: 'Err',
    error: { tag: 'DuplicateOperator', operator: 'from' },
  });
  assert.deepEqual(conflictingFlag, {
    tag: 'Err',
    error: { tag: 'DuplicateOperator', operator: 'is' },
  });
  assert.deepEqual(invalidFlag, {
    tag: 'Err',
    error: { tag: 'InvalidFilterValue', operator: 'is', value: 'bogus' },
  });
  assert.deepEqual(emptyOperator, {
    tag: 'Err',
    error: { tag: 'EmptyOperator', operator: 'from' },
  });

  assert.equal(unsupported.tag, 'Err');
  assert.equal(duplicateFrom.tag, 'Err');
  if (unsupported.tag !== 'Err' || duplicateFrom.tag !== 'Err') return;
  assert.match(formatInboxSearchQueryError(unsupported.error), /INVALID_INBOX_SEARCH_QUERY/);
  assert.match(formatInboxSearchQueryError(duplicateFrom.error), /from: can appear only once/);
});

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: Inbox search applies Gmail-style criteria with AND semantics. */
test('inbox search query matcher requires all parsed criteria to match', () => {
  const parsed = parseInboxSearchQuery('invoice from:gmail.com after:2025-05-17');

  assert.equal(parsed.tag, 'Ok');
  if (parsed.tag !== 'Ok') return;
  assert.equal(matchesInboxSearchQuery(message, parsed.value), true);
  assert.equal(
    matchesInboxSearchQuery(
      { ...message, from: { name: 'Alice Sender', address: 'alice@example.com' } },
      parsed.value
    ),
    false
  );
  assert.equal(
    matchesInboxSearchQuery({ ...message, date: '2025-05-16T23:59:59.000Z' }, parsed.value),
    false
  );
  assert.equal(
    matchesInboxSearchQuery(
      { ...message, subject: 'Reminder', snippet: 'No billing here' },
      parsed.value
    ),
    false
  );
});

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: Inbox search matches recipients via to and cc. */
test('inbox search query matcher filters by to and cc recipients', () => {
  const toParsed = parseInboxSearchQuery('to:estelle');
  const ccParsed = parseInboxSearchQuery('cc:bob');
  assert.equal(toParsed.tag, 'Ok');
  assert.equal(ccParsed.tag, 'Ok');
  if (toParsed.tag !== 'Ok' || ccParsed.tag !== 'Ok') return;

  assert.equal(matchesInboxSearchQuery(message, toParsed.value), true);
  assert.equal(matchesInboxSearchQuery({ ...message, to: [] }, toParsed.value), false);
  assert.equal(matchesInboxSearchQuery(message, ccParsed.value), true);
  assert.equal(matchesInboxSearchQuery({ ...message, cc: [] }, ccParsed.value), false);
});

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: subject operator narrows to the subject line only. */
test('inbox search query matcher scopes subject operator to the subject line', () => {
  const subjectHit = parseInboxSearchQuery('subject:invoice');
  const subjectMiss = parseInboxSearchQuery('subject:finance');
  assert.equal(subjectHit.tag, 'Ok');
  assert.equal(subjectMiss.tag, 'Ok');
  if (subjectHit.tag !== 'Ok' || subjectMiss.tag !== 'Ok') return;

  // "invoice" is in the subject -> matches; "finance" is only in the snippet -> subject: misses.
  assert.equal(matchesInboxSearchQuery(message, subjectHit.value), true);
  assert.equal(matchesInboxSearchQuery(message, subjectMiss.value), false);
});

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: before is exclusive of the named day. */
test('inbox search query matcher treats before as exclusive of the named day', () => {
  const window = parseInboxSearchQuery('after:2025-05-17 before:2025-05-19');
  const sameDay = parseInboxSearchQuery('before:2025-05-18');
  assert.equal(window.tag, 'Ok');
  assert.equal(sameDay.tag, 'Ok');
  if (window.tag !== 'Ok' || sameDay.tag !== 'Ok') return;

  assert.equal(matchesInboxSearchQuery(message, window.value), true);
  // message is dated 2025-05-18 -> excluded by before:2025-05-18.
  assert.equal(matchesInboxSearchQuery(message, sameDay.value), false);
});

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: is and has flags filter by message state. */
test('inbox search query matcher filters by read, flagged, and attachment state', () => {
  const unread = parseInboxSearchQuery('is:unread');
  const read = parseInboxSearchQuery('is:read');
  const starred = parseInboxSearchQuery('is:starred');
  const withAttachment = parseInboxSearchQuery('has:attachment');
  assert.equal(unread.tag, 'Ok');
  assert.equal(read.tag, 'Ok');
  assert.equal(starred.tag, 'Ok');
  assert.equal(withAttachment.tag, 'Ok');
  if (
    unread.tag !== 'Ok' ||
    read.tag !== 'Ok' ||
    starred.tag !== 'Ok' ||
    withAttachment.tag !== 'Ok'
  )
    return;

  assert.equal(matchesInboxSearchQuery(message, unread.value), true);
  assert.equal(matchesInboxSearchQuery(message, read.value), false);
  assert.equal(matchesInboxSearchQuery(message, starred.value), false);
  assert.equal(matchesInboxSearchQuery({ ...message, isFlagged: true }, starred.value), true);
  assert.equal(matchesInboxSearchQuery(message, withAttachment.value), false);
  assert.equal(
    matchesInboxSearchQuery({ ...message, hasAttachments: true }, withAttachment.value),
    true
  );
});
