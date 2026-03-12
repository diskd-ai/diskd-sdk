/**
 * TypeORM + Drive DB -- shop database example
 *
 * Demonstrates using TypeORM entities and repositories against Drive DB via
 * diskd.datasource(). All SQL is routed through Drive DB JSON-RPC; COMMIT
 * flushes WAL to S3, ROLLBACK discards uncommitted changes.
 *
 * Environment:
 *   DISKD_BASE_URL   - Drive API URL (default: https://apis.upgraide.dev:8080)
 *   DRIVE_API_KEY    - API key
 *   WORKSPACE_ID     - Workspace ID
 *
 * Run:
 *   npm run examples:build && node dist-examples/node/typeorm-drive-example.js
 */

import { createApiKeyAuth, diskd } from '../../src/index.js';
import { Entity, PrimaryColumn, Column } from 'typeorm';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DRIVE_API_KEY = process.env.DRIVE_API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';
const DRIVE_URL = process.env.DISKD_BASE_URL
  ? `${process.env.DISKD_BASE_URL}/drive/api/v1`
  : 'https://apis.upgraide.dev:8080/drive/api/v1';

const auth = createApiKeyAuth({ apiKey: DRIVE_API_KEY, workspaceId: WORKSPACE_ID });

// ---------------------------------------------------------------------------
// 1. Define TypeORM entities
// ---------------------------------------------------------------------------

@Entity({ name: 'users' })
class User {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'integer', default: 0, name: 'order_count' })
  orderCount!: number;
}

@Entity({ name: 'orders' })
class Order {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id!: string;

  @Column({ type: 'varchar', length: 26, name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  product!: string;

  @Column({ type: 'integer' })
  total!: number;
}

// ---------------------------------------------------------------------------
// 2. Create DataSource via diskd.datasource()
// ---------------------------------------------------------------------------

const ds = diskd.datasource({
  auth,
  url: DRIVE_URL,
  dbName: `shop.${WORKSPACE_ID}.typeorm-demo`,
  entities: [User, Order],
  synchronize: true,
});

console.log(`Database: shop.${WORKSPACE_ID}.typeorm-demo\n`);

// ---------------------------------------------------------------------------
// 3. Initialize (creates tables via DDL if synchronize: true)
// ---------------------------------------------------------------------------

console.log('=== 1. Initialize DataSource ===');
await ds.initialize();
console.log('[ok] DataSource initialized, tables synchronized');

// ---------------------------------------------------------------------------
// 4. Insert users via TypeORM repository
// ---------------------------------------------------------------------------

console.log('\n=== 2. Insert users ===');

const userRepo = ds.getRepository(User);
const orderRepo = ds.getRepository(Order);

await userRepo.save([
  { id: 'u1', name: 'Alice', email: 'alice@shop.io', orderCount: 0 },
  { id: 'u2', name: 'Bob', email: 'bob@shop.io', orderCount: 0 },
  { id: 'u3', name: 'Carol', email: 'carol@shop.io', orderCount: 0 },
]);

const userCount = await userRepo.count();
console.log(`[ok] Users count: ${userCount}`);

// ---------------------------------------------------------------------------
// 5. Insert orders
// ---------------------------------------------------------------------------

console.log('\n=== 3. Insert orders ===');

await orderRepo.save([
  { id: 'o1', userId: 'u1', product: 'Widget A', total: 2500 },
  { id: 'o2', userId: 'u1', product: 'Widget B', total: 1500 },
  { id: 'o3', userId: 'u2', product: 'Gadget X', total: 7500 },
  { id: 'o4', userId: 'u3', product: 'Gizmo Z', total: 4200 },
]);

const orderCount = await orderRepo.count();
console.log(`[ok] Orders count: ${orderCount}`);

// ---------------------------------------------------------------------------
// 6. findOneBy()
// ---------------------------------------------------------------------------

console.log('\n=== 4. findOneBy() -- user by id ===');

const alice = await userRepo.findOneBy({ id: 'u1' });
console.log(`[ok] Found: ${alice?.name} <${alice?.email}>`);

const missing = await userRepo.findOneBy({ id: 'u999' });
console.log(`[ok] Missing user: ${missing}`); // null

// ---------------------------------------------------------------------------
// 7. find() with order
// ---------------------------------------------------------------------------

console.log('\n=== 5. find() -- all users sorted ===');

const allUsers = await userRepo.find({ order: { name: 'ASC' } });

for (const u of allUsers) {
  console.log(`     ${u.id} -- ${u.name} <${u.email}>`);
}

// ---------------------------------------------------------------------------
// 8. findBy() -- filtered query
// ---------------------------------------------------------------------------

console.log('\n=== 6. findBy() -- orders for user u1 ===');

const aliceOrders = await orderRepo.findBy({ userId: 'u1' });

for (const o of aliceOrders) {
  console.log(`     ${o.id}: ${o.product} -- $${(o.total / 100).toFixed(2)}`);
}

// ---------------------------------------------------------------------------
// 9. Raw SQL -- join query
// ---------------------------------------------------------------------------

console.log('\n=== 7. Raw SQL -- revenue per user ===');

const summary = await ds.query(`
  SELECT u.name, COUNT(o.id) AS order_count, SUM(o.total) AS revenue
  FROM users u
  LEFT JOIN orders o ON o.user_id = u.id
  GROUP BY u.id
  ORDER BY revenue DESC
`) as ReadonlyArray<Record<string, unknown>>;

for (const row of summary) {
  const dollars = (Number(row.revenue ?? 0) / 100).toFixed(2);
  console.log(`     ${row.name}: ${row.order_count} order(s), $${dollars}`);
}

// ---------------------------------------------------------------------------
// 10. Commit -- flush WAL to S3
// ---------------------------------------------------------------------------

console.log('\n=== 8. Commit to S3 ===');

const { commitId } = await ds.driver.commit();
console.log(`[ok] commitId: ${commitId}`);

// ---------------------------------------------------------------------------
// 11. Update -- then rollback
// ---------------------------------------------------------------------------

console.log('\n=== 9. Update + rollback ===');

await userRepo.update({ id: 'u1' }, { orderCount: 2 });
const updated = await userRepo.findOneBy({ id: 'u1' });
console.log(`[ok] Alice orderCount after update: ${updated?.orderCount}`);

await ds.driver.driveRollback();
const afterRollback = await userRepo.findOneBy({ id: 'u1' });
console.log(`[ok] Alice orderCount after rollback: ${afterRollback?.orderCount} (should be 0)`);

// ---------------------------------------------------------------------------
// 12. Cleanup
// ---------------------------------------------------------------------------

console.log('\n=== 10. Cleanup ===');
await ds.destroy();
console.log('[ok] DataSource destroyed');

console.log('\n[done] TypeORM + Drive DB example completed successfully');
