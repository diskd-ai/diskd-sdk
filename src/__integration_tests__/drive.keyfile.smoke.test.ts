import assert from 'node:assert/strict';
import test from 'node:test';

import { diskd } from '../index.js';

const credentialsPath = process.env.DISKD_CREDENTIALS_PATH;
const baseUrl = process.env.APIS_BASE_URL;

const skipReason =
  !credentialsPath || credentialsPath.trim().length === 0
    ? 'Set DISKD_CREDENTIALS_PATH to run integration tests'
    : !baseUrl || baseUrl.trim().length === 0
      ? 'Set APIS_BASE_URL to run integration tests'
      : false;

test('integration: drive.init + drive.list via keyfile', { skip: skipReason }, async () => {
  const auth = await diskd.auth.credentials({
    scopes: ['openid'],
    keyfilePath: credentialsPath as string,
  });

  const drive = diskd.os.drive({ version: 'v1', auth });
  await drive.init();

  const entries = await drive.list({ path: '/' });
  assert.ok(Array.isArray(entries));
});
