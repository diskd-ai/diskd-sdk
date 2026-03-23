import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const PROJECTS_URL = process.env.PROJECTS_URL;

const makeProjects = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ workspaceId: check.env.workspaceId });
  return diskd.platform.projects({ auth, ...(PROJECTS_URL ? { url: PROJECTS_URL } : {}) });
};

// -- Read operations --

test('integration: projects.list returns array', { skip: skipReason }, async () => {
  const projects = makeProjects();
  const list = await projects.list();
  assert.ok(Array.isArray(list));
});

// AI.TODO(projects): re-enable getSystem test when method is added to ProjectsClient
// test('integration: projects.getSystem returns system project', ...)

// -- Full CRUD: create → get → update → delete --

test('integration: project create → get → update → delete', { skip: skipReason }, async () => {
  const projects = makeProjects();
  const testName = `SDK Test ${Date.now()}`;

  // create
  const created = await projects.create({
    name: testName,
    description: 'Created by SDK integration test',
    icon: 'beaker',
  });
  assert.ok(created.id);
  assert.equal(created.name, testName);

  try {
    // get
    const fetched = await projects.get(created.id);
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.name, testName);

    // update
    const updated = await projects.update(created.id, {
      name: `${testName} Updated`,
      description: 'Updated by SDK integration test',
    });
    assert.equal(updated.name, `${testName} Updated`);

    // verify update
    const refetched = await projects.get(created.id);
    assert.equal(refetched.name, `${testName} Updated`);
  } finally {
    await projects.delete(created.id);
  }

  // verify deletion -- list should not contain the project
  const listAfterDelete = await projects.list();
  assert.ok(!listAfterDelete.find((p) => p.id === created.id));
});

// -- Error handling --

test('integration: projects.get with nonexistent ID throws', { skip: skipReason }, async () => {
  const projects = makeProjects();
  await assert.rejects(
    () => projects.get('00000000000000000000000000'),
    (err: Error) => {
      assert.ok(err.message.includes('404') || err.message.includes('Not Found'));
      return true;
    }
  );
});
