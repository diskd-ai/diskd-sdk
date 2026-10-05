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

/* REQ-keyfile-drive-scopes-001: an OAuth2 keyfile client that requests the /v1/os/drive route scopes can init Drive and list its root through the gateway. */
test('integration: drive.init + drive.list via keyfile', { skip: skipReason }, async () => {
  const auth = await diskd.auth.credentials({
    // Gateway route scopes for /v1/os/drive (apis-service routes.yaml required_scopes),
    // so the smoke test keeps passing once the gateway enforces route scopes.
    scopes: ['openid', 'drive:read', 'drive:write'],
    keyfilePath: credentialsPath as string,
  });

  const drive = diskd.os.drive({ version: 'v1', auth });
  await drive.init();

  const entries = await drive.list({ path: '/' });
  assert.ok(Array.isArray(entries));
});
