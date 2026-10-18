"use strict";
// src/infrastructure/inventory/InventoryCostingAdapter.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryCostingAdapter = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
/**
 * الجسر بين محرك القوالب ووحدة المخزون (القسم 3.3 من التصميم):
 * cogs_amount() في القوالب تستدعي calculateCogs هنا، فتُترجَم كل أسطر الأصناف
 * إلى عمليات issueStock فعلية بمنطق FEFO، وتُجمَّع التكلفة الفعلية المستهلكة.
 *
 * ملاحظة ذرّية: استدعاء المحرك يتم قبل ترحيل القيد المالي؛ إذا فشل الصرف
 * (نقص رصيد) يُرمى خطأ عربي واضح قبل كتابة أي قيد — فلا قيد بلا حركة ولا حركة بلا قيد.
 */
class InventoryCostingAdapter {
    store;
    options;
    constructor(store, options = {}) {
        this.store = store;
        this.options = options;
    }
    async calculateCogs(tenantId, warehouseId, items, context) {
        const movementType = this.options.issueMovementType ?? "sale_out";
        const movementDate = this.resolveMovementDate(context?.payload);
        let total = new decimal_js_1.default(0);
        for (const line of items) {
            if (!Number.isFinite(line.qty) || line.qty <= 0)
                continue; // الأسطر غير المخزنية تُتجاهل بأمان
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
    calculateItemsRevenueSum(items) {
        return items.reduce((acc, it) => acc.plus(new decimal_js_1.default(it.lineTotal)), new decimal_js_1.default(0));
    }
    resolveMovementDate(payload) {
        const raw = payload?.["transaction_date"] ?? payload?.["as_of_date"];
        if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
            return raw.slice(0, 10);
        }
        return new Date().toISOString().slice(0, 10);
    }
}
exports.InventoryCostingAdapter = InventoryCostingAdapter;
//# sourceMappingURL=InventoryCostingAdapter.js.map