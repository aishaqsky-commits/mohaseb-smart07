// src/modules/items/items.repository.ts
// ===== مستودع الأصناف والمخزون في SQLite =====

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { CreateItemDto, ItemBatchRow, ItemRow, StockBalanceRow } from './items.dto';

export class ItemsRepository {
  constructor(private readonly db: Database.Database) {}

  ensureDefaultWarehouse(tenantId: string): string {
    const existing = this.db
      .prepare('SELECT id FROM warehouses WHERE tenant_id = ? AND is_default = 1')
      .get(tenantId) as { id: string } | undefined;

    if (existing) return existing.id;

    const id = `wh-main-${tenantId}`;
    this.db
      .prepare(
        `INSERT INTO warehouses (id, tenant_id, code, name_ar, is_default, is_active)
         VALUES (?, ?, 'MAIN', 'المستودع الرئيسي', 1, 1)`
      )
      .run(id, tenantId);

    return id;
  }

  create(tenantId: string, dto: CreateItemDto): ItemRow {
    const id = randomUUID();
    const sku = dto.sku ?? `SKU-${id.slice(0, 8).toUpperCase()}`;
    const avgCost = String(dto.current_avg_cost ?? '0');
    const hasExpiry = dto.has_expiry_date ? 1 : 0;

    this.db
      .prepare(
        `INSERT INTO items (
          id, tenant_id, sku, name_ar, item_type, has_expiry_date,
          current_avg_cost, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(id, tenantId, sku, dto.name_ar, dto.item_type, hasExpiry, avgCost);

    return {
      id,
      tenant_id: tenantId,
      sku,
      name_ar: dto.name_ar,
      item_type: dto.item_type,
      has_expiry_date: hasExpiry,
      current_avg_cost: avgCost,
      is_active: 1,
      total_quantity_on_hand: '0.0000',
      total_cost_value: '0.0000',
    };
  }

  findById(tenantId: string, id: string): ItemRow | null {
    const row = this.db
      .prepare(
        `SELECT id, tenant_id, sku, name_ar, item_type, has_expiry_date,
                current_avg_cost, is_active
         FROM items
         WHERE tenant_id = ? AND id = ?`
      )
      .get(tenantId, id) as ItemRow | undefined;

    if (!row) return null;
    return this.enrichWithStockTotal(tenantId, row);
  }

  list(tenantId: string, filter?: { item_type?: string; search?: string }): ItemRow[] {
    let sql = `SELECT id, tenant_id, sku, name_ar, item_type, has_expiry_date,
                      current_avg_cost, is_active
               FROM items
               WHERE tenant_id = ? AND is_active = 1`;
    const params: unknown[] = [tenantId];

    if (filter?.item_type) {
      sql += ' AND item_type = ?';
      params.push(filter.item_type);
    }

    if (filter?.search && filter.search.trim() !== '') {
      sql += ' AND (name_ar LIKE ? OR sku LIKE ?)';
      const term = `%${filter.search.trim()}%`;
      params.push(term, term);
    }

    sql += ' ORDER BY name_ar ASC';

    const rows = this.db.prepare(sql).all(...params) as ItemRow[];
    return rows.map((r) => this.enrichWithStockTotal(tenantId, r));
  }

  getStockBalances(tenantId: string, itemId: string): StockBalanceRow[] {
    return this.db
      .prepare(
        `SELECT tenant_id, warehouse_id, item_id, current_quantity, total_cost_value, updated_at
         FROM stock_balances
         WHERE tenant_id = ? AND item_id = ?`
      )
      .all(tenantId, itemId) as StockBalanceRow[];
  }

  getBatches(tenantId: string, itemId: string, warehouseId?: string): ItemBatchRow[] {
    let sql = `SELECT id, tenant_id, item_id, warehouse_id, batch_number, expiry_date,
                      unit_cost, quantity_received, quantity_remaining, created_at
               FROM item_batches
               WHERE tenant_id = ? AND item_id = ?`;
    const params: unknown[] = [tenantId, itemId];

    if (warehouseId) {
      sql += ' AND warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY expiry_date ASC NULLS LAST, created_at ASC';
    return this.db.prepare(sql).all(...params) as ItemBatchRow[];
  }

  private enrichWithStockTotal(tenantId: string, item: ItemRow): ItemRow {
    const balance = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CAST(current_quantity AS REAL)), 0) AS total_qty,
           COALESCE(SUM(CAST(total_cost_value AS REAL)), 0) AS total_val
         FROM stock_balances
         WHERE tenant_id = ? AND item_id = ?`
      )
      .get(tenantId, item.id) as { total_qty: number; total_val: number } | undefined;

    return {
      ...item,
      total_quantity_on_hand: balance ? balance.total_qty.toFixed(4) : '0.0000',
      total_cost_value: balance ? balance.total_val.toFixed(4) : '0.0000',
    };
  }
}
