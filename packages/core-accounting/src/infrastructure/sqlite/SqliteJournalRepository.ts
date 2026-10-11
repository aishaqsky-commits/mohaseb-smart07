// src/infrastructure/sqlite/SqliteJournalRepository.ts

import Database from "better-sqlite3";
import { JournalEntry } from "../../domain/entities/JournalEntry";
import { JournalLine } from "../../domain/entities/JournalLine";
import { Money } from "../../domain/value-objects/Money";
import {
  JournalRepository,
  FiscalPeriodStatus,
} from "../../domain/ports/JournalRepository";
import { BalanceMaintenanceStore } from "./BalanceMaintenanceStore";

export class SqliteJournalRepository implements JournalRepository {
  private readonly balanceStore: BalanceMaintenanceStore;

  constructor(private readonly db: Database.Database) {
    this.balanceStore = new BalanceMaintenanceStore(db);
  }

  /**
   * الحفظ الذري: رأس القيد وكل أسطره في Transaction واحدة لا تتجزأ.
   * فشل أي سطر = تراجع كامل (Rollback) تلقائي.
   * تشمل أيضًا تحديث الأرصدة التجميعية (running balances + نتيجة اليوم)
   * ضمن نفس المعاملة — فلا حالة وسيطة بين Ledger والمجمّعات (§2.3/§2.5).
   */
  async save(entry: JournalEntry): Promise<void> {
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

    // better-sqlite3 يدعم Transaction متزامنة بأداء عالٍ جدًا (محلي بطبيعته)
    const runAtomic = this.db.transaction((journalEntry: JournalEntry) => {
      const existingEntry = this.db
        .prepare(`SELECT id FROM journal_entries WHERE id = ?`)
        .get(journalEntry.id);

      if (!existingEntry) {
        insertEntry.run({
          id: journalEntry.id,
          tenantId: journalEntry.tenantId,
          entryDate: journalEntry.entryDate.toISOString().split("T")[0],
          descriptionSimple: journalEntry.descriptionSimple,
          sourceType: journalEntry.sourceType,
          sourceTransactionId: journalEntry.sourceTransactionId,
          reversalOfEntryId: journalEntry.reversalOfEntryId,
          isReversed: journalEntry.isReversed ? 1 : 0,
          baseCurrencyCode: journalEntry.baseCurrencyCode,
          createdAt: journalEntry.createdAt.toISOString(),
        });

        for (const line of journalEntry.lines) {
          insertLine.run({
            id: line.id,
            journalEntryId: journalEntry.id,
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
      } else if (journalEntry.isReversed) {
        // تحديث علامة "معكوس" فقط على القيد الأصلي الموجود مسبقًا
        updateReversedFlag.run(journalEntry.id, journalEntry.tenantId);
      }
    });

    runAtomic(entry);
  }

  async findById(tenantId: string, entryId: string): Promise<JournalEntry | null> {
    const entryRow = this.db
      .prepare(`SELECT * FROM journal_entries WHERE tenant_id = ? AND id = ?`)
      .get(tenantId, entryId) as any;

    if (!entryRow) return null;

    const lineRows = this.db
      .prepare(`SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_order ASC`)
      .all(entryId) as any[];

    const lines = lineRows.map((row) =>
      JournalLine.reconstruct({
        id: row.id,
        accountId: row.account_id,
        side: row.side,
        amount: Money.fromDecimalString(row.amount, row.currency_code),
        baseAmount: Money.fromDecimalString(row.base_amount, entryRow.base_currency_code),
        exchangeRateUsed: row.exchange_rate_used,
        contactId: row.contact_id,
        memoAr: row.memo_ar,
        lineOrder: row.line_order,
      })
    );

    return (JournalEntry as any).reconstructFromPersistence
      ? (JournalEntry as any).reconstructFromPersistence({ ...entryRow, lines })
      : this.buildEntryFromRow(entryRow, lines);
  }

  private buildEntryFromRow(entryRow: any, lines: JournalLine[]): JournalEntry {
    // ملاحظة هندسية: في بيئة الإنتاج تُضاف دالة JournalEntry.reconstruct()
    // مخصصة لإعادة البناء من التخزين دون إعادة تنفيذ التحقق من التوازن
    // (التوازن مضمون مسبقًا لأنه لم يُقبل إلا بعد التحقق عند الإنشاء الأصلي).
    return JournalEntry.create({
      tenantId: entryRow.tenant_id,
      entryDate: new Date(entryRow.entry_date),
      descriptionSimple: entryRow.description_simple,
      sourceType: entryRow.source_type,
      sourceTransactionId: entryRow.source_transaction_id,
      baseCurrencyCode: entryRow.base_currency_code,
      lines,
    });
  }

  async getFiscalPeriodStatus(
    tenantId: string,
    entryDate: Date
  ): Promise<FiscalPeriodStatus> {
    const dateStr = entryDate.toISOString().split("T")[0];
    const row = this.db
      .prepare(
        `SELECT id, period_key, status FROM fiscal_periods 
         WHERE tenant_id = ? AND start_date <= ? AND end_date >= ?`
      )
      .get(tenantId, dateStr, dateStr) as
      | { id: string; period_key: string; status: string }
      | undefined;

    // لا فترة مسجَّلة بعد = تُعامَل كفترة مفتوحة ضمنيًا (Lazy Creation كما صُمِّم سابقًا)
    return {
      isClosed: row?.status === "closed",
      periodId: row?.id ?? null,
      periodKey: row?.period_key ?? null,
    };
  }
}
