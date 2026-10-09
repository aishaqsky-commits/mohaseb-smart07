import Decimal from "decimal.js";
export interface SaleItemInput {
    item_id: string;
    qty: number;
    unit_id?: string;
}
/**
 * منفذ نحو وحدة المخزون المصمَّمة سابقًا (cogs_amount في القوالب).
 * التطبيق الفعلي يستدعي خوارزمية issueStock بمنطق FEFO المصمَّم مسبقًا.
 */
export interface InventoryCostingPort {
    calculateCogs(tenantId: string, warehouseId: string, items: SaleItemInput[]): Promise<Decimal>;
    calculateItemsRevenueSum(items: Array<SaleItemInput & {
        lineTotal: string;
    }>): Decimal;
}
