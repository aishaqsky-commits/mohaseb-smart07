import Database from "better-sqlite3";
export interface FiscalPeriodRow {
    id: string;
    tenantId: string;
    periodKey: string;
    startDate: string;
    endDate: string;
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
export declare class PeriodNotFoundError extends Error {
    constructor();
}
export declare class PeriodStateError extends Error {
}
export declare class PermissionDeniedError extends Error {
    constructor(permission: string);
}
/**
 * محرك الإقفال. الصلاحيات (§9 حوكمة): periods.close للمحاسب/المالك،
 * وperiods.reopen أعلى (المالك فقط + سبب إلزامي + سجل تدقيق).
 */
export declare class PeriodClosingService {
    private readonly db;
    private readonly balanceStore;
    constructor(db: Database.Database);
    /** إنشاء فترة محاسبية جديدة (شهرية أو سنوية) — lazy عند الحاجة */
    createPeriod(tenantId: string, periodKey: string, userId?: string): FiscalPeriodRow;
    getPeriod(tenantId: string, periodId: string): FiscalPeriodRow | null;
    listPeriods(tenantId: string, status?: "open" | "closed"): FiscalPeriodRow[];
    /**
     * §4.1 خوارزمية إقفال فترة — ذرية بالكامل:
     * قيد إقفال (سنوي) ← لقطة ← تعليم مُقفَلة ← تهيئة الفترة التالية ← نقل الأرصدة.
     *
     * ملاحظة حرجة: better-sqlite3 مصممة التزامن؛ دوال db.transaction() **ترفض دوال async**
     * ("Transaction function cannot return a promise"). كل ما داخل المعاملة هنا متزامن بحت
     * (استعلامات .get/.all/.run مباشرة — لا await إطلاقًا)، وهذا أيضًا أسرع بمئات المرات.
     * الترتيب: قيد الإقفال قبل اللقطة حتى تُجمَّد الأرصدة بعد تصفير الاسمية (نتيجة §4.1 الصحيحة).
     */
    closeFiscalPeriod(tenantId: string, periodId: string, context: {
        userId: string;
        permissions?: string[];
        baseCurrencyCode?: string;
        cashCountedBase?: string;
    }): Promise<CloseResult>;
    /**
     * §4.2 إعادة فتح فترة — حرجة: صلاحية أعلى + سبب إلزامي + يجب أن تكون الأحدث مُقفَلة
     * (منع كسر التسلسل: لا يُفتح شهر وسبقه شهر مُقفَل أحدث منه).
     * قيد الإقفال السنوي يُعكس بقيد عكسي رسمي (لا حذف قيود إطلاقًا — مبدأ التصحيح المعتمد).
     */
    reopenFiscalPeriod(tenantId: string, periodId: string, reason: string, context: {
        userId: string;
        permissions?: string[];
    }): Promise<ReopenResult>;
    /**
     * §4.1 قيد الإقفال السنوي: تصفير كل الحسابات الاسمية وترحيل الصافي إلى 3300.
     * **المصدر الصحيح = نشاط الفترة نفسها** (قيود journal_lines بتاريخ ضمن [startDate,endDate])
     * وليس الرصيد المتراكم في account_running_balances — فالمتراكم قد يحمل أرصدة افتتاحية
     * من سنوات سابقة أو حركة فترات أخرى، وترحيله يخلط السنين (§4.1: صافي السنة الحالية فقط).
     * netIncome = Σ(دائن − مدين للإيرادات) − Σ(مدين − دائن للمصروفات) داخل النطاق.
     */
    private postAnnualClosingEntry;
    /**
     * الرصيد الدفتري للنقد (صندوق/بنك/محفظة §6.3 أكواد 1101/1110/1120) من الجدول الحي.
     */
    private bookCashBase;
    /** حساب قابل للترحيل بالكود أو undefined */
    private getAccountIdByCode;
    /**
     * §4.3 قيد تسوية الصندوق عند الإقفال: عجز ⇒ مدين عجز صندوق (5910) / دائن الصندوق؛
     * زيادة ⇒ مدين الصندوق / دائن زيادة صندوق (5911). صلاحيات المحاسب العادي لا المالك.
     */
    private postDailySettlementEntry;
    /** قراءة الأساس المحاسبي للـ tenant — من عملة قيود الفترة إن وُجدت، وإلا YER (افتراضي السوق) */
    private readBaseCurrency;
    private saveEntrySync;
    /** قراءة قيد بأسطره (متزامن) — يعيد بناء كيان المجال من التخزين دون إعادة توليد المعرفات */
    private loadEntrySync;
    /** §9 — audit_log موحّد الاسم مع ما تتوقعه الاختبارات (action/entity_id/details_json) */
    private writeAudit;
}
/** "2026-09" → [2026-09-01, 2026-09-30] ، "2026" → [2026-01-01, 2026-12-31] */
export declare function parsePeriodKey(key: string): {
    start: string;
    end: string;
};
/** "2026-09"→"2026-10"، "2026-12"→"2027-01"، "2026"→"2027" */
export declare function computeNextPeriodKey(key: string): string | null;
