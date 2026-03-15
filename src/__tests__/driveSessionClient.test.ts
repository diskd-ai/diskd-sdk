import assert from 'node:assert/strict';
import test from 'node:test';

import { createDriveSessionClient } from '../drive/session.js';

type RpcCall = { readonly method: string; readonly params: unknown };

const makeRpcMock = (response: unknown) => {
  const calls: RpcCall[] = [];
  const call = async (method: string, params: unknown): Promise<unknown> => {
    calls.push({ method, params });
    return response;
  };
  return { calls, call };
};

test('session client get encodes project_id + session_id', async () => {
  const { calls, call } = makeRpcMock({
    session: {
      id: 'sess-1',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
      title: null,
      config: {
        operative_id: null,
        provider: null,
        model: null,
        prompt_text: null,
        drive_sources_muted: false,
      },
      exchanges: [],
      participants: [],
      messages: [],
      created_at: '2026-03-12T10:00:00Z',
      updated_at: '2026-03-12T10:00:00Z',
      source_origin: null,
      fork_source_session_id: null,
      fork_source_message_id: null,
    },
  });

  const client = createDriveSessionClient({ call });
  await client.get({ projectId: 'proj-1', sessionId: 'sess-1' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, 'drive/session/get');
  assert.deepEqual(calls[0]?.params, { project_id: 'proj-1', session_id: 'sess-1' });
});

test('session client deleteMessages supports rollbackAfterMessageId encoding', async () => {
  const { calls, call } = makeRpcMock({
    session_id: 'sess-1',
    message_count: 10,
    updated_at: '2026-03-12T11:00:00Z',
  });

  const client = createDriveSessionClient({ call });
  await client.deleteMessages({
    projectId: 'proj-1',
    sessionId: 'sess-1',
    rollbackAfterMessageId: 'm-10',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, 'drive/session/delete-messages');
  assert.deepEqual(calls[0]?.params, {
    project_id: 'proj-1',
    session_id: 'sess-1',
    rollback_after_message_id: 'm-10',
  });
});

test('session client deleteMessages supports messageIds encoding', async () => {
  const { calls, call } = makeRpcMock({
    session_id: 'sess-1',
    message_count: 8,
    updated_at: '2026-03-12T11:00:00Z',
  });

  const client = createDriveSessionClient({ call });
  await client.deleteMessages({
    projectId: 'proj-1',
    sessionId: 'sess-1',
    messageIds: ['m-2', 'm-3'],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, 'drive/session/delete-messages');
  assert.deepEqual(calls[0]?.params, {
    project_id: 'proj-1',
    session_id: 'sess-1',
    message_ids: ['m-2', 'm-3'],
  });
});
