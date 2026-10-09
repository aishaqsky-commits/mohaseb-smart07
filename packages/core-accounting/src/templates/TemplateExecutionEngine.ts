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

export interface ExecuteTemplateRequest {
  templateCode: string;
  tenantId: string;
  baseCurrencyCode: string;
  warehouseId?: string;
  payload: Record<string, unknown>;
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
  constructor(
    private readonly registry: TemplateRegistry,
    private readonly journalEngine: JournalEngine,
    private readonly inventoryPort: InventoryCostingPort,
    private readonly exchangeRateProvider: ExchangeRateProviderPort,
    private readonly postActionRegistry: PostActionRegistry,
    private readonly validator: TemplateValidator = new TemplateValidator()
  ) {}

  async execute(request: ExecuteTemplateRequest): Promise<ExecuteTemplateResult> {
    const template = this.registry.resolve(request.templateCode);

    this.validator.validate(template, request.payload);

    const computed = await this.computeDerivedValues(template, request);
    const context: ExpressionContext = { fields: request.payload, computed };

    const transactionId = uuidv4();
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
          request.tenantId, request.warehouseId, items
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
    return raw ? new Date(String(raw)) : new Date();
  }

  private async buildSimpleSummary(
    primary: JournalEntry,
    secondary: JournalEntry | null
  ): Promise<string> {
    // renderSimpleSummary المصمَّمة في JournalEngine سابقًا تحتاج accountRepo خارجيًا؛
    // هنا نعيد وصفًا مختصرًا يعتمد على بيانات القيد المتاحة مباشرة لتفادي استدعاء إضافي.
    const parts = [primary.descriptionSimple];
    if (secondary) parts.push(secondary.descriptionSimple);
    return parts.join(" + ");
  }
}
