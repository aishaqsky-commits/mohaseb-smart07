"use strict";
// src/infrastructure/sqlite/SqliteInventoryStore.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteInventoryStore = void 0;
const crypto_1 = require("crypto");
const decimal_js_1 = __importDefault(require("decimal.js"));
const InventoryErrors_1 = require("../../domain/errors/InventoryErrors");
const INBOUND_TYPES = new Set([
    "purchase_in", "return_in", "transfer_in", "opening_balance", "inventory_count_adj_in",
]);
/**
 * مستودع المخزون (طبقة البنية التحتية): دفتر حركة Append-only + أرصدة تجميعية.
 *
 * الذرّية: كل عملية receive/issue تُنفَّذ داخل db.transaction واحدة تشمل
 * (الحركة + طبقات التكلفة + تحديث الدفعات + تحديث الرصيد المجمّع) —
 * فشل أي خطوة = تراجع كامل، فلا ينفصل الأثر المخزني عن المحاسبي أبدًا
 * (تحديث stock_balances ضمن نفس Transaction كما أوصى قسم الأداء في التصميم).
 *
 * FEFO: الدفعات تُستهلك مرتبةً expiry_date ASC NULLS LAST ثم created_at ASC (FIFO احتياطًا)،
 * وهو تطبيق مباشر للقسم 3.2 من تصميم وحدة المخزون.
 */
class SqliteInventoryStore {
    db;
    constructor(db) {
        this.db = db;
    }
    /** استلام مخزون (شراء/مرتجع من عميل/رصيد افتتاحي/تحويل وارد/زيادة جرد) */
    receive(input) {
        if (!INBOUND_TYPES.has(input.movementType)) {
            throw new Error(`نوع حركة غير صالح للاستلام: ${input.movementType}`);
        }
        const qty = this.assertPositiveDecimal(input.quantity, "quantity");
        const cost = this.assertNonNegativeDecimal(input.unitCost, "unitCost");
        const item = this.assertItemExists(input.itemId);
        this.assertWarehouseExists(input.warehouseId);
        const movementId = (0, crypto_1.randomUUID)();
        const run = this.db.transaction(() => {
            // الدفعات فاعلة للأصناف المخزنية ذات الصلاحية؛ الأصناف الخدمية لا مخزون لها
            const useBatches = item.item_type === "stock" && Boolean(input.batchNumber || input.expiryDate);
            let batchId = null;
            if (useBatches) {
                const batchNumber = input.batchNumber ?? `auto-${movementId.slice(0, 8)}`;
                const existing = this.db
                    .prepare(`SELECT id FROM item_batches
                    WHERE tenant_id = ? AND item_id = ? AND warehouse_id = ? AND batch_number = ?`)
                    .get(item.tenant_id, input.itemId, input.warehouseId, batchNumber);
                if (existing) {
                    // دمج في دفعة قائمة بنفس الرقم — إعادة حساب المتوسط المرجّح للدفعة
                    const b = this.db.prepare(`SELECT quantity_remaining AS q, unit_cost AS c FROM item_batches WHERE id = ?`)
                        .get(existing.id);
                    const oldQty = new decimal_js_1.default(b.q);
                    const newTotal = oldQty.plus(qty);
                    const avgCost = new decimal_js_1.default(b.c).times(oldQty)
                        .plus(cost.times(qty)).div(newTotal);
                    batchId = existing.id;
                    this.db.prepare(`UPDATE item_batches SET quantity_remaining = ?, unit_cost = ? WHERE id = ?`)
                        .run(newTotal.toFixed(4), avgCost.toFixed(6), existing.id);
                }
                else {
                    batchId = (0, crypto_1.randomUUID)();
                    this.db.prepare(`INSERT INTO item_batches
              (id, tenant_id, item_id, warehouse_id, batch_number, expiry_date,
               unit_cost, quantity_received, quantity_remaining, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                        .run(batchId, item.tenant_id, input.itemId, input.warehouseId, batchNumber, input.expiryDate ?? null, cost.toFixed(6), qty.toFixed(4), qty.toFixed(4), new Date().toISOString());
                }
            }
            const totalCost = qty.times(cost);
            this.insertMovement(movementId, item.tenant_id, input.warehouseId, input.itemId, batchId, input.movementType, qty.toFixed(4), cost.toFixed(6), totalCost.toFixed(4), input.movementDate, input.sourceReference);
            this.upsertBalance(item.tenant_id, input.warehouseId, input.itemId, qty, totalCost);
            this.updateItemAvgCost(item.tenant_id, input.itemId);
        });
        run();
        return movementId;
    }
    /**
     * صرف مخزون مع استهلاك FEFO وإرجاع التكلفة الفعلية المستهلكة (COGS).
     * يُنشئ حركة واحدة + طبقة تكلفة لكل دفعة استُهلكت منها كمية.
     */
    issue(input) {
        if (INBOUND_TYPES.has(input.movementType)) {
            throw new Error(`نوع حركة غير صالح للصرف: ${input.movementType}`);
        }
        const qty = this.assertPositiveDecimal(input.quantity, "quantity");
        const item = this.assertItemExists(input.itemId);
        this.assertWarehouseExists(input.warehouseId);
        const movementId = (0, crypto_1.randomUUID)();
        let result;
        const run = this.db.transaction(() => {
            const batches = this.db.prepare(`
        SELECT id, quantity_remaining, unit_cost, expiry_date
        FROM item_batches
        WHERE tenant_id = ? AND item_id = ? AND warehouse_id = ? AND CAST(quantity_remaining AS REAL) > 0
        ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC, created_at ASC
      `).all(item.tenant_id, input.itemId, input.warehouseId);
            const available = batches.reduce((acc, b) => acc.plus(b.quantity_remaining), this.decimal(0));
            if (available.lessThan(qty)) {
                // allow_negative_stock=false افتراضيًا (قرار تصميمي — القسم 3.4)
                throw new InventoryErrors_1.InsufficientStockError(item.name_ar, available.toNumber(), qty.toNumber());
            }
            // مسارات مُعدَّة خارج الحلقة (أداء better-sqlite3)
            const updateBatch = this.db.prepare(`UPDATE item_batches SET quantity_remaining = ? WHERE id = ?`);
            const insertLayer = this.db.prepare(`INSERT INTO stock_movement_cost_layers
        (id, tenant_id, stock_movement_id, consumed_batch_id, qty_consumed, unit_cost_at_consumption)
        VALUES (?, ?, ?, ?, ?, ?)`);
            let remaining = qty;
            let totalCost = this.decimal(0);
            for (const batch of batches) {
                if (remaining.isZero())
                    break;
                const batchQty = this.decimal(batch.quantity_remaining);
                const takeQty = batchQty.lessThan(remaining) ? batchQty : remaining;
                const batchCost = this.decimal(batch.unit_cost);
                totalCost = totalCost.plus(takeQty.times(batchCost));
                remaining = remaining.minus(takeQty);
                updateBatch.run(batchQty.minus(takeQty).toFixed(4), batch.id);
                insertLayer.run((0, crypto_1.randomUUID)(), item.tenant_id, movementId, batch.id, takeQty.toFixed(4), batchCost.toFixed(6));
            }
            const avgConsumed = totalCost.div(qty);
            this.insertMovement(movementId, item.tenant_id, input.warehouseId, input.itemId, null, input.movementType, qty.toFixed(4), avgConsumed.toFixed(6), totalCost.toFixed(4), input.movementDate, input.sourceReference);
            this.upsertBalance(item.tenant_id, input.warehouseId, input.itemId, qty.negated(), totalCost.negated());
            result = { movementId, totalCost: totalCost.toFixed(4) };
        });
        run();
        return result;
    }
    /** كشف حركة صنف (Stock Card) — للاستعلامات والتقارير */
    movementsForItem(tenantId, itemId) {
        return this.db.prepare(`
      SELECT id, movement_type, quantity, total_cost, movement_date
      FROM stock_movements WHERE tenant_id = ? AND item_id = ? ORDER BY movement_date, created_at
    `).all(tenantId, itemId);
    }
    /** اختبار التسوية الآلي (القسم 9): رصيد الجدول المادي = مجموع دفتر الحركات */
    assertReconciliation() {
        const mismatch = this.db.prepare(`
      SELECT b.item_id
      FROM stock_balances b
      JOIN (
        SELECT tenant_id, item_id, warehouse_id,
          SUM(CASE WHEN movement_type IN ('purchase_in','return_in','transfer_in','opening_balance','inventory_count_adj_in')
                   THEN CAST(quantity AS REAL) ELSE -CAST(quantity AS REAL) END) AS ledger_qty
        FROM stock_movements GROUP BY tenant_id, item_id, warehouse_id
      ) m ON m.tenant_id = b.tenant_id AND m.item_id = b.item_id AND m.warehouse_id = b.warehouse_id
      WHERE ABS(CAST(b.current_quantity AS REAL) - m.ledger_qty) > 1e-9
    `).get();
        if (mismatch) {
            throw new Error(`STOCK_RECONCILIATION_MISMATCH عند الصنف ${mismatch.item_id}`);
        }
    }
    // ===================== أدوات داخلية =====================
    decimal(v) {
        return new decimal_js_1.default(String(v));
    }
    assertPositiveDecimal(raw, field) {
        const d = this.decimal(raw);
        if (!d.isFinite() || d.lessThanOrEqualTo(0)) {
            throw new InventoryErrors_1.InvalidStockQuantityError(raw);
        }
        void field;
        return d;
    }
    assertNonNegativeDecimal(raw, field) {
        const d = this.decimal(raw);
        if (!d.isFinite() || d.lessThan(0)) {
            throw new InventoryErrors_1.InvalidStockQuantityError(raw);
        }
        void field;
        return d;
    }
    assertItemExists(itemId) {
        const row = this.db.prepare(`SELECT id, tenant_id, name_ar, item_type FROM items WHERE id = ?`)
            .get(itemId);
        if (!row) {
            throw new InventoryErrors_1.UnknownItemError(itemId);
        }
        return row;
    }
    assertWarehouseExists(warehouseId) {
        const row = this.db.prepare(`SELECT id FROM warehouses WHERE id = ?`).get(warehouseId);
        if (!row) {
            throw new InventoryErrors_1.UnknownWarehouseError(warehouseId);
        }
    }
    insertMovement(id, tenantId, warehouseId, itemId, batchId, type, quantity, unitCost, totalCost, movementDate, sourceReference) {
        this.db.prepare(`INSERT INTO stock_movements
      (id, tenant_id, warehouse_id, item_id, batch_id, movement_type,
       quantity, unit_cost, total_cost, movement_date, journal_entry_id, source_reference, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
            .run(id, tenantId, warehouseId, itemId, batchId, type, quantity, unitCost, totalCost, movementDate, sourceReference ?? null, new Date().toISOString());
    }
    /** تحديث تدريجي للرصيد المجمّع (Increment/Decrement) — القسم 2.11 */
    upsertBalance(tenantId, warehouseId, itemId, qtyDelta, valueDelta) {
        const current = this.db.prepare(`
      SELECT current_quantity, total_cost_value FROM stock_balances
      WHERE tenant_id = ? AND warehouse_id = ? AND item_id = ?
    `).get(tenantId, warehouseId, itemId);
        const newQty = this.decimal(current?.current_quantity ?? "0").plus(qtyDelta);
        const newValue = this.decimal(current?.total_cost_value ?? "0").plus(valueDelta);
        if (current) {
            this.db.prepare(`
        UPDATE stock_balances SET current_quantity = ?, total_cost_value = ?, updated_at = ?
        WHERE tenant_id = ? AND warehouse_id = ? AND item_id = ?
      `).run(newQty.toFixed(4), newValue.toFixed(4), new Date().toISOString(), tenantId, warehouseId, itemId);
        }
        else {
            this.db.prepare(`
        INSERT INTO stock_balances (tenant_id, warehouse_id, item_id, current_quantity, total_cost_value, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(tenantId, warehouseId, itemId, newQty.toFixed(4), newValue.toFixed(4), new Date().toISOString());
        }
    }
    /** إعادة حساب المتوسط المرجّح على مستوى الصنف من الرصيد المجمّع (قسم 3.1) */
    updateItemAvgCost(tenantId, itemId) {
        const agg = this.db.prepare(`
      SELECT COALESCE(SUM(CAST(current_quantity AS REAL)), 0) AS q,
             COALESCE(SUM(CAST(total_cost_value AS REAL)), 0) AS v
      FROM stock_balances WHERE tenant_id = ? AND item_id = ?
    `).get(tenantId, itemId);
        const avg = agg.q > 0 ? this.decimal(agg.v).div(agg.q).toFixed(6) : "0";
        this.db.prepare(`UPDATE items SET current_avg_cost = ? WHERE id = ? AND tenant_id = ?`)
            .run(avg, itemId, tenantId);
    }
}
exports.SqliteInventoryStore = SqliteInventoryStore;
//# sourceMappingURL=SqliteInventoryStore.js.map