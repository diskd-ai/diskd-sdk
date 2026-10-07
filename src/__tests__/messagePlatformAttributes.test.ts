/**
 * Platform-owned flags and labels on Exchange mailbox messages (Redmine #3143 G1/G2).
 *
 * Drive stores platform flags/labels next to the provider mirror; the SDK writes them
 * through messages_store/set-attributes and the inbox client exposes them as one
 * effective star and one label list, without calling the IMAP worker.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const makeAuth = (): AuthModule => ({
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-123',
  getToken: () => ({ accessToken: 'token-123' }),
  getWorkspaceId: async () => 'workspace-1',
});

const withFetchMock = async (
  handler: (input: string, init?: RequestInit) => Response,
  fn: (calls: FetchCall[]) => Promise<void>
): Promise<void> => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  };
  try {
    await fn(calls);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
};

const rpc = (id: unknown, result: unknown): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const body = (init?: RequestInit): Record<string, unknown> =>
  JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;

const storedRow = (platform: {
  readonly flags: readonly string[];
  readonly labels: readonly string[];
  readonly revision: number;
}) => ({
  external_id: '7:42',
  payload: {
    accountId: 'contact',
    mailbox: 'INBOX',
    uid: 42,
    uidValidity: 7,
    messageId: '<rfc@example.test>',
    from: { name: 'FMB', address: 'fmb@example.test' },
    subject: 'Ordre de mission DUPONT',
    flags: ['\\Seen'],
    labels: ['provider-label'],
    bodyState: 'loaded',
    bodyText: 'Body',
  },
  created_at: '2026-10-05T10:00:00+00:00',
  updated_at: '2026-10-05T10:00:00+00:00',
  platform_flags: platform.flags,
  platform_labels: platform.labels,
  platform_revision: platform.revision,
});

/* REQ-SDK-PLATFORM-ATTR-001: folder.setAttributes sends the snake_case Drive contract and decodes the stored platform state. */
test('messagesStore folder.setAttributes calls messages_store/set-attributes', async () => {
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      assert.equal(request.method, 'messages_store/set-attributes');
      assert.deepEqual(request.params, {
        mailbox_id: 'contact',
        folder_id: 'INBOX',
        external_id: '7:42',
        flags_add: ['flagged'],
        labels_add: ['FMB'],
        labels_remove: ['DOMUS'],
      });
      return rpc(request.id, {
        external_id: '7:42',
        platform_flags: ['flagged'],
        platform_labels: ['FMB'],
        platform_revision: 3,
        changed: true,
      });
    },
    async () => {
      const client = diskd.os.messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' });
      const result = await client
        .mailbox({ mailboxId: 'contact' })
        .folder({ folderId: 'INBOX' })
        .setAttributes({
          externalId: '7:42',
          flagsAdd: ['flagged'],
          labelsAdd: ['FMB'],
          labelsRemove: ['DOMUS'],
        });
      assert.deepEqual(result, {
        externalId: '7:42',
        platformFlags: ['flagged'],
        platformLabels: ['FMB'],
        platformRevision: 3,
        changed: true,
      });
    }
  );
});

/* REQ-SDK-PLATFORM-ATTR-002: stored messages carry platform flags, labels and revision; an older Drive without them reads as empty. */
test('messagesStore getMessage decodes platform fields with empty defaults', async () => {
  const rows = [
    storedRow({ flags: ['flagged'], labels: ['FMB'], revision: 2 }),
    {
      ...storedRow({ flags: [], labels: [], revision: 0 }),
      platform_flags: undefined,
      platform_labels: undefined,
      platform_revision: undefined,
    },
  ];
  let index = 0;
  await withFetchMock(
    (_url, init) => {
      const request = body(init);
      const row = rows[index];
      index += 1;
      return rpc(request.id, { message: row });
    },
    async () => {
      const folder = diskd.os
        .messagesStore({ auth: makeAuth(), url: 'http://drive:8000/api/v1' })
        .mailbox({ mailboxId: 'contact' })
        .folder({ folderId: 'INBOX' });
      const withPlatform = await folder.getMessage({ externalId: '7:42' });
      assert.deepEqual(
        [withPlatform.platformFlags, withPlatform.platformLabels, withPlatform.platformRevision],
        [['flagged'], ['FMB'], 2]
      );
      const legacy = await folder.getMessage({ externalId: '7:42' });
      assert.deepEqual(
        [legacy.platformFlags, legacy.platformLabels, legacy.platformRevision],
        [[], [], 0]
      );
    }
  );
});

type InboxFixture = {
  readonly expectedParams: Record<string, unknown>;
  readonly after: {
    readonly flags: readonly string[];
    readonly labels: readonly string[];
    readonly revision: number;
  };
};

/** Drive-only inbox fixture: folder list, get before/after, one set-attributes write. */
const withInboxFixture = async (
  fixture: InboxFixture,
  verify: (inbox: ReturnType<typeof diskd.platform.inbox>, calls: FetchCall[]) => Promise<void>
): Promise<void> => {
  let written = false;
  await withFetchMock(
    (url, init) => {
      const request = body(init);
      if (request.method === 'messages_store/folder/list')
        return rpc(request.id, {
          folders: [
            {
              folder_id: 'INBOX',
              display_name: 'Inbox',
              metadata: {},
              message_count: 1,
              updated_at: '2026-10-05T10:00:00+00:00',
            },
          ],
        });
      if (request.method === 'messages_store/get')
        return rpc(request.id, {
          message: written
            ? storedRow(fixture.after)
            : storedRow({ flags: [], labels: [], revision: 0 }),
        });
      if (request.method === 'messages_store/set-attributes') {
        assert.deepEqual(request.params, fixture.expectedParams);
        written = true;
        return rpc(request.id, {
          external_id: '7:42',
          platform_flags: fixture.after.flags,
          platform_labels: fixture.after.labels,
          platform_revision: fixture.after.revision,
          changed: true,
        });
      }
      throw new Error(`Unexpected call ${url} ${String(request.method)}`);
    },
    (calls) =>
      verify(
        diskd.platform.inbox({
          auth: makeAuth(),
          driveUrl: 'http://drive/api/v1',
          emailUrl: 'http://email',
        }),
        calls
      )
  );
};

/* REQ-SDK-PLATFORM-ATTR-003: setFlagged writes the platform star on Drive and never calls the IMAP worker. */
for (const flagged of [true, false]) {
  test(`platform.inbox.setFlagged(${flagged}) writes the Drive platform flag`, async () => {
    await withInboxFixture(
      {
        expectedParams: {
          mailbox_id: 'exchange-contact',
          folder_id: 'INBOX',
          external_id: '7:42',
          ...(flagged ? { flags_add: ['flagged'] } : { flags_remove: ['flagged'] }),
        },
        after: { flags: flagged ? ['flagged'] : [], labels: [], revision: 1 },
      },
      async (inbox, calls) => {
        const email = await inbox.setFlagged({
          account: 'contact',
          folderId: 'INBOX',
          messageId: '7:42',
          flagged,
        });
        assert.equal(email.isFlagged, flagged);
        /* REQ-SDK-FLAGCOLOR-002: a flagged message without a stored colour reads red; an unflagged one has no colour. */
        assert.equal(email.flagColor, flagged ? 'red' : null);
        assert.equal(email.messageId, '7:42');
        assert(calls.every((call) => !call.url.startsWith('http://email')));
      }
    );
  });
}

/* REQ-SDK-FLAGCOLOR-001: setFlagged with a colour writes the `color:<name>` platform flag (Drive adds `flagged`) and the message reads back flagged in that colour (Exchange flag colours, 2026-10-07). */
test('platform.inbox.setFlagged with a colour writes the colour flag', async () => {
  await withInboxFixture(
    {
      expectedParams: {
        mailbox_id: 'exchange-contact',
        folder_id: 'INBOX',
        external_id: '7:42',
        flags_add: ['color:blue'],
      },
      after: { flags: ['flagged', 'color:blue'], labels: [], revision: 2 },
    },
    async (inbox) => {
      const email = await inbox.setFlagged({
        account: 'contact',
        folderId: 'INBOX',
        messageId: '7:42',
        flagged: true,
        color: 'blue',
      });
      assert.equal(email.isFlagged, true);
      assert.equal(email.flagColor, 'blue');
    }
  );
});

/* REQ-SDK-FLAGCOLOR-003: a colour sent with flagged false is rejected before any call, since unflagging clears the colour. */
test('platform.inbox.setFlagged rejects a colour with flagged false', async () => {
  await withFetchMock(
    () => {
      throw new Error('no call expected');
    },
    async (calls) => {
      const inbox = diskd.platform.inbox({
        auth: makeAuth(),
        driveUrl: 'http://drive/api/v1',
        emailUrl: 'http://email',
      });
      await assert.rejects(
        inbox.setFlagged({
          account: 'contact',
          folderId: 'INBOX',
          messageId: '7:42',
          flagged: false,
          color: 'blue',
        }),
        /colour/
      );
      assert.equal(calls.length, 0);
    }
  );
});

/* REQ-SDK-PLATFORM-ATTR-004: setLabels adds/removes platform labels; labels show provider and platform labels, platformLabels only the removable ones. */
test('platform.inbox.setLabels writes platform labels and merges them for reads', async () => {
  await withInboxFixture(
    {
      expectedParams: {
        mailbox_id: 'exchange-contact',
        folder_id: 'INBOX',
        external_id: '7:42',
        labels_add: ['FMB'],
        labels_remove: ['DOMUS'],
      },
      after: { flags: [], labels: ['FMB'], revision: 1 },
    },
    async (inbox) => {
      const email = await inbox.setLabels({
        account: 'contact',
        folderId: 'INBOX',
        messageId: '7:42',
        add: ['FMB'],
        remove: ['DOMUS'],
      });
      assert.deepEqual(email.labels, ['provider-label', 'FMB']);
      assert.deepEqual(email.platformLabels, ['FMB']);
    }
  );
});

/* REQ-SDK-PLATFORM-ATTR-005: setLabels needs at least one label to add or remove. */
test('platform.inbox.setLabels rejects an empty change', async () => {
  const inbox = diskd.platform.inbox({
    auth: makeAuth(),
    driveUrl: 'http://drive/api/v1',
    emailUrl: 'http://email',
  });
  await assert.rejects(inbox.setLabels({ account: 'contact', messageId: '7:42' }), /add or remove/);
});
