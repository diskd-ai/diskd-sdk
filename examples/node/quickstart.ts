import path from 'node:path';

import { diskd } from '@diskd-ai/sdk';

// Gateway route scopes for /v1/os/drive (apis-service routes.yaml required_scopes).
const scopes = ['openid', 'drive:read', 'drive:write'];
const credentialsPath =
  process.argv[2] ??
  process.env.DISKD_CREDENTIALS_PATH ??
  path.resolve(process.cwd(), 'credentials.json');

const auth = await diskd.auth.credentials({ scopes, keyfilePath: credentialsPath });
const drive = diskd.os.drive({ version: 'v1', auth });

await drive.init();
const entries = await drive.list({ path: '/' });

process.stdout.write(JSON.stringify(entries, null, 2));
process.stdout.write('\n');
