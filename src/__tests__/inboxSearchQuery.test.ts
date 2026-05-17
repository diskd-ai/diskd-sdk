import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatInboxSearchQueryError,
  matchesInboxSearchQuery,
  parseInboxSearchQuery,
} from '../inbox/inboxSearchQuery.js';
import type { InboxEmailEnvelope } from '../inbox/inboxTypes.js';

const envelope: InboxEmailEnvelope = {
  folderId: 'INBOX',
  account: 'exchange-google-personal',
  messageId: '14:42',
  from: { name: 'Alice Sender', address: 'alice@gmail.com' },
  subject: 'Invoice ready',
  snippet: 'May invoice from finance',
  date: '2025-05-18T10:00:00.000Z',
  hasAttachments: false,
  isRead: false,
  isFlagged: false,
  priority: 'normal',
  labels: [],
  drivePath: '',
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

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: Inbox search rejects unsupported Gmail-style operators visibly. */
test('inbox search query parser rejects invalid structured syntax', () => {
  const unsupported = parseInboxSearchQuery('before:2025-05-17');
  const invalidDate = parseInboxSearchQuery('after:2025-02-30');
  const duplicateFrom = parseInboxSearchQuery('from:gmail.com from:example.com');

  assert.deepEqual(unsupported, {
    tag: 'Err',
    error: { tag: 'UnsupportedOperator', operator: 'before' },
  });
  assert.deepEqual(invalidDate, {
    tag: 'Err',
    error: { tag: 'InvalidAfterDate', value: '2025-02-30' },
  });
  assert.deepEqual(duplicateFrom, { tag: 'Err', error: { tag: 'DuplicateFrom' } });
  assert.equal(unsupported.tag, 'Err');
  if (unsupported.tag !== 'Err') return;
  assert.match(formatInboxSearchQueryError(unsupported.error), /INVALID_INBOX_SEARCH_QUERY/);
});

/* REQUIREMENT REQ enabling:dev/platform-api/sdk/inbox: Inbox search applies Gmail-style criteria with AND semantics. */
test('inbox search query matcher requires all parsed criteria to match', () => {
  const parsed = parseInboxSearchQuery('invoice from:gmail.com after:2025-05-17');

  assert.equal(parsed.tag, 'Ok');
  if (parsed.tag !== 'Ok') return;
  assert.equal(matchesInboxSearchQuery(envelope, parsed.value), true);
  assert.equal(
    matchesInboxSearchQuery(
      { ...envelope, from: { name: 'Alice Sender', address: 'alice@example.com' } },
      parsed.value
    ),
    false
  );
  assert.equal(
    matchesInboxSearchQuery({ ...envelope, date: '2025-05-16T23:59:59.000Z' }, parsed.value),
    false
  );
  assert.equal(
    matchesInboxSearchQuery(
      { ...envelope, subject: 'Reminder', snippet: 'No billing here' },
      parsed.value
    ),
    false
  );
});
