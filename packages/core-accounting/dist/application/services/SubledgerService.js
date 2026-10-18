"use strict";
// src/application/services/SubledgerService.ts
// ===== خدمة الذمم الفرعية (AR/AP Sub-Ledger) — وفق docs/04-modules/ar-ap-subledger.md =====
// الحلقة الواصلة بين محرك القوالب (post_actions) ومستودع البنود المفتوحة:
//   createOpenItem        → بند AR/AP من قيد العملية الآجلة (sale_credit/purchase_credit/sale_partial...)
//   allocate_to_invoice   → تسوية FIFO مع فرق عملة لكل بند على حدة + قيد FX تلقائي (4900 ربح / 5900 خسارة)
// المبدأ الحاكم: لا تُبنى القيود يدويًا خارج JournalEngine — هذه الخدمة تستدعي المحرك حصريًا.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubledgerService = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
const SqliteSubledgerRepository_1 = require("../../infrastructure/sqlite/SqliteSubledgerRepository");
const ApplicationErrors_1 = require("../errors/ApplicationErrors");
/** حسابا فروق العملة المعتمدان في بذرة core (§6.1: 4900 أرباح / 5900 خسائر فروق العملة) */
const FX_GAIN_ACCOUNT_CODE = "4900";
const FX_LOSS_ACCOUNT_CODE = "5900";
/** حسابا الضبط المقابل حسب نوع الفرعي — يُتحقق من وجودهما الفعلي في الشجرة قبل الترحيل */
const CONTROL_ACCOUNT_CODES = {
    AR: "1210", // ذمم مدينة — العملاء
    AP: "2110", // ذمم دائنة — الموردون
};
function toIsoDate(d) {
    return d.toISOString().slice(0, 10);
}
/**
 * خدمة التطبيق للذمم الفرعية: بنود مفتوحة، تسويات FIFO، أعمار الديون، كشف الحساب، الشطب، ومنع العكس.
 * تستقر في طبقة التطبيق وتتحدث إلى المنافذ والمحركات فقط (نفس نمط RecordTransactionService).
 */
class SubledgerService {
    journalEngine;
    accountRepo;
    baseCurrencyCode;
    repo;
    constructor(db, journalEngine, accountRepo, 
    /** عملة الأساس للمنشأة — تُحقن من مركّب الاعتماديات (لا استنتاج حرفي داخل الخدمة) */
    baseCurrencyCode) {
        this.journalEngine = journalEngine;
        this.accountRepo = accountRepo;
        this.baseCurrencyCode = baseCurrencyCode;
        this.repo = new SqliteSubledgerRepository_1.SqliteSubledgerRepository(db, baseCurrencyCode);
    }
    // ===================== الربط بمحرك القوالب (post_actions) =====================
    /**
     * تسجيل معالجات post_actions في السجل العام. الأسماء مطابقة لاستخدامات مكتبة القوالب:
     * - createOpenItem(customer_id | supplier_id)     ← قوالب البيع/الشراء الآجل والجزئي
     * - allocate_to_invoice({{invoice_ref}})          ← قوالب التحصيل/السداد
     * - apply_fx_gain_loss_if_needed                  ← no-op موثّق (§4: أُدمج داخل التخصيص نفسه)
     */
    registerPostActions(registry) {
        registry.register("createOpenItem", async (args, ctx) => {
            const contactKey = String(args[0] ?? "contact_id");
            await this.createFromEntry(ctx, contactKey);
        });
        const allocateHandler = async (_args, ctx) => {
            await this.settleFromEntry(ctx);
        };
        registry.register("allocate_to_invoice", allocateHandler);
        // الاسم الوارد في نص التصميم §4 — مرادف للتوافق المستقبلي
        registry.register("allocatePayment", allocateHandler);
        // §4: فرق العملة يُحسب الآن داخل التخصيص لكل بند على حدة (أدق محاسبيًا عند تعدد الفواتير)؛
        // يُسجَّل كـ no-op صريح حتى لا يُطبع تحذير «تم تجاهله» عند كل تسوية.
        registry.register("apply_fx_gain_loss_if_needed", async () => { });
    }
    /**
     * إنشاء بند مفتوح من سطر القيد ذي الصلة بالطرف (سطر يحمل contact_ref في القالب).
     * البند يُقيَّم بعملة السطر وسعره المثبَّت وقت الإنشاء — أساس حساب فروق العملة لاحقًا (§3.2).
     */
    async createFromEntry(ctx, contactKey) {
        const entry = ctx.primaryEntry;
        if (!entry)
            throw new ApplicationErrors_1.InvalidTemplatePayloadError("سياق post_action يفتقر إلى القيد الرئيسي");
        const contactId = ctx.payload[contactKey];
        if (typeof contactId !== "string" || contactId === "")
            return; // بلا طرف ⇒ عملية نقدية، لا ذمم
        const line = entry.lines.find((l) => l.contactId === contactId) ??
            entry.lines.find((l) => l.contactId != null);
        if (!line)
            return;
        const subledgerType = line.side === "debit" ? "AR" : "AP";
        const dueDateRaw = ctx.payload["due_date"];
        const dueDate = typeof dueDateRaw === "string" && dueDateRaw !== "" ? dueDateRaw : null;
        this.repo.createOpenItem({
            tenantId: ctx.tenantId,
            contactId,
            subledgerType,
            sourceTransactionId: ctx.transactionId,
            journalEntryId: entry.id,
            invoiceDate: toIsoDate(entry.entryDate),
            dueDate,
            originalAmount: line.amount.toStorageString(),
            currencyCode: line.amount.currencyCode,
            exchangeRate: line.exchangeRateUsed,
            baseOriginalAmount: line.baseAmount.toStorageString(),
        });
    }
    /**
     * تسوية دفعة انطلاقًا من قيد التسوية نفسه (customer_collection / supplier_payment):
     * سطر الطرف يحدد النوع (دائن على حساب الطرف ⇒ AR)، والسطر النقدي المقابل يحدد المبلغ بسعر اليوم.
     */
    async settleFromEntry(ctx) {
        const entry = ctx.primaryEntry;
        if (!entry)
            throw new ApplicationErrors_1.InvalidTemplatePayloadError("سياق post_action يفتقر إلى القيد الرئيسي");
        const contactLine = entry.lines.find((l) => l.contactId != null);
        if (!contactLine)
            return null; // بلا طرف ⇒ لا شيء لتخصيصه
        // السطر المقابل لسطر الطرف يحمل التدفق النقدي (مدين صندوق في التحصيل / دائن صندوق في الدفع)
        const cashSide = contactLine.side === "credit" ? "debit" : "credit";
        const cashLine = entry.lines.find((l) => l.side === cashSide && l.accountId !== contactLine.accountId) ??
            entry.lines.find((l) => l.side === cashSide);
        if (!cashLine)
            return null;
        const subledgerType = contactLine.side === "credit" ? "AR" : "AP";
        // المجمّع النقدي الفعلي بعملة الأساس من السطر غير المرتبط بالطرف (مدين الصندوق/البنك) —
        // لا يُشتق من سطر الطرف لأنه يحمل سعر اليوم لا السعر المخزَّن للبنود.
        const cashLines = entry.lines.filter((l) => l.contactId == null && l.side === cashSide);
        let amountInBase = cashLines.reduce((acc, l) => acc.plus(new decimal_js_1.default(l.baseAmount.toStorageString())), new decimal_js_1.default(0));
        // ===== تطبيع مبلغ التسوية إلى عملة بنود الطابور الفعلي (§3.2/§7) =====
        // المبدأ الحاكم: fx لكل بند = النقد الفعلي المُخصَّص له − قيمته المخزَّنة بالأساس.
        // لذا يجب أن يُوزَّع المبلغ بالعملة الأصلية للبنود نفسها، لا بعملة سطر القيد —
        // وإلا ضاعت حصة كاملة عند خلط عملات (فاتورة USD وتحصيل مُدخل بعملة YER مثلًا).
        // المسار: البند المستهدف صراحةً (invoice_ref) ← رأس طابور FIFO ← عملة سطر الطرف.
        const targetRef = ctx.payload["invoice_ref"];
        const targetItemId = typeof targetRef === "string" && targetRef !== "" ? targetRef : null;
        const targetItem = targetItemId ? this.repo.findById(ctx.tenantId, targetItemId) : null;
        // طابور FIFO الكامل (بنفس ترتيب المستودع الذي سيُستخدم في التوزيع لاحقًا) — مصدر عملة التطبيع.
        const fifoQueue = targetItemId
            ? []
            : this.repo.findUnsettledItems(ctx.tenantId, contactLine.contactId, subledgerType);
        const headItem = targetItem ?? fifoQueue[0] ?? null;
        const queueCurrency = headItem?.currencyCode ?? null;
        // السعر الفعلي الضمني لسطر الطرف = أساس السطر ÷ مبلغه بالعملة الاسمية — أدقّ من
        // exchangeRateUsed المُعلَن (قد يكون 1 في أسطر مُعبَّر عنها بالأساس خطأً أو عمدًا).
        const contactLineBase = new decimal_js_1.default(contactLine.baseAmount.toStorageString());
        const contactLineAmount = new decimal_js_1.default(contactLine.amount.toStorageString());
        const impliedRate = contactLineAmount.gt(0) ? contactLineBase.div(contactLineAmount) : null;
        const isBaseExpressedLine = impliedRate != null && impliedRate.isFinite() && impliedRate.eq(1);
        let amountInItemCurrency;
        let itemCurrencyCode;
        if (queueCurrency && !isBaseExpressedLine && queueCurrency !== contactLine.amount.currencyCode) {
            // عملة السطر ≠ عملة البنود: اشتقاق المبلغ بالعملة الأصلية عبر الأساس بسعر صرف سطر الطرف
            // المثبَّت في القيد (يعكس صفقة اليوم بدقة). صفر/غير صالح ⇒ استدراك بالسعر المخزَّن للبند.
            let rateToBase = new decimal_js_1.default(contactLine.exchangeRateUsed);
            if (!rateToBase.isFinite() || rateToBase.isZero()) {
                rateToBase = new decimal_js_1.default(headItem?.exchangeRate ?? "1");
            }
            amountInItemCurrency = amountInBase.div(rateToBase);
            itemCurrencyCode = queueCurrency;
        }
        else {
            // المسار القياسي (سطر بعملة البنود) أو بلا بنود في الطابور: مبلغ السطر هو Original currency.
            // استدراك: سعر معلن غير صالح (صفر/غير محدود) ⇒ اشتقاق السعر الفعلي من أساس القيد ÷ مبلغ السطر.
            amountInItemCurrency = contactLineAmount;
            itemCurrencyCode = contactLine.amount.currencyCode;
            const declaredRate = new decimal_js_1.default(contactLine.exchangeRateUsed);
            if (!declaredRate.isFinite() || declaredRate.isZero()) {
                amountInBase = amountInItemCurrency.times(impliedRate ?? new decimal_js_1.default(1));
            }
        }
        const outcome = this.repo.settlePayment({
            tenantId: ctx.tenantId,
            contactId: contactLine.contactId,
            subledgerType,
            settlementTransactionId: ctx.transactionId,
            settlementEntryId: entry.id,
            settlementDate: toIsoDate(entry.entryDate),
            amountInItemCurrency,
            amountInBase,
            itemCurrencyCode,
            currentRate: cashLine.exchangeRateUsed,
            targetItemId,
        });
        // §3.2 + القسم 8 (قاعدة التكامل): كل fx_gain_loss ≠ 0 يجب أن يملك قيدًا — يُنشأ تلقائيًا هنا
        const netFx = outcome.allocations.reduce((acc, a) => acc.plus(a.fxGainLossAmount), new decimal_js_1.default(0));
        if (!netFx.isZero()) {
            await this.postFxEntry(ctx.tenantId, entry.entryDate, netFx, subledgerType);
        }
        return outcome;
    }
    /**
     * قيد فرق العملة (§3.2) بالعملة الأساسية مباشرة (فرق الصرف مُعبَّر عنه بالأساس أصلًا).
     * الاشتقاق (open-item القياسي): الدين الأصلي بالأساس D، قيمة التحصيل الفعلية بالأساس C.
     * netFx = C − D. قيد التسوية سجّل النقد بقيمة C كاملًا وأغلق الذمم بقيمة D فقط،
     * فالفرق يُعترف به مستقلًا:
     *   ربح (C>D):  مدين حساب التحكم (استكمال إغلاق المستحق الزائد عن المخزَّن) / دائن 4900 أرباح FX
     *   خسارة (C<D): دائن حساب التحكم / مدين 5900 خسائر FX
     * (كشف الحساب والتسويات يعتمدان جدول التخصيصات لا هذه القيود، فلا يتأثر الرصيد الفرعي.)
     */
    async postFxEntry(tenantId, entryDate, netFx, subledgerType) {
        const amountStr = netFx.abs().toFixed(4);
        if (new decimal_js_1.default(amountStr).isZero())
            return;
        const controlCode = CONTROL_ACCOUNT_CODES[subledgerType];
        const isGain = netFx.greaterThan(0);
        const fxCode = isGain ? FX_GAIN_ACCOUNT_CODE : FX_LOSS_ACCOUNT_CODE;
        await this.assertAccountsExist(tenantId, [controlCode, fxCode]);
        const lines = isGain
            ? [
                { accountCode: controlCode, side: "debit", amount: amountStr, currencyCode: this.baseCurrencyCode, exchangeRateUsed: "1", memoAr: "فرق عملة — استلام يزيد عن المستحق المخزَّن" },
                { accountCode: fxCode, side: "credit", amount: amountStr, currencyCode: this.baseCurrencyCode, exchangeRateUsed: "1", memoAr: "أرباح فروق عملة من تسوية" },
            ]
            : [
                { accountCode: controlCode, side: "credit", amount: amountStr, currencyCode: this.baseCurrencyCode, exchangeRateUsed: "1", memoAr: "فرق عملة — استلام يقل عن المستحق المخزَّن" },
                { accountCode: fxCode, side: "debit", amount: amountStr, currencyCode: this.baseCurrencyCode, exchangeRateUsed: "1", memoAr: "خسائر فروق عملة من تسوية" },
            ];
        await this.journalEngine.postEntry({
            tenantId,
            entryDate,
            descriptionSimple: `قيد فرق عملة (${isGain ? "ربح" : "خسارة"} ${amountStr} ${this.baseCurrencyCode})`,
            sourceType: "system_adjustment",
            baseCurrencyCode: this.baseCurrencyCode,
            lines,
        });
    }
    // ===================== القراءة والتقارير =====================
    findUnsettledItems(tenantId, contactId, category) {
        if (category)
            return this.repo.findUnsettledItems(tenantId, contactId, category);
        return [
            ...this.repo.findUnsettledItems(tenantId, contactId, "AR"),
            ...this.repo.findUnsettledItems(tenantId, contactId, "AP"),
        ];
    }
    /**
     * أعمار الديون (§5.1): المرجع = due_date ?? invoice_date، والتجميع بعملة الأساس.
     * age <= 0 ⇒ current (لم يستحق بعد).
     */
    calculateAging(tenantId, category, asOfDate) {
        const asOf = new Date(asOfDate ?? new Date());
        if (Number.isNaN(asOf.getTime())) {
            throw new ApplicationErrors_1.InvalidTemplatePayloadError(`تاريخ "as_of_date" غير صالح: ${asOfDate}`);
        }
        const rows = this.repo.listAllUnsettledByType(tenantId, category);
        const byContact = new Map();
        for (const item of rows) {
            const refDate = new Date(item.dueDate ?? item.invoiceDate);
            if (Number.isNaN(refDate.getTime()))
                continue; // بيانات تاريخ تالفة — تُتجاهل في التقرير لا تُسقطه
            const ageDays = Math.floor((asOf.getTime() - refDate.getTime()) / 86_400_000);
            const bucket = ageDays <= 0 ? "current" :
                ageDays <= 30 ? "days_1_30" :
                    ageDays <= 60 ? "days_31_60" :
                        ageDays <= 90 ? "days_61_90" : "over_90";
            const acc = byContact.get(item.contactId) ?? {
                current: new decimal_js_1.default(0), days_1_30: new decimal_js_1.default(0), days_31_60: new decimal_js_1.default(0),
                days_61_90: new decimal_js_1.default(0), over_90: new decimal_js_1.default(0),
            };
            acc[bucket] = acc[bucket].plus(new decimal_js_1.default(item.baseRemainingAmount));
            byContact.set(item.contactId, acc);
        }
        return [...byContact.entries()].map(([contactId, b]) => ({
            contactId,
            current: b.current.toFixed(4),
            days_1_30: b.days_1_30.toFixed(4),
            days_31_60: b.days_31_60.toFixed(4),
            days_61_90: b.days_61_90.toFixed(4),
            over_90: b.over_90.toFixed(4),
            total: Object.values(b).reduce((a, v) => a.plus(v), new decimal_js_1.default(0)).toFixed(4),
        }));
    }
    /** ملخص الأعمار للوحة الرئيسية (§6.2 /reports/aging/summary): إجمالي كل Bucket عبر كل الأطراف */
    agingSummary(tenantId, category, asOfDate) {
        const rows = this.calculateAging(tenantId, category, asOfDate);
        const sum = (k) => rows.reduce((acc, r) => acc.plus(new decimal_js_1.default(r[k])), new decimal_js_1.default(0)).toFixed(4);
        return {
            current: sum("current"),
            days_1_30: sum("days_1_30"),
            days_31_60: sum("days_31_60"),
            days_61_90: sum("days_61_90"),
            over_90: sum("over_90"),
            total: sum("total"),
        };
    }
    /**
     * قائمة البنود المفتوحة (غير المسدَّدة/غير المشطوبة) للطرف — نقطة قراءة موحّدة للـ API.
     * category اختياري: AR أو AP؛ بدونه يُرجع النوعان معًا.
     */
    listOpenItems(tenantId, contactId, category) {
        if (category)
            return this.repo.findUnsettledItems(tenantId, contactId, category);
        return [
            ...this.repo.findUnsettledItems(tenantId, contactId, "AR"),
            ...this.repo.findUnsettledItems(tenantId, contactId, "AP"),
        ];
    }
    /**
     * كشف حساب الطرف (§6.1): فواتير بتواريخها ثم تسوياتها (من جدول التخصيصات) بالترتيب الزمني،
     * والرصيد الجاري بمعنى «المستحق الصافي على الطرف»: الفواتير تزيد والتحصيلات تنقص (AR)،
     * وعكس الاتجاه يُقرأ من الإشارة نفسها في AP (التزام علينا).
     */
    buildStatement(tenantId, contactId) {
        const items = this.repo.findAllItemsForContact(tenantId, contactId);
        const events = [];
        for (const item of items) {
            const isAR = item.subledgerType === "AR";
            const originalBase = new decimal_js_1.default(item.originalAmount).times(new decimal_js_1.default(item.exchangeRate));
            events.push({
                date: item.invoiceDate,
                type: "invoice",
                description: isAR ? `فاتورة بيع آجل (${item.currencyCode})` : `فاتورة شراء آجل (${item.currencyCode})`,
                delta: isAR ? originalBase : originalBase.negated(),
            });
            for (const alloc of this.repo.listAllocationsForItem(item.id)) {
                const allocatedBase = new decimal_js_1.default(alloc.allocatedAmountBase);
                events.push({
                    date: alloc.allocationDate,
                    type: "settlement",
                    description: `تسوية على بند ${item.invoiceDate}`,
                    delta: isAR ? allocatedBase.negated() : allocatedBase,
                });
            }
        }
        events.sort((a, b) => a.date.localeCompare(b.date));
        let running = new decimal_js_1.default(0);
        const lines = events.map((e) => {
            running = running.plus(e.delta);
            return {
                date: e.date,
                type: e.type,
                description: e.description,
                debit: e.delta.gt(0) ? e.delta.toFixed(4) : "0.0000",
                credit: e.delta.lt(0) ? e.delta.abs().toFixed(4) : "0.0000",
                running_balance: running.toFixed(4),
            };
        });
        return { contactId, lines, closingBalance: running.toFixed(4) };
    }
    /** شطب دين معدوم (§6.1 — صلاحية المالك تُفرض في طبقة العرض/الـ Controller) */
    writeOff(tenantId, openItemId, reason) {
        if (!reason || reason.trim() === "") {
            throw new ApplicationErrors_1.InvalidTemplatePayloadError("سبب الشطب إلزامي لأغراض التدقيق");
        }
        const item = this.repo.findById(tenantId, openItemId);
        if (!item)
            throw new ApplicationErrors_1.SubledgerOperationError(`البند المفتوح "${openItemId}" غير موجود`);
        if (item.status === "settled")
            throw new ApplicationErrors_1.SubledgerOperationError("لا يمكن شطب بند مسدَّد بالكامل");
        if (item.status === "written_off")
            throw new ApplicationErrors_1.SubledgerOperationError("البند مشطوب مسبقًا");
        return this.repo.writeOffItem(tenantId, openItemId, reason.trim());
    }
    /** منع عكس فاتورة لها تخصيصات (§7 — قيد تطبيقي صارم يمنع كسر تكامل البيانات) */
    assertReversible(tenantId, sourceTransactionId) {
        if (this.repo.hasAllocationsForSourceTransaction(tenantId, sourceTransactionId)) {
            throw new ApplicationErrors_1.SubledgerOperationError("لا يمكن عكس هذه الفاتورة لأن لها دفعات مُخصَّصة عليها — ألغِ التخصيصات أولًا ثم اعكِس الفاتورة");
        }
    }
    /** رصيد الطرف الفوري (§6.1 /contacts/{id}/balance) */
    getBalance(tenantId, contactId) {
        const sum = (t) => this.repo
            .findUnsettledItems(tenantId, contactId, t)
            .reduce((acc, i) => acc.plus(new decimal_js_1.default(i.baseRemainingAmount)), new decimal_js_1.default(0))
            .toFixed(4);
        return { ar: sum("AR"), ap: sum("AP") };
    }
    // ===================== مساعدات داخلية =====================
    /** فشل سريع برسالة عربية واضحة بدل AccountNotFoundError الغامضة في عمق المحرك */
    async assertAccountsExist(tenantId, codes) {
        const map = await this.accountRepo.findManyByCodes(tenantId, codes);
        const missing = codes.filter((c) => !map.has(c));
        if (missing.length > 0) {
            throw new ApplicationErrors_1.SubledgerOperationError(`حسابات مطلوبة للذمم الفرعية غير متوفرة في شجرة هذه المنشأة: ${missing.join(", ")}`);
        }
    }
}
exports.SubledgerService = SubledgerService;
//# sourceMappingURL=SubledgerService.js.map