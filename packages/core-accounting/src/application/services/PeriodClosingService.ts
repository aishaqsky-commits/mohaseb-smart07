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
import { SqliteJournalRepository } from "../../infrastructure/sqlite/SqliteJournalRepository";
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
  private readonly journalRepo: SqliteJournalRepository;
  private readonly balanceStore: BalanceMaintenanceStore;

  constructor(private readonly db: Database.Database) {
    // إعادة استخدام نفس طبقة الصيانة الذرية — لا منطق أرصدة مكرر أبدًا (DRY)
    this.balanceStore = new BalanceMaintenanceStore(db);
    this.journalRepo = new SqliteJournalRepository(db);
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
   * لقطة ← قيد إقفال (سنوي) ← تعليم مُقفَلة ← تهيئة الفترة التالية ← نقل الأرصدة.
   */
  async closeFiscalPeriod(
    tenantId: string,
    periodId: string,
    context: { userId: string; permissions: string[]; baseCurrencyCode: string }
  ): Promise<CloseResult> {
    assertPermission(context.permissions, "periods.close");

    const period = this.getPeriod(tenantId, periodId);
    if (!period) throw new PeriodNotFoundError();
    if (period.status !== "open") {
      throw new PeriodStateError("الفترة مُقفَلة بالفعل — لا يمكن إقفالها مرتين");
    }

    const isYear = !period.periodKey.includes("-");
    let closingEntryId: string | null = null;
    let snapshotCount = 0;

    const runAtomic = this.db.transaction(async () => {
      // 1) تجميد اللقطة (§4.1 خطوة FOR account)
      snapshotCount = this.balanceStore.snapshotRunningBalances(tenantId, period.id);

      // 2) إن كانت سنة: ترحيل صافي الإيرادات/المصروفات إلى الأرباح المرحّلة 3300 (§4.1)
      if (isYear) {
        closingEntryId = await this.postAnnualClosingEntry(tenantId, period, context.baseCurrencyCode);
      }

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

    await runAtomic();

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
    context: { userId: string; permissions: string[] }
  ): Promise<ReopenResult> {
    assertPermission(context.permissions, "periods.reopen");
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

    const runAtomic = this.db.transaction(async () => {
      // عكس قيد الإقفال السنوي إن وُجد (بحث بالمرجع الدقيق source_transaction_id = period.id)
      const closingEntryRow = this.db
        .prepare(
          `SELECT id FROM journal_entries
           WHERE tenant_id = ? AND source_type = 'system_adjustment'
             AND source_transaction_id = ? AND is_reversed = 0`
        )
        .get(tenantId, period.id) as { id: string } | undefined;

      if (closingEntryRow) {
        const original = await this.journalRepo.findById(tenantId, closingEntryRow.id);
        if (original) {
          const reversal = original.createReversal(`إعادة فتح فترة ${period.periodKey}: ${reason}`);
          await this.journalRepo.save(reversal);
          await this.journalRepo.save(original.markAsReversed());
          reversalEntryId = reversal.id;
        }
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

    await runAtomic();

    return { period: { ...period, status: "open" }, restoredAccounts: restored, reversalEntryId };
  }

  /**
   * §4.1 قيد الإقفال السنوي: مدين كل حساب اسمي برصيده الطبيعي/دائنه بالعكس،
   * والسطر الموازن على 3300 الأرباح المرحّلة. netIncome = Σ(دائن - مدين للإيرادات) - Σ(مدين - دائن للمصروفات).
   */
  private async postAnnualClosingEntry(
    tenantId: string,
    period: FiscalPeriodRow,
    baseCurrencyCode: string
  ): Promise<string | null> {
    const nominalRows = (
      this.db
        .prepare(
          `SELECT a.id, a.code, a.account_type, rb.current_balance_base
         FROM accounts a
         JOIN account_running_balances rb ON rb.tenant_id = a.tenant_id AND rb.account_code = a.code
         WHERE a.tenant_id = ? AND a.is_postable = 1 AND a.account_type IN ('revenue','expense')`
        )
        .all(tenantId) as Array<AccountInfoRow & { current_balance_base: string }>
    ).filter((r) => !new Decimal(r.current_balance_base).isZero()); // لا أسطر صفرية في قيد الإقفال

    if (nominalRows.length === 0) return null;

    const lines: JournalLine[] = [];
    let order = 1;
    let netIncome = new Decimal(0);

    for (const r of nominalRows) {
      // current بإشارة "الطبيعي": الإيراد الدائن موجب، والمصروف المدين موجب.
      // الرصيد قد يكون سالبًا (تجاوز غير طبيعي مثل مرتجعات مبيعات تفوق الإيراد) —
      // نبني السطر على القيمة المطلقة مع اختيار الجهة التي تُصفّر الرصيد فعليًا.
      const bal = new Decimal(r.current_balance_base);
      if (bal.isZero()) continue;
      const absBal = bal.abs();
      if (r.account_type === "revenue") {
        netIncome = netIncome.plus(bal);
        // تصفير إيراد دائن موجب ⇒ مدين؛ إيراد برصيد مدين سالب ⇒ دائن
        lines.push(makeClosingLine(r.id, bal.isPositive() ? "debit" : "credit", absBal, baseCurrencyCode, order++));
      } else {
        netIncome = netIncome.minus(bal);
        // تصفير مصروف مدين موجب ⇒ دائن؛ مصروف برصيد دائن سالب ⇒ مدين
        lines.push(makeClosingLine(r.id, bal.isPositive() ? "credit" : "debit", absBal, baseCurrencyCode, order++));
      }
    }

    if (lines.length === 0) return null; // لا ربح ولا خسارة — لا حاجة لقيد

    const retained = this.db
      .prepare(`SELECT id FROM accounts WHERE tenant_id = ? AND code = ?`)
      .get(tenantId, RETAINED_EARNINGS_CODE) as { id: string } | undefined;
    if (!retained) {
      throw new PeriodStateError(
        `الحساب ${RETAINED_EARNINGS_CODE} (الأرباح المرحّلة) مطلوب للإقفال السنوي وغير مُهيَّأ`
      );
    }

    // السطر الموازن: ربح ⇒ دائن 3300، خسارة ⇒ مدين 3300
    const absNet = netIncome.abs();
    if (!absNet.isZero()) {
      lines.push(
        makeClosingLine(
          retained.id,
          netIncome.isPositive() ? "credit" : "debit",
          absNet,
          baseCurrencyCode,
          order
        )
      );
    } else if (lines.length === 0) {
      return null; // صافي صفروأرصدة اسمية معدومة — لا حاجة لقيد إقفال
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

    await this.journalRepo.save(entry);

    // §4.1: تصفير الأرصدة الحية للاسمية فقط بعد نجاح قيد الإقفال
    this.balanceStore.resetRunningBalancesForAccounts(
      tenantId,
      nominalRows.map((r) => r.code)
    );

    return entry.id;
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
  if (!permissions.includes(required)) throw new PermissionDeniedError(required);
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
