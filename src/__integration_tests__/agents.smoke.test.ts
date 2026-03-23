import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const AGENT_HUB_URL = process.env.AGENT_HUB_URL;

const makeAgents = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ workspaceId: check.env.workspaceId });
  return diskd.os.agents({ auth, ...(AGENT_HUB_URL ? { url: AGENT_HUB_URL } : {}) });
};

// -- Agent listing --

test('integration: agents.list returns agent info array', { skip: skipReason }, async () => {
  const agents = makeAgents();
  const list = await agents.agents.list();
  assert.ok(Array.isArray(list));
});

// -- Supported models --

test('integration: agents.getSupportedModels returns models for each agent', {
  skip: skipReason,
}, async () => {
  const agents = makeAgents();
  const list = await agents.agents.list();
  if (list.length === 0) return;

  const first = list[0];
  assert.ok(first);
  const models = await agents.agents.getSupportedModels(first.id);
  assert.ok(models);
});

// -- Billing aliases --

test('integration: agents.billing.getAliases returns billing info', {
  skip: skipReason,
}, async () => {
  const agents = makeAgents();
  const aliases = await agents.billing.getAliases();
  assert.ok(aliases);
});
