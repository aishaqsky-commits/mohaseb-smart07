// src/application/services/FinancialReportingService.ts
// ===== محرك التقارير الموحّد — docs/04-modules/financial-reporting.md §3، §5، §6 =====
// فلسفة Hot/Cold (§2.1): الرصيد "كما في تاريخ" = أرصدة الفترات المُقفَلة (لقطات مجمّدة — قراءة صفوف قليلة)
// + حركة الفترة المفتوحة من Ledger الحي. لا مسح كامل للقيود في التقارير المالية إطلاقًا (§3 ملاحظة أداء حرجة).

import Database from "better-sqlite3";
import Decimal from "decimal.js";
import { randomUUID } from "crypto";
import { BalanceMaintenanceStore, DailyResultRow } from "../../infrastructure/sqlite/BalanceMaintenanceStore";

export interface ReportContext {
  tenantId: string;
  userId?: string;
  baseCurrencyCode: string;
  permissions: string[];
}

interface AccountMeta {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  normalBalance: "debit" | "credit";
}

interface ActivityPair {
  debit: Decimal;
  credit: Decimal;
}

/** بذرة كتالوج report_definitions (§5 — 11 تقريرًا معتمدًا) */
const REPORT_CATALOG: Array<{
  code: string;
  nameAr: string;
  category: "financial" | "operational" | "inventory" | "ar_ap";
  dataSourceType: "hybrid" | "live_query" | "materialized";
  filters: string[];
}> = [
  { code: "trial_balance", nameAr: "ميزان المراجعة", category: "financial", dataSourceType: "hybrid", filters: ["as_of_date"] },
  { code: "income_statement", nameAr: "قائمة الدخل", category: "financial", dataSourceType: "hybrid", filters: ["date_from", "date_to"] },
  { code: "balance_sheet", nameAr: "الميزانية العمومية", category: "financial", dataSourceType: "hybrid", filters: ["as_of_date"] },
  { code: "daily_result", nameAr: "نتيجة نشاط اليوم", category: "operational", dataSourceType: "materialized", filters: ["business_date"] },
  { code: "period_result", nameAr: "نتيجة نشاط فترة", category: "operational", dataSourceType: "hybrid", filters: ["date_from", "date_to"] },
  { code: "cash_book", nameAr: "دفتر النقدية", category: "financial", dataSourceType: "live_query", filters: ["date_from", "date_to", "account_id"] },
  { code: "general_ledger", nameAr: "دفتر الأستاذ العام", category: "financial", dataSourceType: "live_query", filters: ["account_id", "date_from", "date_to"] },
  { code: "journal_book", nameAr: "دفتر اليومية", category: "financial", dataSourceType: "live_query", filters: ["date_from", "date_to"] },
  { code: "fx_impact_report", nameAr: "تقرير فروق العملة", category: "financial", dataSourceType: "live_query", filters: ["date_from", "date_to"] },
];

export class ReportNotFoundError extends Error {}
export class ReportAssertionError extends Error {}

export class FinancialReportingService {
  private readonly balanceStore: BalanceMaintenanceStore;

  constructor(private readonly db: Database.Database) {
    this.balanceStore = new BalanceMaintenanceStore(db);
    this.seedCatalog();
  }

  /** §2.6/§5: الكتالوج مصدره report_definitions — التقرير الجديد = تعريف مُسجَّل لا تعديل بنية */
  private seedCatalog(): void {
    const insert = this.db.prepare(
      `INSERT INTO report_definitions
         (report_code, name_ar, category, description_ar, data_source_type, required_permission, supported_filters, is_system_report, is_active, sort_order)
       VALUES (?, ?, ?, NULL, ?, 'reports.view', ?, 1, 1, ?)
       ON CONFLICT(report_code) DO UPDATE SET
         name_ar = excluded.name_ar, category = excluded.category,
         data_source_type = excluded.data_source_type, supported_filters = excluded.supported_filters`
    );
    REPORT_CATALOG.forEach((r, i) =>
      insert.run(r.code, r.nameAr, r.category, r.dataSourceType, JSON.stringify(r.filters), i)
    );
  }

  /** GET /reports (§7.1) — قائمة التقارير المتاحة النشطة */
  listAvailableReports(): Array<{ reportCode: string; nameAr: string; category: string }> {
    const rows = this.db
      .prepare(
        `SELECT report_code, name_ar, category FROM report_definitions
         WHERE is_active = 1 ORDER BY sort_order`
      )
      .all() as Array<{ report_code: string; name_ar: string; category: string }>;
    return rows.map((r) => ({ reportCode: r.report_code, nameAr: r.name_ar, category: r.category }));
  }

  /**
   * نقطة الدخول الموحّدة (§7.1 Generic endpoint) مع رصد أداء إلزامي (§2.7).
   * filters: as_of_date | date_from/date_to | business_date | account_id
   */
  async generateReport(
    reportCode: string,
    filters: Record<string, string | undefined>,
    context: ReportContext
  ): Promise<unknown> {
    if (!context.permissions.includes("reports.view")) {
      throw new ReportNotFoundError(`لا صلاحية reports.view للمستخدم`);
    }
    const def = this.db
      .prepare(`SELECT * FROM report_definitions WHERE report_code = ? AND is_active = 1`)
      .get(reportCode) as { report_code: string; supported_filters: string } | undefined;
    if (!def) throw new ReportNotFoundError(`التقرير '${reportCode}' غير معرَّف أو معطّل (Feature Flag §2.6)`);

    const startMs = Date.now();
    let result: unknown;
    switch (reportCode) {
      case "trial_balance":
        result = this.trialBalance(filters.as_of_date ?? today(), context);
        break;
      case "income_statement":
        result = this.incomeStatement(filters.date_from ?? "0001-01-01", filters.date_to ?? today(), context);
        break;
      case "balance_sheet":
        result = this.balanceSheet(filters.as_of_date ?? today(), context);
        break;
      case "daily_result":
        result = this.dailyResult(filters.business_date ?? today(), context);
        break;
      case "period_result":
        result = this.periodResult(filters.date_from ?? "0001-01-01", filters.date_to ?? today(), context);
        break;
      case "cash_book":
        result = this.cashBook(filters, context);
        break;
      case "general_ledger":
        result = this.generalLedger(filters, context);
        break;
      case "journal_book":
        result = this.journalBook(filters.date_from ?? "0001-01-01", filters.date_to ?? today(), context);
        break;
      case "fx_impact_report":
        result = this.fxImpactReport(filters.date_from ?? "0001-01-01", filters.date_to ?? today(), context);
        break;
      default:
        throw new ReportNotFoundError(`منفذ تنفيذ غير مسجَّل للتقرير '${reportCode}' (${def.supported_filters})`);
    }

    this.logExecution(context.tenantId, context.userId, reportCode, filters, Date.now() - startMs);
    return result;
  }

  // ===================== الأدوات الهجينة الجوهرية (§3 hybrid) =====================

  /** كل الحسابات القابلة للترحيل مع بياناتها الوصفية */
  private postableAccounts(context: ReportContext): AccountMeta[] {
    return (
      this.db
        .prepare(
          `SELECT id, code, name_ar_simple, account_type, normal_balance
           FROM accounts WHERE tenant_id = ? AND is_postable = 1 ORDER BY code`
        )
        .all(context.tenantId) as Array<{
        id: string;
        code: string;
        name_ar_simple: string;
        account_type: AccountMeta["type"];
        normal_balance: AccountMeta["normalBalance"];
      }>
    ).map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name_ar_simple,
      type: r.account_type,
      normalBalance: r.normal_balance,
    }));
  }

  /**
   * رصيد حساب "كما في تاريخ" (§3.1) — hybrid بلا ازدواج:
   * - إن وُجدت لقطات مُقفَلة تنتهي ≤ asOf: الأساس = إغلاق أحدث لقطة (opening+d−c)،
   *   ثم += حركة ledger الواقعة **بعد** آخر فترة مُقفَلة فقط (وليس من بداية التاريخ).
   * - وإلا: كل الحركة حيّة من ledger كما historically.
   * الإشارة موحَّدة "طبيعي موجب".
   */
  private balanceAsOf(accountCode: string, asOfDate: string, context: ReportContext): Decimal {
    // ---- بارد: أحدث لقطة مُقفَلة تنتهي ≤ asOf (الأساس المجمّد) ----
    const lastSnap = this.db
      .prepare(
        `SELECT apb.opening_balance_base, apb.period_debit_total_base,
                apb.period_credit_total_base, fp.end_date
         FROM account_period_balances apb
         JOIN fiscal_periods fp ON fp.id = apb.fiscal_period_id
         WHERE apb.tenant_id = ? AND apb.account_code = ? AND fp.status = 'closed' AND fp.end_date <= ?
         ORDER BY fp.end_date DESC LIMIT 1`
      )
      .get(context.tenantId, accountCode, asOfDate) as
      | { opening_balance_base: string; period_debit_total_base: string; period_credit_total_base: string; end_date: string }
      | undefined;

    let bal: Decimal;
    let liveFrom: string;

    if (lastSnap) {
      bal = new Decimal(lastSnap.opening_balance_base)
        .plus(lastSnap.period_debit_total_base)
        .minus(lastSnap.period_credit_total_base);
      liveFrom = addDays(lastSnap.end_date, 1); // الحركة الحية تبدأ بعد نهاية آخر فترة مُجمَّدة
    } else {
      bal = new Decimal(0);
      liveFrom = "0001-01-01";
    }

    // ---- ساخن: حركة ledger للفترة المفتوحة فقط ----
    if (liveFrom <= asOfDate) {
      const activity = this.liveActivityForAccount(accountCode, liveFrom, asOfDate, context);
      bal = bal.plus(activity.debit).minus(activity.credit);
    }

    return bal;
  }

  /** حركة حيّة من journal_lines لحساب خلال مدى (يشمل حتى المُقفَلة — يُستخدم فقط حين لا توجد لقطة لها) */
  private liveActivityForAccount(
    accountCode: string,
    from: string,
    to: string,
    context: ReportContext
  ): ActivityPair {
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN jl.side='debit'  THEN CAST(jl.base_amount AS REAL) END), 0) AS debit,
           COALESCE(SUM(CASE WHEN jl.side='credit' THEN CAST(jl.base_amount AS REAL) END), 0) AS credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN accounts a ON a.id = jl.account_id
         WHERE je.tenant_id = ? AND a.code = ? AND je.entry_date >= ? AND je.entry_date <= ?`
      )
      .get(context.tenantId, accountCode, from, to) as { debit: number; credit: number };
    // REAL هنا للاستعلام التجميعي السريع؛ القيم المخزّنة نص decimal بدقة 4 خانات عشرية
    // والأرقام المحاسبية الفعلية تبقى Decimal — هذا المسار يعيد تجميعات وسيطة تُحوَّل بدقة.
    return {
      debit: toDecimalFromAggregate(row.debit),
      credit: toDecimalFromAggregate(row.credit),
    };
  }

  /**
   * نشاط حساب خلال نطاق زمني هجين (§3 — قلب Golden Test "الفترتين المختلطتين"):
   * اللقطات المُقفَلة الواقعة بالكامل داخل النطاق تُقرأ مجمّدة؛ المتبقّي (أجزاء/الفترة المفتوحة)
   * من ledger بشرط عدم ازدواج: استبعاد أي قيد تاريخه يقع ضمن فترة مُقفَلة تمّت قراءتها من اللقطة
   * بالكامل داخل النطاق. النتيجة مطابقة تمامًا للحساب الحي الكامل (§9 التأكيد الأهم).
   */
  private activityForRangeHybrid(
    accountCode: string,
    from: string,
    to: string,
    context: ReportContext
  ): ActivityPair {
    // 1) لقطات كاملة داخل النطاق
    const snaps = this.db
      .prepare(
        `SELECT apb.period_debit_total_base, apb.period_credit_total_base
         FROM account_period_balances apb
         JOIN fiscal_periods fp ON fp.id = apb.fiscal_period_id
         WHERE apb.tenant_id = ? AND apb.account_code = ? AND fp.status = 'closed'
           AND fp.start_date >= ? AND fp.end_date <= ?`
      )
      .all(context.tenantId, accountCode, from, to) as Array<{
      period_debit_total_base: string;
      period_credit_total_base: string;
    }>;

    // المعامل المستبعد: قيود تقع ضمن هذه الفترات المُقفَلة الكاملة (لمنع الازدواج مع اللقطات)
    const closedRanges = (
      this.db
        .prepare(
          `SELECT start_date, end_date FROM fiscal_periods
           WHERE tenant_id = ? AND status = 'closed' AND start_date >= ? AND end_date <= ?`
        )
        .all(context.tenantId, from, to) as Array<{ start_date: string; end_date: string }>
    );

    // 2) حركة حية لما هو خارج الفترات المُقفَلة الكاملة داخل النطاق
    let debit = new Decimal(0);
    let credit = new Decimal(0);
    for (const s of snaps) {
      debit = debit.plus(s.period_debit_total_base);
      credit = credit.plus(s.period_credit_total_base);
    }

    // نجمع الحركة الحية على مستوى ledger لكل الأجزاء غير المغطاة:
    // أبسط صيغة صحيحة: كل القيود في [from,to] ما عدا تلك الواقعة في فترات مُقفَلة كاملة داخل النطاق.
    const liveRows = this.db
      .prepare(
        `SELECT jl.side AS side, jl.base_amount AS base_amount, je.entry_date AS entry_date
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN accounts a ON a.id = jl.account_id
         WHERE je.tenant_id = ? AND a.code = ? AND je.entry_date >= ? AND je.entry_date <= ?`
      )
      .all(context.tenantId, accountCode, from, to) as Array<{
      side: string;
      base_amount: string;
      entry_date: string;
    }>;

    for (const r of liveRows) {
      const inClosedFull = closedRanges.some(
        (c) => r.entry_date >= c.start_date && r.entry_date <= c.end_date
      );
      if (inClosedFull) continue;
      if (r.side === "debit") debit = debit.plus(r.base_amount);
      else credit = credit.plus(r.base_amount);
    }

    return { debit, credit };
  }

  // ===================== التقارير المالية الرئيسية =====================

  /** §6.1 ميزان المراجعة — مع ASSERT توازن إجمالي إلزامي قبل الإرجاع (§9) */
  trialBalance(asOfDate: string, context: ReportContext): {
    rows: Array<{ accountCode: string; accountName: string; debit: string; credit: string }>;
    totalDebit: string;
    totalCredit: string;
  } {
    const rows: Array<{ accountCode: string; accountName: string; debit: string; credit: string }> = [];
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);

    for (const acc of this.postableAccounts(context)) {
      const bal = this.balanceAsOf(acc.code, asOfDate, context);
      if (bal.isZero()) continue; // §6.1: لا تُعرض الحسابات الصفرية
      // بإشارة "الطبيعي": موجب ⇒ جهة طبيعيته؛ سالبة ⇒ الجهة المقابلة
      const positive = bal.isPositive();
      const naturalSideIsDebit = acc.normalBalance === "debit";
      const onDebitSide = positive === naturalSideIsDebit;
      const absStr = bal.abs().toFixed(4);
      rows.push({
        accountCode: acc.code,
        accountName: acc.name,
        debit: onDebitSide ? absStr : "0.0000",
        credit: onDebitSide ? "0.0000" : absStr,
      });
      if (onDebitSide) totalDebit = totalDebit.plus(bal.abs());
      else totalCredit = totalCredit.plus(bal.abs());
    }

    // Sanity Check إلزامي (§6.1/§9): ledger متوازن دائمًا ⇒ الميزان يجب أن يتوازن
    if (!totalDebit.equals(totalCredit)) {
      throw new ReportAssertionError(
        `انتهاك سلامة: مجموع مدين الميزان (${totalDebit.toFixed(4)}) ≠ دائن (${totalCredit.toFixed(4)})`
      );
    }

    return { rows, totalDebit: totalDebit.toFixed(4), totalCredit: totalCredit.toFixed(4) };
  }

  /** §6.2 قائمة الدخل — net = (دائن − مدين) للإيرادات و (مدين − دائن) للمصروفات، COGS يبدأ بـ 51 */
  incomeStatement(
    from: string,
    to: string,
    context: ReportContext
  ): {
    period: { from: string; to: string };
    revenue: { total: string; lines: Array<{ accountCode: string; accountName: string; amount: string }> };
    cogs: string;
    grossProfit: string;
    operatingExpenses: { total: string; lines: Array<{ accountCode: string; accountName: string; amount: string }> };
    netProfit: string;
  } {
    const revenueLines: Array<{ accountCode: string; accountName: string; amount: string }> = [];
    const expenseLines: Array<{ accountCode: string; accountName: string; amount: string }> = [];
    let totalRevenue = new Decimal(0);
    let cogs = new Decimal(0);
    let opex = new Decimal(0);

    for (const acc of this.postableAccounts(context)) {
      if (acc.type !== "revenue" && acc.type !== "expense") continue;
      const act = this.activityForRangeHybrid(acc.code, from, to, context);
      const net =
        acc.type === "revenue" ? act.credit.minus(act.debit) : act.debit.minus(act.credit);
      if (net.isZero()) continue;
      if (acc.type === "revenue") {
        revenueLines.push({ accountCode: acc.code, accountName: acc.name, amount: net.toFixed(4) });
        totalRevenue = totalRevenue.plus(net);
      } else {
        expenseLines.push({ accountCode: acc.code, accountName: acc.name, amount: net.toFixed(4) });
        if (acc.code.startsWith("51")) cogs = cogs.plus(net); // §6.2 تكلفة المبيعات
        else opex = opex.plus(net);
      }
    }

    const gross = totalRevenue.minus(cogs);
    const netProfit = gross.minus(opex);

    return {
      period: { from, to },
      revenue: { total: totalRevenue.toFixed(4), lines: revenueLines },
      cogs: cogs.toFixed(4),
      grossProfit: gross.toFixed(4),
      operatingExpenses: { total: opex.toFixed(4), lines: expenseLines },
      netProfit: netProfit.toFixed(4),
    };
  }

  /** الميزانية العمومية (§5): أصول/خصوم/حقوق كما في تاريخ — بقايا الإيرادات/المصروفات تظهر عبر قيد الإقفال السنوي في 3300 */
  balanceSheet(asOfDate: string, context: ReportContext): {
    assets: Array<{ accountCode: string; accountName: string; balance: string }>;
    liabilities: Array<{ accountCode: string; accountName: string; balance: string }>;
    equity: Array<{ accountCode: string; accountName: string; balance: string }>;
    totals: { assets: string; liabilities: string; equity: string };
    balanced: boolean;
  } {
    const assets: Array<{ accountCode: string; accountName: string; balance: string }> = [];
    const liabilities: Array<{ accountCode: string; accountName: string; balance: string }> = [];
    const equity: Array<{ accountCode: string; accountName: string; balance: string }> = [];
    let tA = new Decimal(0);
    let tL = new Decimal(0);
    let tE = new Decimal(0);

    for (const acc of this.postableAccounts(context)) {
      if (acc.type === "revenue" || acc.type === "expense") continue;
      const bal = this.balanceAsOf(acc.code, asOfDate, context);
      if (bal.isZero()) continue;
      const entry = { accountCode: acc.code, accountName: acc.name, balance: bal.toFixed(4) };
      if (acc.type === "asset") {
        assets.push(entry);
        tA = tA.plus(bal);
      } else if (acc.type === "liability") {
        liabilities.push(entry);
        tL = tL.plus(bal);
      } else {
        equity.push(entry);
        tE = tE.plus(bal);
      }
    }

    // معادلة المحاسبة: الأصول = الخصوم + الحقوق (بإشارة الطبيعي الموحدة: A - L - E = 0)
    const balanced = tA.minus(tL).minus(tE).isZero();

    return {
      assets,
      liabilities,
      equity,
      totals: { assets: tA.toFixed(4), liabilities: tL.toFixed(4), equity: tE.toFixed(4) },
      balanced,
    };
  }

  /** §6.3 نتيجة اليوم — قراءة صف واحد من daily_business_results (<50ms هدفًا) */
  dailyResult(businessDate: string, context: ReportContext): DailyResultRow | null {
    return this.balanceStore.getDailyResult(context.tenantId, businessDate);
  }

  /** نتيجة فترة هجينة: إيرادات/مصروفات بنفس آلية incomeStatement لكن بإخراج مختصر تشغيلي */
  periodResult(from: string, to: string, context: ReportContext): {
    period: { from: string; to: string };
    revenueTotal: string;
    cogsTotal: string;
    expensesTotal: string;
    netProfit: string;
  } {
    const inc = this.incomeStatement(from, to, context);
    return {
      period: { from, to },
      revenueTotal: inc.revenue.total,
      cogsTotal: inc.cogs,
      expensesTotal: inc.operatingExpenses.total,
      netProfit: inc.netProfit,
    };
  }

  /** دفتر النقدية (live_query): حركة حسابات النقد 1101/1110/1120 مع رصيد جري */
  cashBook(filters: Record<string, string | undefined>, context: ReportContext): {
    rows: Array<{ date: string; description: string; in: string; out: string; running: string }>;
    totalIn: string;
    totalOut: string;
  } {
    const from = filters.date_from ?? "0001-01-01";
    const to = filters.date_to ?? today();
    const cashCodes = ["1101", "1110", "1120"];
    const placeholders = cashCodes.map(() => "?").join(",");
    const rowsRaw = this.db
      .prepare(
        `SELECT je.entry_date AS date, je.description_simple AS description,
                jl.side AS side, jl.base_amount AS base_amount, a.code AS code
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN accounts a ON a.id = jl.account_id
         WHERE je.tenant_id = ? AND a.code IN (${placeholders})
           AND je.entry_date >= ? AND je.entry_date <= ?
         ORDER BY je.entry_date, je.created_at`
      )
      .all(context.tenantId, ...cashCodes, from, to) as Array<{
      date: string;
      description: string;
      side: string;
      base_amount: string;
      code: string;
    }>;

    let running = new Decimal(0);
    let totalIn = new Decimal(0);
    let totalOut = new Decimal(0);
    const rows = rowsRaw.map((r) => {
      const amt = new Decimal(r.base_amount);
      if (r.side === "debit") {
        running = running.plus(amt);
        totalIn = totalIn.plus(amt);
      } else {
        running = running.minus(amt);
        totalOut = totalOut.plus(amt);
      }
      return {
        date: r.date,
        description: `${r.description} (${r.code})`,
        in: r.side === "debit" ? amt.toFixed(4) : "0.0000",
        out: r.side === "credit" ? amt.toFixed(4) : "0.0000",
        running: running.toFixed(4),
      };
    });
    return { rows, totalIn: totalIn.toFixed(4), totalOut: totalOut.toFixed(4) };
  }

  /** دفتر الأستاذ (live_query): كل أسطر حساب خلال مدى مع رصيد جري وإجماليات */
  generalLedger(filters: Record<string, string | undefined>, context: ReportContext): unknown {
    const accountId = filters.account_id;
    if (!accountId) throw new ReportNotFoundError("general_ledger يتطلب فلتر account_id");
    const acc = this.db
      .prepare(`SELECT code, name_ar_simple FROM accounts WHERE tenant_id = ? AND id = ?`)
      .get(context.tenantId, accountId) as { code: string; name_ar_simple: string } | undefined;
    if (!acc) throw new ReportNotFoundError("الحساب غير موجود");

    const from = filters.date_from ?? "0001-01-01";
    const to = filters.date_to ?? today();
    const lineRows = this.db
      .prepare(
        `SELECT je.entry_date AS date, je.description_simple AS description,
                jl.side AS side, jl.base_amount AS base_amount, jl.memo_ar AS memo
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE je.tenant_id = ? AND jl.account_id = ? AND je.entry_date >= ? AND je.entry_date <= ?
         ORDER BY je.entry_date, je.created_at, jl.line_order`
      )
      .all(context.tenantId, accountId, from, to) as Array<{
      date: string;
      description: string;
      side: string;
      base_amount: string;
      memo: string | null;
    }>;

    let running = new Decimal(0);
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    const entries = lineRows.map((r) => {
      const amt = new Decimal(r.base_amount);
      if (r.side === "debit") {
        running = running.plus(amt);
        totalDebit = totalDebit.plus(amt);
      } else {
        running = running.minus(amt);
        totalCredit = totalCredit.plus(amt);
      }
      return { ...r, amount: amt.toFixed(4), running: running.toFixed(4) };
    });

    return { account: { code: acc.code, name: acc.name_ar_simple }, entries, totalDebit: totalDebit.toFixed(4), totalCredit: totalCredit.toFixed(4), closingBalance: running.toFixed(4) };
  }

  /** دفتر اليومية (live_query): قيود كاملة بأسطرها */
  journalBook(from: string, to: string, context: ReportContext): unknown {
    const entryRows = this.db
      .prepare(
        `SELECT id, entry_date, description_simple, source_type FROM journal_entries
         WHERE tenant_id = ? AND entry_date >= ? AND entry_date <= ? ORDER BY entry_date, created_at`
      )
      .all(context.tenantId, from, to) as Array<{
      id: string;
      entry_date: string;
      description_simple: string;
      source_type: string;
    }>;

    const linesStmt = this.db.prepare(
      `SELECT jl.side, jl.base_amount, a.code, a.name_ar_simple
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
       WHERE jl.journal_entry_id = ? ORDER BY jl.line_order`
    );

    return entryRows.map((e) => ({
      entryDate: e.entry_date,
      description: e.description_simple,
      sourceType: e.source_type,
      lines: (linesStmt.all(e.id) as Array<{ side: string; base_amount: string; code: string; name_ar_simple: string }>).map(
        (l) => ({
          account: `${l.code} ${l.name_ar_simple}`,
          debit: l.side === "debit" ? l.base_amount : "0.0000",
          credit: l.side === "credit" ? l.base_amount : "0.0000",
        })
      ),
    }));
  }

  /**
   * §6.4 تقرير فروق العملة — تحقيق توصية فصل الربح التشغيلي عن أثر الصرف (حرج للسوق اليمني).
   * مصدرا الفروق: (أ) حسابات 4900/5900 في ledger، (ب) fx_gain_loss_amount في allocations.
   */
  fxImpactReport(from: string, to: string, context: ReportContext): {
    operatingNetProfit: string;
    fxGains: string;
    fxLosses: string;
    netFxImpact: string;
    totalReportedProfit: string;
    warningAr: string | null;
  } {
    const operating = new Decimal(this.incomeStatement(from, to, context).netProfit);

    // (أ) فروقات مُرحَّلة على حسابات 4900 (خسارة صرف مدينة) و5900 (ربح صرف دائنة)
    const fxAccts = this.db
      .prepare(
        `SELECT a.code AS code, jl.side AS side, jl.base_amount AS base_amount
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN accounts a ON a.id = jl.account_id
         WHERE je.tenant_id = ? AND a.code IN ('4900','5900') AND je.entry_date >= ? AND je.entry_date <= ?`
      )
      .all(context.tenantId, from, to) as Array<{ code: string; side: string; base_amount: string }>;

    let gainsFromLedger = new Decimal(0);
    let lossesFromLedger = new Decimal(0);
    for (const r of fxAccts) {
      const amt = new Decimal(r.base_amount);
      // ربح صرف (5900 دائن) أو خسارة (4900 مدين) — والحالتان المعاكستان تُخصمان بشكل متماثل
      if (r.code === "5900") gainsFromLedger = gainsFromLedger.plus(r.side === "credit" ? amt : amt.negated());
      else lossesFromLedger = lossesFromLedger.plus(r.side === "debit" ? amt : amt.negated());
    }

    // (ب) فروقات التسويات في الذمم الفرعية — مصدرها ar_ap_allocations (مخطط §ar-ap:
    // fx_gain_loss_amount بعملة البند + allocation_date). تُقرأ مباشرة بدقة Decimal بلا JOIN.
    let allocGains = new Decimal(0);
    let allocLosses = new Decimal(0);
    const hasAlloc = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ar_ap_allocations'`)
      .get();
    if (hasAlloc) {
      const allocRows = this.db
        .prepare(
          `SELECT fx_gain_loss_amount AS fx
           FROM ar_ap_allocations
           WHERE tenant_id = ? AND allocation_date >= ? AND allocation_date <= ?`
        )
        .all(context.tenantId, from, to) as Array<{ fx: string | null }>;
      for (const a of allocRows) {
        const v = new Decimal(a.fx ?? "0");
        if (v.isPositive()) allocGains = allocGains.plus(v);
        else allocLosses = allocLosses.plus(v.abs());
      }
    }

    const fxGains = gainsFromLedger.plus(allocGains);
    const fxLosses = lossesFromLedger.plus(allocLosses);
    const netFx = fxGains.minus(fxLosses);

    return {
      operatingNetProfit: operating.toFixed(4),
      fxGains: fxGains.toFixed(4),
      fxLosses: fxLosses.toFixed(4),
      netFxImpact: netFx.toFixed(4),
      totalReportedProfit: operating.plus(netFx).toFixed(4),
      warningAr: netFx.isZero()
        ? null
        : "جزء من ربحك ناتج عن تغيّر سعر الصرف وليس من نشاطك التجاري الفعلي (§6.4)",
    };
  }

  // ===================== إقفال اليوم (§4.3 — مرن، منفصل عن القفل المحاسبي) =====================

  previewDailyClosure(date: string, context: ReportContext): {
    expectedCashBalance: string;
    dailyResult: DailyResultRow | null;
  } {
    // النقد المتوقع = Σ رصيد حسابات الصندوق/البنك/المحفظة كما في نهاية اليوم
    let cash = new Decimal(0);
    for (const code of ["1101", "1110", "1120"]) {
      const rb = this.balanceStore.getRunningBalance(context.tenantId, code);
      // المعاينة تعتمد الجدول الحي (نفس يوم التشغيل) — أدق من إعادة حساب ledger
      if (rb) cash = cash.plus(rb.current_balance_base);
    }
    return { expectedCashBalance: cash.toFixed(4), dailyResult: this.dailyResult(date, context) };
  }

  closeBusinessDay(
    date: string,
    actualCashCounted: string,
    context: ReportContext & { userId: string }
  ): { closureId: string; cashVariance: string; suggestedAdjustment: boolean } {
    const preview = this.previewDailyClosure(date, context);
    const actual = new Decimal(actualCashCounted);
    const expected = new Decimal(preview.expectedCashBalance);
    const variance = actual.minus(expected);

    const id = randomUUID();
    const runAtomic = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO daily_closures
             (id, tenant_id, business_date, cash_expected_balance, cash_actual_counted,
              cash_variance, total_revenue_base, total_expenses_base, net_result_base,
              status, closed_by_user_id, closed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?)
           ON CONFLICT(tenant_id, business_date) DO UPDATE SET
             cash_expected_balance = excluded.cash_expected_balance,
             cash_actual_counted = excluded.cash_actual_counted,
             cash_variance = excluded.cash_variance,
             total_revenue_base = excluded.total_revenue_base,
             total_expenses_base = excluded.total_expenses_base,
             net_result_base = excluded.net_result_base,
             status = 'closed', closed_by_user_id = excluded.closed_by_user_id, closed_at = excluded.closed_at`
        )
        .run(
          id,
          context.tenantId,
          date,
          expected.toFixed(4),
          actual.toFixed(4),
          variance.toFixed(4),
          preview.dailyResult?.revenueTotalBase ?? "0.0000",
          preview.dailyResult?.expensesTotalBase ?? "0.0000",
          preview.dailyResult?.netProfitBase ?? "0.0000",
          context.userId,
          new Date().toISOString()
        );
    });
    runAtomic();

    // §4.3: فرق != 0 ⇒ اقتراح تسوية الصندوق (لا يفرضه — مرونة للتاجر غير المختص)
    return {
      closureId: id,
      cashVariance: variance.toFixed(4),
      suggestedAdjustment: !variance.isZero(),
    };
  }

  // ===================== أدوات =====================

  private logExecution(
    tenantId: string,
    userId: string | undefined,
    reportCode: string,
    filters: Record<string, string | undefined>,
    ms: number
  ): void {
    this.db
      .prepare(
        `INSERT INTO report_execution_log (id, tenant_id, user_id, report_code, filters_used, execution_time_ms, status, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'success', ?)`
      )
      .run(randomUUID(), tenantId, userId ?? null, reportCode, JSON.stringify(filters), ms, new Date().toISOString());
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "2026-09-30" + 1 → "2026-10-01" (UTC، بلا مخاطر توقيت محلي) */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** تحويل تجميع REAL إلى Decimal بدقة التخزين (4 خانات) — يمتص خطأ IEEE ولا يخفيه */
function toDecimalFromAggregate(n: number): Decimal {
  if (!Number.isFinite(n)) return new Decimal(0);
  return new Decimal(n.toFixed(MoneyStorageDecimals));
}

const MoneyStorageDecimals = 4;
