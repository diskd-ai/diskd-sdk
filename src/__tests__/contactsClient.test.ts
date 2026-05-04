/* REQUIREMENT ADR-028: Platform Contacts clients must derive the versioned APIS gateway URL `/v1/platform/contacts` and work with SDK API-key auth modules. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiKeyAuth } from '../auth/createApiKeyAuth.js';
import { diskd } from '../sdk/diskd.js';
import { withEnv, withFetchMock } from '../testing/fetchMock.js';

const wireContact = {
  id: 'contact-1',
  displayName: 'Alice Example',
  givenName: 'Alice',
  familyName: 'Example',
  title: null,
  tags: ['vip'],
  source: 'manual',
  isArchived: false,
  methods: [{ id: 'method-1', type: 'email', value: 'alice@example.com', isPrimary: true }],
  projectLinks: [{ projectId: 'proj-1', role: 'client' }],
  createdAt: '2026-04-08T10:00:00.000Z',
  updatedAt: '2026-04-08T10:00:00.000Z',
};

test('diskd.platform.contacts uses the versioned gateway path and forwards API-key workspace headers', async () => {
  await withEnv(
    {
      APIS_BASE_URL: 'https://apis.example',
      APIS_API_KEY: 'gateway-key',
    },
    async () => {
      await withFetchMock(
        () =>
          new Response(JSON.stringify([wireContact]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        async (calls) => {
          const auth = createApiKeyAuth({ workspaceId: 'ws-1' });
          const client = diskd.platform.contacts({ auth });

          const result = await client.list({ source: 'manual', isArchived: false });

          assert.deepEqual(result, [wireContact]);
          assert.equal(
            calls[0]?.url,
            'https://apis.example/v1/platform/contacts/api/contacts?source=manual&isArchived=false'
          );
          assert.equal(calls[0]?.init?.method, 'GET');

          const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
          assert.equal(headers?.['X-Api-Key'], 'gateway-key');
          assert.equal(headers?.['X-Workspace-Id'], 'ws-1');
        }
      );
    }
  );
});

test('contacts.projectLinks.add posts to the nested REST route', async () => {
  await withEnv(
    {
      APIS_BASE_URL: 'https://apis.example',
      APIS_API_KEY: 'gateway-key',
    },
    async () => {
      await withFetchMock(
        () =>
          new Response(JSON.stringify(wireContact), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        async (calls) => {
          const auth = createApiKeyAuth({ workspaceId: 'ws-1' });
          const client = diskd.platform.contacts({ auth, url: 'http://app-service:3000' });

          const result = await client.projectLinks.add('contact-1', {
            projectId: 'proj-1',
            role: 'client',
          });

          assert.deepEqual(result, wireContact);
          assert.equal(
            calls[0]?.url,
            'http://app-service:3000/api/contacts/contact-1/project-links'
          );
          assert.equal(calls[0]?.init?.method, 'POST');
          const body = JSON.parse(String(calls[0]?.init?.body)) as {
            readonly projectId: string;
            readonly role: string;
          };
          assert.equal(body.projectId, 'proj-1');
          assert.equal(body.role, 'client');
        }
      );
    }
  );
});
