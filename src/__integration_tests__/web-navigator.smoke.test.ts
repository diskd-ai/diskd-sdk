import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const WEB_NAV_URL = process.env.WEB_NAV_URL;

const makeWebNav = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ apiKey: check.env.apiKey, workspaceId: check.env.workspaceId });
  return diskd.utils.webNavigator({ auth, ...(WEB_NAV_URL ? { url: WEB_NAV_URL } : {}) });
};

// -- Resolve --

test('integration: webNavigator.resolve extracts page metadata', { skip: skipReason }, async () => {
  const webNav = makeWebNav();
  const result = await webNav.resolve({ url: 'https://example.com' });
  assert.ok(result);
  assert.equal(typeof result.dbname, 'string');
});
