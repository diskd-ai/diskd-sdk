import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const MCP_HUB_URL = process.env.MCP_HUB_URL;

const makeMcp = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ apiKey: check.env.apiKey, workspaceId: check.env.workspaceId });
  return diskd.os.mcp({ auth, ...(MCP_HUB_URL ? { url: MCP_HUB_URL } : {}) });
};

// -- Catalog --

test('integration: mcp.catalog.list returns paginated results', { skip: skipReason }, async () => {
  const mcp = makeMcp();
  const result = await mcp.catalog.list();
  assert.ok(Array.isArray(result.items));
  assert.equal(typeof result.total, 'number');
  assert.equal(typeof result.page, 'number');
  assert.equal(typeof result.totalPages, 'number');
});

test('integration: mcp.catalog.list supports pagination', { skip: skipReason }, async () => {
  const mcp = makeMcp();
  const page1 = await mcp.catalog.list({ page: 1, pageSize: 2 });
  assert.ok(page1.items.length <= 2);
  assert.equal(page1.page, 1);
});

test('integration: mcp.catalog.list supports search', { skip: skipReason }, async () => {
  const mcp = makeMcp();
  const result = await mcp.catalog.list({ search: 'github' });
  assert.ok(Array.isArray(result.items));
});

test('integration: mcp.catalog.getServerDetails returns details for a catalog server', {
  skip: skipReason,
}, async () => {
  const mcp = makeMcp();
  const list = await mcp.catalog.list({ pageSize: 1 });
  if (list.items.length === 0) return;

  const server = list.items[0];
  assert.ok(server);
  const details = await mcp.catalog.getServerDetails(server.id);
  assert.equal(details.id, server.id);
  assert.equal(typeof details.name, 'string');
});

// -- Registry --

test('integration: mcp.registry.list returns installed servers', { skip: skipReason }, async () => {
  const mcp = makeMcp();
  const result = await mcp.registry.list();
  assert.ok(result);
});
