/**
 * Drive Crontab SDK -- external client example (OAuth2)
 *
 * Creates a disabled project-scoped crontab document, then reads back its
 * status and normalized jobs list.
 *
 * Environment:
 *   DISKD_BASE_URL          - Gateway URL (default: https://apis.diskd.local:8080)
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
const drive = diskd.drive({ version: 'v1', auth });
const crontab = diskd.crontab({ auth });

await drive.init();
console.log('[ok] Drive initialized');

const scope = {
  scopeType: 'project' as const,
  projectId: PROJECT_ID,
};

const saveResult = await crontab.createProjectJob({
  projectId: PROJECT_ID,
  timezone: 'UTC',
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

const getResult = await crontab.get({ scope });
console.log(`[ok] Loaded document version ${getResult.document.version}`);
console.log(`     Timezone: ${getResult.document.timezone ?? '(none)'}`);

const statusResult = await crontab.getStatus({ scope });
console.log(`[ok] Status: ${statusResult.jobCount} job, next run ${statusResult.nextRunAt ?? 'none'}`);

const listResult = await crontab.listJobs({ scope });
console.log(`[ok] Normalized jobs: ${listResult.items.length}`);
for (const item of listResult.items) {
  console.log(`     - ${item.jobId} ${item.method} ${item.url} enabled=${item.enabled}`);
}

console.log('\n[done] Drive crontab example completed');
