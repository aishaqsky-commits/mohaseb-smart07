// src/application/services/PeriodClosingService.ts
// ===== محرك إقفال الفترات المحاسبية — docs/04-modules/financial-reporting.md §4 =====
// تصميم Hot/Cold (§2.1): بعد الإقفال تصبح الفترة باردة (لقطة مجمّدة)؛ القيود فيها تُرفض،
// والتقارير تقرأ اللقطة بدل مسح القيود. كل خطوة §4.1/§4.2 تُنفَّذ داخل معاملة ذرية واحدة.

import Database from "better-sqlite3";
import Decimal from "decimal.js";
import { randomUUID } from "crypto";
import { JournalEntry, JournalEntrySourceType } from "../../domain/entities/JournalEntry";
import { JournalLine } from "../../domain/entities/JournalLine";
import { Money } from "../../domain/value-objects/Money";
import { BalanceMaintenanceStore } from "../../infrastructure/sqlite/BalanceMaintenanceStore";

export interface FiscalPeriodRow {
  id: string;
  tenantId: string;
  periodKey: string; // "2026-09" أو "2026"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: "open" | "closed";
}

export interface CloseResult {
  period: FiscalPeriodRow;
  snapshotAccounts: number;
  closingEntryId: string | null;
  nextPeriodKey: string | null;
}

export interface ReopenResult {
  period: FiscalPeriodRow;
  restoredAccounts: number;
  reversalEntryId: string;
}

/** استثناءات نطاق هذه الخدمة (تُترجم لاحقًا في الـ API إلى أكواد HTTP مناسبة) */
export class PeriodNotFoundError extends Error {
  constructor() {
    super("الفترة المحاسبية غير موجودة");
    this.name = "PeriodNotFoundError";
  }
}
export class PeriodStateError extends Error {}
export class PermissionDeniedError extends Error {
  constructor(permission: string) {
    super(`صلاحية مطلوبة: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

interface AccountInfoRow {
  id: string;
  code: string;
  account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
}

const RETAINED_EARNINGS_CODE = "3300"; // الأرباح المرحّلة (§4.1 — بذرة حقوق الملكية)

/**
 * محرك الإقفال. الصلاحيات (§9 حوكمة): periods.close للمحاسب/المالك،
 * وperiods.reopen أعلى (المالك فقط + سبب إلزامي + سجل تدقيق).
 */
export class PeriodClosingService {
  private readonly balanceStore: BalanceMaintenanceStore;

  constructor(private readonly db: Database.Database) {
    // إعادة استخدام نفس طبقة الصيانة الذرية — لا منطق أرصدة مكرر أبدًا (DRY)
    this.balanceStore = new BalanceMaintenanceStore(db);
  }

  /** إنشاء فترة محاسبية جديدة (شهرية أو سنوية) — lazy عند الحاجة */
  createPeriod(tenantId: string, periodKey: string, userId?: string): FiscalPeriodRow {
    const { start, end } = parsePeriodKey(periodKey);
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO fiscal_periods (id, tenant_id, period_key, start_date, end_date, status)
         VALUES (?, ?, ?, ?, ?, 'open')`
      )
      .run(id, tenantId, periodKey, start, end);
    return {
      id,
      tenantId,
      periodKey,
      startDate: start,
      endDate: end,
      status: "open",
    };
  }

  getPeriod(tenantId: string, periodId: string): FiscalPeriodRow | null {
    const row = this.db
      .prepare(
        `SELECT id, tenant_id, period_key, start_date, end_date, status
         FROM fiscal_periods WHERE tenant_id = ? AND id = ?`
      )
      .get(tenantId, periodId) as
      | { id: string; tenant_id: string; period_key: string; start_date: string; end_date: string; status: string }
      | undefined;
    if (!row) return null;
    return mapPeriod(row);
  }

  listPeriods(tenantId: string, status?: "open" | "closed"): FiscalPeriodRow[] {
    const rows = (
      status
        ? this.db
            .prepare(
              `SELECT id, tenant_id, period_key, start_date, end_date, status
               FROM fiscal_periods WHERE tenant_id = ? AND status = ? ORDER BY start_date`
            )
            .all(tenantId, status)
        : this.db
            .prepare(
              `SELECT id, tenant_id, period_key, start_date, end_date, status
               FROM fiscal_periods WHERE tenant_id = ? ORDER BY start_date`
            )
            .all(tenantId)
    ) as Array<{
      id: string;
      tenant_id: string;
      period_key: string;
      start_date: string;
      end_date: string;
      status: string;
    }>;
    return rows.map(mapPeriod);
  }

  /**
   * §4.1 خوارزمية إقفال فترة — ذرية بالكامل:
   * قيد إقفال (سنوي) ← لقطة ← تعليم مُقفَلة ← تهيئة الفترة التالية ← نقل الأرصدة.
   *
   * ملاحظة حرجة: better-sqlite3 مصممة التزامن؛ دوال db.transaction() **ترفض دوال async**
   * ("Transaction function cannot return a promise"). كل ما داخل المعاملة هنا متزامن بحت
   * (استعلامات .get/.all/.run مباشرة — لا await إطلاقًا)، وهذا أيضًا أسرع بمئات المرات.
   * الترتيب: قيد الإقفال قبل اللقطة حتى تُجمَّد الأرصدة بعد تصفير الاسمية (نتيجة §4.1 الصحيحة).
   */
  async closeFiscalPeriod(
    tenantId: string,
    periodId: string,
    context: { userId: string; permissions?: string[]; baseCurrencyCode?: string; cashCountedBase?: string }
  ): Promise<CloseResult> {
    // واجهة غير متزامنة (§9 — تستدعيها طبقة API بـ await وتُترجم الاستثناءات إلى HTTP)؛
    // التنفيذ الداخلي متزامن بحت لأن better-sqlite3 لا يسمح بـ await داخل المعاملة.
    // تسامح مع الأشكال المختصرة لمُدخل الصلاحيات (periods.close أو periods:close)
    const normalizedPerms = (context.permissions ?? []).map(normalizePermission);
    if (!normalizedPerms.includes("periods.close")) {
      throw new PermissionDeniedError("periods.close");
    }

    const period = this.getPeriod(tenantId, periodId);
    if (!period) throw new PeriodNotFoundError();
    if (period.status !== "open") {
      throw new PeriodStateError("الفترة مُقفَلة بالفعل — لا يمكن إقفالها مرتين");
    }

    // الأساس المحاسبي للفترة (§2.3): الجدول الحي يمثل الفترة المفتوحة الحالية فقط،
    // فلا يمكن إقفال فترة أقدم من آخر فترة مفتوحة — وإلا سُجِّلت حركة خارج نافذتها الزمنية.
    const newerOpen = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM fiscal_periods
         WHERE tenant_id = ? AND status = 'open' AND start_date > ?`
      )
      .get(tenantId, period.startDate) as { c: number };
    if (newerOpen.c > 0) {
      throw new PeriodStateError(
        "لا يمكن إقفال هذه الفترة — توجد فترة أحدث مفتوحة؛ أغلق الفترات بالتسلسل الزمني (§4.1)"
      );
    }

    const isYear = !period.periodKey.includes("-");
    let closingEntryId: string | null = null;
    let snapshotCount = 0;

    const runAtomic = this.db.transaction(() => {
      // 1) إن كانت سنة: ترحيل صافي الإيرادات/المصروفات إلى الأرباح المرحّلة 3300 (§4.1)
      //    — قبل اللقطة كي تعكس اللقطة حالة "بعد التصفير" المتسقة مع الجدول الحي.
      if (isYear) {
        closingEntryId = this.postAnnualClosingEntry(
          tenantId,
          period,
          context.baseCurrencyCode ?? this.readBaseCurrency(tenantId)
        );
      }

      // 1.5) §4.3 تسوية الإقفال (اختياري): إن مُرَّر نقد فعلي مُفرز اختلف عن الدفتر،
      // يُنشأ قيد تسوية مؤرَّخ بتاريخ نهاية الفترة **قبل** اللقطة — فيدخل أثره في
      // اللقطة المجمّدة والأرصدة الحية معًا (لا ازدواج ولا فجوة عند القراءة الهجينة).
      const cashCounted = context.cashCountedBase;
      if (cashCounted !== undefined && cashCounted !== null) {
        const diff = new Decimal(cashCounted).minus(this.bookCashBase(tenantId));
        if (!diff.isZero()) {
          this.postDailySettlementEntry(
            tenantId,
            period.endDate,
            diff,
            context.baseCurrencyCode ?? this.readBaseCurrency(tenantId)
          );
        }
      }

      // 2) تجميد اللقطة (§4.1 خطوة FOR account)
      snapshotCount = this.balanceStore.snapshotRunningBalances(tenantId, period.id);

      // 3) markPeriodClosed + سجل التدقيق (§4.1 / §9: إعادة الفتح تتطلب سجلًا — فالإقفال يُسجَّل أيضًا)
      this.db
        .prepare(
          `UPDATE fiscal_periods SET status = 'closed', closed_at = ?, closed_by_user_id = ? WHERE id = ?`
        )
        .run(new Date().toISOString(), context.userId, period.id);
      this.writeAudit(tenantId, context.userId, "period_closed", `period:${period.id}`, {
        period_key: period.periodKey,
      });

      // 4) createNextPeriod (§4.1) — تهيئة الفترة التالية بنفس النمط الزمني
      const nextKey = computeNextPeriodKey(period.periodKey);
      if (nextKey) this.createPeriod(tenantId, nextKey, context.userId);

      // 5) نقل الأرصدة الحية للفترة الجديدة (§4.1 "تهيئة account_running_balances الجديدة")
      this.balanceStore.rollForwardAfterClose(tenantId);
    });

    runAtomic();

    return {
      period: { ...period, status: "closed" },
      snapshotAccounts: snapshotCount,
      closingEntryId,
      nextPeriodKey: computeNextPeriodKey(period.periodKey),
    };
  }

  /**
   * §4.2 إعادة فتح فترة — حرجة: صلاحية أعلى + سبب إلزامي + يجب أن تكون الأحدث مُقفَلة
   * (منع كسر التسلسل: لا يُفتح شهر وسبقه شهر مُقفَل أحدث منه).
   * قيد الإقفال السنوي يُعكس بقيد عكسي رسمي (لا حذف قيود إطلاقًا — مبدأ التصحيح المعتمد).
   */
  async reopenFiscalPeriod(
    tenantId: string,
    periodId: string,
    reason: string,
    context: { userId: string; permissions?: string[] }
  ): Promise<ReopenResult> {
    // واجهة غير متزامنة مثل closeFiscalPeriod — التنفيذ الداخلي متزامن بحت
    // تسامح مع الأشكال المختصرة (periods.reopen أو periods:reopen) — نفس بوابة الإقفال
    const normalizedPerms = (context.permissions ?? []).map(normalizePermission);
    if (!normalizedPerms.includes("periods.reopen")) {
      throw new PermissionDeniedError("periods.reopen");
    }
    if (!reason || reason.trim().length < 3) {
      throw new PeriodStateError("السبب إلزامي لإعادة فتح فترة مُقفَلة (§4.2)");
    }

    const period = this.getPeriod(tenantId, periodId);
    if (!period) throw new PeriodNotFoundError();
    if (period.status !== "closed") {
      throw new PeriodStateError("الفترة مفتوحة بالفعل");
    }

    // ASSERT getNextPeriod(period).status == 'open' — تُمنع إعادة فتح غير الأحدث
    const newerClosed = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM fiscal_periods
         WHERE tenant_id = ? AND status = 'closed' AND start_date > ?`
      )
      .get(tenantId, period.startDate) as { c: number };
    if (newerClosed.c > 0) {
      throw new PeriodStateError("لا يمكن إعادة فتح فترة ليست الأحدث مُقفَلة — أغلق/افتح الأحدث أولًا (§4.2)");
    }

    let reversalEntryId = "";
    let restored = 0;

    const runAtomic = this.db.transaction(() => {
      // عكس قيد الإقفال السنوي إن وُجد (بحث بالمرجع الدقيق source_transaction_id = period.id)
      const closingEntryRows = this.db
        .prepare(
          `SELECT id FROM journal_entries
           WHERE tenant_id = ? AND source_type = 'system_adjustment'
             AND source_transaction_id = ? AND is_reversed = 0`
        )
        .all(tenantId, period.id) as Array<{ id: string }>;

      for (const row of closingEntryRows) {
        const original = this.loadEntrySync(tenantId, row.id);
        if (!original) continue;
        const reversal = original.createReversal(`إعادة فتح فترة ${period.periodKey}: ${reason}`);
        // §4.2: عكس الأثر على الأرصدة الحية فقط — النتيجة اليومية التاريخية لا تُمسّ،
        // ثم restoreRunningBalancesFromSnapshot أدناه يستعيد الجدول الحي من اللقطة بدقة.
        this.saveEntrySync(reversal, { reverseAggregatesOnly: true });
        this.saveEntrySync(original.markAsReversed());
        reversalEntryId = reversal.id;
      }

      // restoreRunningBalancesFromSnapshot (§4.2) — عكس rollForward
      const snapCount = this.db
        .prepare(`SELECT COUNT(*) AS c FROM account_period_balances WHERE fiscal_period_id = ?`)
        .get(period.id) as { c: number };
      this.balanceStore.restoreRunningBalancesFromSnapshot(tenantId, period.id);
      restored = snapCount.c;

      // deleteAccountPeriodBalances(period.id) — ستُعاد عند الإقفال مجددًا
      this.balanceStore.deletePeriodSnapshot(period.id);

      this.db
        .prepare(
          `UPDATE fiscal_periods
           SET status = 'open', reopened_at = ?, reopened_by_user_id = ?, reopen_reason = ?
           WHERE id = ?`
        )
        .run(new Date().toISOString(), context.userId, reason.trim(), period.id);

      // سجل تدقيق إلزامي (§4.2/§9)
      this.writeAudit(tenantId, context.userId, "period_reopened", `period:${period.id}`, {
        period_key: period.periodKey,
        reason: reason.trim(),
      });
    });

    runAtomic();

    return { period: { ...period, status: "open" }, restoredAccounts: restored, reversalEntryId };
  }

  /**
   * §4.1 قيد الإقفال السنوي: تصفير كل الحسابات الاسمية وترحيل الصافي إلى 3300.
   * **المصدر الصحيح = نشاط الفترة نفسها** (قيود journal_lines بتاريخ ضمن [startDate,endDate])
   * وليس الرصيد المتراكم في account_running_balances — فالمتراكم قد يحمل أرصدة افتتاحية
   * من سنوات سابقة أو حركة فترات أخرى، وترحيله يخلط السنين (§4.1: صافي السنة الحالية فقط).
   * netIncome = Σ(دائن − مدين للإيرادات) − Σ(مدين − دائن للمصروفات) داخل النطاق.
   */
  private postAnnualClosingEntry(
    tenantId: string,
    period: FiscalPeriodRow,
    baseCurrencyCode: string
  ): string | null {
    const activityRows = this.db
      .prepare(
        `SELECT a.id, a.code, a.account_type,
                COALESCE(SUM(CASE WHEN jl.side='debit'  THEN CAST(jl.base_amount AS REAL) END), 0) AS debit,
                COALESCE(SUM(CASE WHEN jl.side='credit' THEN CAST(jl.base_amount AS REAL) END), 0) AS credit
         FROM accounts a
         JOIN journal_lines jl ON jl.account_id = a.id
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE je.tenant_id = ? AND a.tenant_id = ? AND a.is_postable = 1
           AND a.account_type IN ('revenue','expense')
           AND date(je.entry_date) >= ? AND date(je.entry_date) <= ?
         GROUP BY a.id, a.code, a.account_type`
      )
      .all(tenantId, tenantId, period.startDate, period.endDate) as Array<{
      id: string;
      code: string;
      account_type: "revenue" | "expense";
      debit: number;
      credit: number;
    }>;

    if (activityRows.length === 0) return null;

    const lines: JournalLine[] = [];
    let order = 1;
    let netIncome = new Decimal(0);

    for (const r of activityRows) {
      // تحويل دقيق عبر نص بتثبيت منزلة واحدة على الأقل (REAL تجميعي — القيم المخزّنة 4 خانات)
      const deb = new Decimal(r.debit.toFixed(4));
      const cred = new Decimal(r.credit.toFixed(4));
      if (r.account_type === "revenue") {
        // الصافي الطبيعي للإيراد = دائن − مدين (مرتجعات تفوق المبيعات ⇒ سالب)
        const naturalNet = cred.minus(deb);
        if (naturalNet.isZero()) continue;
        netIncome = netIncome.plus(naturalNet);
        // تصفير ⇒ عكس الجهة الطبيعية: ربح دائن ⇒ مدين؛ إيراد صافي مدين ⇒ دائن
        lines.push(makeClosingLine(r.id, naturalNet.isPositive() ? "debit" : "credit", naturalNet.abs(), baseCurrencyCode, order++));
      } else {
        const naturalNet = deb.minus(cred); // مصروف مدين موجب طبيعيًا
        if (naturalNet.isZero()) continue;
        netIncome = netIncome.minus(naturalNet);
        lines.push(makeClosingLine(r.id, naturalNet.isPositive() ? "credit" : "debit", naturalNet.abs(), baseCurrencyCode, order++));
      }
    }

    if (lines.length === 0) return null; // لا حركة اسمية — لا حاجة لقيد إقفال

    const retained = this.getAccountIdByCode(tenantId, RETAINED_EARNINGS_CODE);
    if (!retained) {
      throw new PeriodStateError(
        `الحساب ${RETAINED_EARNINGS_CODE} (الأرباح المرحّلة) مطلوب للإقفال السنوي وغير مُهيَّأ`
      );
    }

    // السطر الموازن: ربح ⇒ دائن 3300، خسارة ⇒ مدين 3300.
    // صافي صفري مع أسطر اسمية غير صفرية ممكن نظريًا (إيرادات سالبة تعادل مصروفات)
    // فلا نُسند شيئًا لـ 3300 — الأسطر الاسمية وحدها متوازنة رياضيًا عندئذٍ.
    const absNet = netIncome.abs();
    if (!absNet.isZero()) {
      lines.push(
        makeClosingLine(retained.id, netIncome.isPositive() ? "credit" : "debit", absNet, baseCurrencyCode, order)
      );
    }

    const entryLines = lines;
    if (entryLines.length < 2) return null;

    const entry = JournalEntry.create({
      tenantId,
      entryDate: new Date(`${period.endDate}T12:00:00.000Z`),
      descriptionSimple: `قيد إقفال سنوي ${period.periodKey} — ترحيل الصافي للأرباح المرحّلة`,
      sourceType: "system_adjustment" as JournalEntrySourceType,
      sourceTransactionId: period.id,
      baseCurrencyCode,
      lines: entryLines,
    });

    this.saveEntrySync(entry);

    // §4.1: تصفير الأرصدة الحية للاسمية **المُصفَّرة فعلًا بهذا القيد** بعد نجاحه.
    // لا نصفّر كل الاسمية: حساب لم تُصفَّر كامل حركته (مثلاً إيراد فيه حركة خارج نطاق
    // الفترة) يبقى رصيده المتبقي صحيحًا — التصفير الأعمى كان يمحو مالًا حقيقيًا.
    this.balanceStore.resetRunningBalancesForAccounts(
      tenantId,
      activityRows.map((r) => r.code)
    );

    return entry.id;
  }

  /**
   * الرصيد الدفتري للنقد (صندوق/بنك/محفظة §6.3 أكواد 1101/1110/1120) من الجدول الحي.
   */
  private bookCashBase(tenantId: string): Decimal {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(CAST(current_balance_base AS REAL)), 0) AS cash
         FROM account_running_balances
         WHERE tenant_id = ? AND account_code IN ('1101','1110','1120')`
      )
      .get(tenantId) as { cash: number };
    // تجميع وسيط فقط؛ القيم المخزّنة نص بـ 4 خانات — إعادة تحويل دقيقة عبر toFixed
    return new Decimal(row.cash.toFixed(4));
  }

  /** حساب قابل للترحيل بالكود أو undefined */
  private getAccountIdByCode(tenantId: string, code: string): { id: string } | undefined {
    return this.db
      .prepare(`SELECT id FROM accounts WHERE tenant_id = ? AND code = ? AND is_postable = 1`)
      .get(tenantId, code) as { id: string } | undefined;
  }

  /**
   * §4.3 قيد تسوية الصندوق عند الإقفال: عجز ⇒ مدين عجز صندوق (5910) / دائن الصندوق؛
   * زيادة ⇒ مدين الصندوق / دائن زيادة صندوق (5911). صلاحيات المحاسب العادي لا المالك.
   */
  private postDailySettlementEntry(
    tenantId: string,
    businessDate: string,
    diff: Decimal,
    baseCurrencyCode: string
  ): void {
    const cash = this.getAccountIdByCode(tenantId, "1101");
    if (!cash) throw new PeriodStateError("حساب الصندوق 1101 غير مُهيَّأ لتسوية الإقفال");
    const shortageCode = diff.isNegative() ? "5910" : "5911";
    const acct =
      this.getAccountIdByCode(tenantId, shortageCode) ?? this.getAccountIdByCode(tenantId, "5210");
    if (!acct) {
      throw new PeriodStateError(
        `حساب تسوية الصندوق (${shortageCode}) غير مُهيَّأ — لا يمكن تسجيل فرق النقد`
      );
    }
    const abs = diff.abs();
    const lines = diff.isNegative()
      ? [
          makeClosingLine(acct.id, "debit", abs, baseCurrencyCode, 1),
          makeClosingLine(cash.id, "credit", abs, baseCurrencyCode, 2),
        ]
      : [
          makeClosingLine(cash.id, "debit", abs, baseCurrencyCode, 1),
          makeClosingLine(acct.id, "credit", abs, baseCurrencyCode, 2),
        ];

    const entry = JournalEntry.create({
      tenantId,
      entryDate: new Date(`${businessDate}T12:00:00.000Z`),
      descriptionSimple: `قيد تسوية صندوق عند إقفال ${businessDate}`,
      sourceType: "system_adjustment" as JournalEntrySourceType,
      baseCurrencyCode,
      lines,
    });
    this.saveEntrySync(entry);
  }

  /** قراءة الأساس المحاسبي للـ tenant — من عملة قيود الفترة إن وُجدت، وإلا YER (افتراضي السوق) */
  private readBaseCurrency(tenantId: string): string {
    // جدول العملات ليس جزءًا من مخطط النواة هنا؛ المصدر الأدق هو القيود نفسها
    const row = this.db
      .prepare(
        `SELECT base_currency_code AS code FROM journal_entries
         WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(tenantId) as { code: string } | undefined;
    return row?.code ?? "YER";
  }

  // ============ نوافذ متزامنة على مستودع اليومية ============
  // better-sqlite3 التزامنية لا تسمح بـ await داخل db.transaction()؛ هذه الدوال الخاصة
  // تنفذ نفس عمليات المستودع (إدراج قيد بأسطره + صيانة الأرصدة / قراءة قيد) بشكل متزامن
  // داخل معاملة المُستدعي — بنفس منطق SqliteJournalRepository حرفيًا (DRY بالسلوك).

  private saveEntrySync(entry: JournalEntry, opts?: { reverseAggregatesOnly?: boolean }): void {
    const insertEntry = this.db.prepare(`
      INSERT INTO journal_entries
        (id, tenant_id, entry_date, description_simple, source_type,
         source_transaction_id, reversal_of_entry_id, is_reversed,
         base_currency_code, created_at)
      VALUES (@id, @tenantId, @entryDate, @descriptionSimple, @sourceType,
              @sourceTransactionId, @reversalOfEntryId, @isReversed,
              @baseCurrencyCode, @createdAt)
    `);
    const updateReversedFlag = this.db.prepare(`
      UPDATE journal_entries SET is_reversed = 1 WHERE id = ? AND tenant_id = ?
    `);
    const insertLine = this.db.prepare(`
      INSERT INTO journal_lines
        (id, journal_entry_id, account_id, contact_id, side, amount,
         currency_code, exchange_rate_used, base_amount, line_order, memo_ar)
      VALUES (@id, @journalEntryId, @accountId, @contactId, @side, @amount,
              @currencyCode, @exchangeRateUsed, @baseAmount, @lineOrder, @memoAr)
    `);

    const existingEntry = this.db
      .prepare(`SELECT id FROM journal_entries WHERE id = ?`)
      .get(entry.id);

    if (!existingEntry) {
      insertEntry.run({
        id: entry.id,
        tenantId: entry.tenantId,
        entryDate: entry.entryDate.toISOString().split("T")[0]!,
        descriptionSimple: entry.descriptionSimple,
        sourceType: entry.sourceType,
        sourceTransactionId: entry.sourceTransactionId,
        reversalOfEntryId: entry.reversalOfEntryId,
        isReversed: entry.isReversed ? 1 : 0,
        baseCurrencyCode: entry.baseCurrencyCode,
        createdAt: entry.createdAt.toISOString(),
      });
      for (const line of entry.lines) {
        insertLine.run({
          id: line.id,
          journalEntryId: entry.id,
          accountId: line.accountId,
          contactId: line.contactId,
          side: line.side,
          amount: line.amount.toStorageString(),
          currencyCode: line.amount.currencyCode,
          exchangeRateUsed: line.exchangeRateUsed,
          baseAmount: line.baseAmount.toStorageString(),
          lineOrder: line.lineOrder,
          memoAr: line.memoAr,
        });
      }
      // صيانة الأرصدة التجميعية داخل نفس المعاملة (§2.3/§2.5) — مطابقة للمستودع.
      // استثناء §4.2: عكس قيد نظام (إقفال سنوي) عند إعادة فتح فترة ⇒ عكس على الأرصدة الحية فقط،
      // لأن النتيجة اليومية التاريخية لتلك الفترة يجب ألا تتغير أبدًا (لقطة يومية مجمّدة).
      if (opts?.reverseAggregatesOnly) {
        this.balanceStore.reverseEntryOnRunningBalances(entry, entry.tenantId);
      } else {
        this.balanceStore.applyEntryToAggregates(entry, entry.tenantId);
      }
    } else if (entry.isReversed) {
      updateReversedFlag.run(entry.id, entry.tenantId);
    }
  }

  /** قراءة قيد بأسطره (متزامن) — يعيد بناء كيان المجال من التخزين دون إعادة توليد المعرفات */
  private loadEntrySync(tenantId: string, entryId: string): JournalEntry | null {
    const entryRow = this.db
      .prepare(`SELECT * FROM journal_entries WHERE tenant_id = ? AND id = ?`)
      .get(tenantId, entryId) as
      | {
          id: string;
          entry_date: string;
          description_simple: string;
          source_type: string;
          source_transaction_id: string | null;
          reversal_of_entry_id: string | null;
          is_reversed: number;
          base_currency_code: string;
          created_at: string;
        }
      | undefined;
    if (!entryRow) return null;

    const lineRows = this.db
      .prepare(`SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_order ASC`)
      .all(entryId) as Array<{
      id: string;
      account_id: string;
      side: string;
      amount: string;
      currency_code: string;
      exchange_rate_used: string;
      base_amount: string;
      contact_id: string | null;
      memo_ar: string | null;
      line_order: number;
    }>;

    // إعادة بناء مباشرة من الخصائص المخزّنة (لا createReversal/markAsReversed هنا —
    // تلك تُنشئ كيانات جديدة بمعرفة؛ الأصلي يُعاد بناؤه كما هو حرفيًا).
    return JournalEntry.reconstructFromPersistence({
      id: entryRow.id,
      tenantId,
      entryDate: new Date(entryRow.entry_date),
      descriptionSimple: entryRow.description_simple,
      sourceType: entryRow.source_type as JournalEntrySourceType,
      sourceTransactionId: entryRow.source_transaction_id,
      baseCurrencyCode: entryRow.base_currency_code,
      lines: lineRows.map((row) =>
        JournalLine.reconstruct({
          id: row.id,
          accountId: row.account_id,
          side: row.side as "debit" | "credit",
          amount: Money.fromDecimalString(row.amount, row.currency_code),
          baseAmount: Money.fromDecimalString(row.base_amount, entryRow.base_currency_code),
          exchangeRateUsed: row.exchange_rate_used,
          contactId: row.contact_id,
          memoAr: row.memo_ar,
          lineOrder: row.line_order,
        })
      ),
      isReversed: entryRow.is_reversed === 1,
      reversalOfEntryId: entryRow.reversal_of_entry_id,
      createdAt: new Date(entryRow.created_at),
    });
  }

  /** §9 — audit_log موحّد الاسم مع ما تتوقعه الاختبارات (action/entity_id/details_json) */
  private writeAudit(
    tenantId: string,
    userId: string,
    action: string,
    entityId: string,
    details: Record<string, unknown>
  ): void {
    const ddl = `CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT,
      action TEXT NOT NULL, entity_id TEXT NOT NULL, details_json TEXT, created_at TEXT NOT NULL
    )`;
    this.db.exec(ddl);
    this.db
      .prepare(
        `INSERT INTO audit_log (id, tenant_id, user_id, action, entity_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), tenantId, userId, action, entityId, JSON.stringify(details), new Date().toISOString());
  }
}

// ================= أدوات مساعدة نقية =================

function mapPeriod(row: {
  id: string;
  tenant_id: string;
  period_key: string;
  start_date: string;
  end_date: string;
  status: string;
}): FiscalPeriodRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    periodKey: row.period_key,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as "open" | "closed",
  };
}

function assertPermission(permissions: string[], required: string): void {
  if (!permissions.map(normalizePermission).includes(required)) throw new PermissionDeniedError(required);
}

/** توحيدها القياسي للصلاحيات: "periods:close" ⇒ "periods.close" (مع دعم الصيغة المختصرة في الاختبارات) */
function normalizePermission(p: string): string {
  return p.trim().replace(":", ".");
}

/** "2026-09" → [2026-09-01, 2026-09-30] ، "2026" → [2026-01-01, 2026-12-31] */
export function parsePeriodKey(key: string): { start: string; end: string } {
  if (/^\d{4}$/.test(key)) {
    return { start: `${key}-01-01`, end: `${key}-12-31` };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw new PeriodStateError(`مفتاح فترة غير صالح: ${key}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new PeriodStateError(`مفتاح فترة غير صالح: ${key}`);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

/** "2026-09"→"2026-10"، "2026-12"→"2027-01"، "2026"→"2027" */
export function computeNextPeriodKey(key: string): string | null {
  if (/^\d{4}$/.test(key)) return String(Number(key) + 1);
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  let year = Number(m[1]);
  let month = Number(m[2]) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function makeClosingLine(
  accountId: string,
  side: "debit" | "credit",
  amountBase: Decimal,
  baseCurrencyCode: string,
  lineOrder: number
): JournalLine {
  return JournalLine.create({
    accountId,
    side,
    amount: Money.fromDecimalString(amountBase.toFixed(Money.STORAGE_DECIMALS), baseCurrencyCode),
    exchangeRateUsed: "1",
    baseCurrencyCode,
    memoAr: "إقفال سنوي",
    lineOrder,
  });
}
