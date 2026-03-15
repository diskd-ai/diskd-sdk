import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessage } from '../drive/sessionBuilder.js';
import { createDriveSessionManager } from '../drive/sessionObject.js';
import type { DriveSessionClient } from '../drive/sessionTypes.js';

const makeMessage = (id: string, role: string, content: string) =>
  buildMessage({ id, role, content });

const makeSessionDocument = (overrides: Record<string, unknown> = {}) => ({
  id: 'sess-1',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  title: 'Test Session',
  config: {
    operativeId: null,
    provider: null,
    model: null,
    promptText: null,
    driveSourcesMuted: false,
  },
  exchanges: [],
  participants: [],
  messages: [] as ReturnType<typeof makeMessage>[],
  createdAt: '2026-03-12T10:00:00Z',
  updatedAt: '2026-03-12T10:00:00Z',
  sourceOrigin: null,
  forkSourceSessionId: null,
  forkSourceMessageId: null,
  ...overrides,
});

type RpcLog = { readonly method: string; readonly args: unknown };

const makeMockRpc = (
  overrides: Partial<DriveSessionClient> = {}
): { rpc: DriveSessionClient; log: RpcLog[] } => {
  const log: RpcLog[] = [];

  const rpc: DriveSessionClient = {
    save: async (p) => {
      log.push({ method: 'save', args: p });
      return {
        sessionId: p.session.id,
        messageCount: p.session.messages.length,
        updatedAt: '2026-03-12T10:00:00Z',
      };
    },
    get: async (p) => {
      log.push({ method: 'get', args: p });
      return { session: makeSessionDocument({ messages: [makeMessage('m-1', 'user', 'Hello')] }) };
    },
    getPreview: async (p) => {
      log.push({ method: 'getPreview', args: p });
      return {
        session: makeSessionDocument(),
        messages: [makeMessage('m-1', 'user', 'Hello')],
        messageCount: 5,
      };
    },
    getMessageRange: async (p) => {
      log.push({ method: 'getMessageRange', args: p });
      return {
        messages: [makeMessage('m-older', 'user', 'Older message')],
        hasMore: false,
      };
    },
    list: async (p) => {
      log.push({ method: 'list', args: p });
      return {
        items: [
          {
            sessionId: 'sess-1',
            title: 'Test Session',
            messageCount: 5,
            updatedAt: '2026-03-12T10:00:00Z',
            provider: null,
            model: null,
          },
        ],
      };
    },
    appendMessages: async (p) => {
      log.push({ method: 'appendMessages', args: p });
      return { sessionId: p.sessionId, messageCount: 10, updatedAt: '2026-03-12T10:01:00Z' };
    },
    deleteMessages: async (p) => {
      log.push({ method: 'deleteMessages', args: p });
      return { sessionId: p.sessionId, messageCount: 3, updatedAt: '2026-03-12T10:02:00Z' };
    },
    delete: async (p) => {
      log.push({ method: 'delete', args: p });
      return { sessionId: p.sessionId, status: 'deleted' };
    },
    ...overrides,
  };

  return { rpc, log };
};

test('manager.start creates a session with auto-generated ID and messageCount 0', async () => {
  const { rpc, log } = makeMockRpc({
    save: async (p) => {
      log.push({ method: 'save', args: p });
      return { sessionId: p.session.id, messageCount: 0, updatedAt: '2026-03-12T10:00:00Z' };
    },
  });
  const manager = createDriveSessionManager({ rpc });

  const session = await manager.start({ projectId: 'proj-1', title: 'New Chat' });

  assert.equal(session.projectId, 'proj-1');
  assert.equal(session.sessionId.length, 26);
  assert.equal(session.messageCount, 0);
  assert.deepEqual(session.messages, []);
  assert.equal(session.document.title, 'New Chat');
  assert.equal(log.length, 1);
  assert.equal(log[0]?.method, 'save');

  session.dispose();
});

test('manager.open with limit uses getPreview', async () => {
  const { rpc, log } = makeMockRpc();
  const manager = createDriveSessionManager({ rpc });

  const session = await manager.open({ projectId: 'proj-1', sessionId: 'sess-1', limit: 20 });

  assert.equal(session.sessionId, 'sess-1');
  assert.equal(session.messageCount, 5);
  assert.equal(session.messages.length, 1);
  assert.equal(log[0]?.method, 'getPreview');

  session.dispose();
});

test('manager.open without limit uses get', async () => {
  const { rpc, log } = makeMockRpc();
  const manager = createDriveSessionManager({ rpc });

  const session = await manager.open({ projectId: 'proj-1', sessionId: 'sess-1' });

  assert.equal(session.messages.length, 1);
  assert.equal(log[0]?.method, 'get');

  session.dispose();
});

test('session.append sends RPC and updates local state', async () => {
  const { rpc, log } = makeMockRpc();
  const manager = createDriveSessionManager({ rpc });
  const session = await manager.start({ projectId: 'proj-1' });

  const msg = buildMessage({ role: 'user', content: 'Hello' });
  await session.append([msg]);

  assert.equal(session.messageCount, 10);
  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0]?.content, 'Hello');

  const appendCall = log.find((c) => c.method === 'appendMessages');
  assert.ok(appendCall);

  session.dispose();
});

test('session.rollback sends deleteMessages with rollbackAfterMessageId and trims local state', async () => {
  const { rpc, log } = makeMockRpc({
    get: async () => ({
      session: makeSessionDocument({
        messages: [
          makeMessage('m-1', 'user', 'First'),
          makeMessage('m-2', 'assistant', 'Second'),
          makeMessage('m-3', 'user', 'Third'),
        ],
      }),
    }),
  });
  const manager = createDriveSessionManager({ rpc });
  const session = await manager.open({ projectId: 'proj-1', sessionId: 'sess-1' });

  assert.equal(session.messages.length, 3);

  await session.rollback('m-2');

  assert.equal(session.messageCount, 3);
  const deleteCall = log.find((c) => c.method === 'deleteMessages');
  assert.ok(deleteCall);
  const deleteArgs = deleteCall.args as { rollbackAfterMessageId?: string };
  assert.equal(deleteArgs.rollbackAfterMessageId, 'm-2');
  // Local state trimmed: messages before m-2 only
  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0]?.id, 'm-1');

  session.dispose();
});

test('session.remove sends deleteMessages with messageIds and filters local state', async () => {
  const { rpc, log } = makeMockRpc({
    get: async () => ({
      session: makeSessionDocument({
        messages: [
          makeMessage('m-1', 'user', 'First'),
          makeMessage('m-2', 'assistant', 'Second'),
          makeMessage('m-3', 'user', 'Third'),
        ],
      }),
    }),
  });
  const manager = createDriveSessionManager({ rpc });
  const session = await manager.open({ projectId: 'proj-1', sessionId: 'sess-1' });

  await session.remove(['m-2']);

  assert.equal(session.messageCount, 3);
  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[0]?.id, 'm-1');
  assert.equal(session.messages[1]?.id, 'm-3');

  const deleteCall = log.find((c) => c.method === 'deleteMessages');
  assert.ok(deleteCall);
  const deleteArgs = deleteCall.args as { messageIds?: readonly string[] };
  assert.deepEqual(deleteArgs.messageIds, ['m-2']);

  session.dispose();
});

test('session.fork creates a new session with fork lineage', async () => {
  const { rpc } = makeMockRpc({
    get: async () => ({
      session: makeSessionDocument({
        messages: [
          makeMessage('m-1', 'user', 'First'),
          makeMessage('m-2', 'assistant', 'Second'),
          makeMessage('m-3', 'user', 'Third'),
        ],
      }),
    }),
  });
  const manager = createDriveSessionManager({ rpc });
  const session = await manager.open({ projectId: 'proj-1', sessionId: 'sess-1' });

  const forked = await session.fork({ atMessageId: 'm-2' });

  assert.equal(forked.projectId, 'proj-1');
  assert.notEqual(forked.sessionId, 'sess-1');
  assert.equal(forked.sessionId.length, 26);
  assert.equal(forked.document.forkSourceSessionId, 'sess-1');
  assert.equal(forked.document.forkSourceMessageId, 'm-2');
  assert.equal(forked.messages.length, 2);
  assert.equal(forked.messages[0]?.id, 'm-1');
  assert.equal(forked.messages[1]?.id, 'm-2');

  forked.dispose();
  session.dispose();
});

test('session.fork throws if fork point not found', async () => {
  const { rpc } = makeMockRpc({
    get: async () => ({
      session: makeSessionDocument({
        messages: [makeMessage('m-1', 'user', 'First')],
      }),
    }),
  });
  const manager = createDriveSessionManager({ rpc });
  const session = await manager.open({ projectId: 'proj-1', sessionId: 'sess-1' });

  await assert.rejects(() => session.fork({ atMessageId: 'nonexistent' }), {
    message: "Fork point message 'nonexistent' not found in session",
  });

  session.dispose();
});

test('session.loadMore prepends older messages', async () => {
  const { rpc } = makeMockRpc();
  const manager = createDriveSessionManager({ rpc });
  const session = await manager.open({ projectId: 'proj-1', sessionId: 'sess-1', limit: 20 });

  const initialCount = session.messages.length;
  const result = await session.loadMore({ limit: 10 });

  assert.equal(result.hasMore, false);
  assert.equal(result.messages.length, 1);
  assert.equal(session.messages.length, initialCount + 1);
  assert.equal(session.messages[0]?.id, 'm-older');

  session.dispose();
});

test('session.refresh replaces local state from backend', async () => {
  let callCount = 0;
  const { rpc } = makeMockRpc({
    get: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          session: makeSessionDocument({ messages: [makeMessage('m-1', 'user', 'First')] }),
        };
      }
      return {
        session: makeSessionDocument({
          title: 'Updated Title',
          messages: [
            makeMessage('m-1', 'user', 'First'),
            makeMessage('m-2', 'assistant', 'Second'),
          ],
        }),
      };
    },
  });
  const manager = createDriveSessionManager({ rpc });
  const session = await manager.open({ projectId: 'proj-1', sessionId: 'sess-1' });

  assert.equal(session.messages.length, 1);

  await session.refresh();

  assert.equal(session.messages.length, 2);
  assert.equal(session.messageCount, 2);

  session.dispose();
});

test('session methods throw after dispose', async () => {
  const { rpc } = makeMockRpc();
  const manager = createDriveSessionManager({ rpc });
  const session = await manager.start({ projectId: 'proj-1' });

  session.dispose();

  const msg = buildMessage({ role: 'user', content: 'test' });
  await assert.rejects(() => session.append([msg]), { message: 'DriveSession is disposed' });
  await assert.rejects(() => session.rollback('m-1'), { message: 'DriveSession is disposed' });
  await assert.rejects(() => session.remove(['m-1']), { message: 'DriveSession is disposed' });
  await assert.rejects(() => session.fork({ atMessageId: 'm-1' }), {
    message: 'DriveSession is disposed',
  });
  await assert.rejects(() => session.refresh(), { message: 'DriveSession is disposed' });
  await assert.rejects(() => session.loadMore({ limit: 10 }), {
    message: 'DriveSession is disposed',
  });
});

test('manager.message builds a message (pure, no RPC)', () => {
  const { rpc } = makeMockRpc();
  const manager = createDriveSessionManager({ rpc });

  const msg = manager.message({ role: 'user', content: 'Hi there' });

  assert.equal(msg.role, 'user');
  assert.equal(msg.content, 'Hi there');
  assert.equal(msg.participantKind, 'human');
  assert.equal(msg.id.length, 26);
});

test('manager.list returns session items', async () => {
  const { rpc, log } = makeMockRpc();
  const manager = createDriveSessionManager({ rpc });

  const result = await manager.list({ projectId: 'proj-1' });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.sessionId, 'sess-1');
  assert.equal(log[0]?.method, 'list');
});

test('manager.delete removes a session', async () => {
  const { rpc, log } = makeMockRpc();
  const manager = createDriveSessionManager({ rpc });

  const result = await manager.delete({ projectId: 'proj-1', sessionId: 'sess-1' });

  assert.equal(result.status, 'deleted');
  assert.equal(log[0]?.method, 'delete');
});

test('manager.save is stateless, returns result without session object', async () => {
  const { rpc } = makeMockRpc();
  const manager = createDriveSessionManager({ rpc });

  const doc = makeSessionDocument({ messages: [makeMessage('m-1', 'user', 'imported')] });
  const result = await manager.save({ projectId: 'proj-1', session: doc });

  assert.equal(result.sessionId, 'sess-1');
  assert.equal(result.messageCount, 1);
});
