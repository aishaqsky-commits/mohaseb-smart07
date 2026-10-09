// src/templates/ports/InventoryCostingPort.ts

import Decimal from "decimal.js";

export interface SaleItemInput {
  item_id: string;
  qty: number;
  unit_id?: string;
}

/**
 * منفذ نحو وحدة المخزون المصمَّمة سابقًا (cogs_amount في القوالب).
 * التطبيق الفعلي: InventoryCostingAdapter → SqliteInventoryStore.issue بمنطق FEFO.
 */
export interface InventoryCostingPort {
  calculateCogs(
    tenantId: string,
    warehouseId: string,
    items: SaleItemInput[],
    /** سياق العملية لربط الحركات بالمعاملة (transactionId) واستخراج تاريخ الحركة */
    context?: { transactionId?: string | undefined; payload?: Record<string, unknown> | undefined }
  ): Promise<Decimal>;

  calculateItemsRevenueSum(items: Array<SaleItemInput & { lineTotal: string }>): Decimal;
}
