/* REQUIREMENT ADR-027: API-key auth must fail fast when APIS_API_KEY or APIS_BASE_URL is missing from the gateway contract. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiKeyAuth } from '../auth/createApiKeyAuth.js';

const withApisBaseUrl = (value: string | undefined, fn: () => void): void => {
  const previous = process.env.APIS_BASE_URL;
  if (value === undefined) {
    delete process.env.APIS_BASE_URL;
  } else {
    process.env.APIS_BASE_URL = value;
  }

  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete process.env.APIS_BASE_URL;
    } else {
      process.env.APIS_BASE_URL = previous;
    }
  }
};

test('createApiKeyAuth rejects empty api keys', () => {
  withApisBaseUrl('https://apis.example', () => {
    assert.throws(
      () => createApiKeyAuth({ apiKey: '', workspaceId: 'ws-test' }),
      /APIS_API_KEY is not set\./
    );
  });
});

test('createApiKeyAuth rejects missing APIS_BASE_URL', () => {
  withApisBaseUrl(undefined, () => {
    assert.throws(
      () => createApiKeyAuth({ apiKey: 'gateway-key', workspaceId: 'ws-test' }),
      /APIS_BASE_URL is not set\./
    );
  });
});
