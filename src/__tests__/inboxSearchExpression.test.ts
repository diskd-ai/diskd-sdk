import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateInboxSearchExpression,
  formatInboxMessageSearchExpression,
  parseInboxSearchExpression,
} from '../inbox/inboxSearchExpression.js';
import { type InboxSearchableMessage, matchesInboxSearchQuery } from '../inbox/inboxSearchQuery.js';

const message: InboxSearchableMessage = {
  from: { name: 'Alice', address: 'alice@example.com' },
  to: [],
  cc: [],
  subject: 'invoice',
  snippet: '',
  bodyText: '',
  date: '2026-10-12T00:00:00Z',
  isRead: false,
  isFlagged: false,
  hasAttachments: false,
  labels: [],
};

/* REQ-3623-001: Boolean precedence and groups select either alternative with common constraints. */
test('Boolean expressions preserve precedence, nested groups and scoped alternatives', () => {
  for (const [query, expected] of [
    ['receipt OR invoice AND from:alice', true],
    ['invoice OR(receipt)', true],
    ['(invoice)OR(receipt)', true],
    ['subject:(invoice AND ready) OR from:alice', true],
    ['subject:(invoice ready)', false],
    ['invoice OR receipt AND from:bob', true],
    ['(invoice OR receipt) AND from:bob', false],
    ['(from:bob OR from:alice) after:2026-10-01', true],
    ['from:(bob OR alice) (receipt OR invoice)', true],
    ['(invoice OR receipt) before:2026-10-01', false],
  ] as const) {
    const parsed = parseInboxSearchExpression(query);
    assert.equal(parsed.tag, 'Ok', query);
    assert.equal(
      evaluateInboxSearchExpression(parsed.value.expression, (leaf) =>
        matchesInboxSearchQuery(message, leaf)
      ),
      expected,
      query
    );
    const wire = formatInboxMessageSearchExpression(parsed.value.expression);
    assert.equal(wire.tag, 'Some');
    const roundtrip = parseInboxSearchExpression(wire.value);
    assert.equal(roundtrip.tag, 'Ok', wire.value);
    if (roundtrip.tag === 'Ok')
      assert.equal(
        evaluateInboxSearchExpression(roundtrip.value.expression, (leaf) =>
          matchesInboxSearchQuery(message, leaf)
        ),
        expected
      );
  }
});

/* REQ-3623-002: Literal Boolean words remain data; incomplete expressions fail before searching. */
test('quotes preserve literals and malformed syntax is rejected', () => {
  for (const query of [
    'invoice OR',
    'OR invoice',
    'invoice AND OR receipt',
    '(invoice',
    'invoice)',
    '()',
    '"invoice',
    'from:()',
    'invoice OR ()',
    '"" OR invoice',
  ]) {
    assert.equal(parseInboxSearchExpression(query).tag, 'Err', query);
  }
  for (const query of [
    '"OR"',
    'subject:"invoice (OR receipt)"',
    'subject:invoice(2026)',
    '"from:(a OR b)"',
  ]) {
    const parsed = parseInboxSearchExpression(query);
    assert.equal(parsed.tag, 'Ok', query);
    if (parsed.tag === 'Ok') {
      const wire = formatInboxMessageSearchExpression(parsed.value.expression);
      assert.equal(wire.tag, 'Some');
      if (wire.tag === 'Some') assert.equal(parseInboxSearchExpression(wire.value).tag, 'Ok');
    }
  }
});

/* REQ-3623-003: Folder routing is one explicit scope, independent of the message alternatives. */
test('folder scope is removed from wire predicates and branch scopes fail', () => {
  const parsed = parseInboxSearchExpression(
    'folder:"Client Mail" recursive:false (invoice OR receipt)'
  );
  assert.equal(parsed.tag, 'Ok');
  if (parsed.tag === 'Ok') {
    assert.deepEqual(parsed.value.folderScope, {
      tag: 'FolderTree',
      selector: 'Client Mail',
      recursive: false,
    });
    assert.deepEqual(formatInboxMessageSearchExpression(parsed.value.expression), {
      tag: 'Some',
      value: '(invoice OR receipt)',
    });
  }
  for (const query of [
    'folder:A OR invoice',
    '(folder:A invoice) OR (folder:B receipt)',
    'recursive:false invoice',
    'from:a from:b',
  ]) {
    assert.equal(parseInboxSearchExpression(query).tag, 'Err', query);
  }
});
