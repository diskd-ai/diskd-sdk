/**
 * Drive Crontab SDK -- external client example (OAuth2)
 *
 * Creates a disabled project-scoped crontab document, then reads back its
 * status and normalized jobs list.
 *
 * Environment:
 *   APIS_BASE_URL          - Gateway URL (default: https://apis.diskd.local:8080)
 *   DISKD_CREDENTIALS_PATH  - Path to OAuth2 credentials.json
 *   DISKD_PROJECT_ID        - Project ID (default: my-project)
 */
import path from 'node:path';

import { diskd } from '@diskd/sdk';

const scopes = ['openid'];
const credentialsPath =
  process.argv[2] ??
  process.env.DISKD_CREDENTIALS_PATH ??
  path.resolve(process.cwd(), 'credentials.json');

const PROJECT_ID = process.env.DISKD_PROJECT_ID ?? 'my-project';

const auth = await diskd.auth.credentials({ scopes, keyfilePath: credentialsPath });
const drive = diskd.os.drive({ version: 'v1', auth });
const crontab = diskd.platform.crontab({
  auth,
  scope: {
    scopeType: 'project',
    projectId: PROJECT_ID,
  },
});

await drive.init();
console.log('[ok] Drive initialized');

const saveResult = await crontab.createJob({
  job: {
    jobId: '01JABCD2FGH3JK4MNP5QRST6VW',
    enabled: false,
    schedule: {
      minute: '*/15',
      hour: '*',
      dayOfMonth: '*',
      month: '*',
      dayOfWeek: '*',
    },
    request: {
      method: 'POST',
      url: 'https://example.invalid/internal/echo',
      payload: {
        kind: 'json',
        value: {
          message: 'hello from @diskd/sdk',
          source: 'example',
        },
      },
    },
  },
});

console.log(`[ok] Saved crontab document (${saveResult.jobCount} job)`);
console.log(`     Updated at: ${saveResult.updatedAt}`);
console.log(`     Next run: ${saveResult.nextRunAt ?? 'none'}`);

const getResult = await crontab.get();
console.log(`[ok] Loaded document version ${getResult.document.version}`);
console.log(`     Timezone: ${getResult.document.timezone ?? '(none)'}`);

const statusResult = await crontab.getStatus();
console.log(
  `[ok] Status: ${statusResult.jobCount} job, next run ${statusResult.nextRunAt ?? 'none'}`
);

const listResult = await crontab.listJobs();
console.log(`[ok] Normalized jobs: ${listResult.items.length}`);
for (const item of listResult.items) {
  console.log(`     - ${item.jobId} ${item.method} ${item.url} enabled=${item.enabled}`);
}

console.log('\n[done] Drive crontab example completed');
