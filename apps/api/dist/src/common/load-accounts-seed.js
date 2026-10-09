"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSeedAccounts = loadSeedAccounts;
exports.seedAccountsIntoSqlite = seedAccountsIntoSqlite;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const NORMAL_BALANCE = {
    asset: 'debit',
    expense: 'debit',
    liability: 'credit',
    equity: 'credit',
    revenue: 'credit',
};
function loadSeedAccounts(scope) {
    const seedsRoot = path.dirname(require.resolve('@platform/chart-of-accounts/seeds/core.seed.json'));
    const files = ['core.seed.json'];
    const scoped = `${scope}.seed.json`;
    if (scope !== 'core' && fs.existsSync(path.join(seedsRoot, scoped)))
        files.push(scoped);
    const seen = new Set();
    const accounts = [];
    for (const file of files) {
        const raw = JSON.parse(fs.readFileSync(path.join(seedsRoot, file), 'utf-8'));
        for (const a of raw.accounts) {
            if (seen.has(a.code))
                continue;
            seen.add(a.code);
            accounts.push(a);
        }
    }
    if (accounts.length === 0) {
        throw new Error('لم يُعثر على بذور شجرة الحسابات — تحقّق من @platform/chart-of-accounts');
    }
    return accounts;
}
function seedAccountsIntoSqlite(db, tenantId, scope) {
    const accounts = loadSeedAccounts(scope);
    const insert = db.prepare(`
    INSERT OR IGNORE INTO accounts
      (id, tenant_id, code, name_ar_simple, account_type, normal_balance, is_header, is_postable, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
    const tx = db.transaction(() => {
        for (const a of accounts) {
            insert.run(`acct_${tenantId}_${a.code}`, tenantId, a.code, a.name_ar_simple, a.account_type, NORMAL_BALANCE[a.account_type], a.is_header ? 1 : 0, a.is_postable ? 1 : 0);
        }
    });
    tx();
    return accounts.length;
}
//# sourceMappingURL=load-accounts-seed.js.map