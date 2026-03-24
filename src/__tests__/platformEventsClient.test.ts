/* REQUIREMENT ADR-028: Platform events clients must derive the versioned APIS gateway URL `/v1/platform/events` and work with SDK API-key auth modules. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiKeyAuth } from '../auth/createApiKeyAuth.js';
import { diskd } from '../sdk/diskd.js';
import { withEnv, withFetchMock } from '../testing/fetchMock.js';

test('diskd.platform.events uses the versioned gateway path and forwards API-key workspace headers', async () => {
  await withEnv(
    {
      APIS_BASE_URL: 'https://apis.example',
      APIS_API_KEY: 'gateway-key',
    },
    async () => {
      await withFetchMock(
        () =>
          new Response(JSON.stringify({ id: 'evt-1', subject: 'platform.ws-1.test' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        async (calls) => {
          const auth = createApiKeyAuth({ workspaceId: 'ws-1' });
          const client = diskd.platform.events({ auth });

          const result = await client.publish({
            subject: 'test',
            data: { ok: true },
          });

          assert.deepEqual(result, { id: 'evt-1', subject: 'platform.ws-1.test' });
          assert.equal(calls[0]?.url, 'https://apis.example/v1/platform/events/publish');
          assert.equal(calls[0]?.init?.method, 'POST');

          const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
          assert.equal(headers?.['X-Api-Key'], 'gateway-key');
          assert.equal(headers?.['X-Workspace-Id'], 'ws-1');

          const body = JSON.parse(String(calls[0]?.init?.body)) as {
            readonly subject: string;
            readonly data: { readonly ok: boolean };
          };
          assert.equal(body.subject, 'test');
          assert.equal(body.data.ok, true);
        }
      );
    }
  );
});
