// ---------------------------------------------------------------------------
// createDriveDataSource -- used internally by diskd.os.datasource()
// ---------------------------------------------------------------------------

import { createRequire } from 'node:module';
import { DataSource } from 'typeorm';
import { DriveDriver } from './DriveDriver.js';
import type { DriveDataSourceParams } from './datasourceTypes.js';

const require = createRequire(import.meta.url);

export const createDriveDataSource = (params: DriveDataSourceParams): unknown => {
  const driveOptions = {
    auth: params.auth,
    dbName: params.dbName,
    dbType: params.dbType,
    schema: params.schema,
    url: params.url,
  };

  // Temporarily intercept DriverFactory to inject DriveDriver.
  // TypeORM has no extension point for custom driver types, so we
  // monkey-patch the factory during DataSource construction only.
  const DriverFactory = require('typeorm/driver/DriverFactory').DriverFactory as {
    prototype: { create: (connection: DataSource) => unknown };
  };

  const originalCreate = DriverFactory.prototype.create;

  DriverFactory.prototype.create = (_connection: DataSource) => new DriveDriver(_connection);

  try {
    return new DataSource({
      type: 'better-sqlite3' as never,
      database: params.dbName,
      entities: params.entities ? [...params.entities] : [],
      synchronize: params.synchronize ?? false,
      logging: params.logging ?? false,
      _driveOptions: driveOptions,
    } as never);
  } finally {
    DriverFactory.prototype.create = originalCreate;
  }
};
