import Database from "better-sqlite3";
import { JournalEntry } from "../../domain/entities/JournalEntry";
import { JournalRepository, FiscalPeriodStatus } from "../../domain/ports/JournalRepository";
export declare class SqliteJournalRepository implements JournalRepository {
    private readonly db;
    private readonly balanceStore;
    constructor(db: Database.Database);
    /**
     * الحفظ الذري: رأس القيد وكل أسطره في Transaction واحدة لا تتجزأ.
     * فشل أي سطر = تراجع كامل (Rollback) تلقائي.
     * تشمل أيضًا تحديث الأرصدة التجميعية (running balances + نتيجة اليوم)
     * ضمن نفس المعاملة — فلا حالة وسيطة بين Ledger والمجمّعات (§2.3/§2.5).
     */
    save(entry: JournalEntry): Promise<void>;
    findById(tenantId: string, entryId: string): Promise<JournalEntry | null>;
    private buildEntryFromRow;
    getFiscalPeriodStatus(tenantId: string, entryDate: Date): Promise<FiscalPeriodStatus>;
}
