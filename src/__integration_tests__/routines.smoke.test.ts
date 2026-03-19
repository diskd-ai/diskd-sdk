import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const ROUTINES_URL = process.env.ROUTINES_URL;

const makeRoutines = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ apiKey: check.env.apiKey, workspaceId: check.env.workspaceId });
  return diskd.platform.routines({ auth, ...(ROUTINES_URL ? { url: ROUTINES_URL } : {}) });
};

const makeRoutineRuns = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ apiKey: check.env.apiKey, workspaceId: check.env.workspaceId });
  return diskd.platform.routineRuns({ auth, ...(ROUTINES_URL ? { url: ROUTINES_URL } : {}) });
};

// -- Routines list --

test('integration: routines.list returns array for profile scope', {
  skip: skipReason,
}, async () => {
  const routines = makeRoutines();
  const list = await routines.list({ scope: 'profile' });
  assert.ok(Array.isArray(list));
});

test('integration: routines.list without params returns all routines', {
  skip: skipReason,
}, async () => {
  const routines = makeRoutines();
  const list = await routines.list();
  assert.ok(Array.isArray(list));
});

// -- Routine runs --

test('integration: routineRuns.list returns runs for existing routine', {
  skip: skipReason,
}, async () => {
  const routines = makeRoutines();
  const routineRuns = makeRoutineRuns();

  const list = await routines.list();
  if (list.length === 0) return; // no routines to query runs for

  const first = list[0];
  assert.ok(first);
  const runs = await routineRuns.list({ routineSlug: first.slug });
  assert.ok(Array.isArray(runs));
});
