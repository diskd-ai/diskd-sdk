import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const TG_USERBOT_URL = process.env.TG_USERBOT_URL;

const makeTg = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ workspaceId: check.env.workspaceId });
  return diskd.utils.tgUserBot({ auth, ...(TG_USERBOT_URL ? { url: TG_USERBOT_URL } : {}) });
};

// -- Channels --

test('integration: tgUserbot.channels.list returns channel array', {
  skip: skipReason,
}, async () => {
  const tg = makeTg();
  const list = await tg.channels.list();
  assert.ok(Array.isArray(list));
});

// -- Tasks --

test('integration: tgUserbot.tasks.list returns task list', { skip: skipReason }, async () => {
  const tg = makeTg();
  const result = await tg.tasks.list();
  assert.ok(result);
});
