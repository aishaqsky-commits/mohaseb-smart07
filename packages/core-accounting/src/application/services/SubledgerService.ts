// src/application/services/SubledgerService.ts
// ===== خدمة الذمم الفرعية (AR/AP Sub-Ledger) — وفق docs/04-modules/ar-ap-subledger.md =====
// الحلقة الواصلة بين محرك القوالب (post_actions) ومستودع البنود المفتوحة:
//   createOpenItem        → بند AR/AP من قيد العملية الآجلة (sale_credit/purchase_credit/sale_partial...)
//   allocate_to_invoice   → تسوية FIFO مع فرق عملة لكل بند على حدة + قيد FX تلقائي (4900 ربح / 5900 خسارة)
// المبدأ الحاكم: لا تُبنى القيود يدويًا خارج JournalEngine — هذه الخدمة تستدعي المحرك حصريًا.

import Decimal from "decimal.js";
import type Database from "better-sqlite3";
import { JournalEngine, PostLineRequest } from "../JournalEngine";
import {
  SqliteSubledgerRepository,
  SettleOutcome,
  SubledgerType,
} from "../../infrastructure/sqlite/SqliteSubledgerRepository";
import { AccountRepository } from "../../domain/ports/AccountRepository";
import { PostActionContext } from "../../templates/ports/PostActionPort";
import {
  InvalidTemplatePayloadError,
  SubledgerOperationError,
} from "../errors/ApplicationErrors";

/** حسابا فروق العملة المعتمدان في بذرة core (§6.1: 4900 أرباح / 5900 خسائر فروق العملة) */
const FX_GAIN_ACCOUNT_CODE = "4900";
const FX_LOSS_ACCOUNT_CODE = "5900";
/** حسابا الضبط المقابل حسب نوع الفرعي — يُتحقق من وجودهما الفعلي في الشجرة قبل الترحيل */
const CONTROL_ACCOUNT_CODES: Record<SubledgerType, string> = {
  AR: "1210", // ذمم مدينة — العملاء
  AP: "2110", // ذمم دائنة — الموردون
};

export interface AgingBucketRow {
  contactId: string;
  current: string;
  days_1_30: string;
  days_31_60: string;
  days_61_90: string;
  over_90: string;
  total: string;
}

export interface StatementLine {
  date: string;
  type: "invoice" | "settlement";
  description: string;
  debit: string;
  credit: string;
  running_balance: string;
}

export interface ContactStatement {
  contactId: string;
  lines: StatementLine[];
  closingBalance: string;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * خدمة التطبيق للذمم الفرعية: بنود مفتوحة، تسويات FIFO، أعمار الديون، كشف الحساب، الشطب، ومنع العكس.
 * تستقر في طبقة التطبيق وتتحدث إلى المنافذ والمحركات فقط (نفس نمط RecordTransactionService).
 */
export class SubledgerService {
  readonly repo: SqliteSubledgerRepository;

  constructor(
    db: Database.Database,
    private readonly journalEngine: JournalEngine,
    private readonly accountRepo: AccountRepository,
    /** عملة الأساس للمنشأة — تُحقن من مركّب الاعتماديات (لا استنتاج حرفي داخل الخدمة) */
    private readonly baseCurrencyCode: string
  ) {
    this.repo = new SqliteSubledgerRepository(db);
  }

  // ===================== الربط بمحرك القوالب (post_actions) =====================

  /**
   * تسجيل معالجات post_actions في السجل العام. الأسماء مطابقة لاستخدامات مكتبة القوالب:
   * - createOpenItem(customer_id | supplier_id)     ← قوالب البيع/الشراء الآجل والجزئي
   * - allocate_to_invoice({{invoice_ref}})          ← قوالب التحصيل/السداد
   * - apply_fx_gain_loss_if_needed                  ← no-op موثّق (§4: أُدمج داخل التخصيص نفسه)
   */
  registerPostActions(registry: {
    register(name: string, handler: (args: unknown[], ctx: PostActionContext) => Promise<void>): void;
  }): void {
    registry.register("createOpenItem", async (args, ctx) => {
      const contactKey = String(args[0] ?? "contact_id");
      await this.createFromEntry(ctx, contactKey);
    });

    const allocateHandler = async (_args: unknown[], ctx: PostActionContext): Promise<void> => {
      await this.settleFromEntry(ctx);
    };
    registry.register("allocate_to_invoice", allocateHandler);
    // الاسم الوارد في نص التصميم §4 — مرادف للتوافق المستقبلي
    registry.register("allocatePayment", allocateHandler);

    // §4: فرق العملة يُحسب الآن داخل التخصيص لكل بند على حدة (أدق محاسبيًا عند تعدد الفواتير)؛
    // يُسجَّل كـ no-op صريح حتى لا يُطبع تحذير «تم تجاهله» عند كل تسوية.
    registry.register("apply_fx_gain_loss_if_needed", async () => {});
  }

  /**
   * إنشاء بند مفتوح من سطر القيد ذي الصلة بالطرف (سطر يحمل contact_ref في القالب).
   * البند يُقيَّم بعملة السطر وسعره المثبَّت وقت الإنشاء — أساس حساب فروق العملة لاحقًا (§3.2).
   */
  async createFromEntry(ctx: PostActionContext, contactKey: string): Promise<void> {
    const entry = ctx.primaryEntry;
    if (!entry) throw new InvalidTemplatePayloadError("سياق post_action يفتقر إلى القيد الرئيسي");
    const contactId = ctx.payload[contactKey];
    if (typeof contactId !== "string" || contactId === "") return; // بلا طرف ⇒ عملية نقدية، لا ذمم

    const line =
      entry.lines.find((l) => l.contactId === contactId) ??
      entry.lines.find((l) => l.contactId != null);
    if (!line) return;

    const subledgerType: SubledgerType = line.side === "debit" ? "AR" : "AP";
    const dueDateRaw = ctx.payload["due_date"];
    const dueDate = typeof dueDateRaw === "string" && dueDateRaw !== "" ? dueDateRaw : null;

    this.repo.createOpenItem({
      tenantId: ctx.tenantId,
      contactId,
      subledgerType,
      sourceTransactionId: ctx.transactionId,
      journalEntryId: entry.id,
      invoiceDate: toIsoDate(entry.entryDate),
      dueDate,
      originalAmount: line.amount.toStorageString(),
      currencyCode: line.amount.currencyCode,
      exchangeRate: line.exchangeRateUsed,
      baseOriginalAmount: line.baseAmount.toStorageString(),
    });
  }

  /**
   * تسوية دفعة انطلاقًا من قيد التسوية نفسه (customer_collection / supplier_payment):
   * سطر الطرف يحدد النوع (دائن على حساب الطرف ⇒ AR)، والسطر النقدي المقابل يحدد المبلغ بسعر اليوم.
   */
  async settleFromEntry(ctx: PostActionContext): Promise<SettleOutcome | null> {
    const entry = ctx.primaryEntry;
    if (!entry) throw new InvalidTemplatePayloadError("سياق post_action يفتقر إلى القيد الرئيسي");

    const contactLine = entry.lines.find((l) => l.contactId != null);
    if (!contactLine) return null; // بلا طرف ⇒ لا شيء لتخصيصه

    // السطر المقابل لسطر الطرف يحمل التدفق النقدي (مدين صندوق في التحصيل / دائن صندوق في الدفع)
    const cashSide = contactLine.side === "credit" ? "debit" : "credit";
    const cashLine =
      entry.lines.find((l) => l.side === cashSide && l.accountId !== contactLine.accountId) ??
      entry.lines.find((l) => l.side === cashSide);
    if (!cashLine) return null;

    const subledgerType: SubledgerType = contactLine.side === "credit" ? "AR" : "AP";
    // المجمّع النقدي الفعلي بعملة الأساس من السطر غير المرتبط بالطرف (مدين الصندوق/البنك) —
    // لا يُشتق من سطر الطرف لأنه يحمل سعر اليوم لا السعر المخزَّن للبنود.
    const cashLines = entry.lines.filter((l) => l.contactId == null && l.side === cashSide);
    const amountInBase = cashLines.reduce(
      (acc, l) => acc.plus(new Decimal(l.baseAmount.toStorageString())),
      new Decimal(0)
    );
    // القسم 7: لو اختلفت عملة التحصيل عن عملة بنود الطرف يُحوَّل المبلغ أولًا بسعر اليوم
    const itemRate = new Decimal(contactLine.exchangeRateUsed);
    const amountInItemCurrency =
      cashLine.amount.currencyCode === contactLine.amount.currencyCode
        ? new Decimal(cashLine.amount.toStorageString())
        : amountInBase.div(itemRate);

    const targetRef = ctx.payload["invoice_ref"];
    const outcome = this.repo.settlePayment({
      tenantId: ctx.tenantId,
      contactId: contactLine.contactId!,
      subledgerType,
      settlementTransactionId: ctx.transactionId,
      settlementEntryId: entry.id,
      settlementDate: toIsoDate(entry.entryDate),
      amountInItemCurrency,
      amountInBase,
      itemCurrencyCode: contactLine.amount.currencyCode,
      currentRate: cashLine.exchangeRateUsed,
      targetItemId: typeof targetRef === "string" && targetRef !== "" ? targetRef : null,
    });

    // §3.2 + القسم 8 (قاعدة التكامل): كل fx_gain_loss ≠ 0 يجب أن يملك قيدًا — يُنشأ تلقائيًا هنا
    const netFx = outcome.allocations.reduce(
      (acc, a) => acc.plus(a.fxGainLossAmount),
      new Decimal(0)
    );
    if (!netFx.isZero()) {
      await this.postFxEntry(ctx.tenantId, entry.entryDate, netFx, subledgerType);
    }
    return outcome;
  }

  /**
   * قيد فرق العملة (§3.2) بالعملة الأساسية مباشرة (فرق الصرف مُعبَّر عنه بالأساس أصلًا).
   * الاشتقاق (open-item القياسي): الدين الأصلي بالأساس D، قيمة التحصيل الفعلية بالأساس C.
   * netFx = C − D. قيد التسوية سجّل النقد بقيمة C كاملًا وأغلق الذمم بقيمة D فقط،
   * فالفرق يُعترف به مستقلًا:
   *   ربح (C>D):  مدين حساب التحكم (استكمال إغلاق المستحق الزائد عن المخزَّن) / دائن 4900 أرباح FX
   *   خسارة (C<D): دائن حساب التحكم / مدين 5900 خسائر FX
   * (كشف الحساب والتسويات يعتمدان جدول التخصيصات لا هذه القيود، فلا يتأثر الرصيد الفرعي.)
   */
  private async postFxEntry(
    tenantId: string,
    entryDate: Date,
    netFx: Decimal,
    subledgerType: SubledgerType
  ): Promise<void> {
    const amountStr = netFx.abs().toFixed(4);
    if (new Decimal(amountStr).isZero()) return;

    const controlCode = CONTROL_ACCOUNT_CODES[subledgerType];
    const isGain = netFx.greaterThan(0);
    const fxCode = isGain ? FX_GAIN_ACCOUNT_CODE : FX_LOSS_ACCOUNT_CODE;

    await this.assertAccountsExist(tenantId, [controlCode, fxCode]);

    const lines: PostLineRequest[] = isGain
      ? [
          { accountCode: controlCode, side: "debit", amount: amountStr, currencyCode: this.baseCurrencyCode, exchangeRateUsed: "1", memoAr: "فرق عملة — استلام يزيد عن المستحق المخزَّن" },
          { accountCode: fxCode, side: "credit", amount: amountStr, currencyCode: this.baseCurrencyCode, exchangeRateUsed: "1", memoAr: "أرباح فروق عملة من تسوية" },
        ]
      : [
          { accountCode: controlCode, side: "credit", amount: amountStr, currencyCode: this.baseCurrencyCode, exchangeRateUsed: "1", memoAr: "فرق عملة — استلام يقل عن المستحق المخزَّن" },
          { accountCode: fxCode, side: "debit", amount: amountStr, currencyCode: this.baseCurrencyCode, exchangeRateUsed: "1", memoAr: "خسائر فروق عملة من تسوية" },
        ];

    await this.journalEngine.postEntry({
      tenantId,
      entryDate,
      descriptionSimple: `قيد فرق عملة (${isGain ? "ربح" : "خسارة"} ${amountStr} ${this.baseCurrencyCode})`,
      sourceType: "system_adjustment",
      baseCurrencyCode: this.baseCurrencyCode,
      lines,
    });
  }

  // ===================== القراءة والتقارير =====================

  findUnsettledItems(tenantId: string, contactId: string, category?: SubledgerType) {
    if (category) return this.repo.findUnsettledItems(tenantId, contactId, category);
    return [
      ...this.repo.findUnsettledItems(tenantId, contactId, "AR"),
      ...this.repo.findUnsettledItems(tenantId, contactId, "AP"),
    ];
  }

  /**
   * أعمار الديون (§5.1): المرجع = due_date ?? invoice_date، والتجميع بعملة الأساس.
   * age <= 0 ⇒ current (لم يستحق بعد).
   */
  calculateAging(tenantId: string, category: SubledgerType, asOfDate?: string): AgingBucketRow[] {
    const asOf = new Date(asOfDate ?? new Date());
    if (Number.isNaN(asOf.getTime())) {
      throw new InvalidTemplatePayloadError(`تاريخ "as_of_date" غير صالح: ${asOfDate}`);
    }
    const rows = this.repo.listAllUnsettledByType(tenantId, category);
    type BucketKey = "current" | "days_1_30" | "days_31_60" | "days_61_90" | "over_90";
    const byContact = new Map<string, Record<BucketKey, Decimal>>();

    for (const item of rows) {
      const refDate = new Date(item.dueDate ?? item.invoiceDate);
      if (Number.isNaN(refDate.getTime())) continue; // بيانات تاريخ تالفة — تُتجاهل في التقرير لا تُسقطه
      const ageDays = Math.floor((asOf.getTime() - refDate.getTime()) / 86_400_000);
      const bucket: BucketKey =
        ageDays <= 0 ? "current" :
        ageDays <= 30 ? "days_1_30" :
        ageDays <= 60 ? "days_31_60" :
        ageDays <= 90 ? "days_61_90" : "over_90";

      const acc = byContact.get(item.contactId) ?? {
        current: new Decimal(0), days_1_30: new Decimal(0), days_31_60: new Decimal(0),
        days_61_90: new Decimal(0), over_90: new Decimal(0),
      };
      acc[bucket] = acc[bucket].plus(new Decimal(item.baseRemainingAmount));
      byContact.set(item.contactId, acc);
    }

    return [...byContact.entries()].map(([contactId, b]) => ({
      contactId,
      current: b.current.toFixed(4),
      days_1_30: b.days_1_30.toFixed(4),
      days_31_60: b.days_31_60.toFixed(4),
      days_61_90: b.days_61_90.toFixed(4),
      over_90: b.over_90.toFixed(4),
      total: Object.values(b).reduce((a, v) => a.plus(v), new Decimal(0)).toFixed(4),
    }));
  }

  /** ملخص الأعمار للوحة الرئيسية (§6.2 /reports/aging/summary): إجمالي كل Bucket عبر كل الأطراف */
  agingSummary(tenantId: string, category: SubledgerType, asOfDate?: string) {
    const rows = this.calculateAging(tenantId, category, asOfDate);
    const sum = (k: keyof Omit<AgingBucketRow, "contactId">) =>
      rows.reduce((acc, r) => acc.plus(new Decimal(r[k])), new Decimal(0)).toFixed(4);
    return {
      current: sum("current"),
      days_1_30: sum("days_1_30"),
      days_31_60: sum("days_31_60"),
      days_61_90: sum("days_61_90"),
      over_90: sum("over_90"),
      total: sum("total"),
    };
  }

  /**
   * كشف حساب الطرف (§6.1): فواتير بتواريخها ثم تسوياتها (من جدول التخصيصات) بالترتيب الزمني،
   * والرصيد الجاري بمعنى «المستحق الصافي على الطرف»: الفواتير تزيد والتحصيلات تنقص (AR)،
   * وعكس الاتجاه يُقرأ من الإشارة نفسها في AP (التزام علينا).
   */
  buildStatement(tenantId: string, contactId: string): ContactStatement {
    const items = this.repo.findAllItemsForContact(tenantId, contactId);
    const events: Array<{ date: string; type: StatementLine["type"]; description: string; delta: Decimal }> = [];

    for (const item of items) {
      const isAR = item.subledgerType === "AR";
      const originalBase = new Decimal(item.originalAmount).times(new Decimal(item.exchangeRate));
      events.push({
        date: item.invoiceDate,
        type: "invoice",
        description: isAR ? `فاتورة بيع آجل (${item.currencyCode})` : `فاتورة شراء آجل (${item.currencyCode})`,
        delta: isAR ? originalBase : originalBase.negated(),
      });

      for (const alloc of this.repo.listAllocationsForItem(item.id)) {
        const allocatedBase = new Decimal(alloc.allocatedAmountBase);
        events.push({
          date: alloc.allocationDate,
          type: "settlement",
          description: `تسوية على بند ${item.invoiceDate}`,
          delta: isAR ? allocatedBase.negated() : allocatedBase,
        });
      }
    }

    events.sort((a, b) => a.date.localeCompare(b.date));
    let running = new Decimal(0);
    const lines: StatementLine[] = events.map((e) => {
      running = running.plus(e.delta);
      return {
        date: e.date,
        type: e.type,
        description: e.description,
        debit: e.delta.gt(0) ? e.delta.toFixed(4) : "0.0000",
        credit: e.delta.lt(0) ? e.delta.abs().toFixed(4) : "0.0000",
        running_balance: running.toFixed(4),
      };
    });
    return { contactId, lines, closingBalance: running.toFixed(4) };
  }

  /** شطب دين معدوم (§6.1 — صلاحية المالك تُفرض في طبقة العرض/الـ Controller) */
  writeOff(tenantId: string, openItemId: string, reason: string) {
    if (!reason || reason.trim() === "") {
      throw new InvalidTemplatePayloadError("سبب الشطب إلزامي لأغراض التدقيق");
    }
    const item = this.repo.findById(tenantId, openItemId);
    if (!item) throw new SubledgerOperationError(`البند المفتوح "${openItemId}" غير موجود`);
    if (item.status === "settled") throw new SubledgerOperationError("لا يمكن شطب بند مسدَّد بالكامل");
    if (item.status === "written_off") throw new SubledgerOperationError("البند مشطوب مسبقًا");
    return this.repo.writeOffItem(tenantId, openItemId, reason.trim());
  }

  /** منع عكس فاتورة لها تخصيصات (§7 — قيد تطبيقي صارم يمنع كسر تكامل البيانات) */
  assertReversible(tenantId: string, sourceTransactionId: string): void {
    if (this.repo.hasAllocationsForSourceTransaction(tenantId, sourceTransactionId)) {
      throw new SubledgerOperationError(
        "لا يمكن عكس هذه الفاتورة لأن لها دفعات مُخصَّصة عليها — ألغِ التخصيصات أولًا ثم اعكِس الفاتورة"
      );
    }
  }

  /** رصيد الطرف الفوري (§6.1 /contacts/{id}/balance) */
  getBalance(tenantId: string, contactId: string): { ar: string; ap: string } {
    const sum = (t: SubledgerType) =>
      this.repo
        .findUnsettledItems(tenantId, contactId, t)
        .reduce((acc, i) => acc.plus(new Decimal(i.baseRemainingAmount)), new Decimal(0))
        .toFixed(4);
    return { ar: sum("AR"), ap: sum("AP") };
  }

  // ===================== مساعدات داخلية =====================

  /** فشل سريع برسالة عربية واضحة بدل AccountNotFoundError الغامضة في عمق المحرك */
  private async assertAccountsExist(tenantId: string, codes: string[]): Promise<void> {
    const map = await this.accountRepo.findManyByCodes(tenantId, codes);
    const missing = codes.filter((c) => !map.has(c));
    if (missing.length > 0) {
      throw new SubledgerOperationError(
        `حسابات مطلوبة للذمم الفرعية غير متوفرة في شجرة هذه المنشأة: ${missing.join(", ")}`
      );
    }
  }
}
