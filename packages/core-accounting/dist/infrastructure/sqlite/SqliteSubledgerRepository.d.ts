import Database from "better-sqlite3";
import Decimal from "decimal.js";
export type SubledgerType = "AR" | "AP";
export type OpenItemStatus = "open" | "partially_paid" | "settled" | "written_off";
export interface OpenItemRow {
    id: string;
    tenantId: string;
    contactId: string;
    subledgerType: SubledgerType;
    sourceTransactionId: string;
    journalEntryId: string;
    invoiceDate: string;
    dueDate: string | null;
    originalAmount: string;
    remainingAmount: string;
    currencyCode: string;
    exchangeRate: string;
    baseRemainingAmount: string;
    status: OpenItemStatus;
    /** بند فائض (§3.3): رصيد دائن للطرف من دفعة زائدة — يُستهلك في أول تسوية لاحقة */
    isOverpayment: boolean;
}
/** صف تخصيص (تسوية) — يُقرأ في كشف الحساب (§6.1) */
export interface AllocationRow {
    id: string;
    tenantId: string;
    openItemId: string;
    settlementTransactionId: string;
    allocatedAmount: string;
    allocatedAmountBase: string;
    fxGainLossAmount: string;
    allocationDate: string;
}
export declare class SqliteSubledgerRepository {
    private readonly db;
    /** عملة الأساس للمنشأة — تُستخدم لتمييز بنود العملة الأجنبية عند تصحيح سعر التسوية */
    private readonly baseCurrencyCodeHint;
    constructor(db: Database.Database, 
    /** عملة الأساس للمنشأة — تُستخدم لتمييز بنود العملة الأجنبية عند تصحيح سعر التسوية */
    baseCurrencyCodeHint?: string);
    /** البنود غير المسددة لطرف، مرتبة FIFO (الأقدم document_date أولًا — القسم 3.2) */
    findUnsettledItems(tenantId: string, contactId: string, subledgerType: SubledgerType): OpenItemRow[];
    findById(tenantId: string, itemId: string): OpenItemRow | null;
    /** كل بنود الطرف (لأغراض كشف الحساب والربط العكسي للمرتجعات) */
    findAllItemsForContact(tenantId: string, contactId: string): OpenItemRow[];
    hasAllocationsForSourceTransaction(tenantId: string, sourceTransactionId: string): boolean;
    /** كل البنود غير المسددة لنوع فرعي عبر كل الأطراف (أساس تقرير الأعمار §5.1 — يستغل فهرس idx_open_items_aging) */
    listAllUnsettledByType(tenantId: string, subledgerType: SubledgerType): OpenItemRow[];
    /** تخصيصات بند واحد (سطور «دفعة/تحصيل» في كشف الحساب §6.1) */
    listAllocationsForItem(openItemId: string): AllocationRow[];
    createOpenItem(input: {
        tenantId: string;
        contactId: string;
        subledgerType: SubledgerType;
        sourceTransactionId: string;
        journalEntryId: string;
        invoiceDate: string;
        dueDate?: string | null;
        originalAmount: string;
        currencyCode: string;
        exchangeRate: string;
        baseOriginalAmount: string;
        /** المتبقي الابتدائي — افتراضيًا كامل الأصلي؛ يُمرَّر صراحةً لبنود الفائض (overpayment) */
        remainingAmount?: string;
        /** بند فائض (§3.3) — رصيد دائن للطرف يُستهلك في أول تسوية لاحقة */
        isOverpayment?: boolean;
    }): OpenItemRow;
    insertAllocation(input: {
        tenantId: string;
        openItemId: string;
        settlementTransactionId: string;
        allocatedAmount: string;
        allocatedAmountBase: string;
        fxGainLossAmount: string;
        allocationDate: string;
    }): void;
    updateItemSettlement(input: {
        tenantId: string;
        openItemId: string;
        remainingAmount: string;
        baseRemainingAmount: string;
        status: OpenItemStatus;
    }): void;
    /** شطب دين معدوم (القسم 6.1 — صلاحية الطبقة العليا تُفرض في الـ Controller) */
    writeOffItem(tenantId: string, openItemId: string, reason: string): OpenItemRow | null;
    /**
     * تسوية دفعة كاملة (تحصيل/سداد) على بنود الطرف بمنطق FIFO مع مرونة بند محدد مسبقًا.
     * ذرّية بالكامل: أي فشل في منتصف التوزيع = تراجع كل شيء (لا تخصيص جزئي معلّق).
     * يعيد وصف كل تخصيص أُنشئ وأثر فرق العملة المحسوب لكل بند على حدة (القسم 3.2).
     */
    settlePayment(input: {
        tenantId: string;
        contactId: string;
        subledgerType: SubledgerType;
        settlementTransactionId: string;
        settlementEntryId: string;
        settlementDate: string;
        amountInItemCurrency: Decimal;
        amountInBase: Decimal;
        itemCurrencyCode: string;
        currentRate: string;
        targetItemId?: string | null;
    }): SettleOutcome;
}
export interface SettleAllocation {
    openItemId: string;
    contactId: string;
    currencyCode: string;
    allocatedAmount: Decimal;
    allocatedBase: Decimal;
    /** موجب = ربح صرف (ارتفع سعر العملة)، سالب = خسارة */
    fxGainLossAmount: Decimal;
    itemNowSettled: boolean;
}
export interface SettleOutcome {
    allocations: SettleAllocation[];
    overpayment: Decimal;
    overpaymentBase: Decimal;
}
