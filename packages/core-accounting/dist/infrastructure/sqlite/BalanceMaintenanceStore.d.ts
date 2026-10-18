import Database from "better-sqlite3";
import { JournalEntry } from "../../domain/entities/JournalEntry";
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
/**
 * مخزن الصيانة التجميعية. كل الدوال هنا **غير مستقلة بذاتها** — يجب أن تُنفَّذ
 * داخل db.transaction() التي تستدعيها (حفظ القيد أو إقفال الفترة)، فلا توجد
 * حالة وسيطة بين Ledger والأرصدة المجمّعة أبدًا.
 */
export declare class BalanceMaintenanceStore {
    private readonly db;
    constructor(db: Database.Database);
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
    applyEntryToAggregates(entry: JournalEntry, tenantId: string): void;
    /** عكس الحركة (للقيد العكسي Reversal) — يطبَّق بنفس آلية applyEntry لأن createReversal يقلب الأسطر فعليًا */
    /** قراءة صف النتيجة اليومية كما هو (§2.5) */
    getDailyResult(tenantId: string, businessDate: string): DailyResultRow | null;
    /**
     * ترحيل لقطة الرصيد الحي إلى جدول الفترات المجمّدة (§4.1 خطوة 1).
     * تُكتب كل صفوف الحسابات للفترة — لا تُحذف من الجدول الحي هنا؛
     * النقل للفترة التالية يتم عبر rollForwardAfterClose.
     * إذا مُرِّر startDate و endDate: تُحسب دورات الفترة بدقة من قيود تلك النافذة الزمنية
     * حمايةً من أي قيود مستقبلية قد تكون أُدخلت قبل تنفيذ الإقفال (§9 Golden Test).
     */
    snapshotRunningBalances(tenantId: string, periodId: string, startDate?: string, endDate?: string): number;
    /**
     * نقل الأرصدة للفترة التالية (§4.1 "createNextPeriod يهيّئ account_running_balances الجديدة"):
     * إغلاق كل حساب يصبح افتتاحي الفترة القادمة، وتصفير دورات الفترة المنتهية.
     * الحسابات الاسمية (إيرادات/مصروفات) تصفر افتتاحيًا عند الإقفال السنوي.
     * إن وُجدت قيود مستقبلية سُجِّلت مسبقًا للفترة التالية (من nextStartDate)، تُحسب دوراتها بدقة.
     */
    rollForwardAfterClose(tenantId: string, nextStartDate?: string, isAnnualClose?: boolean): void;
    /** حذف لقطة فترة (عند إعادة الفتح §4.2 — ستُعاد عند الإقفال مجددًا) */
    deletePeriodSnapshot(periodId: string): void;
    /**
     * استعادة الأرصدة الحية من اللقطة عند إعادة فتح فترة (§4.2 restoreRunningBalancesFromSnapshot):
     * عكس rollForward — الافتتاحي يعود لقيمة افتتاحي الفترة المُقفَلة والدورات لقيمتها المخزّنة.
     * يُطبَّق فقط على الحسابات الموجودة في اللقطة (الأحدث يفوق الأقدم تسلسلًا مضمون بإغلاق المتتالية).
     */
    restoreRunningBalancesFromSnapshot(tenantId: string, periodId: string): number;
    /** قراءة رصيد حي واحد (للاختبارات والمعاينات) */
    getRunningBalance(tenantId: string, accountCode: string): RunningBalanceDbRow & {
        current_balance_base: string;
    } | null;
    /**
     * تصفير الأرصدة الحية لحسابات اسمية (إيرادات/مصروفات) بعد قيد الإقفال السنوي (§4.1).
     * الصيغة المعتمدة "0.0000" بدقة التخزين الكاملة — لا "0" المجرد، لأن اللقطة المجمّدة
     * تُقرأ لاحقًا في المسار الهجين ويجب أن تتطابق النصوص تنسيقياً مع بقية الأعمدة.
     */
    resetRunningBalancesForAccounts(tenantId: string, accountCodes: string[]): void;
    /**
     * إعادة تطبيق حركة قيد على الأرصدة الحية فقط (بدون daily_business_results وبدون فحص فترات) —
     * تُستخدم حصريًا لعكس أثر قيود النظام (إقفال سنوي/تسويات يومية) عند إعادة فتح فترة (§4.2)،
     * تطبيق حركة قيد نظام (إقفال سنوي، تسوية، أو عكس إقفال) على الأرصدة الحية فقط دون المساس بـ daily_business_results (§4.1/§4.2)
     */
    reverseEntryOnRunningBalances(entry: JournalEntry, tenantId: string): void;
}
export {};
