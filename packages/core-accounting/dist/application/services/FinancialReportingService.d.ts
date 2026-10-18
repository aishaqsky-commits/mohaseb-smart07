import Database from "better-sqlite3";
import { DailyResultRow } from "../../infrastructure/sqlite/BalanceMaintenanceStore";
export interface ReportContext {
    tenantId: string;
    userId?: string;
    baseCurrencyCode: string;
    permissions: string[];
}
export declare class ReportNotFoundError extends Error {
}
export declare class ReportAssertionError extends Error {
}
export declare class FinancialReportingService {
    private readonly db;
    private readonly balanceStore;
    constructor(db: Database.Database);
    /** §2.6/§5: الكتالوج مصدره report_definitions — التقرير الجديد = تعريف مُسجَّل لا تعديل بنية */
    private seedCatalog;
    /** GET /reports (§7.1) — قائمة التقارير المتاحة النشطة */
    listAvailableReports(): Array<{
        reportCode: string;
        nameAr: string;
        category: string;
    }>;
    /**
     * نقطة الدخول الموحّدة (§7.1 Generic endpoint) مع رصد أداء إلزامي (§2.7).
     * filters: as_of_date | date_from/date_to | business_date | account_id
     */
    generateReport(reportCode: string, filters: Record<string, string | undefined>, context: ReportContext): Promise<unknown>;
    /** كل الحسابات القابلة للترحيل مع بياناتها الوصفية */
    private postableAccounts;
    /**
     * رصيد حساب "كما في تاريخ" (§3.1) — hybrid بلا ازدواج:
     * - الأساس دائمًا = إغلاق آخر لقطة مُقفَلة **تنتهي ≤ asOf** (أو صفر إن لم توجد).
     *   اللقطة تحتوي أثر قيود النظام المؤرخة بتاريخ نهاية الفترة (إقفال سنوي/تسوية يومية §4.3)،
     *   فهي المرجع الصحيح؛ والحركة الحية تُضاف فقط من اليوم التالي للفترة المُجمَّدة.
     * - استثناء واحد (§ اختبار "لا يزدوج مع اللقطة"): إذا كانت أحدث فترة مُقفَلة **تحتوي** asOf
     *   (طلب كما-في-تاريخ داخل فترة مقفلة قديمة) ⇒ اللقطة تتجاوزه زمنيًا، فتُقرأ الحركة ledger
     *   كاملة حتى asOf بدون أساس لقطة (منع الازدواج/الضعف).
     * الإشارة موحَّدة بمصطلح المستودع: current = opening + debit − credit.
     */
    private balanceAsOf;
    /** حركة حيّة من journal_lines لحساب خلال مدى (يشمل حتى المُقفَلة — يُستخدم فقط حين لا توجد لقطة لها) */
    private liveActivityForAccount;
    /**
     * نشاط حساب خلال نطاق زمني هجين (§3 — قلب Golden Test "الفترتين المختلطتين"):
     * اللقطات المُقفَلة الواقعة بالكامل داخل النطاق تُقرأ مجمّدة؛ المتبقّي (أجزاء/الفترة المفتوحة)
     * من ledger بشرط عدم ازدواج: استبعاد أي قيد تاريخه يقع ضمن فترة مُقفَلة تمّت قراءتها من اللقطة
     * بالكامل داخل النطاق. النتيجة مطابقة تمامًا للحساب الحي الكامل (§9 التأكيد الأهم).
     */
    private activityForRangeHybrid;
    /** §6.1 ميزان المراجعة — مع ASSERT توازن إجمالي إلزامي قبل الإرجاع (§9) */
    trialBalance(asOfDate: string, context: ReportContext): {
        rows: Array<{
            accountCode: string;
            accountName: string;
            debit: string;
            credit: string;
        }>;
        totalDebit: string;
        totalCredit: string;
    };
    /** §6.2 قائمة الدخل — net = (دائن − مدين) للإيرادات و (مدين − دائن) للمصروفات، COGS يبدأ بـ 51 */
    incomeStatement(from: string, to: string, context: ReportContext): {
        period: {
            from: string;
            to: string;
        };
        revenue: {
            total: string;
            lines: Array<{
                accountCode: string;
                accountName: string;
                amount: string;
            }>;
        };
        cogs: string;
        grossProfit: string;
        operatingExpenses: {
            total: string;
            lines: Array<{
                accountCode: string;
                accountName: string;
                amount: string;
            }>;
        };
        netProfit: string;
    };
    /** الميزانية العمومية (§5): أصول/خصوم/حقوق كما في تاريخ — بقايا الإيرادات/المصروفات تظهر عبر قيد الإقفال السنوي في 3300 */
    balanceSheet(asOfDate: string, context: ReportContext): {
        assets: Array<{
            accountCode: string;
            accountName: string;
            balance: string;
        }>;
        liabilities: Array<{
            accountCode: string;
            accountName: string;
            balance: string;
        }>;
        equity: Array<{
            accountCode: string;
            accountName: string;
            balance: string;
        }>;
        totals: {
            assets: string;
            liabilities: string;
            equity: string;
        };
        balanced: boolean;
    };
    /** §6.3 نتيجة اليوم — قراءة صف واحد من daily_business_results (<50ms هدفًا) */
    dailyResult(businessDate: string, context: ReportContext): DailyResultRow | null;
    /** نتيجة فترة هجينة: إيرادات/مصروفات بنفس آلية incomeStatement لكن بإخراج مختصر تشغيلي */
    periodResult(from: string, to: string, context: ReportContext): {
        period: {
            from: string;
            to: string;
        };
        revenueTotal: string;
        cogsTotal: string;
        expensesTotal: string;
        netProfit: string;
    };
    /** دفتر النقدية (live_query): حركة حسابات النقد 1101/1110/1120 مع رصيد جري */
    cashBook(filters: Record<string, string | undefined>, context: ReportContext): {
        rows: Array<{
            date: string;
            description: string;
            in: string;
            out: string;
            running: string;
        }>;
        totalIn: string;
        totalOut: string;
    };
    /** دفتر الأستاذ (live_query): كل أسطر حساب خلال مدى مع رصيد جري وإجماليات */
    generalLedger(filters: Record<string, string | undefined>, context: ReportContext): unknown;
    /** دفتر اليومية (live_query): قيود كاملة بأسطرها */
    journalBook(from: string, to: string, context: ReportContext): unknown;
    /**
     * §6.4 تقرير فروق العملة — تحقيق توصية فصل الربح التشغيلي عن أثر الصرف (حرج للسوق اليمني).
     * مصدرا الفروق: (أ) حسابات 4900/5900 في ledger، (ب) fx_gain_loss_amount في allocations.
     */
    fxImpactReport(from: string, to: string, context: ReportContext): {
        operatingNetProfit: string;
        fxGains: string;
        fxLosses: string;
        netFxImpact: string;
        totalReportedProfit: string;
        warningAr: string | null;
    };
    previewDailyClosure(date: string, context: ReportContext): {
        expectedCashBalance: string;
        dailyResult: DailyResultRow | null;
    };
    closeBusinessDay(date: string, actualCashCounted: string, context: ReportContext & {
        userId: string;
    }): {
        closureId: string;
        cashVariance: string;
        suggestedAdjustment: boolean;
    };
    private logExecution;
}
