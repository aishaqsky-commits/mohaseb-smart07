import Decimal from "decimal.js";
import { InventoryCostingPort, SaleItemInput } from "../../templates/ports/InventoryCostingPort";
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
export declare class InventoryCostingAdapter implements InventoryCostingPort {
    private readonly store;
    private readonly options;
    constructor(store: SqliteInventoryStore, options?: InventoryCostingAdapterOptions);
    calculateCogs(tenantId: string, warehouseId: string, items: SaleItemInput[], context?: {
        transactionId?: string;
        payload?: Record<string, unknown>;
    }): Promise<Decimal>;
    /** مجموع إيراد أسطر الأصناف (البيع بالتفصيل) — حساب نصّي دقيق بلا float */
    calculateItemsRevenueSum(items: Array<SaleItemInput & {
        lineTotal: string;
    }>): Decimal;
    private resolveMovementDate;
}
