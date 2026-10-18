"use strict";
// src/application/services/FinancialReportingService.ts
// ===== محرك التقارير الموحّد — docs/04-modules/financial-reporting.md §3، §5، §6 =====
// فلسفة Hot/Cold (§2.1): الرصيد "كما في تاريخ" = أرصدة الفترات المُقفَلة (لقطات مجمّدة — قراءة صفوف قليلة)
// + حركة الفترة المفتوحة من Ledger الحي. لا مسح كامل للقيود في التقارير المالية إطلاقًا (§3 ملاحظة أداء حرجة).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinancialReportingService = exports.ReportAssertionError = exports.ReportNotFoundError = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
const crypto_1 = require("crypto");
const BalanceMaintenanceStore_1 = require("../../infrastructure/sqlite/BalanceMaintenanceStore");
/** بذرة كتالوج report_definitions (§5 — 11 تقريرًا معتمدًا) */
const REPORT_CATALOG = [
    { code: "trial_balance", nameAr: "ميزان المراجعة", category: "financial", dataSourceType: "hybrid", filters: ["as_of_date"] },
    { code: "income_statement", nameAr: "قائمة الدخل", category: "financial", dataSourceType: "hybrid", filters: ["date_from", "date_to"] },
    { code: "balance_sheet", nameAr: "الميزانية العمومية", category: "financial", dataSourceType: "hybrid", filters: ["as_of_date"] },
    { code: "daily_result", nameAr: "نتيجة نشاط اليوم", category: "operational", dataSourceType: "materialized", filters: ["business_date"] },
    { code: "period_result", nameAr: "نتيجة نشاط فترة", category: "operational", dataSourceType: "hybrid", filters: ["date_from", "date_to"] },
    { code: "cash_book", nameAr: "دفتر النقدية", category: "financial", dataSourceType: "live_query", filters: ["date_from", "date_to", "account_id"] },
    { code: "general_ledger", nameAr: "دفتر الأستاذ العام", category: "financial", dataSourceType: "live_query", filters: ["account_id", "date_from", "date_to"] },
    { code: "journal_book", nameAr: "دفتر اليومية", category: "financial", dataSourceType: "live_query", filters: ["date_from", "date_to"] },
    { code: "fx_impact_report", nameAr: "تقرير فروق العملة", category: "financial", dataSourceType: "live_query", filters: ["date_from", "date_to"] },
];
class ReportNotFoundError extends Error {
}
exports.ReportNotFoundError = ReportNotFoundError;
class ReportAssertionError extends Error {
}
exports.ReportAssertionError = ReportAssertionError;
class FinancialReportingService {
    db;
    balanceStore;
    constructor(db) {
        this.db = db;
        this.balanceStore = new BalanceMaintenanceStore_1.BalanceMaintenanceStore(db);
        this.seedCatalog();
    }
    /** §2.6/§5: الكتالوج مصدره report_definitions — التقرير الجديد = تعريف مُسجَّل لا تعديل بنية */
    seedCatalog() {
        const insert = this.db.prepare(`INSERT INTO report_definitions
         (report_code, name_ar, category, description_ar, data_source_type, required_permission, supported_filters, is_system_report, is_active, sort_order)
       VALUES (?, ?, ?, NULL, ?, 'reports.view', ?, 1, 1, ?)
       ON CONFLICT(report_code) DO UPDATE SET
         name_ar = excluded.name_ar, category = excluded.category,
         data_source_type = excluded.data_source_type, supported_filters = excluded.supported_filters`);
        REPORT_CATALOG.forEach((r, i) => insert.run(r.code, r.nameAr, r.category, r.dataSourceType, JSON.stringify(r.filters), i));
    }
    /** GET /reports (§7.1) — قائمة التقارير المتاحة النشطة */
    listAvailableReports() {
        const rows = this.db
            .prepare(`SELECT report_code, name_ar, category FROM report_definitions
         WHERE is_active = 1 ORDER BY sort_order`)
            .all();
        return rows.map((r) => ({ reportCode: r.report_code, nameAr: r.name_ar, category: r.category }));
    }
    /**
     * نقطة الدخول الموحّدة (§7.1 Generic endpoint) مع رصد أداء إلزامي (§2.7).
     * filters: as_of_date | date_from/date_to | business_date | account_id
     */
    async generateReport(reportCode, filters, context) {
        if (!context.permissions.includes("reports.view")) {
            throw new ReportNotFoundError(`لا صلاحية reports.view للمستخدم`);
        }
        const def = this.db
            .prepare(`SELECT * FROM report_definitions WHERE report_code = ? AND is_active = 1`)
            .get(reportCode);
        if (!def)
            throw new ReportNotFoundError(`التقرير '${reportCode}' غير معرَّف أو معطّل (Feature Flag §2.6)`);
        const startMs = Date.now();
        let result;
        switch (reportCode) {
            case "trial_balance":
                result = this.trialBalance(filters.as_of_date ?? today(), context);
                break;
            case "income_statement":
                result = this.incomeStatement(filters.date_from ?? "0001-01-01", filters.date_to ?? today(), context);
                break;
            case "balance_sheet":
                result = this.balanceSheet(filters.as_of_date ?? today(), context);
                break;
            case "daily_result":
                result = this.dailyResult(filters.business_date ?? today(), context);
                break;
            case "period_result":
                result = this.periodResult(filters.date_from ?? "0001-01-01", filters.date_to ?? today(), context);
                break;
            case "cash_book":
                result = this.cashBook(filters, context);
                break;
            case "general_ledger":
                result = this.generalLedger(filters, context);
                break;
            case "journal_book":
                result = this.journalBook(filters.date_from ?? "0001-01-01", filters.date_to ?? today(), context);
                break;
            case "fx_impact_report":
                result = this.fxImpactReport(filters.date_from ?? "0001-01-01", filters.date_to ?? today(), context);
                break;
            default:
                throw new ReportNotFoundError(`منفذ تنفيذ غير مسجَّل للتقرير '${reportCode}' (${def.supported_filters})`);
        }
        this.logExecution(context.tenantId, context.userId, reportCode, filters, Date.now() - startMs);
        return result;
    }
    // ===================== الأدوات الهجينة الجوهرية (§3 hybrid) =====================
    /** كل الحسابات القابلة للترحيل مع بياناتها الوصفية */
    postableAccounts(context) {
        return this.db
            .prepare(`SELECT id, code, name_ar_simple, account_type, normal_balance
           FROM accounts WHERE tenant_id = ? AND is_postable = 1 ORDER BY code`)
            .all(context.tenantId).map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name_ar_simple,
            type: r.account_type,
            normalBalance: r.normal_balance,
        }));
    }
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
    balanceAsOf(accountCode, asOfDate, context) {
        // ---- البارد: أحدث لقطة مُقفَلة تنتهي ≤ asOf (الأساس المجمّد) ----
        const lastSnap = this.db
            .prepare(`SELECT apb.opening_balance_base, apb.period_debit_total_base,
                apb.period_credit_total_base, fp.end_date
         FROM account_period_balances apb
         JOIN fiscal_periods fp ON fp.id = apb.fiscal_period_id
         WHERE apb.tenant_id = ? AND apb.account_code = ? AND fp.status = 'closed' AND fp.end_date <= ?
         ORDER BY fp.end_date DESC LIMIT 1`)
            .get(context.tenantId, accountCode, asOfDate);
        let bal;
        let liveFrom;
        if (lastSnap) {
            bal = new decimal_js_1.default(lastSnap.opening_balance_base)
                .plus(lastSnap.period_debit_total_base)
                .minus(lastSnap.period_credit_total_base);
            liveFrom = addDays(lastSnap.end_date, 1); // الحركة الحية تبدأ بعد نهاية آخر فترة مُجمَّدة
        }
        else {
            // ---- حالة خاصة: asOf يقع داخل فترة مُقفَلة (لقطة تنتهي > asOf) ----
            // لا يمكن استخدام اللقطة كأساس لأنها تتضمن حركة بعد asOf ⇒ نعود لمسار ledger الخالص.
            const coveringPeriod = this.db
                .prepare(`SELECT COUNT(*) AS c FROM fiscal_periods
           WHERE tenant_id = ? AND status = 'closed' AND start_date <= ? AND end_date > ?`)
                .get(context.tenantId, asOfDate, asOfDate);
            if (coveringPeriod.c > 0) {
                const activity = this.liveActivityForAccount(accountCode, "0001-01-01", asOfDate, context);
                return activity.debit.minus(activity.credit);
            }
            bal = new decimal_js_1.default(0);
            liveFrom = "0001-01-01";
        }
        // ---- الساخن: حركة ledger للفترة المفتوحة فقط ----
        if (liveFrom <= asOfDate) {
            const activity = this.liveActivityForAccount(accountCode, liveFrom, asOfDate, context);
            bal = bal.plus(activity.debit).minus(activity.credit);
        }
        return bal;
    }
    /** حركة حيّة من journal_lines لحساب خلال مدى (يشمل حتى المُقفَلة — يُستخدم فقط حين لا توجد لقطة لها) */
    liveActivityForAccount(accountCode, from, to, context) {
        const row = this.db
            .prepare(`SELECT
           COALESCE(SUM(CASE WHEN jl.side='debit'  THEN CAST(jl.base_amount AS REAL) END), 0) AS debit,
           COALESCE(SUM(CASE WHEN jl.side='credit' THEN CAST(jl.base_amount AS REAL) END), 0) AS credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN accounts a ON a.id = jl.account_id
         WHERE je.tenant_id = ? AND a.code = ? AND je.entry_date >= ? AND je.entry_date <= ?`)
            .get(context.tenantId, accountCode, from, to);
        // REAL هنا للاستعلام التجميعي السريع؛ القيم المخزّنة نص decimal بدقة 4 خانات عشرية
        // والأرقام المحاسبية الفعلية تبقى Decimal — هذا المسار يعيد تجميعات وسيطة تُحوَّل بدقة.
        return {
            debit: toDecimalFromAggregate(row.debit),
            credit: toDecimalFromAggregate(row.credit),
        };
    }
    /**
     * نشاط حساب خلال نطاق زمني هجين (§3 — قلب Golden Test "الفترتين المختلطتين"):
     * اللقطات المُقفَلة الواقعة بالكامل داخل النطاق تُقرأ مجمّدة؛ المتبقّي (أجزاء/الفترة المفتوحة)
     * من ledger بشرط عدم ازدواج: استبعاد أي قيد تاريخه يقع ضمن فترة مُقفَلة تمّت قراءتها من اللقطة
     * بالكامل داخل النطاق. النتيجة مطابقة تمامًا للحساب الحي الكامل (§9 التأكيد الأهم).
     */
    activityForRangeHybrid(accountCode, from, to, context) {
        // 1) لقطات كاملة داخل النطاق — **بشرط ألا يكون لها لقطة أحدث منها** (إلا فهي محذوفة/مستعادة §4.2).
        //    قيد الإقفال السنوي مؤرَّخ بتاريخ نهاية الفترة نفسها، ولقطته تحتوي أثره في دوراتها؛
        //    استبعاد هذه القيود من المسار الحيّ يمنع الازدواج ويحفظ التطابق مع الحساب الحي (§9 Golden).
        const snaps = this.db
            .prepare(`SELECT apb.period_debit_total_base, apb.period_credit_total_base
         FROM account_period_balances apb
         JOIN fiscal_periods fp ON fp.id = apb.fiscal_period_id
         WHERE apb.tenant_id = ? AND apb.account_code = ? AND fp.status = 'closed'
           AND fp.start_date >= ? AND fp.end_date <= ?
           AND NOT EXISTS (
             SELECT 1 FROM account_period_balances newer
             JOIN fiscal_periods nfp ON nfp.id = newer.fiscal_period_id
             WHERE newer.tenant_id = apb.tenant_id AND newer.account_code = apb.account_code
               AND nfp.status = 'closed' AND nfp.id != fp.id
               AND nfp.start_date <= fp.start_date AND nfp.end_date >= fp.end_date
               AND (nfp.start_date < fp.start_date OR nfp.end_date > fp.end_date)
           )`)
            .all(context.tenantId, accountCode, from, to);
        // المعامل المستبعد: قيود تقع ضمن فترات مُقفَلة **قائمة اللقطة** لهذا الحساب فقط
        // (فترة بلا لقطة لحساب معيَّن ⇒ حركتها تُقرأ حيّة بالكامل — لا ازدواج ولا فجوة).
        const closedRanges = this.db
            .prepare(`SELECT fp.start_date, fp.end_date FROM fiscal_periods fp
           WHERE fp.tenant_id = ? AND fp.status = 'closed' AND fp.start_date >= ? AND fp.end_date <= ?
             AND EXISTS (
               SELECT 1 FROM account_period_balances apb
               WHERE apb.fiscal_period_id = fp.id AND apb.tenant_id = fp.tenant_id
                 AND apb.account_code = ?
             )`)
            .all(context.tenantId, from, to, accountCode);
        // 2) حركة حية لما هو خارج الفترات المُقفَلة الكاملة داخل النطاق
        let debit = new decimal_js_1.default(0);
        let credit = new decimal_js_1.default(0);
        for (const s of snaps) {
            debit = debit.plus(s.period_debit_total_base);
            credit = credit.plus(s.period_credit_total_base);
        }
        // نجمع الحركة الحية على مستوى ledger لكل الأجزاء غير المغطاة:
        // أبسط صيغة صحيحة: كل القيود في [from,to] ما عدا تلك الواقعة في فترات مُقفَلة كاملة داخل النطاق.
        const liveRows = this.db
            .prepare(`SELECT jl.side AS side, jl.base_amount AS base_amount, je.entry_date AS entry_date
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN accounts a ON a.id = jl.account_id
         WHERE je.tenant_id = ? AND a.code = ? AND je.entry_date >= ? AND je.entry_date <= ?`)
            .all(context.tenantId, accountCode, from, to);
        for (const r of liveRows) {
            const inClosedFull = closedRanges.some((c) => r.entry_date >= c.start_date && r.entry_date <= c.end_date);
            if (inClosedFull)
                continue;
            if (r.side === "debit")
                debit = debit.plus(r.base_amount);
            else
                credit = credit.plus(r.base_amount);
        }
        return { debit, credit };
    }
    // ===================== التقارير المالية الرئيسية =====================
    /** §6.1 ميزان المراجعة — مع ASSERT توازن إجمالي إلزامي قبل الإرجاع (§9) */
    trialBalance(asOfDate, context) {
        const rows = [];
        let totalDebit = new decimal_js_1.default(0);
        let totalCredit = new decimal_js_1.default(0);
        for (const acc of this.postableAccounts(context)) {
            const bal = this.balanceAsOf(acc.code, asOfDate, context); // بمصطلح المستودع: +mدين −دائن
            if (bal.isZero())
                continue; // §6.1: لا تُعرض الحسابات الصفرية
            // جهة العرض من إشارة الرصيد مباشرة: موجب ⇒ مدين، سالب ⇒ دائن
            const absStr = bal.abs().toFixed(4);
            const onDebitSide = bal.isPositive();
            rows.push({
                accountCode: acc.code,
                accountName: acc.name,
                debit: onDebitSide ? absStr : "0.0000",
                credit: onDebitSide ? "0.0000" : absStr,
            });
            if (onDebitSide)
                totalDebit = totalDebit.plus(bal.abs());
            else
                totalCredit = totalCredit.plus(bal.abs());
        }
        // Sanity Check إلزامي (§6.1/§9): ledger متوازن دائمًا ⇒ الميزان يجب أن يتوازن
        if (!totalDebit.equals(totalCredit)) {
            throw new ReportAssertionError(`انتهاك سلامة: مجموع مدين الميزان (${totalDebit.toFixed(4)}) ≠ دائن (${totalCredit.toFixed(4)})`);
        }
        return { rows, totalDebit: totalDebit.toFixed(4), totalCredit: totalCredit.toFixed(4) };
    }
    /** §6.2 قائمة الدخل — net = (دائن − مدين) للإيرادات و (مدين − دائن) للمصروفات، COGS يبدأ بـ 51 */
    incomeStatement(from, to, context) {
        const revenueLines = [];
        const expenseLines = [];
        let totalRevenue = new decimal_js_1.default(0);
        let cogs = new decimal_js_1.default(0);
        let opex = new decimal_js_1.default(0);
        for (const acc of this.postableAccounts(context)) {
            if (acc.type !== "revenue" && acc.type !== "expense")
                continue;
            const act = this.activityForRangeHybrid(acc.code, from, to, context);
            const net = acc.type === "revenue" ? act.credit.minus(act.debit) : act.debit.minus(act.credit);
            if (net.isZero())
                continue;
            if (acc.type === "revenue") {
                revenueLines.push({ accountCode: acc.code, accountName: acc.name, amount: net.toFixed(4) });
                totalRevenue = totalRevenue.plus(net);
            }
            else {
                expenseLines.push({ accountCode: acc.code, accountName: acc.name, amount: net.toFixed(4) });
                if (acc.code.startsWith("51"))
                    cogs = cogs.plus(net); // §6.2 تكلفة المبيعات
                else
                    opex = opex.plus(net);
            }
        }
        const gross = totalRevenue.minus(cogs);
        const netProfit = gross.minus(opex);
        return {
            period: { from, to },
            revenue: { total: totalRevenue.toFixed(4), lines: revenueLines },
            cogs: cogs.toFixed(4),
            grossProfit: gross.toFixed(4),
            operatingExpenses: { total: opex.toFixed(4), lines: expenseLines },
            netProfit: netProfit.toFixed(4),
        };
    }
    /** الميزانية العمومية (§5): أصول/خصوم/حقوق كما في تاريخ — بقايا الإيرادات/المصروفات تظهر عبر قيد الإقفال السنوي في 3300 */
    balanceSheet(asOfDate, context) {
        const assets = [];
        const liabilities = [];
        const equity = [];
        let tA = new decimal_js_1.default(0);
        let tL = new decimal_js_1.default(0);
        let tE = new decimal_js_1.default(0);
        for (const acc of this.postableAccounts(context)) {
            if (acc.type === "revenue" || acc.type === "expense")
                continue;
            const raw = this.balanceAsOf(acc.code, asOfDate, context); // مصطلح المستودع: +مدين −دائن
            // العرض بالجهة الطبيعية للأصول والخصوم/حقوق الملكية (+طبيعي) ⇒ قلب إشارة غير الأصول
            const bal = acc.type === "asset" ? raw : raw.negated();
            if (bal.isZero())
                continue;
            const entry = { accountCode: acc.code, accountName: acc.name, balance: bal.toFixed(4) };
            if (acc.type === "asset") {
                assets.push(entry);
                tA = tA.plus(bal);
            }
            else if (acc.type === "liability") {
                liabilities.push(entry);
                tL = tL.plus(bal);
            }
            else {
                equity.push(entry);
                tE = tE.plus(bal);
            }
        }
        // إن كانت هناك إيرادات أو مصروفات لم تُرحَّل بعد بقيد إقفال سنوي إلى 3300:
        // صافي دخل الفترة الحالية = Σ(دائن − مدين للإيرادات) − Σ(مدين − دائن للمصروفات)
        // يُدرج ضمن حقوق الملكية لضمان توازن الميزانية العمومية (§5 A = L + E في أي تاريخ بيني)
        let currentPeriodNet = new decimal_js_1.default(0);
        for (const acc of this.postableAccounts(context)) {
            if (acc.type !== "revenue" && acc.type !== "expense")
                continue;
            const raw = this.balanceAsOf(acc.code, asOfDate, context); // +مدين −دائن
            const net = acc.type === "revenue" ? raw.negated() : raw;
            if (acc.type === "revenue")
                currentPeriodNet = currentPeriodNet.plus(net);
            else
                currentPeriodNet = currentPeriodNet.minus(net);
        }
        if (!currentPeriodNet.isZero()) {
            equity.push({
                accountCode: "CURRENT_PERIOD_NET",
                accountName: "أرباح (خسائر) الفترة الحالية",
                balance: currentPeriodNet.toFixed(4),
            });
            tE = tE.plus(currentPeriodNet);
        }
        // معادلة المحاسبة: الأصول = الخصوم + الحقوق (بعد توحيد إشارة العرض بالطبيعي)
        const balanced = tA.equals(tL.plus(tE));
        return {
            assets,
            liabilities,
            equity,
            totals: { assets: tA.toFixed(4), liabilities: tL.toFixed(4), equity: tE.toFixed(4) },
            balanced,
        };
    }
    /** §6.3 نتيجة اليوم — قراءة صف واحد من daily_business_results (<50ms هدفًا) */
    dailyResult(businessDate, context) {
        return this.balanceStore.getDailyResult(context.tenantId, businessDate);
    }
    /** نتيجة فترة هجينة: إيرادات/مصروفات بنفس آلية incomeStatement لكن بإخراج مختصر تشغيلي */
    periodResult(from, to, context) {
        const inc = this.incomeStatement(from, to, context);
        return {
            period: { from, to },
            revenueTotal: inc.revenue.total,
            cogsTotal: inc.cogs,
            expensesTotal: inc.operatingExpenses.total,
            netProfit: inc.netProfit,
        };
    }
    /** دفتر النقدية (live_query): حركة حسابات النقد 1101/1110/1120 مع رصيد جري */
    cashBook(filters, context) {
        const from = filters.date_from ?? "0001-01-01";
        const to = filters.date_to ?? today();
        const cashCodes = ["1101", "1110", "1120"];
        const placeholders = cashCodes.map(() => "?").join(",");
        const rowsRaw = this.db
            .prepare(`SELECT je.entry_date AS date, je.description_simple AS description,
                jl.side AS side, jl.base_amount AS base_amount, a.code AS code
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN accounts a ON a.id = jl.account_id
         WHERE je.tenant_id = ? AND a.code IN (${placeholders})
           AND je.entry_date >= ? AND je.entry_date <= ?
         ORDER BY je.entry_date, je.created_at`)
            .all(context.tenantId, ...cashCodes, from, to);
        let running = new decimal_js_1.default(0);
        let totalIn = new decimal_js_1.default(0);
        let totalOut = new decimal_js_1.default(0);
        const rows = rowsRaw.map((r) => {
            const amt = new decimal_js_1.default(r.base_amount);
            if (r.side === "debit") {
                running = running.plus(amt);
                totalIn = totalIn.plus(amt);
            }
            else {
                running = running.minus(amt);
                totalOut = totalOut.plus(amt);
            }
            return {
                date: r.date,
                description: `${r.description} (${r.code})`,
                in: r.side === "debit" ? amt.toFixed(4) : "0.0000",
                out: r.side === "credit" ? amt.toFixed(4) : "0.0000",
                running: running.toFixed(4),
            };
        });
        return { rows, totalIn: totalIn.toFixed(4), totalOut: totalOut.toFixed(4) };
    }
    /** دفتر الأستاذ (live_query): كل أسطر حساب خلال مدى مع رصيد جري وإجماليات */
    generalLedger(filters, context) {
        const accountId = filters.account_id;
        if (!accountId)
            throw new ReportNotFoundError("general_ledger يتطلب فلتر account_id");
        const acc = this.db
            .prepare(`SELECT code, name_ar_simple FROM accounts WHERE tenant_id = ? AND id = ?`)
            .get(context.tenantId, accountId);
        if (!acc)
            throw new ReportNotFoundError("الحساب غير موجود");
        const from = filters.date_from ?? "0001-01-01";
        const to = filters.date_to ?? today();
        const lineRows = this.db
            .prepare(`SELECT je.entry_date AS date, je.description_simple AS description,
                jl.side AS side, jl.base_amount AS base_amount, jl.memo_ar AS memo
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE je.tenant_id = ? AND jl.account_id = ? AND je.entry_date >= ? AND je.entry_date <= ?
         ORDER BY je.entry_date, je.created_at, jl.line_order`)
            .all(context.tenantId, accountId, from, to);
        let running = new decimal_js_1.default(0);
        let totalDebit = new decimal_js_1.default(0);
        let totalCredit = new decimal_js_1.default(0);
        const entries = lineRows.map((r) => {
            const amt = new decimal_js_1.default(r.base_amount);
            if (r.side === "debit") {
                running = running.plus(amt);
                totalDebit = totalDebit.plus(amt);
            }
            else {
                running = running.minus(amt);
                totalCredit = totalCredit.plus(amt);
            }
            return { ...r, amount: amt.toFixed(4), running: running.toFixed(4) };
        });
        return { account: { code: acc.code, name: acc.name_ar_simple }, entries, totalDebit: totalDebit.toFixed(4), totalCredit: totalCredit.toFixed(4), closingBalance: running.toFixed(4) };
    }
    /** دفتر اليومية (live_query): قيود كاملة بأسطرها */
    journalBook(from, to, context) {
        const entryRows = this.db
            .prepare(`SELECT id, entry_date, description_simple, source_type FROM journal_entries
         WHERE tenant_id = ? AND entry_date >= ? AND entry_date <= ? ORDER BY entry_date, created_at`)
            .all(context.tenantId, from, to);
        const linesStmt = this.db.prepare(`SELECT jl.side, jl.base_amount, a.code, a.name_ar_simple
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
       WHERE jl.journal_entry_id = ? ORDER BY jl.line_order`);
        return entryRows.map((e) => ({
            entryDate: e.entry_date,
            description: e.description_simple,
            sourceType: e.source_type,
            lines: linesStmt.all(e.id).map((l) => ({
                account: `${l.code} ${l.name_ar_simple}`,
                debit: l.side === "debit" ? l.base_amount : "0.0000",
                credit: l.side === "credit" ? l.base_amount : "0.0000",
            })),
        }));
    }
    /**
     * §6.4 تقرير فروق العملة — تحقيق توصية فصل الربح التشغيلي عن أثر الصرف (حرج للسوق اليمني).
     * مصدرا الفروق: (أ) حسابات 4900/5900 في ledger، (ب) fx_gain_loss_amount في allocations.
     */
    fxImpactReport(from, to, context) {
        const operating = new decimal_js_1.default(this.incomeStatement(from, to, context).netProfit);
        // (أ) فروقات مُرحَّلة على حسابات 4900 (خسارة صرف مدينة) و5900 (ربح صرف دائنة)
        const fxAccts = this.db
            .prepare(`SELECT a.code AS code, jl.side AS side, jl.base_amount AS base_amount
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN accounts a ON a.id = jl.account_id
         WHERE je.tenant_id = ? AND a.code IN ('4900','5900') AND je.entry_date >= ? AND je.entry_date <= ?`)
            .all(context.tenantId, from, to);
        let gainsFromLedger = new decimal_js_1.default(0);
        let lossesFromLedger = new decimal_js_1.default(0);
        for (const r of fxAccts) {
            const amt = new decimal_js_1.default(r.base_amount);
            // ربح صرف (5900 دائن) أو خسارة (4900 مدين) — والحالتان المعاكستان تُخصمان بشكل متماثل
            if (r.code === "5900")
                gainsFromLedger = gainsFromLedger.plus(r.side === "credit" ? amt : amt.negated());
            else
                lossesFromLedger = lossesFromLedger.plus(r.side === "debit" ? amt : amt.negated());
        }
        // (ب) فروقات التسويات في الذمم الفرعية — مصدرها ar_ap_allocations (مخطط §ar-ap:
        // fx_gain_loss_amount بعملة البند + allocation_date). تُقرأ مباشرة بدقة Decimal بلا JOIN.
        let allocGains = new decimal_js_1.default(0);
        let allocLosses = new decimal_js_1.default(0);
        const hasAlloc = this.db
            .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ar_ap_allocations'`)
            .get();
        if (hasAlloc) {
            const allocRows = this.db
                .prepare(`SELECT fx_gain_loss_amount AS fx
           FROM ar_ap_allocations
           WHERE tenant_id = ? AND allocation_date >= ? AND allocation_date <= ?`)
                .all(context.tenantId, from, to);
            for (const a of allocRows) {
                const v = new decimal_js_1.default(a.fx ?? "0");
                if (v.isPositive())
                    allocGains = allocGains.plus(v);
                else
                    allocLosses = allocLosses.plus(v.abs());
            }
        }
        const fxGains = gainsFromLedger.plus(allocGains);
        const fxLosses = lossesFromLedger.plus(allocLosses);
        const netFx = fxGains.minus(fxLosses);
        return {
            operatingNetProfit: operating.toFixed(4),
            fxGains: fxGains.toFixed(4),
            fxLosses: fxLosses.toFixed(4),
            netFxImpact: netFx.toFixed(4),
            totalReportedProfit: operating.plus(netFx).toFixed(4),
            warningAr: netFx.isZero()
                ? null
                : "جزء من ربحك ناتج عن تغيّر سعر الصرف وليس من نشاطك التجاري الفعلي (§6.4)",
        };
    }
    // ===================== إقفال اليوم (§4.3 — مرن، منفصل عن القفل المحاسبي) =====================
    previewDailyClosure(date, context) {
        // النقد المتوقع = Σ رصيد حسابات الصندوق/البنك/المحفظة كما في نهاية اليوم
        let cash = new decimal_js_1.default(0);
        for (const code of ["1101", "1110", "1120"]) {
            const rb = this.balanceStore.getRunningBalance(context.tenantId, code);
            // المعاينة تعتمد الجدول الحي (نفس يوم التشغيل) — أدق من إعادة حساب ledger
            if (rb)
                cash = cash.plus(rb.current_balance_base);
        }
        return { expectedCashBalance: cash.toFixed(4), dailyResult: this.dailyResult(date, context) };
    }
    closeBusinessDay(date, actualCashCounted, context) {
        const preview = this.previewDailyClosure(date, context);
        const actual = new decimal_js_1.default(actualCashCounted);
        const expected = new decimal_js_1.default(preview.expectedCashBalance);
        const variance = actual.minus(expected);
        const id = (0, crypto_1.randomUUID)();
        const runAtomic = this.db.transaction(() => {
            this.db
                .prepare(`INSERT INTO daily_closures
             (id, tenant_id, business_date, cash_expected_balance, cash_actual_counted,
              cash_variance, total_revenue_base, total_expenses_base, net_result_base,
              status, closed_by_user_id, closed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?)
           ON CONFLICT(tenant_id, business_date) DO UPDATE SET
             cash_expected_balance = excluded.cash_expected_balance,
             cash_actual_counted = excluded.cash_actual_counted,
             cash_variance = excluded.cash_variance,
             total_revenue_base = excluded.total_revenue_base,
             total_expenses_base = excluded.total_expenses_base,
             net_result_base = excluded.net_result_base,
             status = 'closed', closed_by_user_id = excluded.closed_by_user_id, closed_at = excluded.closed_at`)
                .run(id, context.tenantId, date, expected.toFixed(4), actual.toFixed(4), variance.toFixed(4), preview.dailyResult?.revenueTotalBase ?? "0.0000", preview.dailyResult?.expensesTotalBase ?? "0.0000", preview.dailyResult?.netProfitBase ?? "0.0000", context.userId, new Date().toISOString());
        });
        runAtomic();
        // §4.3: فرق != 0 ⇒ اقتراح تسوية الصندوق (لا يفرضه — مرونة للتاجر غير المختص)
        return {
            closureId: id,
            cashVariance: variance.toFixed(4),
            suggestedAdjustment: !variance.isZero(),
        };
    }
    // ===================== أدوات =====================
    logExecution(tenantId, userId, reportCode, filters, ms) {
        this.db
            .prepare(`INSERT INTO report_execution_log (id, tenant_id, user_id, report_code, filters_used, execution_time_ms, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run((0, crypto_1.randomUUID)(), tenantId, userId ?? null, reportCode, JSON.stringify(filters), ms, new Date().toISOString());
    }
}
exports.FinancialReportingService = FinancialReportingService;
function today() {
    return new Date().toISOString().slice(0, 10);
}
/** "2026-09-30" + 1 → "2026-10-01" (UTC، بلا مخاطر توقيت محلي) */
function addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
/** تحويل تجميع REAL إلى Decimal بدقة التخزين (4 خانات) — يمتص خطأ IEEE ولا يخفيه */
function toDecimalFromAggregate(n) {
    if (!Number.isFinite(n))
        return new decimal_js_1.default(0);
    return new decimal_js_1.default(n.toFixed(MoneyStorageDecimals));
}
const MoneyStorageDecimals = 4;
//# sourceMappingURL=FinancialReportingService.js.map