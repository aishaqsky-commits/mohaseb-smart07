"use strict";
// src/infrastructure/sqlite/SqliteJournalRepository.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteJournalRepository = void 0;
const JournalEntry_1 = require("../../domain/entities/JournalEntry");
const JournalLine_1 = require("../../domain/entities/JournalLine");
const Money_1 = require("../../domain/value-objects/Money");
class SqliteJournalRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * الحفظ الذري: رأس القيد وكل أسطره في Transaction واحدة لا تتجزأ.
     * فشل أي سطر = تراجع كامل (Rollback) تلقائي.
     */
    async save(entry) {
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
        const runAtomic = this.db.transaction((journalEntry) => {
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
            }
            else if (journalEntry.isReversed) {
                // تحديث علامة "معكوس" فقط على القيد الأصلي الموجود مسبقًا
                updateReversedFlag.run(journalEntry.id, journalEntry.tenantId);
            }
        });
        runAtomic(entry);
    }
    async findById(tenantId, entryId) {
        const entryRow = this.db
            .prepare(`SELECT * FROM journal_entries WHERE tenant_id = ? AND id = ?`)
            .get(tenantId, entryId);
        if (!entryRow)
            return null;
        const lineRows = this.db
            .prepare(`SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_order ASC`)
            .all(entryId);
        const lines = lineRows.map((row) => JournalLine_1.JournalLine.reconstruct({
            id: row.id,
            accountId: row.account_id,
            side: row.side,
            amount: Money_1.Money.fromDecimalString(row.amount, row.currency_code),
            baseAmount: Money_1.Money.fromDecimalString(row.base_amount, entryRow.base_currency_code),
            exchangeRateUsed: row.exchange_rate_used,
            contactId: row.contact_id,
            memoAr: row.memo_ar,
            lineOrder: row.line_order,
        }));
        return JournalEntry_1.JournalEntry.reconstructFromPersistence
            ? JournalEntry_1.JournalEntry.reconstructFromPersistence({ ...entryRow, lines })
            : this.buildEntryFromRow(entryRow, lines);
    }
    buildEntryFromRow(entryRow, lines) {
        // ملاحظة هندسية: في بيئة الإنتاج تُضاف دالة JournalEntry.reconstruct()
        // مخصصة لإعادة البناء من التخزين دون إعادة تنفيذ التحقق من التوازن
        // (التوازن مضمون مسبقًا لأنه لم يُقبل إلا بعد التحقق عند الإنشاء الأصلي).
        return JournalEntry_1.JournalEntry.create({
            tenantId: entryRow.tenant_id,
            entryDate: new Date(entryRow.entry_date),
            descriptionSimple: entryRow.description_simple,
            sourceType: entryRow.source_type,
            sourceTransactionId: entryRow.source_transaction_id,
            baseCurrencyCode: entryRow.base_currency_code,
            lines,
        });
    }
    async getFiscalPeriodStatus(tenantId, entryDate) {
        const dateStr = entryDate.toISOString().split("T")[0];
        const row = this.db
            .prepare(`SELECT status FROM fiscal_periods 
         WHERE tenant_id = ? AND start_date <= ? AND end_date >= ?`)
            .get(tenantId, dateStr, dateStr);
        // لا فترة مسجَّلة بعد = تُعامَل كفترة مفتوحة ضمنيًا (Lazy Creation كما صُمِّم سابقًا)
        return { isClosed: row?.status === "closed" };
    }
}
exports.SqliteJournalRepository = SqliteJournalRepository;
//# sourceMappingURL=SqliteJournalRepository.js.map