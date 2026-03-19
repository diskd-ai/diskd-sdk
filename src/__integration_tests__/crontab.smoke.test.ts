import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const DRIVE_API_URL = process.env.DRIVE_API_URL;

const makeCrontab = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ apiKey: check.env.apiKey, workspaceId: check.env.workspaceId });
  return diskd.platform.crontab({
    auth,
    scope: { scopeType: 'profile' },
    timezone: 'UTC',
    ...(DRIVE_API_URL ? { url: DRIVE_API_URL } : {}),
  });
};

// -- Full lifecycle: save → getStatus → listJobs → get --

test('integration: crontab save → getStatus → listJobs → get', {
  skip: skipReason,
}, async () => {
  const crontab = makeCrontab();

  // save an empty crontab to ensure it exists
  const saveResult = await crontab.save({ jobs: [] });
  assert.equal(typeof saveResult.jobCount, 'number');

  // getStatus
  const status = await crontab.getStatus();
  assert.equal(typeof status.jobCount, 'number');

  // listJobs
  const jobs = await crontab.listJobs();
  assert.ok(Array.isArray(jobs.items));

  // get
  const doc = await crontab.get();
  assert.ok(doc);
});
