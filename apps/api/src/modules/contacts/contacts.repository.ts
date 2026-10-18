// src/modules/contacts/contacts.repository.ts
// ===== مستودع جهات الاتصال: إدارة العملاء والموردين والموظفين محلياً في SQLite =====

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { ContactRow, CreateContactDto } from './contacts.dto';

export class ContactsRepository {
  constructor(private readonly db: Database.Database) {}

  create(tenantId: string, dto: CreateContactDto): ContactRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    const creditLimit = String(dto.credit_limit ?? '0');

    this.db
      .prepare(
        `INSERT INTO contacts (
          id, tenant_id, contact_type, full_name, phone, address,
          tax_number, credit_limit, is_credit_hold, notes, is_active,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`
      )
      .run(
        id,
        tenantId,
        dto.contact_type,
        dto.full_name,
        dto.phone ?? null,
        dto.address ?? null,
        dto.tax_number ?? null,
        creditLimit,
        dto.notes ?? null,
        now,
        now
      );

    return {
      id,
      tenant_id: tenantId,
      contact_type: dto.contact_type,
      full_name: dto.full_name,
      phone: dto.phone ?? null,
      address: dto.address ?? null,
      tax_number: dto.tax_number ?? null,
      credit_limit: creditLimit,
      is_credit_hold: 0,
      notes: dto.notes ?? null,
      is_active: 1,
      created_at: now,
      updated_at: now,
      current_balance: '0.0000',
    };
  }

  findById(tenantId: string, id: string): ContactRow | null {
    const row = this.db
      .prepare(
        `SELECT id, tenant_id, contact_type, full_name, phone, address,
                tax_number, credit_limit, is_credit_hold, notes, is_active,
                created_at, updated_at
         FROM contacts
         WHERE tenant_id = ? AND id = ?`
      )
      .get(tenantId, id) as Omit<ContactRow, 'current_balance'> | undefined;

    if (!row) return null;
    return { ...row, current_balance: '0.0000' };
  }

  list(tenantId: string, filter?: { contact_type?: string; search?: string }): ContactRow[] {
    let sql = `SELECT id, tenant_id, contact_type, full_name, phone, address,
                      tax_number, credit_limit, is_credit_hold, notes, is_active,
                      created_at, updated_at
               FROM contacts
               WHERE tenant_id = ? AND is_active = 1`;
    const params: unknown[] = [tenantId];

    if (filter?.contact_type) {
      sql += ' AND contact_type = ?';
      params.push(filter.contact_type);
    }

    if (filter?.search && filter.search.trim() !== '') {
      sql += ' AND (full_name LIKE ? OR phone LIKE ?)';
      const term = `%${filter.search.trim()}%`;
      params.push(term, term);
    }

    sql += ' ORDER BY full_name ASC';

    const rows = this.db.prepare(sql).all(...params) as Array<Omit<ContactRow, 'current_balance'>>;
    return rows.map((r) => ({ ...r, current_balance: '0.0000' }));
  }

  update(
    tenantId: string,
    id: string,
    dto: Partial<CreateContactDto & { is_credit_hold?: number; is_active?: number }>
  ): ContactRow | null {
    const existing = this.findById(tenantId, id);
    if (!existing) return null;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (dto.full_name !== undefined) {
      updates.push('full_name = ?');
      params.push(dto.full_name);
    }
    if (dto.phone !== undefined) {
      updates.push('phone = ?');
      params.push(dto.phone);
    }
    if (dto.address !== undefined) {
      updates.push('address = ?');
      params.push(dto.address);
    }
    if (dto.tax_number !== undefined) {
      updates.push('tax_number = ?');
      params.push(dto.tax_number);
    }
    if (dto.credit_limit !== undefined) {
      updates.push('credit_limit = ?');
      params.push(String(dto.credit_limit));
    }
    if (dto.is_credit_hold !== undefined) {
      updates.push('is_credit_hold = ?');
      params.push(dto.is_credit_hold ? 1 : 0);
    }
    if (dto.notes !== undefined) {
      updates.push('notes = ?');
      params.push(dto.notes);
    }
    if (dto.is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(dto.is_active ? 1 : 0);
    }

    if (updates.length === 0) return existing;

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    params.push(now);

    params.push(tenantId, id);
    this.db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...params);

    return this.findById(tenantId, id);
  }

  setCreditHold(tenantId: string, id: string, isHold: boolean, creditLimit?: string): ContactRow | null {
    const existing = this.findById(tenantId, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    if (creditLimit !== undefined) {
      this.db
        .prepare(
          `UPDATE contacts
           SET is_credit_hold = ?, credit_limit = ?, updated_at = ?
           WHERE tenant_id = ? AND id = ?`
        )
        .run(isHold ? 1 : 0, String(creditLimit), now, tenantId, id);
    } else {
      this.db
        .prepare(
          `UPDATE contacts
           SET is_credit_hold = ?, updated_at = ?
           WHERE tenant_id = ? AND id = ?`
        )
        .run(isHold ? 1 : 0, now, tenantId, id);
    }

    return this.findById(tenantId, id);
  }
}
