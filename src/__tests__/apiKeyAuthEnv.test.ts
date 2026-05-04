/* REQUIREMENT ADR-027: API-key auth must fail fast when APIS_API_KEY or APIS_BASE_URL is missing from the gateway contract. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiKeyAuth } from '../auth/createApiKeyAuth.js';

const withGatewayEnv = (
  env: { readonly apiKey?: string; readonly baseUrl?: string },
  fn: () => void
): void => {
  const previousApiKey = process.env.APIS_API_KEY;
  const previousBaseUrl = process.env.APIS_BASE_URL;

  if (env.apiKey === undefined) {
    delete process.env.APIS_API_KEY;
  } else {
    process.env.APIS_API_KEY = env.apiKey;
  }

  if (env.baseUrl === undefined) {
    delete process.env.APIS_BASE_URL;
  } else {
    process.env.APIS_BASE_URL = env.baseUrl;
  }

  try {
    fn();
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.APIS_API_KEY;
    } else {
      process.env.APIS_API_KEY = previousApiKey;
    }

    if (previousBaseUrl === undefined) {
      delete process.env.APIS_BASE_URL;
    } else {
      process.env.APIS_BASE_URL = previousBaseUrl;
    }
  }
};

test('createApiKeyAuth rejects missing APIS_API_KEY', () => {
  withGatewayEnv({ baseUrl: 'https://apis.example' }, () => {
    assert.throws(() => createApiKeyAuth({ workspaceId: 'ws-test' }), /APIS_API_KEY is not set\./);
  });
});

test('createApiKeyAuth rejects missing APIS_BASE_URL', () => {
  withGatewayEnv({ apiKey: 'gateway-key' }, () => {
    assert.throws(() => createApiKeyAuth({ workspaceId: 'ws-test' }), /APIS_BASE_URL is not set\./);
  });
});

test('createApiKeyAuth reads APIS_API_KEY from env for request headers', async () => {
  await new Promise<void>((resolve, reject) => {
    withGatewayEnv({ apiKey: 'gateway-key', baseUrl: 'https://apis.example' }, () => {
      const auth = createApiKeyAuth({
        workspaceId: 'ws-test',
        orgId: 'org-test',
        userId: 'user-test',
      });

      auth
        .getRequestHeaders?.()
        .then((headers) => {
          assert.deepEqual(headers, {
            'X-Api-Key': 'gateway-key',
            'X-Workspace-Id': 'ws-test',
            'X-User-Id': 'user-test',
            'X-Organization-Id': 'org-test',
          });
          resolve();
        })
        .catch(reject);
    });
  });
});
