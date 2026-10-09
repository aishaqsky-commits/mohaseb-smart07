// src/infrastructure/inventory/InventoryCostingAdapter.ts

import Decimal from "decimal.js";
import {
  InventoryCostingPort,
  SaleItemInput,
} from "../../templates/ports/InventoryCostingPort";
import { SqliteInventoryStore } from "../sqlite/SqliteInventoryStore";

export interface InventoryCostingAdapterOptions {
  /** نوع حركة الصرف المرتبط بقوالب البيع (افتراضيًا sale_out) */
  issueMovementType?: "sale_out" | "damage_out" | "return_out" | "transfer_out";
}

/**
 * الجسر بين محرك القوالب ووحدة المخزون (القسم 3.3 من التصميم):
 * cogs_amount() في القوالب تستدعي calculateCogs هنا، فتُترجَم كل أسطر الأصناف
 * إلى عمليات issueStock فعلية بمنطق FEFO، وتُجمَّع التكلفة الفعلية المستهلكة.
 *
 * ملاحظة ذرّية: استدعاء المحرك يتم قبل ترحيل القيد المالي؛ إذا فشل الصرف
 * (نقص رصيد) يُرمى خطأ عربي واضح قبل كتابة أي قيد — فلا قيد بلا حركة ولا حركة بلا قيد.
 */
export class InventoryCostingAdapter implements InventoryCostingPort {
  constructor(
    private readonly store: SqliteInventoryStore,
    private readonly options: InventoryCostingAdapterOptions = {}
  ) {}

  async calculateCogs(
    tenantId: string,
    warehouseId: string,
    items: SaleItemInput[],
    context?: { transactionId?: string; payload?: Record<string, unknown> }
  ): Promise<Decimal> {
    const movementType = this.options.issueMovementType ?? "sale_out";
    const movementDate = this.resolveMovementDate(context?.payload);

    let total = new Decimal(0);

    for (const line of items) {
      if (!Number.isFinite(line.qty) || line.qty <= 0) continue; // الأسطر غير المخزنية تُتجاهل بأمان
      const result = this.store.issue({
        itemId: line.item_id,
        warehouseId,
        quantity: String(line.qty),
        movementType,
        movementDate,
        sourceReference: context?.transactionId || undefined,
      });
      total = total.plus(result.totalCost);
    }

    return total;
  }

  /** مجموع إيراد أسطر الأصناف (البيع بالتفصيل) — حساب نصّي دقيق بلا float */
  calculateItemsRevenueSum(
    items: Array<SaleItemInput & { lineTotal: string }>
  ): Decimal {
    return items.reduce(
      (acc, it) => acc.plus(new Decimal(it.lineTotal)),
      new Decimal(0)
    );
  }

  private resolveMovementDate(payload?: Record<string, unknown>): string {
    const raw = payload?.["transaction_date"] ?? payload?.["as_of_date"];
    if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return raw.slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  }
}
