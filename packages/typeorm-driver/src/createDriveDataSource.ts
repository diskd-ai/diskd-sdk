// ---------------------------------------------------------------------------
// createDriveDataSource -- convenience factory
// ---------------------------------------------------------------------------
//
// Creates a TypeORM DataSource backed by Drive DB. Temporarily patches
// TypeORM's DriverFactory to inject DriveDriver (the standard pattern for
// custom TypeORM drivers, since TypeORM has no extension point for custom
// driver types).
// ---------------------------------------------------------------------------

import { DataSource } from 'typeorm';
import type { DriveDataSourceOptions } from './types';
import { DriveDriver } from './DriveDriver';

export const createDriveDataSource = (options: DriveDataSourceOptions): DataSource => {
  const driveOptions = {
    auth: options.auth,
    dbName: options.dbName,
    dbType: options.dbType,
    schema: options.schema,
    url: options.url,
  };

  // Temporarily intercept DriverFactory to inject our custom driver.
  // Restore immediately after DataSource construction.
  const DriverFactory =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('typeorm/driver/DriverFactory').DriverFactory as {
      prototype: { create: (connection: DataSource) => unknown };
    };

  const originalCreate = DriverFactory.prototype.create;

  DriverFactory.prototype.create = function (_connection: DataSource) {
    return new DriveDriver(_connection);
  };

  try {
    return new DataSource({
      type: 'better-sqlite3' as never,
      database: options.dbName,
      entities: options.entities ? [...options.entities] : [],
      synchronize: options.synchronize ?? false,
      logging: options.logging ?? false,
      _driveOptions: driveOptions,
    } as never);
  } finally {
    DriverFactory.prototype.create = originalCreate;
  }
};
