/**
 * Drive DB Repository -- shop database example
 *
 * Demonstrates diskd.repository() with generic CRUD operations:
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
// 2. Create repository via diskd.repository()
// ---------------------------------------------------------------------------

const shop = diskd.repository({
  auth,
  dbName: `shop.${WORKSPACE_ID}.main`,
  dbType: 'database',
  schema: shopSchema,
});

console.log(`Database: ${shop.dbName}\n`);

// ---------------------------------------------------------------------------
// 3. Create database (idempotent)
// ---------------------------------------------------------------------------

console.log('=== 1. Create shop database ===');
const { dbInode, fileId } = await shop.ensureCreated();
console.log(`[ok] Created -- inode: ${dbInode}, fileId: ${fileId}`);

// ---------------------------------------------------------------------------
// 4. Insert users
// ---------------------------------------------------------------------------

console.log('\n=== 2. Insert users ===');

await shop.insert('users', [
  { id: 'u1', name: 'Alice', email: 'alice@example.com', created_at: new Date().toISOString() },
  { id: 'u2', name: 'Bob', email: 'bob@example.com', created_at: new Date().toISOString() },
  { id: 'u3', name: 'Charlie', email: 'charlie@example.com', created_at: new Date().toISOString() },
]);

console.log(`[ok] Users count: ${await shop.count('users')}`);

// ---------------------------------------------------------------------------
// 5. Insert orders
// ---------------------------------------------------------------------------

console.log('\n=== 3. Insert orders ===');

const { inserted } = await shop.insert('orders', [
  { id: 'o1', user_id: 'u1', product: 'Widget', quantity: 2, price_cents: 1500, status: 'completed', created_at: new Date().toISOString() },
  { id: 'o2', user_id: 'u1', product: 'Gadget', quantity: 1, price_cents: 3200, status: 'pending', created_at: new Date().toISOString() },
  { id: 'o3', user_id: 'u2', product: 'Widget', quantity: 5, price_cents: 1500, status: 'completed', created_at: new Date().toISOString() },
  { id: 'o4', user_id: 'u3', product: 'Gizmo', quantity: 1, price_cents: 8900, status: 'shipped', created_at: new Date().toISOString() },
]);

console.log(`[ok] Inserted ${inserted} order(s)`);

// ---------------------------------------------------------------------------
// 6. find() -- list all users sorted by name
// ---------------------------------------------------------------------------

console.log('\n=== 4. find() -- all users ===');

const allUsers = await shop.find('users', {
  orderBy: { column: 'name', direction: 'ASC' },
});

for (const u of allUsers) {
  console.log(`     ${u.id} -- ${u.name} <${u.email}>`);
}

// ---------------------------------------------------------------------------
// 7. find() with where + limit
// ---------------------------------------------------------------------------

console.log('\n=== 5. find() -- completed orders (limit 2) ===');

const completedOrders = await shop.find('orders', {
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

const alice = await shop.findOne('users', { id: 'u1' });
console.log(`[ok] Found: ${alice?.name} <${alice?.email}>`);

const missing = await shop.findOne('users', { id: 'u999' });
console.log(`[ok] Missing user: ${missing}`);  // null

// ---------------------------------------------------------------------------
// 9. count()
// ---------------------------------------------------------------------------

console.log('\n=== 7. count() ===');

const totalOrders = await shop.count('orders');
const pendingOrders = await shop.count('orders', { status: 'pending' });
console.log(`[ok] Total orders: ${totalOrders}, pending: ${pendingOrders}`);

// ---------------------------------------------------------------------------
// 10. update()
// ---------------------------------------------------------------------------

console.log('\n=== 8. update() -- ship pending order ===');

const { changes } = await shop.update('orders', {
  where: { id: 'o2', status: 'pending' },
  set: { status: 'shipped' },
});

console.log(`[ok] Updated ${changes} row(s)`);

const updated = await shop.findOne('orders', { id: 'o2' });
console.log(`     Order o2 status: ${updated?.status}`);

// ---------------------------------------------------------------------------
// 11. deleteRows()
// ---------------------------------------------------------------------------

console.log('\n=== 9. deleteRows() -- remove shipped orders ===');

const deleted = await shop.deleteRows('orders', { status: 'shipped' });
console.log(`[ok] Deleted ${deleted.changes} row(s)`);
console.log(`     Remaining orders: ${await shop.count('orders')}`);

// ---------------------------------------------------------------------------
// 12. Raw SQL -- join query with parameters
// ---------------------------------------------------------------------------

console.log('\n=== 10. Raw SQL -- orders per user ===');

const summary = await shop.query(`
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
// 13. Commit (flush WAL to S3)
// ---------------------------------------------------------------------------

console.log('\n=== 11. Commit ===');

const { commitId } = await shop.commit();
console.log(`[ok] Committed -- commitId: ${commitId}`);

// ---------------------------------------------------------------------------
// 14. Metadata
// ---------------------------------------------------------------------------

console.log('\n=== 12. Database metadata ===');

const meta = await shop.metadata();
console.log(`[ok] ${meta.displayName}: ${meta.recordCount} records, ${meta.sizeBytes} bytes`);

// ---------------------------------------------------------------------------
// 15. Clean up
// ---------------------------------------------------------------------------

console.log('\n=== 13. Drop database ===');

const dropResult = await shop.drop();
console.log(`[ok] Dropped: deletedFromMetadata=${dropResult.deletedFromMetadata}`);

console.log('\n[done] Shop database example completed successfully');
