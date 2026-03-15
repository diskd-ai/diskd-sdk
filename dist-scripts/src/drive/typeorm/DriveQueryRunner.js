// ---------------------------------------------------------------------------
// DriveQueryRunner -- routes SQL through Drive DB JSON-RPC
// ---------------------------------------------------------------------------
import { QueryResult } from 'typeorm';
import { AbstractSqliteQueryRunner } from 'typeorm/driver/sqlite-abstract/AbstractSqliteQueryRunner.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TRANSACTION_BEGIN = /^(BEGIN(\s+TRANSACTION)?|SAVEPOINT\s)/i;
const TRANSACTION_COMMIT = /^(COMMIT|RELEASE\s)/i;
const TRANSACTION_ROLLBACK = /^(ROLLBACK(\s+TO)?)\b/i;
const DML_PREFIX = /^\s*(INSERT|UPDATE|DELETE)\b/i;
const emptyQueryResult = () => {
    const r = new QueryResult();
    r.raw = [];
    r.records = [];
    return r;
};
// ---------------------------------------------------------------------------
// QueryRunner
// ---------------------------------------------------------------------------
export class DriveQueryRunner extends AbstractSqliteQueryRunner {
    constructor(driver) {
        super();
        this.driver = driver;
    }
    get db() {
        return this.driver.databaseConnection;
    }
    get dbName() {
        return this.driver.driveOptions.dbName;
    }
    get dbType() {
        return this.driver.driveOptions.dbType;
    }
    async connect() { }
    async release() { }
    async query(sql, parameters, useStructuredResult) {
        const trimmed = sql.trim();
        if (TRANSACTION_BEGIN.test(trimmed)) {
            return useStructuredResult ? emptyQueryResult() : [];
        }
        if (TRANSACTION_COMMIT.test(trimmed)) {
            await this.db.commit({ name: this.dbName, dbType: this.dbType });
            return useStructuredResult ? emptyQueryResult() : [];
        }
        if (TRANSACTION_ROLLBACK.test(trimmed)) {
            await this.db.rollback({ name: this.dbName, dbType: this.dbType });
            return useStructuredResult ? emptyQueryResult() : [];
        }
        const queryResult = await this.db.query({
            name: this.dbName,
            sql,
            parameters: parameters && parameters.length > 0 ? parameters : undefined,
            dbType: this.dbType,
        });
        const rows = queryResult.rows;
        const isDml = DML_PREFIX.test(trimmed);
        if (useStructuredResult) {
            const result = new QueryResult();
            result.records = rows;
            result.raw = isDml ? 0 : rows;
            if (isDml) {
                result.affected = 0;
            }
            return result;
        }
        if (isDml) {
            return { changes: 0, lastInsertRowid: 0 };
        }
        return rows;
    }
    async beforeMigration() { }
    async afterMigration() { }
}
