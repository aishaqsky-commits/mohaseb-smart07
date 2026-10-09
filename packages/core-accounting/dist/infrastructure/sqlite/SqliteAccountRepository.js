"use strict";
// src/infrastructure/sqlite/SqliteAccountRepository.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteAccountRepository = void 0;
const Account_1 = require("../../domain/entities/Account");
class SqliteAccountRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    rowToAccount(row) {
        return Account_1.Account.reconstruct({
            id: row.id,
            tenantId: row.tenant_id,
            code: row.code,
            nameArSimple: row.name_ar_simple,
            accountType: row.account_type,
            normalBalance: row.normal_balance,
            isHeader: Boolean(row.is_header),
            isPostable: Boolean(row.is_postable),
            isActive: Boolean(row.is_active),
        });
    }
    async findById(tenantId, accountId) {
        const row = this.db
            .prepare(`SELECT * FROM accounts WHERE tenant_id = ? AND id = ?`)
            .get(tenantId, accountId);
        return row ? this.rowToAccount(row) : null;
    }
    async findByCode(tenantId, code) {
        const row = this.db
            .prepare(`SELECT * FROM accounts WHERE tenant_id = ? AND code = ?`)
            .get(tenantId, code);
        return row ? this.rowToAccount(row) : null;
    }
    async findManyByCodes(tenantId, codes) {
        if (codes.length === 0)
            return new Map();
        const uniqueCodes = [...new Set(codes)];
        const placeholders = uniqueCodes.map(() => "?").join(",");
        const rows = this.db
            .prepare(`SELECT * FROM accounts WHERE tenant_id = ? AND code IN (${placeholders})`)
            .all(tenantId, ...uniqueCodes);
        const map = new Map();
        for (const row of rows) {
            map.set(row.code, this.rowToAccount(row));
        }
        return map;
    }
    async listByTenant(tenantId) {
        const rows = this.db
            .prepare(`SELECT * FROM accounts WHERE tenant_id = ? ORDER BY code ASC`)
            .all(tenantId);
        return rows.map((row) => this.rowToAccount(row));
    }
}
exports.SqliteAccountRepository = SqliteAccountRepository;
//# sourceMappingURL=SqliteAccountRepository.js.map