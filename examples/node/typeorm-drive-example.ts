// ---------------------------------------------------------------------------
// TypeORM + Drive DB example
// ---------------------------------------------------------------------------
//
// Demonstrates using TypeORM entities and repositories against Drive DB via
// the @diskd/typeorm-driver package. All SQL is routed through Drive DB
// JSON-RPC; COMMIT flushes WAL to S3, ROLLBACK discards uncommitted changes.
//
// Usage:
//   DRIVE_API_KEY=... WORKSPACE_ID=... npx ts-node examples/node/typeorm-drive-example.ts
// ---------------------------------------------------------------------------

import { createApiKeyAuth } from '../../src/index.js';
import { Entity, PrimaryColumn, Column, DataSource } from 'typeorm';

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

@Entity({ name: 'users' })
class User {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'integer', default: 0 })
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
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const apiKey = process.env.DRIVE_API_KEY;
  const workspaceId = process.env.WORKSPACE_ID;
  if (!apiKey || !workspaceId) {
    console.error('Set DRIVE_API_KEY and WORKSPACE_ID');
    process.exit(1);
  }

  const auth = createApiKeyAuth({ apiKey, workspaceId });
  const driveUrl =
    process.env.DRIVE_URL ?? 'https://apis.upgraide.me/drive/api/v1';
  const dbName = `shop.${workspaceId}.typeorm-demo`;

  // -- The createDriveDataSource factory is in @diskd/typeorm-driver.
  // -- For this example we import it relatively from the packages/ dir.
  const { createDriveDataSource } = await import(
    '../../packages/typeorm-driver/src/createDriveDataSource.js'
  );
  const { DriveDriver } = await import(
    '../../packages/typeorm-driver/src/DriveDriver.js'
  );

  // Create DataSource backed by Drive DB
  const dataSource: DataSource = createDriveDataSource({
    auth,
    url: driveUrl,
    dbName,
    entities: [User, Order],
    synchronize: true,
    logging: true,
  });

  console.log('--- Initializing DataSource ---');
  await dataSource.initialize();

  // -- TypeORM repositories --------------------------------------------- //

  const userRepo = dataSource.getRepository(User);
  const orderRepo = dataSource.getRepository(Order);

  // Insert users
  console.log('\n--- Inserting users ---');
  await userRepo.save({ id: 'u1', name: 'Alice', email: 'alice@shop.io', orderCount: 0 });
  await userRepo.save({ id: 'u2', name: 'Bob', email: 'bob@shop.io', orderCount: 0 });
  await userRepo.save({ id: 'u3', name: 'Carol', email: 'carol@shop.io', orderCount: 0 });

  // Insert orders
  console.log('\n--- Inserting orders ---');
  await orderRepo.save({ id: 'o1', userId: 'u1', product: 'Widget A', total: 2500 });
  await orderRepo.save({ id: 'o2', userId: 'u1', product: 'Widget B', total: 1500 });
  await orderRepo.save({ id: 'o3', userId: 'u2', product: 'Gadget X', total: 7500 });

  // Query
  console.log('\n--- Querying ---');
  const alice = await userRepo.findOneBy({ id: 'u1' });
  console.log('Alice:', alice);

  const allUsers = await userRepo.find({ order: { name: 'ASC' } });
  console.log('All users:', allUsers);

  const aliceOrders = await orderRepo.findBy({ userId: 'u1' });
  console.log('Alice orders:', aliceOrders);

  // Raw SQL join
  console.log('\n--- Raw SQL ---');
  const summary = await dataSource.query(`
    SELECT u.name, COUNT(o.id) AS order_count, SUM(o.total) AS revenue
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.id
    ORDER BY revenue DESC
  `);
  console.log('Revenue summary:', summary);

  // Commit to S3
  console.log('\n--- Committing to S3 ---');
  const driver = dataSource.driver;
  if (driver instanceof DriveDriver) {
    const { commitId } = await driver.commit();
    console.log('Committed:', commitId);
  }

  // Update
  console.log('\n--- Updating ---');
  await userRepo.update({ id: 'u1' }, { orderCount: 2 });
  const updated = await userRepo.findOneBy({ id: 'u1' });
  console.log('Alice after update:', updated);

  // Rollback uncommitted changes
  console.log('\n--- Rolling back ---');
  if (driver instanceof DriveDriver) {
    await driver.driveRollback();
    const afterRollback = await userRepo.findOneBy({ id: 'u1' });
    console.log('Alice after rollback (orderCount should be 0):', afterRollback);
  }

  // Cleanup
  console.log('\n--- Cleanup ---');
  await dataSource.destroy();
  console.log('Done.');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
