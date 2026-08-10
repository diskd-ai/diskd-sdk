import assert from 'node:assert/strict';
import test from 'node:test';
import { type InboxSearchableMessage, matchesInboxSearchQuery } from '../inbox/inboxSearchQuery.js';
import {
  formatInboxMessageSearchQuery,
  formatInboxSearchQueryError,
  parseInboxSearchQuery,
} from '../index.js';

const message: InboxSearchableMessage = {
  from: { name: 'Alice Sender', address: 'alice@gmail.com' },
  to: [{ name: 'Estelle Roy', address: 'estelle@aileron.fr' }],
  cc: [{ name: 'Bob Cc', address: 'bob@example.com' }],
  subject: 'Invoice ready',
  snippet: 'May invoice from finance',
  bodyText: 'The May invoice is ready for review.',
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

/* REQ-2910-001: A folder selector accepts quoted display names and searches descendants by default. */
test('inbox search query parser defaults folder selectors to recursive search', () => {
  const parsed = parseInboxSearchQuery('folder:"Aix Centre" subject:invoice');

  assert.equal(parsed.tag, 'Ok');
  if (parsed.tag !== 'Ok') return;
  assert.deepEqual(parsed.value.folderScope, {
    tag: 'FolderTree',
    selector: 'Aix Centre',
    recursive: true,
  });
  assert.deepEqual(formatInboxMessageSearchQuery(parsed.value), {
    tag: 'Some',
    value: 'subject:invoice',
  });
});

/* REQ-2910-002: recursive:false restricts a folder query to the selected folder. */
test('inbox search query parser accepts an explicit non-recursive folder selector', () => {
  const parsed = parseInboxSearchQuery('folder:Aix recursive:false');

  assert.equal(parsed.tag, 'Ok');
  if (parsed.tag !== 'Ok') return;
  assert.deepEqual(parsed.value.folderScope, {
    tag: 'FolderTree',
    selector: 'Aix',
    recursive: false,
  });
  assert.deepEqual(formatInboxMessageSearchQuery(parsed.value), { tag: 'None' });
});

/* REQ-2910-003: recursive is valid only as a modifier of a folder selector. */
test('inbox search query parser rejects recursive without folder', () => {
  const parsed = parseInboxSearchQuery('recursive:true');

  assert.deepEqual(parsed, {
    tag: 'Err',
    error: { tag: 'MissingOperatorDependency', operator: 'recursive', required: 'folder' },
  });
  assert.equal(parsed.tag, 'Err');
  if (parsed.tag !== 'Err') return;
  assert.match(formatInboxSearchQueryError(parsed.error), /recursive: requires folder:/);
});

/* REQ-2910-004: Folder query modifiers reject malformed and duplicate values visibly. */
test('inbox search query parser rejects invalid folder modifiers', () => {
  assert.deepEqual(parseInboxSearchQuery('folder:Aix recursive:yes'), {
    tag: 'Err',
    error: { tag: 'InvalidFilterValue', operator: 'recursive', value: 'yes' },
  });
  assert.deepEqual(parseInboxSearchQuery('folder:Aix folder:Lyon'), {
    tag: 'Err',
    error: { tag: 'DuplicateOperator', operator: 'folder' },
  });
  assert.deepEqual(parseInboxSearchQuery('folder:"Aix Centre'), {
    tag: 'Err',
    error: { tag: 'InvalidQuotedValue', operator: 'folder', value: '"Aix' },
  });
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
      {
        ...message,
        subject: 'Reminder',
        snippet: 'No billing here',
        bodyText: 'The quarterly report is ready for review.',
      },
      parsed.value
    ),
    false
  );
});

/* REQ-2912-1: Free-text inbox search matches terms that occur only in the stored message body. */
test('inbox search query matcher includes the stored message body in free-text search', () => {
  const parsed = parseInboxSearchQuery('Luna');
  const bodyOnlyMessage = {
    ...message,
    from: { name: 'OpenAI', address: 'noreply@email.openai.com' },
    subject: 'New: Lower GPT-5.6 pricing and Fast mode for Sol',
    snippet: 'Today, we are making GPT-5.6 more affordable and faster.',
    bodyText: 'GPT-5.6 Luna now costs 80% less.',
  };

  assert.equal(parsed.tag, 'Ok');
  if (parsed.tag !== 'Ok') return;
  assert.equal(matchesInboxSearchQuery(bodyOnlyMessage, parsed.value), true);
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
