"use strict";
// src/templates/TemplateExecutionEngine.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplateExecutionEngine = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
const uuid_1 = require("uuid");
const Money_1 = require("../domain/value-objects/Money");
const ExpressionEngine_1 = require("./engine/ExpressionEngine");
const TemplateValidator_1 = require("./validation/TemplateValidator");
const ApplicationErrors_1 = require("../application/errors/ApplicationErrors");
/** حارس الحافة لمدخلات الحقول المالية (نوع amount):
 * يرفض القيم غير الرقمية أو السالبة برسالة عربية واضحة تحمل اسم الحقل المعروض،
 * قبل أن تصل للنواة وتُرمي استثناءات داخلية تُترجم خطأً إلى HTTP 500. */
function assertAmountFieldsValid(template, payload) {
    for (const field of template.fields) {
        if (field.type !== "amount")
            continue;
        const raw = payload[field.key];
        if (raw === undefined || raw === null || raw === "")
            continue; // مطلوب/فارغ يعالجه TemplateValidator
        // Decimal يرمي استثناءً على النصوص غير الرقمية ("abc") — نحوّله لرسالة تحقق عربية واضحة (400 لا 500)
        let numericValue;
        try {
            numericValue = new decimal_js_1.default(String(raw).replace(/,/g, ""));
        }
        catch {
            throw new ApplicationErrors_1.InvalidTemplatePayloadError(`قيمة الحقل "${field.label_ar}" غير صالحة — يجب أن تكون رقمًا`);
        }
        if (!numericValue.isFinite() || numericValue.isNegative()) {
            throw new ApplicationErrors_1.InvalidTemplatePayloadError(`قيمة الحقل "${field.label_ar}" غير صالحة — يجب أن تكون رقمًا موجبًا`);
        }
    }
}
const CATEGORY_TO_SOURCE_TYPE = {
    purchases: "purchase", sales: "sale", returns: "return", settlements: "settlement",
    damage: "damage", opening_balance: "opening_balance", expenses: "expense",
    owner: "owner", services: "sale",
};
/**
 * نقطة الدخول الوحيدة لتنفيذ أي قالب في كامل التطبيق.
 * تُترجم تعريف JSON الوصفي إلى استدعاء فعلي لـ JournalEngine، مع ضمان التوازن
 * عبر "قاعدة التقريب الإلزامية" (آخر سطر = الباقي الدقيق) في كل توزيع.
 */
class TemplateExecutionEngine {
    registry;
    journalEngine;
    inventoryPort;
    exchangeRateProvider;
    postActionRegistry;
    validator;
    /** مستودع الحسابات — اختياري حقنًا للتوافق؛ يلزم لعرض أسماء الحسابات في الملخص المبسّط */
    accountRepo;
    constructor(registry, journalEngine, inventoryPort, exchangeRateProvider, postActionRegistry, validator = new TemplateValidator_1.TemplateValidator(), accountRepo) {
        this.registry = registry;
        this.journalEngine = journalEngine;
        this.inventoryPort = inventoryPort;
        this.exchangeRateProvider = exchangeRateProvider;
        this.postActionRegistry = postActionRegistry;
        this.validator = validator;
        this.accountRepo = accountRepo;
    }
    /** ربط مستودع الحسابات بعد الإنشاء (يُستخدم من مركّب الاعتماديات لتفادي توسيع توقيع المُنشئ) */
    setAccountRepository(accountRepo) {
        this.accountRepo = accountRepo;
    }
    /**
     * إسقاط القيم الافتراضية المعرفة في القالب لأي حقل غير مُرسَل من الواجهة.
     * يعمل على نسخة جديدة من الـ payload (عدم تعديل مدخلات المستدعي).
     * القيم الحية تُحل هنا لا في الواجهة: "today" → تاريخ اليوم بصيغة ISO،
     * و "{{tenant.base_currency}}" → عملة المنشأة الأساسية من سياق الاستدعاء.
     */
    applyFieldDefaults(template, payload, baseCurrencyCode) {
        const result = { ...payload };
        for (const field of template.fields) {
            if (result[field.key] !== undefined || field.default === undefined)
                continue;
            if (field.default === "today") {
                result[field.key] = new Date().toISOString().slice(0, 10); // YYYY-MM-DD بالتوقيت المحلي
            }
            else if (field.default === "{{tenant.base_currency}}") {
                result[field.key] = baseCurrencyCode;
            }
            else {
                result[field.key] = field.default;
            }
        }
        return result;
    }
    async execute(request) {
        const template = this.registry.resolve(request.templateCode);
        // إسقاط القيم الافتراضية للحقول غير المُرسَلة قبل التحقق —
        // حتى يعرف المحرك أن inventory_mode=false (وضع سريع) وأن المستلم الصندوق الرئيسي.
        const payload = this.applyFieldDefaults(template, request.payload, request.baseCurrencyCode);
        request = { ...request, payload };
        this.validator.validate(template, payload);
        // حارس الحافة: المبالغ المالية غير الرقمية/السالبة → 400 عربي واضح بدل انهيار داخلي 500
        assertAmountFieldsValid(template, payload);
        const computed = await this.computeDerivedValues(template, request);
        const context = { fields: request.payload, computed };
        const transactionId = (0, uuid_1.v4)();
        const entryDate = this.resolveEntryDate(request.payload);
        const primaryLines = await this.buildLines(template.journal_rules, context, request);
        const primaryEntry = await this.journalEngine.postEntry({
            tenantId: request.tenantId,
            entryDate,
            descriptionSimple: template.ui.description_ar,
            sourceType: CATEGORY_TO_SOURCE_TYPE[template.category],
            sourceTransactionId: transactionId,
            baseCurrencyCode: request.baseCurrencyCode,
            lines: primaryLines,
        });
        let secondaryEntry = null;
        if (template.secondary_journal_rules?.length) {
            const applicable = template.secondary_journal_rules.filter((rule) => !rule.condition || ExpressionEngine_1.ExpressionEngine.evaluateAsBoolean(rule.condition, context));
            if (applicable.length > 0) {
                const secondaryLines = await this.buildLines(applicable, context, request);
                secondaryEntry = await this.journalEngine.postEntry({
                    tenantId: request.tenantId,
                    entryDate,
                    descriptionSimple: `${template.ui.description_ar} - تكلفة`,
                    sourceType: CATEGORY_TO_SOURCE_TYPE[template.category],
                    sourceTransactionId: transactionId,
                    baseCurrencyCode: request.baseCurrencyCode,
                    lines: secondaryLines,
                });
            }
        }
        if (template.post_actions?.length) {
            const postActionContext = {
                tenantId: request.tenantId, transactionId, payload: request.payload,
            };
            for (const actionExpr of template.post_actions) {
                await this.postActionRegistry.execute(actionExpr, postActionContext);
            }
        }
        const simpleSummary = await this.buildSimpleSummary(primaryEntry, secondaryEntry);
        return { transactionId, primaryEntry, secondaryEntry, simpleSummary };
    }
    // ===================== بناء أسطر القيد =====================
    async buildLines(rules, context, request) {
        const lines = [];
        for (const rule of rules) {
            if (rule.repeat_for) {
                await this.buildRepeatedLines(rule, context, request, lines);
            }
            else {
                await this.buildSingleRuleLine(rule, context, request, lines);
            }
        }
        return lines;
    }
    async buildSingleRuleLine(rule, context, request, outputLines) {
        if (rule.condition && !ExpressionEngine_1.ExpressionEngine.evaluateAsBoolean(rule.condition, context))
            return;
        const amount = rule.amount_formula.trim() === "plug_balance()"
            ? this.computePlugAmount(outputLines, request.baseCurrencyCode)
            : ExpressionEngine_1.ExpressionEngine.evaluateAsDecimal(rule.amount_formula, context);
        if (amount.lessThanOrEqualTo(0))
            return;
        outputLines.push(await this.buildPostLineRequest(rule, amount, context, request));
    }
    async buildRepeatedLines(rule, context, request, outputLines) {
        const arrayValue = context.fields[rule.repeat_for];
        if (!Array.isArray(arrayValue)) {
            throw new Error(`الحقل "${rule.repeat_for}" المستخدم في repeat_for ليس قائمة`);
        }
        const generatedAmounts = [];
        for (let index = 0; index < arrayValue.length; index++) {
            const loopContext = { ...context, loopIndex: index };
            if (rule.condition && !ExpressionEngine_1.ExpressionEngine.evaluateAsBoolean(rule.condition, loopContext)) {
                generatedAmounts.push(new decimal_js_1.default(0));
                continue;
            }
            const isLastItem = index === arrayValue.length - 1;
            let amount;
            // === قاعدة التقريب الإلزامية (مُختبَرة سابقًا بـ Fuzz Test) ===
            if (isLastItem && rule.rounding_anchor_field) {
                const anchorTotal = ExpressionEngine_1.ExpressionEngine.evaluateAsDecimal(rule.rounding_anchor_field, loopContext);
                // المبلغ النهائي = المرساة مطروحًا عنها مجموع الأسطر السابقة بعد التقريب الفعلي
                // إلى دقة التخزين — وهي نفس القيم التي ستُخزَّن وتُجمع لاحقًا في assertBalanced.
                // هذا يضمن توازن القيد تمامًا حتى مع نسب كسرية غير تمثيلية ثنائيًا (IEEE-754).
                const sumSoFarRounded = generatedAmounts.reduce((acc, v) => acc.plus(this.clampToStorage(v)), new decimal_js_1.default(0));
                amount = this.clampToStorage(anchorTotal).minus(sumSoFarRounded);
            }
            else {
                amount = ExpressionEngine_1.ExpressionEngine.evaluateAsDecimal(rule.amount_formula, loopContext);
            }
            generatedAmounts.push(amount);
            // السطر الأخير المُقرَّر قد يصبح صفراً أو سالبًا بهوامش التقريب — لا يُضاف كسطر
            if (amount.greaterThan(0)) {
                outputLines.push(await this.buildPostLineRequest(rule, amount, loopContext, request));
            }
        }
    }
    /** يقرّب مبلغًا إلى دقة التخزين المعتمدة (نفس دقة toStorageString في Money) */
    clampToStorage(amount) {
        return new decimal_js_1.default(amount.toFixed(Money_1.Money.STORAGE_DECIMALS, decimal_js_1.default.ROUND_HALF_UP));
    }
    async buildPostLineRequest(rule, amount, context, request) {
        const accountCode = ExpressionEngine_1.ExpressionEngine.evaluateAsString(rule.account_code_ref, context);
        const contactId = rule.contact_ref
            ? this.tryEvaluateOptionalString(rule.contact_ref, context)
            : undefined;
        const currencyCode = rule.currency_ref
            ? ExpressionEngine_1.ExpressionEngine.evaluateAsString(rule.currency_ref, context)
            : request.baseCurrencyCode;
        const memoAr = rule.memo_ar ? this.safeInterpolateMemo(rule.memo_ar, context) : undefined;
        const exchangeRateUsed = currencyCode === request.baseCurrencyCode
            ? "1"
            : await this.exchangeRateProvider.getRate(request.tenantId, currencyCode, request.baseCurrencyCode);
        return {
            accountCode,
            side: rule.side,
            amount: amount.toFixed(4),
            currencyCode,
            exchangeRateUsed,
            contactId,
            memoAr,
        };
    }
    /** الفرق المطلق بين إجمالي المدين والدائن للأسطر المبنية حتى الآن - أساس plug_balance() */
    computePlugAmount(existingLines, baseCurrency) {
        let debitTotal = new decimal_js_1.default(0);
        let creditTotal = new decimal_js_1.default(0);
        for (const line of existingLines) {
            // تبسيط: نفترض أن معظم أسطر الرصيد الافتتاحي بعملة الأساس مباشرة
            const amt = new decimal_js_1.default(line.amount).times(new decimal_js_1.default(line.exchangeRateUsed));
            if (line.side === "debit")
                debitTotal = debitTotal.plus(amt);
            else
                creditTotal = creditTotal.plus(amt);
        }
        void baseCurrency;
        return debitTotal.minus(creditTotal).abs();
    }
    tryEvaluateOptionalString(expr, context) {
        try {
            const value = ExpressionEngine_1.ExpressionEngine.evaluateRaw(expr, context);
            if (value === null || value === undefined)
                return undefined;
            return ExpressionEngine_1.ExpressionEngine.toStringValue(value);
        }
        catch {
            return undefined;
        }
    }
    safeInterpolateMemo(memoTemplate, context) {
        return memoTemplate.replace(/\{\{(.*?)\}\}/g, (_, expr) => {
            try {
                return ExpressionEngine_1.ExpressionEngine.toStringValue(ExpressionEngine_1.ExpressionEngine.evaluateRaw(`{{${expr}}}`, context));
            }
            catch {
                return "";
            }
        });
    }
    // ===================== القيم المحسوبة مسبقًا (Async Pre-computation) =====================
    async computeDerivedValues(template, request) {
        const computed = {};
        const needsCogs = this.templateReferencesFunction(template, "cogs_amount") ||
            this.templateReferencesFunction(template, "items_cost_sum");
        if (needsCogs) {
            const items = request.payload.items ?? [];
            if (items.length > 0 && request.warehouseId) {
                computed["cogs_amount"] = await this.inventoryPort.calculateCogs(request.tenantId, request.warehouseId, items);
            }
            else {
                computed["cogs_amount"] = new decimal_js_1.default(0);
            }
        }
        if (this.templateReferencesFunction(template, "total_or_items_sum")) {
            const inventoryMode = Boolean(request.payload.inventory_mode);
            if (inventoryMode) {
                const items = request.payload.items ?? [];
                computed["total_or_items_sum"] = items.reduce((acc, it) => acc.plus(new decimal_js_1.default(it.lineTotal ?? 0)), new decimal_js_1.default(0));
            }
            else {
                computed["total_or_items_sum"] = new decimal_js_1.default(String(request.payload.total_amount ?? 0));
            }
        }
        return computed;
    }
    templateReferencesFunction(template, fnName) {
        const allRules = [...template.journal_rules, ...(template.secondary_journal_rules ?? [])];
        return allRules.some((r) => r.amount_formula.includes(fnName));
    }
    resolveEntryDate(payload) {
        const raw = payload["transaction_date"] ?? payload["as_of_date"] ?? payload["start_date"];
        if (!raw)
            return new Date();
        const parsed = new Date(String(raw));
        // حارس الصرامة: منع Invalid time value الذي يفسد toISOString لاحقًا (خطأ 500 وهمي)
        if (Number.isNaN(parsed.getTime())) {
            throw new ApplicationErrors_1.InvalidDateError(String(raw));
        }
        return parsed;
    }
    async buildSimpleSummary(primary, secondary) {
        // فلسفة "لا مصطلحات محاسبية": ملخص بشرى مثل «الصندوق الرئيسي يزيد 15,000.00 YER · ...»
        // يعتمد على listByTenant (استعلام واحد لكل الحسابات — بدون N+1) بدل findById لكل سطر.
        const sentences = await this.describeEntryLines(primary);
        if (secondary)
            sentences.push(...(await this.describeEntryLines(secondary)));
        return sentences.join(" · ");
    }
    /** يحوّل أسطر القيد إلى جمل عربية مبسّطة عبر ربط accountId بالحساب ثم جلب الأسماء دفعة واحدة */
    async describeEntryLines(entry) {
        if (!this.accountRepo) {
            return [entry.descriptionSimple];
        }
        const allAccounts = await this.accountRepo.listByTenant(entry.tenantId);
        const byId = new Map(allAccounts.map((a) => [a.id, a]));
        const sentences = [];
        for (const line of entry.lines) {
            const account = byId.get(line.accountId);
            if (!account)
                continue;
            const verb = account.resolveDirectionEffect(line.side) === "increase" ? "يزيد" : "ينقص";
            sentences.push(`${account.nameArSimple} ${verb} ${line.amount.toDisplayString()}`);
        }
        return sentences.length > 0 ? sentences : [entry.descriptionSimple];
    }
}
exports.TemplateExecutionEngine = TemplateExecutionEngine;
//# sourceMappingURL=TemplateExecutionEngine.js.map