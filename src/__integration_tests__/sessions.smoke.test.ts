import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessage } from '../drive/sessionBuilder.js';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const PROJECT_ID = process.env.DISKD_PROJECT_ID;
const skipReason =
  check.tag === 'Skip'
    ? check.reason
    : !PROJECT_ID
      ? 'Set DISKD_PROJECT_ID to run session tests'
      : false;
const DRIVE_API_URL = process.env.DRIVE_API_URL;

const getEnv = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  return check.env;
};

const makeSessions = () => {
  const env = getEnv();
  if (!PROJECT_ID) throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ workspaceId: env.workspaceId });
  return diskd.platform.sessions({
    auth,
    scope: { scopeType: 'project', projectId: PROJECT_ID },
    ...(DRIVE_API_URL ? { url: DRIVE_API_URL } : {}),
  });
};

// -- List --

test('integration: sessions.list returns items array', { skip: skipReason }, async () => {
  const sessions = makeSessions();
  const result = await sessions.list();
  assert.ok(Array.isArray(result.items));
});

// -- Full lifecycle: start → append → open → rollback → delete --

test('integration: session start → append → open → rollback → delete', {
  skip: skipReason,
}, async () => {
  const sessions = makeSessions();

  // start
  const session = await sessions.start({
    title: 'SDK Integration Test',
    workspaceId: getEnv().workspaceId,
  });
  assert.ok(session.sessionId);
  assert.equal(session.projectId, PROJECT_ID);
  assert.equal(session.messages.length, 0);

  try {
    // append messages
    const msg1 = buildMessage({ role: 'user', content: 'Hello from integration test' });
    const msg2 = buildMessage({ role: 'assistant', content: 'Hello! I am responding.' });
    await session.append([msg1, msg2]);
    assert.equal(session.messages.length, 2);

    // open in a new handle to verify persistence
    const reopened = await sessions.open({ sessionId: session.sessionId });
    assert.equal(reopened.messages.length, 2);
    assert.equal(reopened.messages[0]?.content, 'Hello from integration test');
    assert.equal(reopened.messages[1]?.content, 'Hello! I am responding.');
    reopened.dispose();

    // rollback to after first message
    await session.rollback(msg1.id);
    assert.equal(session.messages.length, 1);
    assert.equal(session.messages[0]?.id, msg1.id);

    // verify in listing
    const list = await sessions.list();
    const found = list.items.find((s) => s.sessionId === session.sessionId);
    assert.ok(found, 'session should appear in list');
    assert.equal(found?.title, 'SDK Integration Test');
  } finally {
    session.dispose();
    await sessions.delete({ sessionId: session.sessionId });
  }
});

// -- Fork --

test('integration: session fork creates a new session', { skip: skipReason }, async () => {
  const sessions = makeSessions();
  const session = await sessions.start({ title: 'Fork Source', workspaceId: getEnv().workspaceId });

  try {
    const msg1 = buildMessage({ role: 'user', content: 'Message 1' });
    const msg2 = buildMessage({ role: 'assistant', content: 'Message 2' });
    const msg3 = buildMessage({ role: 'user', content: 'Message 3' });
    await session.append([msg1, msg2, msg3]);

    // fork at msg2
    const forked = await session.fork({ atMessageId: msg2.id });
    assert.ok(forked.sessionId !== session.sessionId);
    assert.equal(forked.messages.length, 2);
    assert.equal(forked.messages[0]?.content, 'Message 1');
    assert.equal(forked.messages[1]?.content, 'Message 2');

    forked.dispose();
    await sessions.delete({ sessionId: forked.sessionId });
  } finally {
    session.dispose();
    await sessions.delete({ sessionId: session.sessionId });
  }
});
