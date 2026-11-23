/* REQ-3894-022: StoredMessage, StoredEmail and InboxEmailEnvelope carry replyHeaders, 'LOADED' or 'UNAVAILABLE', from Drive's reply_headers; a missing or malformed value is 'UNAVAILABLE', never a claim that the headers were read. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { diskd } from '../sdk/diskd.js';

const makeAuth = (): AuthModule => ({
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-123',
  getToken: () => ({ accessToken: 'token-123' }),
  getWorkspaceId: async () => 'workspace-1',
});

const rpc = (id: unknown, result: unknown): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** Runs fn with a fetch stub answering each JSON-RPC method from the given table. */
const withDrive = async (
  answers: { readonly [method: string]: unknown },
  fn: () => Promise<void>
): Promise<void> => {
  const originalFetch = globalThis.fetch;
  const stub = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      readonly id: unknown;
      readonly method: unknown;
    };
    const answer = answers[String(request.method)];
    if (answer === undefined) throw new Error(`unexpected method ${String(request.method)}`);
    return rpc(request.id, answer);
  };
  /* Exception to the no-assignment rule: the global fetch is an IO-boundary handle, restored below. */
  (globalThis as { fetch: typeof fetch }).fetch = stub;
  try {
    await fn();
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
};

const row = (externalId: string, replyHeaders: unknown) => ({
  external_id: externalId,
  payload: {
    mailbox: 'INBOX',
    messageId: `<${externalId}@example.test>`,
    subject: externalId,
    date: '2026-11-20T10:00:00.000Z',
    flags: [],
    bodyText: 'x',
    bodyState: 'loaded',
  },
  created_at: '2026-11-20T10:00:00.000Z',
  updated_at: '2026-11-20T10:00:00.000Z',
  ...(replyHeaders === undefined ? {} : { reply_headers: replyHeaders }),
});

const ROWS = [
  row('loaded', 'LOADED'),
  row('unavailable', 'UNAVAILABLE'),
  row('missing', undefined),
  row('lowercase', 'loaded'),
  row('number', 1),
];
const EXPECTED = [
  ['loaded', 'LOADED'],
  ['unavailable', 'UNAVAILABLE'],
  ['missing', 'UNAVAILABLE'],
  ['lowercase', 'UNAVAILABLE'],
  ['number', 'UNAVAILABLE'],
];

test('messagesStore.listMessages decodes reply_headers; missing or malformed is UNAVAILABLE', async () => {
  await withDrive({ 'messages_store/list': { items: ROWS, next_cursor: null } }, async () => {
    const store = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive/api/v1' });
    const page = await store
      .mailbox({ mailboxId: 'owner@example.test' })
      .folder({ folderId: 'INBOX' })
      .listMessages({ limit: 10 });
    assert.deepEqual(
      page.items.map((item) => [item.externalId, item.replyHeaders]),
      EXPECTED
    );
  });
});

test('platform.inbox.list envelopes carry replyHeaders', async () => {
  await withDrive({ 'messages_store/list': { items: ROWS, next_cursor: null } }, async () => {
    const inbox = diskd.platform.inbox({
      auth: makeAuth(),
      driveUrl: 'http://drive/api/v1',
      contentMode: 'stored-only',
    });
    const page = await inbox.list({ account: 'owner@example.test', folderId: 'INBOX' });
    assert.deepEqual(
      page.items.map((item) => [item.messageId, item.replyHeaders]),
      EXPECTED
    );
  });
});

test('platform.inbox.read carries replyHeaders', async () => {
  await withDrive(
    {
      'messages_store/folder/list': {
        folders: [
          {
            folder_id: 'INBOX',
            display_name: 'Inbox',
            metadata: {},
            message_count: 1,
            updated_at: '2026-11-20T10:00:00.000Z',
          },
        ],
      },
      'messages_store/get': { message: row('loaded', 'LOADED') },
    },
    async () => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        contentMode: 'stored-only',
      });
      const email = await inbox.read({ account: 'owner@example.test', messageId: 'loaded' });
      assert.equal(email.replyHeaders, 'LOADED');
    }
  );
});

test('a readable message without reply headers is LOADED with null and []', async () => {
  await withDrive(
    { 'messages_store/list': { items: [row('headerless', 'LOADED')], next_cursor: null } },
    async () => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        contentMode: 'stored-only',
      });
      const page = await inbox.list({ account: 'owner@example.test', folderId: 'INBOX' });
      assert.deepEqual(
        page.items.map((item) => [item.replyHeaders, item.inReplyTo, item.references]),
        [['LOADED', null, []]]
      );
    }
  );
});
