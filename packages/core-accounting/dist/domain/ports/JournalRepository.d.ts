import { JournalEntry } from "../entities/JournalEntry";
/**
 * حالة الفترة المحاسبية لتاريخ معيّن.
 * موسَّعة وفق docs/04-modules/financial-reporting.md §2.1 — تبقى الحقول القديمة
 * (isClosed) كما هي لضمان التوافق الكامل مع كل المستدعين الحاليين.
 */
export interface FiscalPeriodStatus {
    isClosed: boolean;
    /** معرف الفترة المطابقة (null = لا فترة مسجّلة → تُعامَل كمفتوحة ضمنيًا Lazy Creation) */
    periodId?: string | null;
    /** مفتاح الفترة "2025-01" أو "2025" */
    periodKey?: string | null;
    periodType?: "month" | "year" | null;
    startDate?: string | null;
    endDate?: string | null;
}
export interface JournalRepository {
    /** يجب أن تُنفَّذ كمعاملة ذرية واحدة (رأس القيد + كل الأسطر معًا) */
    save(entry: JournalEntry): Promise<void>;
    findById(tenantId: string, entryId: string): Promise<JournalEntry | null>;
    getFiscalPeriodStatus(tenantId: string, entryDate: Date): Promise<FiscalPeriodStatus>;
}
