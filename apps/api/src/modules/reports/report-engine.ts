// src/modules/reports/report-engine.ts
// ===== محرك التقارير المالية الحي — وفق docs/04-modules/financial-reporting.md §3 §6 =====
// يقرأ مباشرة من دفتر اليومية العام عبر SQL على نفس قاعدة النواة،
// بنفس قواعد الدقة: مبالغ كنص Decimal (Decimal.js) — بلا فاصلة عائمة إطلاقًا.
//
// قرارات تصميمية موثّقة:
// - كل القيود تُحتسب بأثرها الكامل بما فيها القيود العكسية (reversal entries):
//   القيد العكسي قيد متوازن بحد ذاته، وضمّه هو ما يجعل الأرصدة تعكس المرتدات/التسويات.
// - المحرك "حي" بالكامل (live_query): قراءة account_period_balances تُضاف عند تنفيذ
//   محرك إقفال الفترات (§4) — غير منفذ في Phase 1.
// - الفترة [date_from, date_to): التاريخان ISO؛ date_to غير شامل (نصف مفتوحة).

import { Inject, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type Database from 'better-sqlite3';
import type { CoreContainer } from '@platform/core-accounting';
import { CORE_CONTAINER } from '../../core/core.module';

export interface ReportAccountRow {
  code: string;
  nameArSimple: string;
  accountType: string;
  debit: string; // نص Decimal خام (التنسيق مسؤولية الواجهة)
  credit: string;
}

export interface TrialBalanceResult {
  asOfDate: string;
  currencyCode: string;
  rows: ReportAccountRow[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
}

export interface IncomeStatementLine {
  code: string;
  nameArSimple: string;
  amount: string; // موجب باتجاه طبيعة الحساب
}

export interface IncomeStatementResult {
  dateFrom: string;
  dateTo: string;
  currencyCode: string;
  revenueLines: IncomeStatementLine[];
  totalRevenue: string;
  cogsAmount: string; // مصروفات فئة 51xx (تكلفة المبيعات)
  grossProfit: string;
  expenseLines: IncomeStatementLine[]; // المصروفات عدا COGS
  operatingExpenses: string;
  netProfit: string;
}

/** خطأ تحقق مستخدم → HTTP 400 عبر toApiError (مسار ValidationError الموجود) */
export function validationError(message: string): Error {
  return Object.assign(new Error(message), { name: 'ValidationError' });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface AccountMetaRow {
  id: string;
  code: string;
  nameArSimple: string;
  accountType: string;
  normalBalance: 'debit' | 'credit';
  isHeader: number;
  isPostable: number;
  isActive: number;
}

interface LineRow {
  accountId: string;
  side: 'debit' | 'credit';
  baseAmount: string;
}

@Injectable()
export class ReportEngineService {
  constructor(
    @Inject(CORE_CONTAINER) private readonly defaultContainer: CoreContainer,
  ) {}

  /** §6.1 ميزان المراجعة حتى تاريخ (as_of_date شامل).
   * صافي كل حساب = Σمدين − Σدائن؛ يُعرض في عمود طبيعته بالمقدار المطلق،
   * وتُحذف الأرصدة الصفرية. الضمان الصحي الإلزامي: Σمدين == Σدائن.
   * ctx حاوية سياق الطلب (multi-tenant) — الافتراضية عند غيابها (MVP). */
  trialBalance(tenantId: string, asOfDate: string, ctx?: CoreContainer): TrialBalanceResult {
    this.assertDate(asOfDate, 'as_of_date');
    const db = (ctx ?? this.defaultContainer).db;

    const lines = db
      .prepare(
        `SELECT jl.account_id AS accountId, jl.side AS side, jl.base_amount AS baseAmount
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE je.tenant_id = ? AND date(je.entry_date) <= date(?)`
      )
      .all(tenantId, asOfDate) as LineRow[];

    const netByAccount = this.netByAccount(lines);

    const accounts = this.listAccountMeta(db, tenantId);
    const zero = new Decimal(0);
    let totalDebit = zero;
    let totalCredit = zero;
    const rows: ReportAccountRow[] = [];

    for (const a of accounts) {
      if (!this.isLeafPostable(a)) continue; // التجميعية/غير النشطة لا تحمل أرصدة عرض
      const net = netByAccount.get(a.id) ?? zero;
      if (net.isZero()) continue;
      const onDebitSide =
        (a.normalBalance === 'debit' && net.gte(0)) || (a.normalBalance === 'credit' && net.lt(0));
      const abs = net.abs();
      rows.push({
        code: a.code,
        nameArSimple: a.nameArSimple,
        accountType: a.accountType,
        debit: onDebitSide ? abs.toFixed(4) : '0',
        credit: onDebitSide ? '0' : abs.toFixed(4),
      });
      if (onDebitSide) totalDebit = totalDebit.plus(abs);
      else totalCredit = totalCredit.plus(abs);
    }

    rows.sort((x, y) => x.code.localeCompare(y.code));
    return {
      asOfDate,
      currencyCode: this.baseCurrency(),
      rows,
      totalDebit: totalDebit.toFixed(4),
      totalCredit: totalCredit.toFixed(4),
      balanced: totalDebit.eq(totalCredit), // Sanity Check قبل الإرجاع (§6.1 ASSERT)
    };
  }

  /**
   * §6.2 قائمة الدخل للفترة [date_from, date_to) — نشاط الإيرادات والمصروفات فقط.
   * صافي الإيراد = Σدائن − Σمدين؛ صافي المصروف = Σمدين − Σدائن.
   * الإجمالي الفرعي: gross = revenue − COGS(51xx)، net = gross − بقية المصروفات.
   */
  incomeStatement(tenantId: string, dateFrom: string, dateTo: string, ctx?: CoreContainer): IncomeStatementResult {
    this.assertDate(dateFrom, 'date_from');
    this.assertDate(dateTo, 'date_to');
    if (dateFrom >= dateTo) throw validationError('date_from يجب أن يسبق date_to');

    const db = (ctx ?? this.defaultContainer).db;
    const lines = db
      .prepare(
        `SELECT jl.account_id AS accountId, jl.side AS side, jl.base_amount AS baseAmount
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN accounts a ON a.id = jl.account_id AND a.tenant_id = je.tenant_id
         WHERE je.tenant_id = ?
           AND a.account_type IN ('revenue','expense')
           AND date(je.entry_date) >= date(?) AND date(je.entry_date) < date(?)`
      )
      .all(tenantId, dateFrom, dateTo) as LineRow[];

    const netRaw = this.netByAccount(lines); // مدين − دين

    const metaById = new Map(this.listAccountMeta(db, tenantId).map((a) => [a.id, a]));
    const zero = new Decimal(0);
    const revenueLines: IncomeStatementLine[] = [];
    const expenseLines: IncomeStatementLine[] = [];
    let totalRevenue = zero;
    let cogs = zero;
    let operating = zero;

    for (const [accountId, net] of netRaw) {
      const a = metaById.get(accountId);
      if (!a) continue;
      if (a.accountType === 'revenue') {
        const shown = net.negated(); // صافي دائن موجب
        if (shown.isZero()) continue;
        revenueLines.push({ code: a.code, nameArSimple: a.nameArSimple, amount: shown.toFixed(4) });
        totalRevenue = totalRevenue.plus(shown);
      } else {
        if (net.isZero()) continue;
        if (a.code.startsWith('51')) {
          cogs = cogs.plus(net);
        } else {
          expenseLines.push({ code: a.code, nameArSimple: a.nameArSimple, amount: net.toFixed(4) });
          operating = operating.plus(net);
        }
      }
    }

    revenueLines.sort((x, y) => x.code.localeCompare(y.code));
    expenseLines.sort((x, y) => x.code.localeCompare(y.code));
    const grossProfit = totalRevenue.minus(cogs);
    const netProfit = grossProfit.minus(operating);

    return {
      dateFrom,
      dateTo,
      currencyCode: this.baseCurrency(),
      revenueLines,
      totalRevenue: totalRevenue.toFixed(4),
      cogsAmount: cogs.toFixed(4),
      grossProfit: grossProfit.toFixed(4),
      expenseLines,
      operatingExpenses: operating.toFixed(4),
      netProfit: netProfit.toFixed(4),
    };
  }

  // ===== أدوات داخلية =====

  /** تجميع دقيق (Decimal على نصوص المخزن) لصافي مدين−دين لكل حساب */
  private netByAccount(lines: LineRow[]): Map<string, Decimal> {
    const acc = new Map<string, Decimal>();
    for (const l of lines) {
      const cur = acc.get(l.accountId) ?? new Decimal(0);
      acc.set(l.accountId, l.side === 'debit' ? cur.plus(l.baseAmount) : cur.minus(l.baseAmount));
    }
    return acc;
  }

  private listAccountMeta(db: Database.Database, tenantId: string): AccountMetaRow[] {
    return db
      .prepare(
        `SELECT id, code, name_ar_simple AS nameArSimple, account_type AS accountType,
                normal_balance AS normalBalance, is_header AS isHeader,
                is_postable AS isPostable, is_active AS isActive
         FROM accounts WHERE tenant_id = ? ORDER BY code`
      )
      .all(tenantId) as AccountMetaRow[];
  }

  /** ورقة قابلة للترحيل ونشطة — مطابقة لمنطق الكيان Account.isPostableSafe */
  private isLeafPostable(a: AccountMetaRow): boolean {
    return a.isHeader === 0 && a.isPostable === 1 && a.isActive === 1;
  }

  private baseCurrency(): string {
    return process.env.BASE_CURRENCY ?? 'YER';
  }

  private assertDate(value: string, field: string): void {
    if (!DATE_RE.test(value)) {
      throw validationError(`الحقل "${field}" يجب أن يكون بتاريخ ISO (YYYY-MM-DD)`);
    }
  }
}
