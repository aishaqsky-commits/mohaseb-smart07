// src/infrastructure/sqlite/SqliteSubledgerRepository.ts
// ===== مستودع الذمم الفرعية (AR/AP Sub-Ledger) وفق docs/04-modules/ar-ap-subledger.md =====
// نمط الفاتورة المفتوحة (Open Item Accounting): إنشاء البنود، التخصيص FIFO، الأعمار، كشف الحساب.
// كل الكتابة عبر this.db.transaction(...) — ذرّية SQLite المتزامنة (نفس نمط SqliteJournalRepository).

import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import Decimal from "decimal.js";
import { Money } from "../../domain/value-objects/Money";

export type SubledgerType = "AR" | "AP";
export type OpenItemStatus = "open" | "partially_paid" | "settled" | "written_off";

export interface OpenItemRow {
  id: string;
  tenantId: string;
  contactId: string;
  subledgerType: SubledgerType;
  sourceTransactionId: string;
  journalEntryId: string;
  invoiceDate: string;   // YYYY-MM-DD
  dueDate: string | null;
  originalAmount: string; // Decimal كنص بعملة الفاتورة
  remainingAmount: string;
  currencyCode: string;
  exchangeRate: string;   // مثبّت وقت الإنشاء → عملة الأساس
  baseRemainingAmount: string;
  status: OpenItemStatus;
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

interface DbRow { [k: string]: unknown }

const OPEN_ITEM_SELECT_COLUMNS = `
  id, tenant_id, contact_id, subledger_type, source_transaction_id, journal_entry_id,
  invoice_date, due_date, original_amount, remaining_amount, currency_code,
  exchange_rate, base_remaining_amount, status`;

function rowToOpenItem(row: DbRow): OpenItemRow {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    contactId: row.contact_id as string,
    subledgerType: row.subledger_type as SubledgerType,
    sourceTransactionId: row.source_transaction_id as string,
    journalEntryId: row.journal_entry_id as string,
    invoiceDate: row.invoice_date as string,
    dueDate: (row.due_date as string | null) ?? null,
    originalAmount: row.original_amount as string,
    remainingAmount: row.remaining_amount as string,
    currencyCode: row.currency_code as string,
    exchangeRate: row.exchange_rate as string,
    baseRemainingAmount: row.base_remaining_amount as string,
    status: row.status as OpenItemStatus,
  };
}

export class SqliteSubledgerRepository {
  constructor(private readonly db: Database.Database) {}

  // ===================== قراءة =====================

  /** البنود غير المسددة لطرف، مرتبة FIFO (الأقدم document_date أولًا — القسم 3.2) */
  findUnsettledItems(tenantId: string, contactId: string, subledgerType: SubledgerType): OpenItemRow[] {
    const rows = this.db
      .prepare(
        `SELECT ${OPEN_ITEM_SELECT_COLUMNS} FROM ar_ap_open_items
         WHERE tenant_id = ? AND contact_id = ? AND subledger_type = ?
           AND status IN ('open', 'partially_paid')
         ORDER BY invoice_date ASC, created_at ASC`
      )
      .all(tenantId, contactId, subledgerType) as DbRow[];
    return rows.map(rowToOpenItem);
  }

  findById(tenantId: string, itemId: string): OpenItemRow | null {
    const row = this.db
      .prepare(`SELECT ${OPEN_ITEM_SELECT_COLUMNS} FROM ar_ap_open_items WHERE tenant_id = ? AND id = ?`)
      .get(tenantId, itemId) as DbRow | undefined;
    return row ? rowToOpenItem(row) : null;
  }

  /** كل بنود الطرف (لأغراض كشف الحساب والربط العكسي للمرتجعات) */
  findAllItemsForContact(tenantId: string, contactId: string): OpenItemRow[] {
    const rows = this.db
      .prepare(
        `SELECT ${OPEN_ITEM_SELECT_COLUMNS} FROM ar_ap_open_items
         WHERE tenant_id = ? AND contact_id = ? ORDER BY invoice_date ASC, created_at ASC`
      )
      .all(tenantId, contactId) as DbRow[];
    return rows.map(rowToOpenItem);
  }

  hasAllocationsForSourceTransaction(tenantId: string, sourceTransactionId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ar_ap_allocations a
         JOIN ar_ap_open_items o ON o.id = a.open_item_id
         WHERE o.tenant_id = ? AND o.source_transaction_id = ?`
      )
      .get(tenantId, sourceTransactionId) as { n: number };
    return row.n > 0;
  }

  /** كل البنود غير المسددة لنوع فرعي عبر كل الأطراف (أساس تقرير الأعمار §5.1 — يستغل فهرس idx_open_items_aging) */
  listAllUnsettledByType(tenantId: string, subledgerType: SubledgerType): OpenItemRow[] {
    const rows = this.db
      .prepare(
        `SELECT ${OPEN_ITEM_SELECT_COLUMNS} FROM ar_ap_open_items
         WHERE tenant_id = ? AND subledger_type = ? AND status IN ('open', 'partially_paid')
         ORDER BY invoice_date ASC, created_at ASC`
      )
      .all(tenantId, subledgerType) as DbRow[];
    return rows.map(rowToOpenItem);
  }

  /** تخصيصات بند واحد (سطور «دفعة/تحصيل» في كشف الحساب §6.1) */
  listAllocationsForItem(openItemId: string): AllocationRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, tenant_id, open_item_id, settlement_transaction_id, allocated_amount,
                allocated_amount_base, fx_gain_loss_amount, allocation_date
         FROM ar_ap_allocations WHERE open_item_id = ? ORDER BY allocation_date ASC, created_at ASC`
      )
      .all(openItemId) as DbRow[];
    return rows.map((r) => ({
      id: r.id as string,
      tenantId: r.tenant_id as string,
      openItemId: r.open_item_id as string,
      settlementTransactionId: r.settlement_transaction_id as string,
      allocatedAmount: r.allocated_amount as string,
      allocatedAmountBase: r.allocated_amount_base as string,
      fxGainLossAmount: r.fx_gain_loss_amount as string,
      allocationDate: r.allocation_date as string,
    }));
  }

  // ===================== كتابة (ذرّية) =====================

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
  }): OpenItemRow {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO ar_ap_open_items
         (id, tenant_id, contact_id, subledger_type, source_transaction_id, journal_entry_id,
          invoice_date, due_date, original_amount, remaining_amount, currency_code,
          exchange_rate, base_remaining_amount, status, created_at, updated_at)
         VALUES (@id, @tenantId, @contactId, @subledgerType, @sourceTransactionId, @journalEntryId,
                 @invoiceDate, @dueDate, @originalAmount, @remainingAmount, @currencyCode,
                 @exchangeRate, @baseRemainingAmount, 'open', @createdAt, @updatedAt)`
      )
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
        remainingAmount: input.originalAmount,
        currencyCode: input.currencyCode,
        exchangeRate: input.exchangeRate,
        baseRemainingAmount: input.baseOriginalAmount,
        createdAt: now,
        updatedAt: now,
      });
    const created = this.findById(input.tenantId, id);
    if (!created) throw new Error("فشل إنشاء البند المفتوح (تعذّر قراءته بعد الإدراج)");
    return created;
  }

  insertAllocation(input: {
    tenantId: string;
    openItemId: string;
    settlementTransactionId: string;
    allocatedAmount: string;
    allocatedAmountBase: string;
    fxGainLossAmount: string;
    allocationDate: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO ar_ap_allocations
         (id, tenant_id, open_item_id, settlement_transaction_id, allocated_amount,
          allocated_amount_base, fx_gain_loss_amount, allocation_date, created_at)
         VALUES (@id, @tenantId, @openItemId, @settlementTransactionId, @allocatedAmount,
                 @allocatedAmountBase, @fxGainLossAmount, @allocationDate, @createdAt)`
      )
      .run({
        id: uuidv4(),
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

  updateItemSettlement(input: {
    tenantId: string;
    openItemId: string;
    remainingAmount: string;
    baseRemainingAmount: string;
    status: OpenItemStatus;
  }): void {
    this.db
      .prepare(
        `UPDATE ar_ap_open_items
         SET remaining_amount = @remainingAmount, base_remaining_amount = @baseRemainingAmount,
             status = @status, updated_at = @updatedAt
         WHERE tenant_id = @tenantId AND id = @openItemId`
      )
      .run({ ...input, updatedAt: new Date().toISOString() });
  }

  /** شطب دين معدوم (القسم 6.1 — صلاحية الطبقة العليا تُفرض في الـ Controller) */
  writeOffItem(tenantId: string, openItemId: string, reason: string): OpenItemRow | null {
    this.db
      .prepare(
        `UPDATE ar_ap_open_items
         SET status = 'written_off', write_off_reason = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ? AND status != 'settled'`
      )
      .run(reason, new Date().toISOString(), tenantId, openItemId);
    return this.findById(tenantId, openItemId);
  }

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
    amountInItemCurrency: Decimal; // مبلغ التسوية معادلًا بعملة البنود إن اختلفت (القسم 7)
    amountInBase: Decimal;         // المبلغ نفسه بعملة الأساس بسعر اليوم
    itemCurrencyCode: string;      // عملة بنود الطرف المستهدفة
    currentRate: string;           // سعر الصرف السائد الآن → الأساس (لفروق العملة)
    targetItemId?: string | null;
  }): SettleOutcome {
    const run = this.db.transaction((): SettleOutcome => {
      const queue = input.targetItemId
        ? (() => {
            const item = this.findById(input.tenantId, input.targetItemId!);
            if (!item || item.status === "settled" || item.status === "written_off") {
              throw new Error(
                `الفاتورة المحددة "${input.targetItemId}" غير موجودة أو مسدَّدة بالفعل — لا يمكن التخصيص لها`
              );
            }
            return [item];
          })()
        : this.findUnsettledItems(input.tenantId, input.contactId, input.subledgerType);

      let remaining = input.amountInItemCurrency;
      const allocations: SettleAllocation[] = [];
      const currentRate = new Decimal(input.currentRate);

      // نسبة المبلغ الأساسي إلى المخصَّص بالعملة الأصلية عبر كل البند — تحفظ invariant
      // Σ allocated_base = المبلغ النقدي المدفوع فعليًا (بدون انحراف تقريبي متراكم)،
      // والفارق عن القيمة المخزَّنة يظهر كـ fxGainLoss لكل بند.
      let basePool = input.amountInBase;
      let consumedItemCcy = new Decimal(0);

      for (const item of queue) {
        if (remaining.lte(0)) break;
        const itemRemaining = new Decimal(item.remainingAmount);
        const allocate = Decimal.min(itemRemaining, remaining);
        if (allocate.lte(0)) continue;

        // فرق العملة (القسم 3.2): قيمة المخصَّص بسعر اليوم ناقص قيمته المخزَّنة بالأساس.
        // نسبة المتبقي الأساسي/المتبقي الأصلي = السعر الفعلي المثبَّت لهذا البند تحديداً.
        const allocatedBaseToday = allocate.times(currentRate);
        const itemBaseRatio = itemRemaining.gt(0)
          ? new Decimal(item.baseRemainingAmount).div(itemRemaining)
          : currentRate;
        const allocatedBaseStored = allocate.times(itemBaseRatio);
        const fxGainLoss = allocatedBaseToday.minus(allocatedBaseStored);

        // حصة هذا البند من النقد الفعلي المدفوع (نسبة تناسقية، والباقي كاملاً للبند الأخير)
        let allocatedBaseCash: Decimal;
        if (remaining.eq(allocate)) {
          // آخر مخصص في الطابور — يأخذ كامل المتبقي من مجمّع النقد لمنع انحراف التقسيم
          allocatedBaseCash = basePool;
        } else {
          const shareRatio = allocate.div(input.amountInItemCurrency);
          allocatedBaseCash = new Decimal(
            input.amountInBase.times(shareRatio).toFixed(Money.STORAGE_DECIMALS)
          );
          basePool = basePool.minus(allocatedBaseCash);
        }

        const newRemaining = itemRemaining.minus(allocate);
        const rawNewBaseRemaining = new Decimal(item.baseRemainingAmount).minus(allocatedBaseStored);
        // حماية: بهوامش التقريب قد تنكمش القيمة الأساسية إلى سالب طفيف — تُثبَّت عند الصفر
        const safeBaseRemaining = Decimal.max(rawNewBaseRemaining, new Decimal(0));
        const newStatus: OpenItemStatus = newRemaining.eq(0) ? "settled" : "partially_paid";

        this.insertAllocation({
          tenantId: input.tenantId,
          openItemId: item.id,
          settlementTransactionId: input.settlementTransactionId,
          allocatedAmount: allocate.toFixed(Money.STORAGE_DECIMALS),
          allocatedAmountBase: allocatedBaseCash.toFixed(Money.STORAGE_DECIMALS),
          fxGainLossAmount: fxGainLoss.toFixed(Money.STORAGE_DECIMALS),
          allocationDate: input.settlementDate,
        });

        this.updateItemSettlement({
          tenantId: input.tenantId,
          openItemId: item.id,
          remainingAmount: newRemaining.toFixed(Money.STORAGE_DECIMALS),
          baseRemainingAmount: safeBaseRemaining.toFixed(Money.STORAGE_DECIMALS),
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

        remaining = remaining.minus(allocate);
      }

      const overpayment = Decimal.max(remaining, new Decimal(0));
      const overpaymentBase = Decimal.max(basePool, new Decimal(0));

      // الدفعة الزائدة (القسم 3.3): تُسجَّل بندًا مفتوحًا بقيمة الفائض بنفس نوع الفرعي،
      // مرجعه معاملة التسوية نفسها — يظهر في كشف الحساب كرصيد للطرف يُستهلك لاحقًا.
      // ملاحظة إصدار أول: الفائض لا يُخصم تلقائيًا من الفواتير القادمة؛ الاستعلام عنه متاح عبر findUnsettledItems.
      if (overpayment.gt(0)) {
        this.createOpenItem({
          tenantId: input.tenantId,
          contactId: input.contactId,
          subledgerType: input.subledgerType,
          sourceTransactionId: input.settlementTransactionId,
          journalEntryId: input.settlementEntryId,
          invoiceDate: input.settlementDate,
          dueDate: null,
          originalAmount: overpayment.toFixed(Money.STORAGE_DECIMALS),
          currencyCode: input.itemCurrencyCode,
          exchangeRate: input.currentRate,
          baseOriginalAmount: overpaymentBase.toFixed(Money.STORAGE_DECIMALS),
        });
      }

      return { allocations, overpayment, overpaymentBase };
    });
    return run();
  }
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
