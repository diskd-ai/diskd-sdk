// ---------------------------------------------------------------------------
// DriveDriver -- TypeORM driver that routes SQL through Drive DB JSON-RPC
// ---------------------------------------------------------------------------
import { AbstractSqliteDriver } from 'typeorm/driver/sqlite-abstract/AbstractSqliteDriver.js';
import { createDriveDbClient } from '../driveDb.js';
import { jsonRpcCall } from '../rpc.js';
import { DriveQueryRunner } from './DriveQueryRunner.js';
// ---------------------------------------------------------------------------
// RPC call factory (same pattern as drive.ts)
// ---------------------------------------------------------------------------
const createCallFn = (auth, rpcUrl) => {
    let nextId = 1;
    return async (method, rpcParams) => {
        const id = nextId;
        nextId += 1;
        if (auth.getRequestHeaders) {
            const headers = await auth.getRequestHeaders();
            return jsonRpcCall({ url: rpcUrl, headers, method, rpcParams, id });
        }
        const bearerToken = await auth.getAccessToken();
        return jsonRpcCall({ url: rpcUrl, bearerToken, method, rpcParams, id });
    };
};
// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
export class DriveDriver extends AbstractSqliteDriver {
    driveOptions;
    constructor(connection) {
        super(connection);
        const opts = connection.options._driveOptions;
        if (!opts) {
            throw new Error('@diskd/sdk: missing Drive options. Use diskd.os.datasource() to create the DataSource.');
        }
        this.driveOptions = opts;
        this.database = opts.dbName;
        this.treeSupport = true;
        this.transactionSupport = 'simple';
    }
    loadDependencies() {
        this.sqlite = {};
    }
    async createDatabaseConnection() {
        const rpcUrl = this.driveOptions.url.replace(/\/+$/, '');
        const call = createCallFn(this.driveOptions.auth, rpcUrl);
        const db = createDriveDbClient({ call });
        if (this.driveOptions.schema) {
            await db.create({
                name: this.driveOptions.dbName,
                schema: this.driveOptions.schema,
                checkExists: true,
                dbType: this.driveOptions.dbType,
            });
        }
        return db;
    }
    async afterConnect() { }
    async disconnect() {
        this.queryRunner = undefined;
        this.databaseConnection = undefined;
    }
    createQueryRunner(_mode) {
        if (!this.queryRunner) {
            this.queryRunner = new DriveQueryRunner(this);
        }
        return this.queryRunner;
    }
    /** Flush WAL to S3. */
    async commit() {
        const db = this.databaseConnection;
        const result = await db.commit({
            name: this.driveOptions.dbName,
            dbType: this.driveOptions.dbType,
        });
        return { commitId: result.commitId };
    }
    /** Discard uncommitted WAL changes. */
    async driveRollback() {
        const db = this.databaseConnection;
        await db.rollback({
            name: this.driveOptions.dbName,
            dbType: this.driveOptions.dbType,
        });
    }
}
