// src/common/load-accounts-seed.ts
// ===== مشغّل بذور شجرة الحسابات (@platform/chart-of-accounts) =====
// يحمّل بذور core + نطاق النشاط ويزرعها في SQLite بشكل idempotent (INSERT OR IGNORE).

import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';

interface SeedAccount {
  code: string;
  parent_code: string | null;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  name_ar_simple: string;
  is_header: boolean;
  is_postable: boolean;
}

const NORMAL_BALANCE: Record<SeedAccount['account_type'], 'debit' | 'credit'> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
};

/** تحميل حسابات بذرة core ثم بذرة النطاق (إن وُجدت) — بدون تكرارات */
export function loadSeedAccounts(scope: string): SeedAccount[] {
  const seedsRoot = path.dirname(
    require.resolve('@platform/chart-of-accounts/seeds/core.seed.json'),
  );
  const files = ['core.seed.json'];
  const scoped = `${scope}.seed.json`;
  if (scope !== 'core' && fs.existsSync(path.join(seedsRoot, scoped))) files.push(scoped);

  const seen = new Set<string>();
  const accounts: SeedAccount[] = [];
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(seedsRoot, file), 'utf-8'));
    for (const a of raw.accounts as SeedAccount[]) {
      if (seen.has(a.code)) continue;
      seen.add(a.code);
      accounts.push(a);
    }
  }
  if (accounts.length === 0) {
    throw new Error('لم يُعثر على بذور شجرة الحسابات — تحقّق من @platform/chart-of-accounts');
  }
  return accounts;
}

/** زرع الحسابات في قاعدة SQLite — آمنة للاستدعاء المتكرر (idempotent) */
export function seedAccountsIntoSqlite(
  db: Database.Database,
  tenantId: string,
  scope: string,
): number {
  const accounts = loadSeedAccounts(scope);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO accounts
      (id, tenant_id, code, name_ar_simple, account_type, normal_balance, is_header, is_postable, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const tx = db.transaction(() => {
    for (const a of accounts) {
      insert.run(
        `acct_${tenantId}_${a.code}`,
        tenantId,
        a.code,
        a.name_ar_simple,
        a.account_type,
        NORMAL_BALANCE[a.account_type],
        a.is_header ? 1 : 0,
        a.is_postable ? 1 : 0,
      );
    }
  });
  tx();
  return accounts.length;
}
