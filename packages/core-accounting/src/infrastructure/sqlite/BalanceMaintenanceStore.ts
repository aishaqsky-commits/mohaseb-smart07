// src/infrastructure/sqlite/BalanceMaintenanceStore.ts
// ===== صيانة الأرصدة التجميعية (Hot Aggregates) — docs/04-modules/financial-reporting.md §2.3, §2.5 =====
// المبدأ الحاكم (§ تعليمات المرحلة 5 في PRD): التقارير تُبنى على جداول تجميعية محدَّثة تدريجيًا،
// لا على مسح كامل القيود. هذا الملف هو المكان الوحيد الذي تُحدَّث فيه account_running_balances
// و daily_business_results — ويُستدعى حصريًا داخل نفس المعاملة الذرية لحفظ القيد (Atomicity).

import Database from "better-sqlite3";
import Decimal from "decimal.js";
import { JournalEntry } from "../../domain/entities/JournalEntry";

/** حسابات النقد المعتمدة في بذرة core (§1101 الصندوق، §1110 بنك محلي، §1120 محافظ يمنية) */
const CASH_ACCOUNT_CODES = new Set(["1101", "1110", "1120"]);

export interface DailyResultRow {
  businessDate: string;
  revenueTotalBase: string;
  cogsTotalBase: string;
  grossProfitBase: string;
  expensesTotalBase: string;
  netProfitBase: string;
  cashInBase: string;
  cashOutBase: string;
  transactionsCount: number;
}

interface RunningBalanceDbRow {
  opening_balance_base: string;
  period_debit_total_base: string;
  period_credit_total_base: string;
}

interface DailyResultDbRow {
  revenue_total_base: string;
  cogs_total_base: string;
  expenses_total_base: string;
  cash_in_base: string;
  cash_out_base: string;
  transactions_count: number;
}

/**
 * مخزن الصيانة التجميعية. كل الدوال هنا **غير مستقلة بذاتها** — يجب أن تُنفَّذ
 * داخل db.transaction() التي تستدعيها (حفظ القيد أو إقفال الفترة)، فلا توجد
 * حالة وسيطة بين Ledger والأرصدة المجمّعة أبدًا.
 */
export class BalanceMaintenanceStore {
  constructor(private readonly db: Database.Database) {}

  /**
   * تطبيق حركة قيد على الأرصدة الحية + النتيجة اليومية (Incremental Update).
   * يُستدعى بعد نجاح إدراج القيد مباشرةً في نفس المعاملة الذرية.
   *
   * إشارة الرصيد الحي موحَّدة بمصطلح "الطبيعي" لكل الأنواع حتى لا يعرف هذا الملف
   * أنواع الحسابات إطلاقًا (فصل مسؤوليات نظيف):
   *   current = opening + debit - credit
   * والحسابات المدينة الطبيعية (أصول/مصروفات) تكون موجبة عند الزيادة،
   * والدائنة الطبيعية (خصوم/حقوق/إيرادات) تكون سالبة عند الزيادة — وهو اصطلاح
   * متسق داخليًا بالكامل؛ محرك التقارير يقلبه حسب normal_balance عند العرض.
   */
  applyEntryToAggregates(entry: JournalEntry, tenantId: string): void {
    const businessDate = entry.entryDate.toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    let revenueInc = new Decimal(0);
    let cogsInc = new Decimal(0);
    let expenseInc = new Decimal(0);
    let cashInInc = new Decimal(0);
    let cashOutInc = new Decimal(0);

    for (const line of entry.lines) {
      const baseAmt = new Decimal(line.baseAmount.toStorageString());
      const isDebit = line.side === "debit";

      // ---- الرصيد الحي (جدول واحد لكل حساب — يمثل الفترة المفتوحة دائمًا §2.3) ----
      // يحدَّد كود الحساب من الشجرة (الكيان النطاق يحمل accountId فقط)
      const accountRow = this.db
        .prepare(`SELECT code FROM accounts WHERE id = ?`)
        .get(line.accountId) as { code: string } | undefined;
      if (!accountRow) continue; // حساب غير معروف — لا يُجمَّع (لن يحدث عمليًا بسبب FK)
      const code = accountRow.code;

      const existing = this.db
        .prepare(
          `SELECT opening_balance_base, period_debit_total_base, period_credit_total_base
           FROM account_running_balances WHERE tenant_id = ? AND account_code = ?`
        )
        .get(tenantId, code) as RunningBalanceDbRow | undefined;

      let opening = new Decimal(existing?.opening_balance_base ?? "0");
      let periodDebit = new Decimal(existing?.period_debit_total_base ?? "0");
      let periodCredit = new Decimal(existing?.period_credit_total_base ?? "0");

      if (isDebit) periodDebit = periodDebit.plus(baseAmt);
      else periodCredit = periodCredit.plus(baseAmt);

      const current = opening.plus(periodDebit).minus(periodCredit);

      this.db
        .prepare(
          `INSERT INTO account_running_balances
             (tenant_id, account_code, opening_balance_base, period_debit_total_base,
              period_credit_total_base, current_balance_base, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, account_code) DO UPDATE SET
             period_debit_total_base = excluded.period_debit_total_base,
             period_credit_total_base = excluded.period_credit_total_base,
             current_balance_base = excluded.current_balance_base,
             updated_at = excluded.updated_at`
        )
        .run(
          tenantId,
          code,
          opening.toFixed(4),
          periodDebit.toFixed(4),
          periodCredit.toFixed(4),
          current.toFixed(4),
          nowIso
        );

      // ---- التجميع اليومي (§2.5 Hook): الإيراد/COGS/المصروف/النقد من أكواد الحسابات ----
      if (code === "4900" || code === "5900") {
        // فروقات العملة — معزولة تمامًا عن النتيجة التشغيلية (§5.3 PRD: "تقرير فروق العملة منفصل عن الربح التشغيلي")
      } else if (code.startsWith("4")) {
        // إيرادات ومردودات (4xxx) — المدين (عكس/مردود) يخصم طبيعيًا
        revenueInc = isDebit ? revenueInc.minus(baseAmt) : revenueInc.plus(baseAmt);
      } else if (code === "5110") {
        // تكلفة البضاعة/الخدمات المباعة COGS (§ بذرة retail: 5110 تحت رأس 5100)
        cogsInc = cogsInc.plus(isDebit ? baseAmt : baseAmt.negated());
      } else if (code.startsWith("5")) {
        expenseInc = expenseInc.plus(isDebit ? baseAmt : baseAmt.negated());
      } else if (CASH_ACCOUNT_CODES.has(code)) {
        if (isDebit) cashInInc = cashInInc.plus(baseAmt);
        else cashOutInc = cashOutInc.plus(baseAmt);
      }
    }

    // ---- upsert النتيجة اليومية تراكميًا ----
    const prev = this.db
      .prepare(
        `SELECT revenue_total_base, cogs_total_base, expenses_total_base,
                cash_in_base, cash_out_base, transactions_count
         FROM daily_business_results WHERE tenant_id = ? AND business_date = ?`
      )
      .get(tenantId, businessDate) as DailyResultDbRow | undefined;

    const revenue = new Decimal(prev?.revenue_total_base ?? "0").plus(revenueInc);
    const cogs = new Decimal(prev?.cogs_total_base ?? "0").plus(cogsInc);
    const expenses = new Decimal(prev?.expenses_total_base ?? "0").plus(expenseInc);
    const cashIn = new Decimal(prev?.cash_in_base ?? "0").plus(cashInInc);
    const cashOut = new Decimal(prev?.cash_out_base ?? "0").plus(cashOutInc);
    const count = (prev?.transactions_count ?? 0) + 1;
    const gross = revenue.minus(cogs);
    const net = gross.minus(expenses);

    this.db
      .prepare(
        `INSERT INTO daily_business_results
           (tenant_id, business_date, revenue_total_base, cogs_total_base, gross_profit_base,
            expenses_total_base, net_profit_base, cash_in_base, cash_out_base, transactions_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, business_date) DO UPDATE SET
           revenue_total_base = excluded.revenue_total_base,
           cogs_total_base = excluded.cogs_total_base,
           gross_profit_base = excluded.gross_profit_base,
           expenses_total_base = excluded.expenses_total_base,
           net_profit_base = excluded.net_profit_base,
           cash_in_base = excluded.cash_in_base,
           cash_out_base = excluded.cash_out_base,
           transactions_count = excluded.transactions_count,
           updated_at = excluded.updated_at`
      )
      .run(
        tenantId,
        businessDate,
        revenue.toFixed(4),
        cogs.toFixed(4),
        gross.toFixed(4),
        expenses.toFixed(4),
        net.toFixed(4),
        cashIn.toFixed(4),
        cashOut.toFixed(4),
        count,
        nowIso
      );
  }

  /** عكس الحركة (للقيد العكسي Reversal) — يطبَّق بنفس آلية applyEntry لأن createReversal يقلب الأسطر فعليًا */

  /** قراءة صف النتيجة اليومية كما هو (§2.5) */
  getDailyResult(tenantId: string, businessDate: string): DailyResultRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM daily_business_results WHERE tenant_id = ? AND business_date = ?`
      )
      .get(tenantId, businessDate) as
      | {
          business_date: string;
          revenue_total_base: string;
          cogs_total_base: string;
          gross_profit_base: string;
          expenses_total_base: string;
          net_profit_base: string;
          cash_in_base: string;
          cash_out_base: string;
          transactions_count: number;
        }
      | undefined;
    if (!row) return null;
    return {
      businessDate: row.business_date,
      revenueTotalBase: row.revenue_total_base,
      cogsTotalBase: row.cogs_total_base,
      grossProfitBase: row.gross_profit_base,
      expensesTotalBase: row.expenses_total_base,
      netProfitBase: row.net_profit_base,
      cashInBase: row.cash_in_base,
      cashOutBase: row.cash_out_base,
      transactionsCount: row.transactions_count,
    };
  }

  /**
   * ترحيل لقطة الرصيد الحي إلى جدول الفترات المجمّدة (§4.1 خطوة 1).
   * تُكتب كل صفوف account_running_balances للفترة — لا تُحذف من الجدول الحي هنا؛
   * النقل للفترة التالية يتم عبر rollForwardAfterClose (تصفير الدورات وتحميل الإغلاق كافتتاحي).
   */
  snapshotRunningBalances(tenantId: string, periodId: string): number {
    const rows = this.db
      .prepare(
        `SELECT account_code, opening_balance_base, period_debit_total_base,
                period_credit_total_base, current_balance_base
         FROM account_running_balances WHERE tenant_id = ?`
      )
      .all(tenantId) as Array<{
      account_code: string;
      opening_balance_base: string;
      period_debit_total_base: string;
      period_credit_total_base: string;
      current_balance_base: string;
    }>;

    const insert = this.db.prepare(
      `INSERT INTO account_period_balances
         (tenant_id, fiscal_period_id, account_code, opening_balance_base,
          period_debit_total_base, period_credit_total_base, closing_balance_base, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const nowIso = new Date().toISOString();
    for (const r of rows) {
      insert.run(
        tenantId,
        periodId,
        r.account_code,
        r.opening_balance_base,
        r.period_debit_total_base,
        r.period_credit_total_base,
        r.current_balance_base,
        nowIso
      );
    }
    return rows.length;
  }

  /**
   * نقل الأرصدة للفترة التالية (§4.1 "createNextPeriod يهيّئ account_running_balances الجديدة"):
   * إغلاق كل حساب يصبح افتتاحي الفترة القادمة، وتصفير دورات الفترة المنتهية.
   * الحسابات الاسمية (إيرادات/مصروفات) يكون إغلاقها صفرًا أصلًا بعد قيد الإقفال السنوي.
   */
  rollForwardAfterClose(tenantId: string): void {
    this.db
      .prepare(
        `UPDATE account_running_balances
         SET opening_balance_base = current_balance_base,
             period_debit_total_base = '0.0000',
             period_credit_total_base = '0.0000',
             current_balance_base = current_balance_base,
             updated_at = ?
         WHERE tenant_id = ?`
      )
      .run(new Date().toISOString(), tenantId);
  }

  /** حذف لقطة فترة (عند إعادة الفتح §4.2 — ستُعاد عند الإقفال مجددًا) */
  deletePeriodSnapshot(periodId: string): void {
    this.db
      .prepare(`DELETE FROM account_period_balances WHERE fiscal_period_id = ?`)
      .run(periodId);
  }

  /**
   * استعادة الأرصدة الحية من اللقطة عند إعادة فتح فترة (§4.2 restoreRunningBalancesFromSnapshot):
   * عكس rollForward — الافتتاحي يعود لقيمة افتتاحي الفترة المُقفَلة والدورات لقيدها المخزّنة.
   * يُطبَّق فقط على الحسابات الموجودة في اللقطة (الأحدث يفوق الأقدم تسلسلًا مضمون بإغلاق المتتالية).
   */
  restoreRunningBalancesFromSnapshot(tenantId: string, periodId: string): void {
    const rows = this.db
      .prepare(
        `SELECT account_code, opening_balance_base, period_debit_total_base,
                period_credit_total_base, closing_balance_base
         FROM account_period_balances WHERE fiscal_period_id = ? AND tenant_id = ?`
      )
      .all(periodId, tenantId) as Array<{
      account_code: string;
      opening_balance_base: string;
      period_debit_total_base: string;
      period_credit_total_base: string;
      closing_balance_base: string;
    }>;
    const update = this.db.prepare(
      `UPDATE account_running_balances
       SET opening_balance_base = ?, period_debit_total_base = ?,
           period_credit_total_base = ?, current_balance_base = ?, updated_at = ?
       WHERE tenant_id = ? AND account_code = ?`
    );
    const nowIso = new Date().toISOString();
    for (const r of rows) {
      update.run(
        r.opening_balance_base,
        r.period_debit_total_base,
        r.period_credit_total_base,
        r.closing_balance_base,
        nowIso,
        tenantId,
        r.account_code
      );
    }
  }

  /** قراءة رصيد حي واحد (للاختبارات والمعاينات) */
  getRunningBalance(tenantId: string, accountCode: string): RunningBalanceDbRow & { current_balance_base: string } | null {
    const row = this.db
      .prepare(
        `SELECT opening_balance_base, period_debit_total_base, period_credit_total_base, current_balance_base
         FROM account_running_balances WHERE tenant_id = ? AND account_code = ?`
      )
      .get(tenantId, accountCode) as
      | (RunningBalanceDbRow & { current_balance_base: string })
      | undefined;
    return row ?? null;
  }

  /** تصفير الأرصدة الحية لحسابات اسمية (إيرادات/مصروفات) بعد قيد الإقفال السنوي (§4.1) */
  resetRunningBalancesForAccounts(tenantId: string, accountCodes: string[]): void {
    const stmt = this.db.prepare(
      `UPDATE account_running_balances
       SET opening_balance_base = '0', period_debit_total_base = '0',
           period_credit_total_base = '0', current_balance_base = '0', updated_at = ?
       WHERE tenant_id = ? AND account_code = ?`
    );
    const nowIso = new Date().toISOString();
    for (const code of accountCodes) {
      stmt.run(nowIso, tenantId, code);
    }
  }
}
