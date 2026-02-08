import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAuth } from '../auth/createAuth.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const writeTempKeyfile = async (content: unknown): Promise<string> => {
  const filePath = path.join(os.tmpdir(), `diskd-sdk-keyfile-${Date.now()}.json`);
  await fs.writeFile(filePath, JSON.stringify(content), 'utf-8');
  return filePath;
};

test('createAuth (keyfile) requests client-credentials token via discovery token_endpoint', async () => {
  const keyfilePath = await writeTempKeyfile({
    issuer: 'https://issuer.example',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    audience: 'diskd-api',
  });

  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    if (url.endsWith('/.well-known/openid-configuration')) {
      return new Response(
        JSON.stringify({
          issuer: 'https://issuer.example',
          authorization_endpoint: 'https://issuer.example/oauth2/auth',
          token_endpoint: 'https://issuer.example/oauth2/token',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.endsWith('/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'token-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'unexpected' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;
  try {
    const auth = await createAuth({ scopes: ['openid'], keyfilePath });
    const token = await auth.getAccessToken();

    assert.equal(token, 'token-123');
    assert.equal(calls[0]?.url, 'https://issuer.example/.well-known/openid-configuration');
    assert.equal(calls[1]?.url, 'https://issuer.example/oauth2/token');

    const init = calls[1]?.init;
    assert.equal(init?.method, 'POST');
    const authHeader = (init?.headers as { Authorization?: string } | undefined)?.Authorization;
    assert.equal(typeof authHeader, 'string');
    assert.ok(authHeader?.startsWith('Basic '));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
});

