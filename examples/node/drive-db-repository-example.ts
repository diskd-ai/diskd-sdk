/**
 * Drive DB Repository -- shop database example
 *
 * Demonstrates diskd.database() with table-scoped repository CRUD:
 * insert, find, findOne, count, update, deleteRows, plus raw SQL queries.
 *
 * Environment:
 *   DISKD_BASE_URL   - Drive API URL (default: https://apis.upgraide.dev:8080)
 *   DRIVE_API_KEY    - API key
 *   WORKSPACE_ID     - Workspace ID
 *
 * Run:
 *   npm run examples:build && node dist-examples/node/drive-db-repository-example.js
 */

import { createApiKeyAuth } from '../../src/auth/createApiKeyAuth.js';
import { diskd } from '../../src/sdk/diskd.js';
import type { DriveDbSchema } from '../../src/drive/driveDbTypes.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DRIVE_API_KEY = process.env.DRIVE_API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';

const auth = createApiKeyAuth({ apiKey: DRIVE_API_KEY, workspaceId: WORKSPACE_ID });

// ---------------------------------------------------------------------------
// 1. Define shop database schema
// ---------------------------------------------------------------------------

const shopSchema: DriveDbSchema = {
  users: {
    id:         { type: 'TEXT', primaryKey: true },
    name:       { type: 'TEXT', notNull: true },
    email:      { type: 'TEXT', notNull: true },
    created_at: { type: 'TEXT', notNull: true },
  },
  orders: {
    id:          { type: 'TEXT', primaryKey: true },
    user_id:     { type: 'TEXT', notNull: true },
    product:     { type: 'TEXT', notNull: true },
    quantity:    { type: 'INTEGER', notNull: true },
    price_cents: { type: 'INTEGER', notNull: true },
    status:      { type: 'TEXT', notNull: true, defaultValue: 'pending' },
    created_at:  { type: 'TEXT', notNull: true },
  },
};

// ---------------------------------------------------------------------------
// 2. Create database + table-scoped repositories
// ---------------------------------------------------------------------------

const db = diskd.database({
  auth,
  dbName: `shop.${WORKSPACE_ID}.main`,
  dbType: 'database',
  schema: shopSchema,
});

const users = db.repository('users');
const orders = db.repository('orders');

console.log(`Database: ${db.dbName}\n`);

// ---------------------------------------------------------------------------
// 3. Create database (idempotent)
// ---------------------------------------------------------------------------

console.log('=== 1. Create shop database ===');
const { dbInode, fileId } = await db.ensureCreated();
console.log(`[ok] Created -- inode: ${dbInode}, fileId: ${fileId}`);

// ---------------------------------------------------------------------------
// 4. Insert users via repository
// ---------------------------------------------------------------------------

console.log('\n=== 2. Insert users ===');

await users.insert([
  { id: 'u1', name: 'Alice', email: 'alice@example.com', created_at: new Date().toISOString() },
  { id: 'u2', name: 'Bob', email: 'bob@example.com', created_at: new Date().toISOString() },
  { id: 'u3', name: 'Charlie', email: 'charlie@example.com', created_at: new Date().toISOString() },
]);

console.log(`[ok] Users count: ${await users.count()}`);

// ---------------------------------------------------------------------------
// 5. Insert orders via repository
// ---------------------------------------------------------------------------

console.log('\n=== 3. Insert orders ===');

const { inserted } = await orders.insert([
  { id: 'o1', user_id: 'u1', product: 'Widget', quantity: 2, price_cents: 1500, status: 'completed', created_at: new Date().toISOString() },
  { id: 'o2', user_id: 'u1', product: 'Gadget', quantity: 1, price_cents: 3200, status: 'pending', created_at: new Date().toISOString() },
  { id: 'o3', user_id: 'u2', product: 'Widget', quantity: 5, price_cents: 1500, status: 'completed', created_at: new Date().toISOString() },
  { id: 'o4', user_id: 'u3', product: 'Gizmo', quantity: 1, price_cents: 8900, status: 'shipped', created_at: new Date().toISOString() },
]);

console.log(`[ok] Inserted ${inserted} order(s)`);

// ---------------------------------------------------------------------------
// 6. find() -- all users sorted by name
// ---------------------------------------------------------------------------

console.log('\n=== 4. find() -- all users ===');

const allUsers = await users.find({
  orderBy: { column: 'name', direction: 'ASC' },
});

for (const u of allUsers) {
  console.log(`     ${u.id} -- ${u.name} <${u.email}>`);
}

// ---------------------------------------------------------------------------
// 7. find() with where + limit
// ---------------------------------------------------------------------------

console.log('\n=== 5. find() -- completed orders (limit 2) ===');

const completedOrders = await orders.find({
  where: { status: 'completed' },
  orderBy: { column: 'created_at', direction: 'DESC' },
  limit: 2,
});

for (const o of completedOrders) {
  console.log(`     ${o.id}: ${o.product} x${o.quantity}`);
}

// ---------------------------------------------------------------------------
// 8. findOne()
// ---------------------------------------------------------------------------

console.log('\n=== 6. findOne() -- user by id ===');

const alice = await users.findOne({ id: 'u1' });
console.log(`[ok] Found: ${alice?.name} <${alice?.email}>`);

const missing = await users.findOne({ id: 'u999' });
console.log(`[ok] Missing user: ${missing}`);  // null

// ---------------------------------------------------------------------------
// 9. count()
// ---------------------------------------------------------------------------

console.log('\n=== 7. count() ===');

const totalOrders = await orders.count();
const pendingOrders = await orders.count({ status: 'pending' });
console.log(`[ok] Total orders: ${totalOrders}, pending: ${pendingOrders}`);

// ---------------------------------------------------------------------------
// 10. update()
// ---------------------------------------------------------------------------

console.log('\n=== 8. update() -- ship pending order ===');

await orders.update({
  where: { id: 'o2', status: 'pending' },
  set: { status: 'shipped' },
});

const updated = await orders.findOne({ id: 'o2' });
console.log(`[ok] Order o2 status: ${updated?.status}`);

// ---------------------------------------------------------------------------
// 11. deleteRows()
// ---------------------------------------------------------------------------

console.log('\n=== 9. deleteRows() -- remove shipped orders ===');

await orders.deleteRows({ status: 'shipped' });
console.log(`[ok] Remaining orders: ${await orders.count()}`);

// ---------------------------------------------------------------------------
// 12. Raw SQL on database level -- join query
// ---------------------------------------------------------------------------

console.log('\n=== 10. Raw SQL -- orders per user ===');

const summary = await db.query(`
  SELECT u.name, COUNT(o.id) AS order_count, SUM(o.quantity * o.price_cents) AS total_cents
  FROM users u
  LEFT JOIN orders o ON o.user_id = u.id
  GROUP BY u.id
  ORDER BY total_cents DESC
`);

for (const row of summary) {
  const totalDollars = (Number(row.total_cents ?? 0) / 100).toFixed(2);
  console.log(`     ${row.name}: ${row.order_count} order(s), $${totalDollars}`);
}

// ---------------------------------------------------------------------------
// 13. Commit + metadata
// ---------------------------------------------------------------------------

console.log('\n=== 11. Commit ===');
const { commitId } = await db.commit();
console.log(`[ok] commitId: ${commitId}`);

console.log('\n=== 12. Metadata ===');
const meta = await db.metadata();
console.log(`[ok] ${meta.displayName}: ${meta.recordCount} records, ${meta.sizeBytes} bytes`);

// ---------------------------------------------------------------------------
// 14. Clean up
// ---------------------------------------------------------------------------

console.log('\n=== 13. Drop database ===');
const dropResult = await db.drop();
console.log(`[ok] Dropped: deletedFromMetadata=${dropResult.deletedFromMetadata}`);

console.log('\n[done] Shop database example completed successfully');
