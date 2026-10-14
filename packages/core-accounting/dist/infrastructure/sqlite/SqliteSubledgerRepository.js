"use strict";
// src/infrastructure/sqlite/SqliteSubledgerRepository.ts
// ===== مستودع الذمم الفرعية (AR/AP Sub-Ledger) وفق docs/04-modules/ar-ap-subledger.md =====
// نمط الفاتورة المفتوحة (Open Item Accounting): إنشاء البنود، التخصيص FIFO، الأعمار، كشف الحساب.
// كل الكتابة عبر this.db.transaction(...) — ذرّية SQLite المتزامنة (نفس نمط SqliteJournalRepository).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteSubledgerRepository = void 0;
const uuid_1 = require("uuid");
const decimal_js_1 = __importDefault(require("decimal.js"));
const Money_1 = require("../../domain/value-objects/Money");
const OPEN_ITEM_SELECT_COLUMNS = `
  id, tenant_id, contact_id, subledger_type, source_transaction_id, journal_entry_id,
  invoice_date, due_date, original_amount, remaining_amount, currency_code,
  exchange_rate, base_remaining_amount, status, is_overpayment`;
function rowToOpenItem(row) {
    return {
        id: row.id,
        tenantId: row.tenant_id,
        contactId: row.contact_id,
        subledgerType: row.subledger_type,
        sourceTransactionId: row.source_transaction_id,
        journalEntryId: row.journal_entry_id,
        invoiceDate: row.invoice_date,
        dueDate: row.due_date ?? null,
        originalAmount: row.original_amount,
        remainingAmount: row.remaining_amount,
        currencyCode: row.currency_code,
        exchangeRate: row.exchange_rate,
        baseRemainingAmount: row.base_remaining_amount,
        status: row.status,
        isOverpayment: Number(row.is_overpayment) === 1,
    };
}
class SqliteSubledgerRepository {
    db;
    baseCurrencyCodeHint;
    constructor(db, 
    /** عملة الأساس للمنشأة — تُستخدم لتمييز بنود العملة الأجنبية عند تصحيح سعر التسوية */
    baseCurrencyCodeHint = "YER") {
        this.db = db;
        this.baseCurrencyCodeHint = baseCurrencyCodeHint;
    }
    // ===================== قراءة =====================
    /** البنود غير المسددة لطرف، مرتبة FIFO (الأقدم document_date أولًا — القسم 3.2) */
    findUnsettledItems(tenantId, contactId, subledgerType) {
        const rows = this.db
            .prepare(`SELECT ${OPEN_ITEM_SELECT_COLUMNS} FROM ar_ap_open_items
         WHERE tenant_id = ? AND contact_id = ? AND subledger_type = ?
           AND status IN ('open', 'partially_paid')
         ORDER BY is_overpayment DESC, invoice_date ASC, created_at ASC`)
            .all(tenantId, contactId, subledgerType);
        return rows.map(rowToOpenItem);
    }
    findById(tenantId, itemId) {
        const row = this.db
            .prepare(`SELECT ${OPEN_ITEM_SELECT_COLUMNS} FROM ar_ap_open_items WHERE tenant_id = ? AND id = ?`)
            .get(tenantId, itemId);
        return row ? rowToOpenItem(row) : null;
    }
    /** كل بنود الطرف (لأغراض كشف الحساب والربط العكسي للمرتجعات) */
    findAllItemsForContact(tenantId, contactId) {
        const rows = this.db
            .prepare(`SELECT ${OPEN_ITEM_SELECT_COLUMNS} FROM ar_ap_open_items
         WHERE tenant_id = ? AND contact_id = ? ORDER BY invoice_date ASC, created_at ASC`)
            .all(tenantId, contactId);
        return rows.map(rowToOpenItem);
    }
    hasAllocationsForSourceTransaction(tenantId, sourceTransactionId) {
        const row = this.db
            .prepare(`SELECT COUNT(*) AS n FROM ar_ap_allocations a
         JOIN ar_ap_open_items o ON o.id = a.open_item_id
         WHERE o.tenant_id = ? AND o.source_transaction_id = ?`)
            .get(tenantId, sourceTransactionId);
        return row.n > 0;
    }
    /** كل البنود غير المسددة لنوع فرعي عبر كل الأطراف (أساس تقرير الأعمار §5.1 — يستغل فهرس idx_open_items_aging) */
    listAllUnsettledByType(tenantId, subledgerType) {
        const rows = this.db
            .prepare(`SELECT ${OPEN_ITEM_SELECT_COLUMNS} FROM ar_ap_open_items
         WHERE tenant_id = ? AND subledger_type = ? AND status IN ('open', 'partially_paid')
         ORDER BY invoice_date ASC, created_at ASC`)
            .all(tenantId, subledgerType);
        return rows.map(rowToOpenItem);
    }
    /** تخصيصات بند واحد (سطور «دفعة/تحصيل» في كشف الحساب §6.1) */
    listAllocationsForItem(openItemId) {
        const rows = this.db
            .prepare(`SELECT id, tenant_id, open_item_id, settlement_transaction_id, allocated_amount,
                allocated_amount_base, fx_gain_loss_amount, allocation_date
         FROM ar_ap_allocations WHERE open_item_id = ? ORDER BY allocation_date ASC, created_at ASC`)
            .all(openItemId);
        return rows.map((r) => ({
            id: r.id,
            tenantId: r.tenant_id,
            openItemId: r.open_item_id,
            settlementTransactionId: r.settlement_transaction_id,
            allocatedAmount: r.allocated_amount,
            allocatedAmountBase: r.allocated_amount_base,
            fxGainLossAmount: r.fx_gain_loss_amount,
            allocationDate: r.allocation_date,
        }));
    }
    // ===================== كتابة (ذرّية) =====================
    createOpenItem(input) {
        const id = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        const initialRemaining = input.remainingAmount ?? input.originalAmount;
        this.db
            .prepare(`INSERT INTO ar_ap_open_items
         (id, tenant_id, contact_id, subledger_type, source_transaction_id, journal_entry_id,
          invoice_date, due_date, original_amount, remaining_amount, currency_code,
          exchange_rate, base_remaining_amount, status, is_overpayment, created_at, updated_at)
         VALUES (@id, @tenantId, @contactId, @subledgerType, @sourceTransactionId, @journalEntryId,
                 @invoiceDate, @dueDate, @originalAmount, @remainingAmount, @currencyCode,
                 @exchangeRate, @baseRemainingAmount, 'open', @isOverpayment, @createdAt, @updatedAt)`)
            .run({
            id,
            tenantId: input.tenantId,
            contactId: input.contactId,
            subledgerType: input.subledgerType,
            sourceTransactionId: input.sourceTransactionId,
            journalEntryId: input.journalEntryId,
            invoiceDate: input.invoiceDate,
            dueDate: input.dueDate ?? null,
            originalAmount: input.originalAmount,
            remainingAmount: initialRemaining,
            currencyCode: input.currencyCode,
            exchangeRate: input.exchangeRate,
            baseRemainingAmount: input.baseOriginalAmount,
            isOverpayment: input.isOverpayment ? 1 : 0,
            createdAt: now,
            updatedAt: now,
        });
        const created = this.findById(input.tenantId, id);
        if (!created)
            throw new Error("فشل إنشاء البند المفتوح (تعذّر قراءته بعد الإدراج)");
        return created;
    }
    insertAllocation(input) {
        this.db
            .prepare(`INSERT INTO ar_ap_allocations
         (id, tenant_id, open_item_id, settlement_transaction_id, allocated_amount,
          allocated_amount_base, fx_gain_loss_amount, allocation_date, created_at)
         VALUES (@id, @tenantId, @openItemId, @settlementTransactionId, @allocatedAmount,
                 @allocatedAmountBase, @fxGainLossAmount, @allocationDate, @createdAt)`)
            .run({
            id: (0, uuid_1.v4)(),
            tenantId: input.tenantId,
            openItemId: input.openItemId,
            settlementTransactionId: input.settlementTransactionId,
            allocatedAmount: input.allocatedAmount,
            allocatedAmountBase: input.allocatedAmountBase,
            fxGainLossAmount: input.fxGainLossAmount,
            allocationDate: input.allocationDate,
            createdAt: new Date().toISOString(),
        });
    }
    updateItemSettlement(input) {
        this.db
            .prepare(`UPDATE ar_ap_open_items
         SET remaining_amount = @remainingAmount, base_remaining_amount = @baseRemainingAmount,
             status = @status, updated_at = @updatedAt
         WHERE tenant_id = @tenantId AND id = @openItemId`)
            .run({ ...input, updatedAt: new Date().toISOString() });
    }
    /** شطب دين معدوم (القسم 6.1 — صلاحية الطبقة العليا تُفرض في الـ Controller) */
    writeOffItem(tenantId, openItemId, reason) {
        this.db
            .prepare(`UPDATE ar_ap_open_items
         SET status = 'written_off', write_off_reason = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ? AND status != 'settled'`)
            .run(reason, new Date().toISOString(), tenantId, openItemId);
        return this.findById(tenantId, openItemId);
    }
    /**
     * تسوية دفعة كاملة (تحصيل/سداد) على بنود الطرف بمنطق FIFO مع مرونة بند محدد مسبقًا.
     * ذرّية بالكامل: أي فشل في منتصف التوزيع = تراجع كل شيء (لا تخصيص جزئي معلّق).
     * يعيد وصف كل تخصيص أُنشئ وأثر فرق العملة المحسوب لكل بند على حدة (القسم 3.2).
     */
    settlePayment(input) {
        const run = this.db.transaction(() => {
            const queue = input.targetItemId
                ? (() => {
                    const item = this.findById(input.tenantId, input.targetItemId);
                    if (!item || item.status === "settled" || item.status === "written_off") {
                        throw new Error(`الفاتورة المحددة "${input.targetItemId}" غير موجودة أو مسدَّدة بالفعل — لا يمكن التخصيص لها`);
                    }
                    return [item];
                })()
                : this.findUnsettledItems(input.tenantId, input.contactId, input.subledgerType);
            // تطبيع مبلغ التسوية إلى عملة بنود الطرف (القسم 7):
            // في المسار القياسي يمرر settleFromEntry مبلغًا مطبَّعًا مسبقًا بسعر سطر الطرف الفعلي؛
            // هذا الاستدراك يغطي المسارات المباشرة التي تُقدّم مبلغًا بعملة لا تطابق أول بند في الطابور.
            // التحويل عبر الأساس: amount_item = amount_base ÷ سعر البند المخزَّن (سعر اليوم لا يُعرف هنا).
            const itemQueue = queue[0];
            if (itemQueue && input.itemCurrencyCode !== itemQueue.currencyCode) {
                const normalizationRate = new decimal_js_1.default(itemQueue.exchangeRate); // سعر عملة البنود ÷ الأساس
                if (normalizationRate.isFinite() && !normalizationRate.isZero()) {
                    input = {
                        ...input,
                        amountInItemCurrency: input.amountInBase.div(normalizationRate),
                        itemCurrencyCode: itemQueue.currencyCode,
                    };
                }
            }
            let remaining = input.amountInItemCurrency;
            const allocations = [];
            const planned = [];
            for (const item of queue) {
                if (remaining.lte(0))
                    break;
                const itemRemaining = new decimal_js_1.default(item.remainingAmount);
                const allocate = decimal_js_1.default.min(itemRemaining, remaining);
                if (allocate.lte(0))
                    continue;
                planned.push({ item, allocate, isLast: false });
                remaining = remaining.minus(allocate);
            }
            if (planned.length > 0)
                planned[planned.length - 1].isLast = true;
            let basePool = input.amountInBase;
            const totalAllocated = input.amountInItemCurrency.minus(decimal_js_1.default.max(remaining, new decimal_js_1.default(0)));
            for (const { item, allocate, isLast } of planned) {
                const itemRemaining = new decimal_js_1.default(item.remainingAmount);
                // السعر المثبَّت الفعلي للبنود المتبقية = الأساس المخزَّن ÷ المتبقي بالعملة الأصلية.
                const storedRatio = itemRemaining.gt(0)
                    ? new decimal_js_1.default(item.baseRemainingAmount).div(itemRemaining)
                    : new decimal_js_1.default(input.currentRate);
                // حصة هذا البند من النقد الفعلي المدفوع (تناسقية، وآخر مخصص يأخذ الباقي لمنع انحراف التقسيم)
                let allocatedBaseCash;
                if (isLast) {
                    allocatedBaseCash = basePool;
                }
                else {
                    allocatedBaseCash = new decimal_js_1.default(input.amountInBase.times(allocate.div(totalAllocated)).toFixed(Money_1.Money.STORAGE_DECIMALS));
                    basePool = basePool.minus(allocatedBaseCash);
                }
                // فرق العملة (القسم 3.2): النقد الفعلي المُخصَّس للبند ناقص قيمته المخزَّنة بالأساس.
                // عند تساوي سعر السطر مع سعر البنود المخزَّن يكون fx = 0 بدقة رياضية — لا قيد FX زائف.
                const expectedBaseCash = allocate.times(storedRatio);
                const fxGainLoss = allocatedBaseCash.minus(expectedBaseCash);
                // المتبقي الأساسي الجديد = المخزَّن × نسبة المتبقي الأصلي بعد التخصيص (تناسبي رياضيًا ≥ 0).
                // لا يُثبَّت عند الصفر بالتفريغ: التثبيت السابق كان يخفي انحرافًا تراكميًا يكسر invariant
                // (فاتورة مسددة تبقى لها قيمة أساسية متبقية تُحسب fx خطأً في التسويات اللاحقة).
                const newBaseRemaining = new decimal_js_1.default(item.baseRemainingAmount)
                    .times(itemRemaining.minus(allocate))
                    .div(itemRemaining.gt(0) ? itemRemaining : new decimal_js_1.default(1));
                const safeNewBaseRemaining = decimal_js_1.default.max(new decimal_js_1.default(newBaseRemaining.toFixed(Money_1.Money.STORAGE_DECIMALS)), new decimal_js_1.default(0));
                const newRemaining = itemRemaining.minus(allocate);
                const newStatus = newRemaining.eq(0) ? "settled" : "partially_paid";
                this.insertAllocation({
                    tenantId: input.tenantId,
                    openItemId: item.id,
                    settlementTransactionId: input.settlementTransactionId,
                    allocatedAmount: allocate.toFixed(Money_1.Money.STORAGE_DECIMALS),
                    allocatedAmountBase: allocatedBaseCash.toFixed(Money_1.Money.STORAGE_DECIMALS),
                    fxGainLossAmount: fxGainLoss.toFixed(Money_1.Money.STORAGE_DECIMALS),
                    allocationDate: input.settlementDate,
                });
                this.updateItemSettlement({
                    tenantId: input.tenantId,
                    openItemId: item.id,
                    remainingAmount: newRemaining.toFixed(Money_1.Money.STORAGE_DECIMALS),
                    baseRemainingAmount: safeNewBaseRemaining.toFixed(Money_1.Money.STORAGE_DECIMALS),
                    status: newStatus,
                });
                allocations.push({
                    openItemId: item.id,
                    contactId: item.contactId,
                    currencyCode: item.currencyCode,
                    allocatedAmount: allocate,
                    allocatedBase: allocatedBaseCash,
                    fxGainLossAmount: fxGainLoss,
                    itemNowSettled: newStatus === "settled",
                });
            }
            const overpayment = decimal_js_1.default.max(remaining, new decimal_js_1.default(0));
            const overpaymentBase = decimal_js_1.default.max(basePool, new decimal_js_1.default(0));
            // الدفعة الزائدة (القسم 3.3): تُسجَّل بندًا مفتوحًا بقيمة الفائض بنفس نوع الفرعي،
            // مرجعه معاملة التسوية نفسها — يظهر في كشف الحساب كرصيد دائن للطرف (advance credit)
            // بتاريخ التسوية، ويتصدر طابور FIFO في أول تسوية لاحقة (الأقدم أولًا).
            if (overpayment.gt(0)) {
                this.createOpenItem({
                    tenantId: input.tenantId,
                    contactId: input.contactId,
                    subledgerType: input.subledgerType,
                    sourceTransactionId: input.settlementTransactionId,
                    journalEntryId: input.settlementEntryId,
                    invoiceDate: input.settlementDate,
                    dueDate: null,
                    originalAmount: overpayment.toFixed(Money_1.Money.STORAGE_DECIMALS),
                    currencyCode: input.itemCurrencyCode,
                    exchangeRate: input.currentRate,
                    baseOriginalAmount: overpaymentBase.toFixed(Money_1.Money.STORAGE_DECIMALS),
                    isOverpayment: true,
                });
            }
            return { allocations, overpayment, overpaymentBase };
        });
        return run();
    }
}
exports.SqliteSubledgerRepository = SqliteSubledgerRepository;
//# sourceMappingURL=SqliteSubledgerRepository.js.map