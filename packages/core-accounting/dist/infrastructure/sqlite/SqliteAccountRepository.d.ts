import Database from "better-sqlite3";
import { Account } from "../../domain/entities/Account";
import { AccountRepository } from "../../domain/ports/AccountRepository";
export declare class SqliteAccountRepository implements AccountRepository {
    private readonly db;
    constructor(db: Database.Database);
    private rowToAccount;
    findById(tenantId: string, accountId: string): Promise<Account | null>;
    findByCode(tenantId: string, code: string): Promise<Account | null>;
    findManyByCodes(tenantId: string, codes: string[]): Promise<Map<string, Account>>;
}
