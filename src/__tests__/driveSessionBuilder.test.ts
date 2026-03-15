import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMessage, buildMinimalDocument, generateUlid } from '../drive/sessionBuilder.js';

test('generateUlid returns a 26-character Crockford Base32 string', () => {
  const id = generateUlid();
  assert.equal(id.length, 26);
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('generateUlid produces unique values', () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateUlid()));
  assert.equal(ids.size, 100);
});

test('buildMessage fills defaults from role "user"', () => {
  const msg = buildMessage({ role: 'user', content: 'Hello' });

  assert.equal(msg.role, 'user');
  assert.equal(msg.content, 'Hello');
  assert.equal(msg.participantKind, 'human');
  assert.equal(msg.id.length, 26);
  assert.equal(msg.participantId, null);
  assert.equal(msg.participantName, null);
  assert.equal(msg.participantSlug, null);
  assert.equal(msg.contentBlocksJson, null);
  assert.equal(msg.sourceOrigin, null);
  assert.equal(msg.turnCorrelationId, null);
  assert.equal(msg.turnContextJson, null);
  assert.equal(msg.functionCall, null);
  assert.equal(msg.toolCalls, null);
  assert.equal(msg.toolCallId, null);
  assert.equal(msg.context, null);
  assert.equal(msg.metadata, null);
  assert.equal(msg.attachments, null);
  assert.equal(msg.subtype, null);
  assert.equal(msg.parentMessageId, null);
  assert.equal(msg.isSidechain, false);
  assert.equal(msg.tokenCount, null);
  assert.equal(msg.updatedAt, null);
  assert.equal(msg.deletedAt, null);
  assert.ok(msg.createdAt.length > 0);
});

test('buildMessage infers participantKind "ai" for assistant role', () => {
  const msg = buildMessage({ role: 'assistant', content: 'Hi' });
  assert.equal(msg.participantKind, 'ai');
});

test('buildMessage infers participantKind "system" for system role', () => {
  const msg = buildMessage({ role: 'system', content: 'You are a helper' });
  assert.equal(msg.participantKind, 'system');
});

test('buildMessage uses role as participantKind for unknown roles', () => {
  const msg = buildMessage({ role: 'tool', content: 'result' });
  assert.equal(msg.participantKind, 'tool');
});

test('buildMessage respects explicit participantKind override', () => {
  const msg = buildMessage({ role: 'user', content: 'Hi', participantKind: 'custom' });
  assert.equal(msg.participantKind, 'custom');
});

test('buildMessage respects explicit id', () => {
  const msg = buildMessage({ role: 'user', content: 'Hi', id: 'my-id-1' });
  assert.equal(msg.id, 'my-id-1');
});

test('buildMessage passes through optional fields', () => {
  const msg = buildMessage({
    role: 'assistant',
    content: 'result',
    participantName: 'Claude',
    metadata: { model: 'claude-4' },
    attachments: ['file-1'],
    isSidechain: true,
    tokenCount: 42,
  });
  assert.equal(msg.participantName, 'Claude');
  assert.deepEqual(msg.metadata, { model: 'claude-4' });
  assert.deepEqual(msg.attachments, ['file-1']);
  assert.equal(msg.isSidechain, true);
  assert.equal(msg.tokenCount, 42);
});

test('buildMinimalDocument creates a valid document shell', () => {
  const doc = buildMinimalDocument({ sessionId: 'sess-1', projectId: 'proj-1', title: 'Test' });

  assert.equal(doc.id, 'sess-1');
  assert.equal(doc.projectId, 'proj-1');
  assert.equal(doc.title, 'Test');
  assert.equal(doc.workspaceId, '');
  assert.deepEqual(doc.exchanges, []);
  assert.deepEqual(doc.participants, []);
  assert.deepEqual(doc.messages, []);
  assert.equal(doc.sourceOrigin, null);
  assert.equal(doc.forkSourceSessionId, null);
  assert.equal(doc.forkSourceMessageId, null);
  assert.ok(doc.createdAt.length > 0);
  assert.equal(doc.createdAt, doc.updatedAt);
});

test('buildMinimalDocument defaults title to null', () => {
  const doc = buildMinimalDocument({ sessionId: 'sess-1', projectId: 'proj-1' });
  assert.equal(doc.title, null);
});

test('buildMinimalDocument accepts workspaceId', () => {
  const doc = buildMinimalDocument({
    sessionId: 'sess-1',
    projectId: 'proj-1',
    workspaceId: 'ws-1',
  });
  assert.equal(doc.workspaceId, 'ws-1');
});
