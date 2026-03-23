import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const EVENTS_URL = process.env.PLATFORM_EVENTS_URL;
// No default URL -- platform events may not be available in all setups
const skipEvents =
  skipReason || (!EVENTS_URL ? 'Set PLATFORM_EVENTS_URL to run platform events tests' : false);

test('integration: platformEvents.publish sends event', { skip: skipEvents }, async () => {
  if (check.tag !== 'Ready' || !EVENTS_URL) return;
  const auth = diskd.auth.apiKey({ workspaceId: check.env.workspaceId });
  const events = diskd.platform.events({ auth, url: EVENTS_URL });

  const result = await events.publish({
    subject: 'sdk.integration.test',
    data: { timestamp: Date.now(), source: 'sdk-integration-test' },
  });
  assert.ok(result);
});
