import Database from "better-sqlite3";
/** أنواع الحركات المعتمدة (مطابقة لـ CHECK في schema — انظر 002_inventory.sql) */
export type StockMovementType = "purchase_in" | "sale_out" | "return_in" | "return_out" | "transfer_in" | "transfer_out" | "damage_out" | "opening_balance" | "inventory_count_adj_in" | "inventory_count_adj_out";
export interface ReceiveInput {
    itemId: string;
    warehouseId: string;
    /** بالوحدة الأساسية دائمًا (تحويلات الوحدات خارج نطاق هذا المنفذ حاليًا) */
    quantity: string;
    /** تكلفة الوحدة بعملة الأساس — Decimal كنص */
    unitCost: string;
    batchNumber?: string;
    expiryDate?: string;
    movementType: StockMovementType;
    movementDate: string;
    sourceReference?: string | undefined;
}
export interface IssueInput {
    itemId: string;
    warehouseId: string;
    quantity: string;
    movementType: StockMovementType;
    movementDate: string;
    sourceReference?: string | undefined;
}
export interface IssueResult {
    movementId: string;
    totalCost: string;
}
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
export declare class SqliteInventoryStore {
    private readonly db;
    constructor(db: Database.Database);
    /** استلام مخزون (شراء/مرتجع من عميل/رصيد افتتاحي/تحويل وارد/زيادة جرد) */
    receive(input: ReceiveInput): string;
    /**
     * صرف مخزون مع استهلاك FEFO وإرجاع التكلفة الفعلية المستهلكة (COGS).
     * يُنشئ حركة واحدة + طبقة تكلفة لكل دفعة استُهلكت منها كمية.
     */
    issue(input: IssueInput): IssueResult;
    /** كشف حركة صنف (Stock Card) — للاستعلامات والتقارير */
    movementsForItem(tenantId: string, itemId: string): Array<{
        id: string;
        movement_type: string;
        quantity: string;
        total_cost: string;
        movement_date: string;
    }>;
    /** اختبار التسوية الآلي (القسم 9): رصيد الجدول المادي = مجموع دفتر الحركات */
    assertReconciliation(): void;
    private decimal;
    private assertPositiveDecimal;
    private assertNonNegativeDecimal;
    private assertItemExists;
    private assertWarehouseExists;
    private insertMovement;
    /** تحديث تدريجي للرصيد المجمّع (Increment/Decrement) — القسم 2.11 */
    private upsertBalance;
    /** إعادة حساب المتوسط المرجّح على مستوى الصنف من الرصيد المجمّع (قسم 3.1) */
    private updateItemAvgCost;
}
