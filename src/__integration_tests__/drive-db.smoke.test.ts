import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const DRIVE_API_URL = process.env.DRIVE_API_URL;
const DB_NAME = `sdk_test_${Date.now()}`;

const makeDrive = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ workspaceId: check.env.workspaceId });
  return diskd.os.drive({ version: 'v1', auth, ...(DRIVE_API_URL ? { url: DRIVE_API_URL } : {}) });
};

// -- Database lifecycle via low-level drive.db --

test('integration: drive.db create → insert → query → commit → drop', {
  skip: skipReason,
}, async () => {
  const drive = makeDrive();

  // create database with SQL schema
  const created = await drive.db.create({
    name: DB_NAME,
    schema: {
      items: {
        id: { type: 'TEXT', primaryKey: true },
        title: { type: 'TEXT' },
        count: { type: 'INTEGER' },
      },
    },
  });
  assert.ok(created.dbInode);

  try {
    // insert
    await drive.db.insert({
      name: DB_NAME,
      table: 'items',
      rows: [
        { id: '1', title: 'First', count: 10 },
        { id: '2', title: 'Second', count: 20 },
      ],
    });

    // query
    const queryResult = await drive.db.query({
      name: DB_NAME,
      sql: 'SELECT id, title, count FROM items ORDER BY id',
    });
    assert.equal(queryResult.rows.length, 2);

    // commit
    const commitResult = await drive.db.commit({ name: DB_NAME });
    assert.ok(commitResult.commitId);

    // metadata
    const meta = await drive.db.metadata({ name: DB_NAME });
    assert.ok(meta.inode);
  } finally {
    await drive.db.drop({ name: DB_NAME });
  }
});
