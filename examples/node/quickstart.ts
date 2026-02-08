import path from 'node:path';

import { createAuth, diskd } from '@diskd/sdk';

const scopes = ['openid'];
const credentialsPath =
  process.argv[2] ??
  process.env.DISKD_CREDENTIALS_PATH ??
  path.resolve(process.cwd(), 'credentials.json');

const auth = await createAuth({ scopes, keyfilePath: credentialsPath });
const drive = diskd.drive({ version: 'v1', auth });

await drive.init();
const entries = await drive.list({ path: '/' });

process.stdout.write(JSON.stringify(entries, null, 2));
process.stdout.write('\n');

