/* REQ-3894-017: StoredEmail and InboxEmailEnvelope carry inReplyTo, references and answered from the stored payload; missing or malformed values map to null, [] and false. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { replyStateOf } from '../inbox/inboxReplyState.js';
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

const requestOf = (init?: RequestInit): { readonly id: unknown; readonly method: unknown } =>
  JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
    readonly id: unknown;
    readonly method: unknown;
  };

/** Runs fn with a fetch stub that answers each JSON-RPC method from the given table. */
const withDrive = async (
  answers: { readonly [method: string]: unknown },
  fn: () => Promise<void>
): Promise<void> => {
  const originalFetch = globalThis.fetch;
  const stub = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = requestOf(init);
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

const replyRow = {
  external_id: '14:43',
  payload: {
    mailbox: 'INBOX',
    uid: 43,
    uidValidity: 14,
    messageId: '<reply@example.com>',
    inReplyTo: '<original@example.com>',
    references: ['<root@example.com>', '<original@example.com>'],
    from: { name: 'Bob', address: 'bob@example.com' },
    to: [],
    cc: [],
    subject: 'Re: Hello',
    date: '2026-05-04T11:00:00.000Z',
    flags: ['\\Seen', '\\Answered'],
    labels: [],
    hasAttachments: false,
    attachments: [],
    snippet: 'Reply',
    bodyText: 'Reply',
    bodyHtml: null,
    bodyState: 'loaded',
  },
  created_at: '2026-05-04T11:00:00.000Z',
  updated_at: '2026-05-04T11:00:00.000Z',
};

const legacyRow = {
  external_id: '14:44',
  payload: {
    mailbox: 'INBOX',
    uid: 44,
    messageId: '<legacy@example.com>',
    from: { name: 'Carol', address: 'carol@example.com' },
    subject: 'Before reply headers were stored',
    date: '2026-05-03T11:00:00.000Z',
    flags: ['\\Seen'],
    bodyText: 'Old',
    bodyState: 'loaded',
  },
  created_at: '2026-05-03T11:00:00.000Z',
  updated_at: '2026-05-03T11:00:00.000Z',
};

test('replyStateOf maps stored reply headers and the \\Answered flag', () => {
  assert.deepEqual(replyStateOf(replyRow.payload), {
    inReplyTo: '<original@example.com>',
    references: ['<root@example.com>', '<original@example.com>'],
    answered: true,
  });
});

test('replyStateOf maps a payload without reply headers to null, [] and false', () => {
  assert.deepEqual(replyStateOf(legacyRow.payload), {
    inReplyTo: null,
    references: [],
    answered: false,
  });
  assert.deepEqual(replyStateOf(null), { inReplyTo: null, references: [], answered: false });
});

test('replyStateOf maps malformed reply values explicitly', () => {
  const cases: readonly (readonly [unknown, unknown])[] = [
    [
      { inReplyTo: '   ', references: 'not-a-list', flags: '\\Answered' },
      { inReplyTo: null, references: [], answered: false },
    ],
    [
      { inReplyTo: 42, references: [7, ' <a@x> ', '', null], flags: [1, '\\answered'] },
      { inReplyTo: null, references: ['<a@x>'], answered: true },
    ],
    [
      { inReplyTo: ' <p@x> ', references: null, flags: null },
      { inReplyTo: '<p@x>', references: [], answered: false },
    ],
  ];
  for (const [payload, expected] of cases) assert.deepEqual(replyStateOf(payload), expected);
});

test('platform.inbox.list envelopes carry inReplyTo, references and answered', async () => {
  await withDrive(
    { 'messages_store/list': { items: [replyRow, legacyRow], next_cursor: null } },
    async () => {
      const inbox = diskd.platform.inbox({ auth: makeAuth(), driveUrl: 'http://drive/api/v1' });
      const page = await inbox.list({ account: 'owner@example.com', folderId: 'INBOX' });
      assert.deepEqual(
        page.items.map((item) => [item.messageId, item.inReplyTo, item.references, item.answered]),
        [
          [
            '14:43',
            '<original@example.com>',
            ['<root@example.com>', '<original@example.com>'],
            true,
          ],
          ['14:44', null, [], false],
        ]
      );
    }
  );
});

test('platform.inbox.read carries inReplyTo, references and answered', async () => {
  await withDrive(
    {
      'messages_store/folder/list': {
        folders: [
          {
            folder_id: 'INBOX',
            display_name: 'Inbox',
            metadata: {},
            message_count: 1,
            updated_at: '2026-05-04T10:00:00.000Z',
          },
        ],
      },
      'messages_store/get': { message: replyRow },
    },
    async () => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        contentMode: 'stored-only',
      });
      const email = await inbox.read({ account: 'owner@example.com', messageId: '14:43' });
      assert.deepEqual(
        [email.inReplyTo, email.references, email.answered],
        ['<original@example.com>', ['<root@example.com>', '<original@example.com>'], true]
      );
    }
  );
});
