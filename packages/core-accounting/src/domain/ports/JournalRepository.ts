// src/domain/ports/JournalRepository.ts

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
  startDate?: string | null; // YYYY-MM-DD
  endDate?: string | null;   // YYYY-MM-DD
}

export interface JournalRepository {
  /** يجب أن تُنفَّذ كمعاملة ذرية واحدة (رأس القيد + كل الأسطر معًا) */
  save(entry: JournalEntry): Promise<void>;
  findById(tenantId: string, entryId: string): Promise<JournalEntry | null>;
  /**
   * كل قيود عملية مصدرية واحدة (عملية بيع قد تولّد primary + secondary entry بنفس
   * source_transaction_id) — أساس مسار التراجع/العكس الكامل للعملية (docs/04-modules §Undo).
   */
  findBySourceTransaction(tenantId: string, sourceTransactionId: string): Promise<JournalEntry[]>;
  /** قيد عكسي سابق يشير لهذا الأصل إن وُجد — منع ازدواج العكس حتى لو فاتت علامة is_reversed */
  findReversalOf(tenantId: string, originalEntryId: string): Promise<JournalEntry | null>;
  getFiscalPeriodStatus(tenantId: string, entryDate: Date): Promise<FiscalPeriodStatus>;
}

// فائدة هذا الفصل: JournalEngine أدناه لا يعرف شيئًا عن SQLite أو PostgreSQL —
// يمكن اختباره بالكامل بمستودعات وهمية (In-Memory Fakes)، ويمكن استبدال التخزين
// لاحقًا دون تعديل منطق الأعمال.
