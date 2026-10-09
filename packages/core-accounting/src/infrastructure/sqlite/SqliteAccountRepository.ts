// src/infrastructure/sqlite/SqliteAccountRepository.ts

import Database from "better-sqlite3";
import { Account, AccountProps } from "../../domain/entities/Account";
import { AccountRepository } from "../../domain/ports/AccountRepository";

interface AccountRow {
  id: string;
  tenant_id: string;
  code: string;
  name_ar_simple: string;
  account_type: AccountProps["accountType"];
  normal_balance: AccountProps["normalBalance"];
  is_header: number;
  is_postable: number;
  is_active: number;
}

export class SqliteAccountRepository implements AccountRepository {
  constructor(private readonly db: Database.Database) {}

  private rowToAccount(row: AccountRow): Account {
    return Account.reconstruct({
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

  async findById(tenantId: string, accountId: string): Promise<Account | null> {
    const row = this.db
      .prepare(`SELECT * FROM accounts WHERE tenant_id = ? AND id = ?`)
      .get(tenantId, accountId) as AccountRow | undefined;
    return row ? this.rowToAccount(row) : null;
  }

  async findByCode(tenantId: string, code: string): Promise<Account | null> {
    const row = this.db
      .prepare(`SELECT * FROM accounts WHERE tenant_id = ? AND code = ?`)
      .get(tenantId, code) as AccountRow | undefined;
    return row ? this.rowToAccount(row) : null;
  }

  async findManyByCodes(
    tenantId: string,
    codes: string[]
  ): Promise<Map<string, Account>> {
    if (codes.length === 0) return new Map();

    const uniqueCodes = [...new Set(codes)];
    const placeholders = uniqueCodes.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM accounts WHERE tenant_id = ? AND code IN (${placeholders})`
      )
      .all(tenantId, ...uniqueCodes) as AccountRow[];

    const map = new Map<string, Account>();
    for (const row of rows) {
      map.set(row.code, this.rowToAccount(row));
    }
    return map;
  }

  async listByTenant(tenantId: string): Promise<Account[]> {
    const rows = this.db
      .prepare(`SELECT * FROM accounts WHERE tenant_id = ? ORDER BY code ASC`)
      .all(tenantId) as AccountRow[];
    return rows.map((row) => this.rowToAccount(row));
  }
}
