// src/templates/TemplateExecutionEngine.ts

import Decimal from "decimal.js";
import { v4 as uuidv4 } from "uuid";
import { JournalEngine } from "../application/JournalEngine";
import { JournalEntry } from "../domain/entities/JournalEntry";
import { Money } from "../domain/value-objects/Money";
import { TemplateDefinition, JournalLineRule, TemplateCategory } from "./types/TemplateDefinition";
import { ExpressionEngine, ExpressionContext } from "./engine/ExpressionEngine";
import { TemplateValidator } from "./validation/TemplateValidator";
import { TemplateRegistry } from "./registry/TemplateRegistry";
import { InventoryCostingPort } from "./ports/InventoryCostingPort";
import { ExchangeRateProviderPort } from "./ports/ExchangeRateProviderPort";
import { PostActionRegistry, PostActionContext } from "./ports/PostActionPort";
import { PostLineRequest } from "../application/JournalEngine";
import { AccountRepository } from "../domain/ports/AccountRepository";
import { InvalidDateError, InvalidTemplatePayloadError } from "../application/errors/ApplicationErrors";

export interface ExecuteTemplateRequest {
  templateCode: string;
  tenantId: string;
  baseCurrencyCode: string;
  warehouseId?: string;
  payload: Record<string, unknown>;
  /** معرّف العملية — يُمرَّر لمنفذ المخزون لربط الحركات بالمعاملة (يولّده المحرك إن غاب) */
  transactionId?: string | undefined;
}

/** حارس الحافة لمدخلات الحقول المالية (نوع amount):
 * يرفض القيم غير الرقمية أو السالبة برسالة عربية واضحة تحمل اسم الحقل المعروض،
 * قبل أن تصل للنواة وتُرمي استثناءات داخلية تُترجم خطأً إلى HTTP 500. */
function assertAmountFieldsValid(
  template: TemplateDefinition,
  payload: Record<string, unknown>
): void {
  for (const field of template.fields) {
    if (field.type !== "amount") continue;
    const raw = payload[field.key];
    if (raw === undefined || raw === null || raw === "") continue; // مطلوب/فارغ يعالجه TemplateValidator

    // Decimal يرمي استثناءً على النصوص غير الرقمية ("abc") — نحوّله لرسالة تحقق عربية واضحة (400 لا 500)
    let numericValue: Decimal;
    try {
      numericValue = new Decimal(String(raw).replace(/,/g, ""));
    } catch {
      throw new InvalidTemplatePayloadError(
        `قيمة الحقل "${field.label_ar}" غير صالحة — يجب أن تكون رقمًا`
      );
    }
    if (!numericValue.isFinite() || numericValue.isNegative()) {
      throw new InvalidTemplatePayloadError(
        `قيمة الحقل "${field.label_ar}" غير صالحة — يجب أن تكون رقمًا موجبًا`
      );
    }
  }
}

export interface ExecuteTemplateResult {
  transactionId: string;
  primaryEntry: JournalEntry;
  secondaryEntry: JournalEntry | null;
  simpleSummary: string;
}

const CATEGORY_TO_SOURCE_TYPE: Record<TemplateCategory, JournalEntry["sourceType"]> = {
  purchases: "purchase", sales: "sale", returns: "return", settlements: "settlement",
  damage: "damage", opening_balance: "opening_balance", expenses: "expense",
  owner: "owner", services: "sale",
};

/**
 * نقطة الدخول الوحيدة لتنفيذ أي قالب في كامل التطبيق.
 * تُترجم تعريف JSON الوصفي إلى استدعاء فعلي لـ JournalEngine، مع ضمان التوازن
 * عبر "قاعدة التقريب الإلزامية" (آخر سطر = الباقي الدقيق) في كل توزيع.
 */
export class TemplateExecutionEngine {
  /** مستودع الحسابات — اختياري حقنًا للتوافق؛ يلزم لعرض أسماء الحسابات في الملخص المبسّط */
  private accountRepo?: AccountRepository | undefined;

  constructor(
    private readonly registry: TemplateRegistry,
    private readonly journalEngine: JournalEngine,
    private readonly inventoryPort: InventoryCostingPort,
    private readonly exchangeRateProvider: ExchangeRateProviderPort,
    private readonly postActionRegistry: PostActionRegistry,
    private readonly validator: TemplateValidator = new TemplateValidator(),
    accountRepo?: AccountRepository | undefined
  ) {
    this.accountRepo = accountRepo;
  }

  /** ربط مستودع الحسابات بعد الإنشاء (يُستخدم من مركّب الاعتماديات لتفادي توسيع توقيع المُنشئ) */
  setAccountRepository(accountRepo: AccountRepository): void {
    this.accountRepo = accountRepo;
  }

  /**
   * إسقاط القيم الافتراضية المعرفة في القالب لأي حقل غير مُرسَل من الواجهة.
   * يعمل على نسخة جديدة من الـ payload (عدم تعديل مدخلات المستدعي).
   * القيم الحية تُحل هنا لا في الواجهة: "today" → تاريخ اليوم بصيغة ISO،
   * و "{{tenant.base_currency}}" → عملة المنشأة الأساسية من سياق الاستدعاء.
   */
  private applyFieldDefaults(
    template: TemplateDefinition,
    payload: Record<string, unknown>,
    baseCurrencyCode: string
  ): Record<string, unknown> {
    const result = { ...payload };
    for (const field of template.fields) {
      if (result[field.key] !== undefined || field.default === undefined) continue;
      if (field.default === "today") {
        result[field.key] = new Date().toISOString().slice(0, 10); // YYYY-MM-DD بالتوقيت المحلي
      } else if (field.default === "{{tenant.base_currency}}") {
        result[field.key] = baseCurrencyCode;
      } else {
        result[field.key] = field.default;
      }
    }
    return result;
  }

  async execute(request: ExecuteTemplateRequest): Promise<ExecuteTemplateResult> {
    const template = this.registry.resolve(request.templateCode);

    // معرّف العملية يُولَّد مبكرًا — تُربط به حركات المخزون (source_reference) والقيود
    // (source_transactionId) معًا، فلا ينفصل الأثر المخزني عن المحاسبي (القسم 0.2 من التصميم).
    request = { ...request, transactionId: request.transactionId ?? uuidv4() };

    // إسقاط القيم الافتراضية للحقول غير المُرسَلة قبل التحقق —
    // حتى يعرف المحرك أن inventory_mode=false (وضع سريع) وأن المستلم الصندوق الرئيسي.
    const payload = this.applyFieldDefaults(
      template,
      request.payload,
      request.baseCurrencyCode
    );
    request = { ...request, payload };

    this.validator.validate(template, payload);
    // حارس الحافة: المبالغ المالية غير الرقمية/السالبة → 400 عربي واضح بدل انهيار داخلي 500
    assertAmountFieldsValid(template, payload);

    const computed = await this.computeDerivedValues(template, request);
    const context: ExpressionContext = { fields: request.payload, computed };

    // مضمون التوليد أعلاه — تكرار الضمان يضيّق النوع لـ string تحت strict/exactOptionalPropertyTypes
    const transactionId: string = request.transactionId ?? uuidv4();
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

    let secondaryEntry: JournalEntry | null = null;
    if (template.secondary_journal_rules?.length) {
      const applicable = template.secondary_journal_rules.filter(
        (rule) => !rule.condition || ExpressionEngine.evaluateAsBoolean(rule.condition, context)
      );
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
      const postActionContext: PostActionContext = {
        tenantId: request.tenantId, transactionId, payload: request.payload,
        // تمرير القيد الرئيسي وعملة الأساس: معالجات الذمم الفرعية (createOpenItem/allocatePayment)
        // تحتاج أسطر القيد الفعلية لا الـ payload وحده — وإلا تُنشأ بنود مفتوحة بمبالغ صفرية.
        primaryEntry, baseCurrencyCode: request.baseCurrencyCode,
      };
      for (const actionExpr of template.post_actions) {
        await this.postActionRegistry.execute(actionExpr, postActionContext);
      }
    }

    const simpleSummary = await this.buildSimpleSummary(primaryEntry, secondaryEntry);

    return { transactionId, primaryEntry, secondaryEntry, simpleSummary };
  }

  // ===================== بناء أسطر القيد =====================

  private async buildLines(
    rules: JournalLineRule[],
    context: ExpressionContext,
    request: ExecuteTemplateRequest
  ): Promise<PostLineRequest[]> {
    const lines: PostLineRequest[] = [];

    for (const rule of rules) {
      if (rule.repeat_for) {
        await this.buildRepeatedLines(rule, context, request, lines);
      } else {
        await this.buildSingleRuleLine(rule, context, request, lines);
      }
    }

    return lines;
  }

  private async buildSingleRuleLine(
    rule: JournalLineRule,
    context: ExpressionContext,
    request: ExecuteTemplateRequest,
    outputLines: PostLineRequest[]
  ): Promise<void> {
    if (rule.condition && !ExpressionEngine.evaluateAsBoolean(rule.condition, context)) return;

    const amount =
      rule.amount_formula.trim() === "plug_balance()"
        ? this.computePlugAmount(outputLines, request.baseCurrencyCode)
        : ExpressionEngine.evaluateAsDecimal(rule.amount_formula, context);

    if (amount.lessThanOrEqualTo(0)) return;

    outputLines.push(await this.buildPostLineRequest(rule, amount, context, request));
  }

  private async buildRepeatedLines(
    rule: JournalLineRule,
    context: ExpressionContext,
    request: ExecuteTemplateRequest,
    outputLines: PostLineRequest[]
  ): Promise<void> {
    const arrayValue = context.fields[rule.repeat_for!];
    if (!Array.isArray(arrayValue)) {
      throw new Error(`الحقل "${rule.repeat_for}" المستخدم في repeat_for ليس قائمة`);
    }

    const generatedAmounts: Decimal[] = [];

    for (let index = 0; index < arrayValue.length; index++) {
      const loopContext: ExpressionContext = { ...context, loopIndex: index };

      if (rule.condition && !ExpressionEngine.evaluateAsBoolean(rule.condition, loopContext)) {
        generatedAmounts.push(new Decimal(0));
        continue;
      }

      const isLastItem = index === arrayValue.length - 1;
      let amount: Decimal;

      // === قاعدة التقريب الإلزامية (مُختبَرة سابقًا بـ Fuzz Test) ===
      if (isLastItem && rule.rounding_anchor_field) {
        const anchorTotal = ExpressionEngine.evaluateAsDecimal(rule.rounding_anchor_field, loopContext);
        // المبلغ النهائي = المرساة مطروحًا عنها مجموع الأسطر السابقة بعد التقريب الفعلي
        // إلى دقة التخزين — وهي نفس القيم التي ستُخزَّن وتُجمع لاحقًا في assertBalanced.
        // هذا يضمن توازن القيد تمامًا حتى مع نسب كسرية غير تمثيلية ثنائيًا (IEEE-754).
        const sumSoFarRounded = generatedAmounts.reduce(
          (acc, v) => acc.plus(this.clampToStorage(v)),
          new Decimal(0)
        );
        amount = this.clampToStorage(anchorTotal).minus(sumSoFarRounded);
      } else {
        amount = ExpressionEngine.evaluateAsDecimal(rule.amount_formula, loopContext);
      }

      generatedAmounts.push(amount);

      // السطر الأخير المُقرَّر قد يصبح صفراً أو سالبًا بهوامش التقريب — لا يُضاف كسطر
      if (amount.greaterThan(0)) {
        outputLines.push(await this.buildPostLineRequest(rule, amount, loopContext, request));
      }
    }
  }

  /** يقرّب مبلغًا إلى دقة التخزين المعتمدة (نفس دقة toStorageString في Money) */
  private clampToStorage(amount: Decimal): Decimal {
    return new Decimal(amount.toFixed(Money.STORAGE_DECIMALS, Decimal.ROUND_HALF_UP));
  }

  private async buildPostLineRequest(
    rule: JournalLineRule,
    amount: Decimal,
    context: ExpressionContext,
    request: ExecuteTemplateRequest
  ): Promise<PostLineRequest> {
    const accountCode = ExpressionEngine.evaluateAsString(rule.account_code_ref, context);
    const contactId = rule.contact_ref
      ? this.tryEvaluateOptionalString(rule.contact_ref, context)
      : undefined;
    const currencyCode = rule.currency_ref
      ? ExpressionEngine.evaluateAsString(rule.currency_ref, context)
      : request.baseCurrencyCode;
    const memoAr = rule.memo_ar ? this.safeInterpolateMemo(rule.memo_ar, context) : undefined;

    const exchangeRateUsed =
      currencyCode === request.baseCurrencyCode
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
  private computePlugAmount(existingLines: PostLineRequest[], baseCurrency: string): Decimal {
    let debitTotal = new Decimal(0);
    let creditTotal = new Decimal(0);

    for (const line of existingLines) {
      // تبسيط: نفترض أن معظم أسطر الرصيد الافتتاحي بعملة الأساس مباشرة
      const amt = new Decimal(line.amount).times(new Decimal(line.exchangeRateUsed));
      if (line.side === "debit") debitTotal = debitTotal.plus(amt);
      else creditTotal = creditTotal.plus(amt);
    }
    void baseCurrency;
    return debitTotal.minus(creditTotal).abs();
  }

  private tryEvaluateOptionalString(expr: string, context: ExpressionContext): string | undefined {
    try {
      const value = ExpressionEngine.evaluateRaw(expr, context);
      if (value === null || value === undefined) return undefined;
      return ExpressionEngine.toStringValue(value);
    } catch {
      return undefined;
    }
  }

  private safeInterpolateMemo(memoTemplate: string, context: ExpressionContext): string {
    return memoTemplate.replace(/\{\{(.*?)\}\}/g, (_, expr) => {
      try {
        return ExpressionEngine.toStringValue(ExpressionEngine.evaluateRaw(`{{${expr}}}`, context));
      } catch {
        return "";
      }
    });
  }

  // ===================== القيم المحسوبة مسبقًا (Async Pre-computation) =====================

  private async computeDerivedValues(
    template: TemplateDefinition,
    request: ExecuteTemplateRequest
  ): Promise<Record<string, Decimal>> {
    const computed: Record<string, Decimal> = {};
    const needsCogs = this.templateReferencesFunction(template, "cogs_amount") ||
                       this.templateReferencesFunction(template, "items_cost_sum");

    if (needsCogs) {
      const items = (request.payload.items as Array<{ item_id: string; qty: number }>) ?? [];
      if (items.length > 0 && request.warehouseId) {
        computed["cogs_amount"] = await this.inventoryPort.calculateCogs(
          request.tenantId, request.warehouseId, items,
          { transactionId: request.transactionId ?? "", payload: request.payload }
        );
      } else {
        computed["cogs_amount"] = new Decimal(0);
      }
    }

    if (this.templateReferencesFunction(template, "total_or_items_sum")) {
      const inventoryMode = Boolean(request.payload.inventory_mode);
      if (inventoryMode) {
        const items = (request.payload.items as Array<{ lineTotal: string }>) ?? [];
        computed["total_or_items_sum"] = items.reduce(
          (acc, it) => acc.plus(new Decimal(it.lineTotal ?? 0)),
          new Decimal(0)
        );
      } else {
        computed["total_or_items_sum"] = new Decimal(String(request.payload.total_amount ?? 0));
      }
    }

    return computed;
  }

  private templateReferencesFunction(template: TemplateDefinition, fnName: string): boolean {
    const allRules = [...template.journal_rules, ...(template.secondary_journal_rules ?? [])];
    return allRules.some((r) => r.amount_formula.includes(fnName));
  }

  private resolveEntryDate(payload: Record<string, unknown>): Date {
    const raw = payload["transaction_date"] ?? payload["as_of_date"] ?? payload["start_date"];
    if (!raw) return new Date();
    const parsed = new Date(String(raw));
    // حارس الصرامة: منع Invalid time value الذي يفسد toISOString لاحقًا (خطأ 500 وهمي)
    if (Number.isNaN(parsed.getTime())) {
      throw new InvalidDateError(String(raw));
    }
    return parsed;
  }

  private async buildSimpleSummary(
    primary: JournalEntry,
    secondary: JournalEntry | null
  ): Promise<string> {
    // فلسفة "لا مصطلحات محاسبية": ملخص بشرى مثل «الصندوق الرئيسي يزيد 15,000.00 YER · ...»
    // يعتمد على listByTenant (استعلام واحد لكل الحسابات — بدون N+1) بدل findById لكل سطر.
    const sentences = await this.describeEntryLines(primary);
    if (secondary) sentences.push(...(await this.describeEntryLines(secondary)));
    return sentences.join(" · ");
  }

  /** يحوّل أسطر القيد إلى جمل عربية مبسّطة عبر ربط accountId بالحساب ثم جلب الأسماء دفعة واحدة */
  private async describeEntryLines(entry: JournalEntry): Promise<string[]> {
    if (!this.accountRepo) {
      return [entry.descriptionSimple];
    }
    const allAccounts = await this.accountRepo.listByTenant(entry.tenantId);
    const byId = new Map(allAccounts.map((a) => [a.id, a]));

    const sentences: string[] = [];
    for (const line of entry.lines) {
      const account = byId.get(line.accountId);
      if (!account) continue;
      const verb = account.resolveDirectionEffect(line.side) === "increase" ? "يزيد" : "ينقص";
      sentences.push(`${account.nameArSimple} ${verb} ${line.amount.toDisplayString()}`);
    }
    return sentences.length > 0 ? sentences : [entry.descriptionSimple];
  }
}
