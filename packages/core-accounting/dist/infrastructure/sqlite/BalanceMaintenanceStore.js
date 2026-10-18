"use strict";
// src/infrastructure/sqlite/BalanceMaintenanceStore.ts
// ===== صيانة الأرصدة التجميعية (Hot Aggregates) — docs/04-modules/financial-reporting.md §2.3, §2.5 =====
// المبدأ الحاكم (§ تعليمات المرحلة 5 في PRD): التقارير تُبنى على جداول تجميعية محدَّثة تدريجيًا،
// لا على مسح كامل القيود. هذا الملف هو المكان الوحيد الذي تُحدَّث فيه account_running_balances
// و daily_business_results — ويُستدعى حصريًا داخل نفس المعاملة الذرية لحفظ القيد (Atomicity).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BalanceMaintenanceStore = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
/** حسابات النقد المعتمدة في بذرة core (§1101 الصندوق، §1110 بنك محلي، §1120 محافظ يمنية) */
const CASH_ACCOUNT_CODES = new Set(["1101", "1110", "1120"]);
/**
 * مخزن الصيانة التجميعية. كل الدوال هنا **غير مستقلة بذاتها** — يجب أن تُنفَّذ
 * داخل db.transaction() التي تستدعيها (حفظ القيد أو إقفال الفترة)، فلا توجد
 * حالة وسيطة بين Ledger والأرصدة المجمّعة أبدًا.
 */
class BalanceMaintenanceStore {
    db;
    constructor(db) {
        this.db = db;
    }
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
    applyEntryToAggregates(entry, tenantId) {
        const businessDate = entry.entryDate.toISOString().slice(0, 10);
        const nowIso = new Date().toISOString();
        let revenueInc = new decimal_js_1.default(0);
        let cogsInc = new decimal_js_1.default(0);
        let expenseInc = new decimal_js_1.default(0);
        let cashInInc = new decimal_js_1.default(0);
        let cashOutInc = new decimal_js_1.default(0);
        for (const line of entry.lines) {
            const baseAmt = new decimal_js_1.default(line.baseAmount.toStorageString());
            const isDebit = line.side === "debit";
            // ---- الرصيد الحي (جدول واحد لكل حساب — يمثل الفترة المفتوحة دائمًا §2.3) ----
            // يحدَّد كود الحساب وطبيعته من الشجرة (الكيان النطاق يحمل accountId فقط)
            const accountRow = this.db
                .prepare(`SELECT code, normal_balance FROM accounts WHERE id = ?`)
                .get(line.accountId);
            if (!accountRow)
                continue; // حساب غير معروف — لا يُجمَّع (لن يحدث عمليًا بسبب FK)
            const code = accountRow.code;
            const isCreditNormal = accountRow.normal_balance === "credit";
            const existing = this.db
                .prepare(`SELECT opening_balance_base, period_debit_total_base, period_credit_total_base
           FROM account_running_balances WHERE tenant_id = ? AND account_code = ?`)
                .get(tenantId, code);
            let opening = new decimal_js_1.default(existing?.opening_balance_base ?? "0");
            let periodDebit = new decimal_js_1.default(existing?.period_debit_total_base ?? "0");
            let periodCredit = new decimal_js_1.default(existing?.period_credit_total_base ?? "0");
            if (isDebit)
                periodDebit = periodDebit.plus(baseAmt);
            else
                periodCredit = periodCredit.plus(baseAmt);
            // الرصيد الحي بإشارة الرصيد الطبيعي (الدائن موجب لخصوم/حقوق/إيرادات، والمدين لأصول/مصروفات)
            const current = isCreditNormal
                ? opening.plus(periodCredit).minus(periodDebit)
                : opening.plus(periodDebit).minus(periodCredit);
            this.db
                .prepare(`INSERT INTO account_running_balances
             (tenant_id, account_code, opening_balance_base, period_debit_total_base,
              period_credit_total_base, current_balance_base, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, account_code) DO UPDATE SET
             period_debit_total_base = excluded.period_debit_total_base,
             period_credit_total_base = excluded.period_credit_total_base,
             current_balance_base = excluded.current_balance_base,
             updated_at = excluded.updated_at`)
                .run(tenantId, code, opening.toFixed(4), periodDebit.toFixed(4), periodCredit.toFixed(4), current.toFixed(4), nowIso);
            // ---- التجميع اليومي (§2.5 Hook): الإيراد/COGS/المصروف/النقد من أكواد الحسابات ----
            if (code === "4900" || code === "5900") {
                // فروقات العملة — معزولة تمامًا عن النتيجة التشغيلية (§5.3 PRD: "تقرير فروق العملة منفصل عن الربح التشغيلي")
            }
            else if (code.startsWith("4")) {
                // إيرادات ومردودات (4xxx) — المدين (عكس/مردود) يخصم طبيعيًا
                revenueInc = isDebit ? revenueInc.minus(baseAmt) : revenueInc.plus(baseAmt);
            }
            else if (code === "5110") {
                // تكلفة البضاعة/الخدمات المباعة COGS (§ بذرة retail: 5110 تحت رأس 5100)
                cogsInc = cogsInc.plus(isDebit ? baseAmt : baseAmt.negated());
            }
            else if (code.startsWith("5")) {
                expenseInc = expenseInc.plus(isDebit ? baseAmt : baseAmt.negated());
            }
            else if (CASH_ACCOUNT_CODES.has(code)) {
                if (isDebit)
                    cashInInc = cashInInc.plus(baseAmt);
                else
                    cashOutInc = cashOutInc.plus(baseAmt);
            }
        }
        // ---- upsert النتيجة اليومية تراكميًا ----
        const prev = this.db
            .prepare(`SELECT revenue_total_base, cogs_total_base, expenses_total_base,
                cash_in_base, cash_out_base, transactions_count
         FROM daily_business_results WHERE tenant_id = ? AND business_date = ?`)
            .get(tenantId, businessDate);
        const revenue = new decimal_js_1.default(prev?.revenue_total_base ?? "0").plus(revenueInc);
        const cogs = new decimal_js_1.default(prev?.cogs_total_base ?? "0").plus(cogsInc);
        const expenses = new decimal_js_1.default(prev?.expenses_total_base ?? "0").plus(expenseInc);
        const cashIn = new decimal_js_1.default(prev?.cash_in_base ?? "0").plus(cashInInc);
        const cashOut = new decimal_js_1.default(prev?.cash_out_base ?? "0").plus(cashOutInc);
        const count = (prev?.transactions_count ?? 0) + 1;
        const gross = revenue.minus(cogs);
        const net = gross.minus(expenses);
        this.db
            .prepare(`INSERT INTO daily_business_results
           (tenant_id, business_date, revenue_total_base, cogs_total_base, gross_profit_base,
            expenses_total_base, net_profit_base, cash_in_base, cash_out_base, transactions_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, business_date) DO UPDATE SET
           revenue_total_base = excluded.revenue_total_base,
           cogs_total_base = excluded.cogs_total_base,
           gross_profit_base = excluded.gross_profit_base,
           expenses_total_base = excluded.expenses_total_base,
           net_profit_base = excluded.net_profit_base,
           cash_in_base = excluded.cash_in_base,
           cash_out_base = excluded.cash_out_base,
           transactions_count = excluded.transactions_count,
           updated_at = excluded.updated_at`)
            .run(tenantId, businessDate, revenue.toFixed(4), cogs.toFixed(4), gross.toFixed(4), expenses.toFixed(4), net.toFixed(4), cashIn.toFixed(4), cashOut.toFixed(4), count, nowIso);
    }
    /** عكس الحركة (للقيد العكسي Reversal) — يطبَّق بنفس آلية applyEntry لأن createReversal يقلب الأسطر فعليًا */
    /** قراءة صف النتيجة اليومية كما هو (§2.5) */
    getDailyResult(tenantId, businessDate) {
        const row = this.db
            .prepare(`SELECT * FROM daily_business_results WHERE tenant_id = ? AND business_date = ?`)
            .get(tenantId, businessDate);
        if (!row)
            return null;
        return {
            businessDate: row.business_date,
            revenueTotalBase: row.revenue_total_base,
            cogsTotalBase: row.cogs_total_base,
            grossProfitBase: row.gross_profit_base,
            expensesTotalBase: row.expenses_total_base,
            netProfitBase: row.net_profit_base,
            cashInBase: row.cash_in_base,
            cashOutBase: row.cash_out_base,
            transactionsCount: row.transactions_count,
        };
    }
    /**
     * ترحيل لقطة الرصيد الحي إلى جدول الفترات المجمّدة (§4.1 خطوة 1).
     * تُكتب كل صفوف الحسابات للفترة — لا تُحذف من الجدول الحي هنا؛
     * النقل للفترة التالية يتم عبر rollForwardAfterClose.
     * إذا مُرِّر startDate و endDate: تُحسب دورات الفترة بدقة من قيود تلك النافذة الزمنية
     * حمايةً من أي قيود مستقبلية قد تكون أُدخلت قبل تنفيذ الإقفال (§9 Golden Test).
     */
    snapshotRunningBalances(tenantId, periodId, startDate, endDate) {
        const postable = this.db
            .prepare(`SELECT id, code, normal_balance FROM accounts WHERE tenant_id = ? AND is_postable = 1`)
            .all(tenantId);
        let periodActivity = null;
        if (startDate && endDate) {
            periodActivity = new Map();
            const activityRows = this.db
                .prepare(`SELECT jl.account_id,
                  COALESCE(SUM(CASE WHEN jl.side = 'debit' THEN CAST(jl.base_amount AS REAL) ELSE 0 END), 0) AS debit,
                  COALESCE(SUM(CASE WHEN jl.side = 'credit' THEN CAST(jl.base_amount AS REAL) ELSE 0 END), 0) AS credit
           FROM journal_lines jl
           JOIN journal_entries je ON je.id = jl.journal_entry_id
           WHERE je.tenant_id = ? AND je.entry_date >= ? AND je.entry_date <= ?
           GROUP BY jl.account_id`)
                .all(tenantId, startDate, endDate);
            for (const ar of activityRows) {
                periodActivity.set(ar.account_id, {
                    debit: new decimal_js_1.default(ar.debit.toFixed(4)),
                    credit: new decimal_js_1.default(ar.credit.toFixed(4)),
                });
            }
        }
        const insert = this.db.prepare(`INSERT INTO account_period_balances
         (tenant_id, fiscal_period_id, account_code, opening_balance_base,
          period_debit_total_base, period_credit_total_base, closing_balance_base, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        const nowIso = new Date().toISOString();
        for (const acct of postable) {
            const running = this.db
                .prepare(`SELECT opening_balance_base, period_debit_total_base, period_credit_total_base, current_balance_base
           FROM account_running_balances WHERE tenant_id = ? AND account_code = ?`)
                .get(tenantId, acct.code);
            let opening = new decimal_js_1.default(running?.opening_balance_base ?? "0");
            let periodDebit;
            let periodCredit;
            if (periodActivity) {
                const act = periodActivity.get(acct.id);
                periodDebit = act?.debit ?? new decimal_js_1.default(0);
                periodCredit = act?.credit ?? new decimal_js_1.default(0);
            }
            else {
                periodDebit = new decimal_js_1.default(running?.period_debit_total_base ?? "0");
                periodCredit = new decimal_js_1.default(running?.period_credit_total_base ?? "0");
            }
            const closing = acct.normal_balance === "credit"
                ? opening.plus(periodCredit).minus(periodDebit)
                : opening.plus(periodDebit).minus(periodCredit);
            insert.run(tenantId, periodId, acct.code, opening.toFixed(4), periodDebit.toFixed(4), periodCredit.toFixed(4), closing.toFixed(4), nowIso);
        }
        return postable.length;
    }
    /**
     * نقل الأرصدة للفترة التالية (§4.1 "createNextPeriod يهيّئ account_running_balances الجديدة"):
     * إغلاق كل حساب يصبح افتتاحي الفترة القادمة، وتصفير دورات الفترة المنتهية.
     * الحسابات الاسمية (إيرادات/مصروفات) تصفر افتتاحيًا عند الإقفال السنوي.
     * إن وُجدت قيود مستقبلية سُجِّلت مسبقًا للفترة التالية (من nextStartDate)، تُحسب دوراتها بدقة.
     */
    rollForwardAfterClose(tenantId, nextStartDate, isAnnualClose = false) {
        const postable = this.db
            .prepare(`SELECT id, code, account_type, normal_balance FROM accounts WHERE tenant_id = ? AND is_postable = 1`)
            .all(tenantId);
        const nowIso = new Date().toISOString();
        const update = this.db.prepare(`INSERT INTO account_running_balances
         (tenant_id, account_code, opening_balance_base, period_debit_total_base,
          period_credit_total_base, current_balance_base, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, account_code) DO UPDATE SET
         opening_balance_base = excluded.opening_balance_base,
         period_debit_total_base = excluded.period_debit_total_base,
         period_credit_total_base = excluded.period_credit_total_base,
         current_balance_base = excluded.current_balance_base,
         updated_at = excluded.updated_at`);
        for (const acct of postable) {
            const running = this.db
                .prepare(`SELECT current_balance_base FROM account_running_balances WHERE tenant_id = ? AND account_code = ?`)
                .get(tenantId, acct.code);
            const isNominal = acct.account_type === "revenue" || acct.account_type === "expense";
            let newOpening = (isAnnualClose && isNominal)
                ? new decimal_js_1.default(0)
                : new decimal_js_1.default(running?.current_balance_base ?? "0");
            let periodDebit = new decimal_js_1.default(0);
            let periodCredit = new decimal_js_1.default(0);
            if (nextStartDate) {
                const futureAct = this.db
                    .prepare(`SELECT
               COALESCE(SUM(CASE WHEN jl.side = 'debit' THEN CAST(jl.base_amount AS REAL) ELSE 0 END), 0) AS debit,
               COALESCE(SUM(CASE WHEN jl.side = 'credit' THEN CAST(jl.base_amount AS REAL) ELSE 0 END), 0) AS credit
             FROM journal_lines jl
             JOIN journal_entries je ON je.id = jl.journal_entry_id
             WHERE je.tenant_id = ? AND jl.account_id = ? AND je.entry_date >= ?`)
                    .get(tenantId, acct.id, nextStartDate);
                periodDebit = new decimal_js_1.default(futureAct.debit.toFixed(4));
                periodCredit = new decimal_js_1.default(futureAct.credit.toFixed(4));
            }
            const current = acct.normal_balance === "credit"
                ? newOpening.plus(periodCredit).minus(periodDebit)
                : newOpening.plus(periodDebit).minus(periodCredit);
            update.run(tenantId, acct.code, newOpening.toFixed(4), periodDebit.toFixed(4), periodCredit.toFixed(4), current.toFixed(4), nowIso);
        }
    }
    /** حذف لقطة فترة (عند إعادة الفتح §4.2 — ستُعاد عند الإقفال مجددًا) */
    deletePeriodSnapshot(periodId) {
        this.db
            .prepare(`DELETE FROM account_period_balances WHERE fiscal_period_id = ?`)
            .run(periodId);
    }
    /**
     * استعادة الأرصدة الحية من اللقطة عند إعادة فتح فترة (§4.2 restoreRunningBalancesFromSnapshot):
     * عكس rollForward — الافتتاحي يعود لقيمة افتتاحي الفترة المُقفَلة والدورات لقيمتها المخزّنة.
     * يُطبَّق فقط على الحسابات الموجودة في اللقطة (الأحدث يفوق الأقدم تسلسلًا مضمون بإغلاق المتتالية).
     */
    restoreRunningBalancesFromSnapshot(tenantId, periodId) {
        const rows = this.db
            .prepare(`SELECT account_code, opening_balance_base, period_debit_total_base,
                period_credit_total_base, closing_balance_base
         FROM account_period_balances WHERE fiscal_period_id = ? AND tenant_id = ?`)
            .all(periodId, tenantId);
        const update = this.db.prepare(`UPDATE account_running_balances
       SET opening_balance_base = ?, period_debit_total_base = ?,
           period_credit_total_base = ?, current_balance_base = ?, updated_at = ?
       WHERE tenant_id = ? AND account_code = ?`);
        const nowIso = new Date().toISOString();
        for (const r of rows) {
            update.run(r.opening_balance_base, r.period_debit_total_base, r.period_credit_total_base, r.closing_balance_base, nowIso, tenantId, r.account_code);
        }
        return rows.length;
    }
    /** قراءة رصيد حي واحد (للاختبارات والمعاينات) */
    getRunningBalance(tenantId, accountCode) {
        const row = this.db
            .prepare(`SELECT opening_balance_base, period_debit_total_base, period_credit_total_base, current_balance_base
         FROM account_running_balances WHERE tenant_id = ? AND account_code = ?`)
            .get(tenantId, accountCode);
        return row ?? null;
    }
    /**
     * تصفير الأرصدة الحية لحسابات اسمية (إيرادات/مصروفات) بعد قيد الإقفال السنوي (§4.1).
     * الصيغة المعتمدة "0.0000" بدقة التخزين الكاملة — لا "0" المجرد، لأن اللقطة المجمّدة
     * تُقرأ لاحقًا في المسار الهجين ويجب أن تتطابق النصوص تنسيقياً مع بقية الأعمدة.
     */
    resetRunningBalancesForAccounts(tenantId, accountCodes) {
        const stmt = this.db.prepare(`UPDATE account_running_balances
       SET opening_balance_base = '0.0000', period_debit_total_base = '0.0000',
           period_credit_total_base = '0.0000', current_balance_base = '0.0000', updated_at = ?
       WHERE tenant_id = ? AND account_code = ?`);
        const nowIso = new Date().toISOString();
        for (const code of accountCodes) {
            stmt.run(nowIso, tenantId, code);
        }
    }
    /**
     * إعادة تطبيق حركة قيد على الأرصدة الحية فقط (بدون daily_business_results وبدون فحص فترات) —
     * تُستخدم حصريًا لعكس أثر قيود النظام (إقفال سنوي/تسويات يومية) عند إعادة فتح فترة (§4.2)،
     * تطبيق حركة قيد نظام (إقفال سنوي، تسوية، أو عكس إقفال) على الأرصدة الحية فقط دون المساس بـ daily_business_results (§4.1/§4.2)
     */
    reverseEntryOnRunningBalances(entry, tenantId) {
        for (const line of entry.lines) {
            const accountRow = this.db
                .prepare(`SELECT code, normal_balance FROM accounts WHERE id = ?`)
                .get(line.accountId);
            if (!accountRow)
                continue;
            const isCreditNormal = accountRow.normal_balance === "credit";
            const existing = this.db
                .prepare(`SELECT opening_balance_base, period_debit_total_base, period_credit_total_base
           FROM account_running_balances WHERE tenant_id = ? AND account_code = ?`)
                .get(tenantId, accountRow.code);
            const baseAmt = new decimal_js_1.default(line.baseAmount.toStorageString());
            let opening = new decimal_js_1.default(existing?.opening_balance_base ?? "0");
            let periodDebit = new decimal_js_1.default(existing?.period_debit_total_base ?? "0");
            let periodCredit = new decimal_js_1.default(existing?.period_credit_total_base ?? "0");
            if (line.side === "debit")
                periodDebit = periodDebit.plus(baseAmt);
            else
                periodCredit = periodCredit.plus(baseAmt);
            const current = isCreditNormal
                ? opening.plus(periodCredit).minus(periodDebit)
                : opening.plus(periodDebit).minus(periodCredit);
            this.db
                .prepare(`INSERT INTO account_running_balances
             (tenant_id, account_code, opening_balance_base, period_debit_total_base,
              period_credit_total_base, current_balance_base, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, account_code) DO UPDATE SET
             period_debit_total_base = excluded.period_debit_total_base,
             period_credit_total_base = excluded.period_credit_total_base,
             current_balance_base = excluded.current_balance_base,
             updated_at = excluded.updated_at`)
                .run(tenantId, accountRow.code, opening.toFixed(4), periodDebit.toFixed(4), periodCredit.toFixed(4), current.toFixed(4), new Date().toISOString());
        }
    }
}
exports.BalanceMaintenanceStore = BalanceMaintenanceStore;
//# sourceMappingURL=BalanceMaintenanceStore.js.map