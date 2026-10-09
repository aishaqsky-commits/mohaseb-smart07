// src/templates/validation/TemplateValidator.ts

import Decimal from "decimal.js";
import { ExpressionEngine, ExpressionContext } from "../engine/ExpressionEngine";
import { TemplateDefinition, FieldDefinition } from "../types/TemplateDefinition";

/**
 * تسامح مقارنات النسب المئوية (بالـ point): عند توزيع مبلغ على أطراف بنسب عشرية،
 * قد يصل مجموع النسب إلى 100.000000000000002 بسبب تمثيل الأرقام العشرية في IEEE-754
 * قبل تحويلها إلى Decimal. التسامح 1e-6 يغطي هذه الهوامش دون إضعاف صحة التحقق.
 */
const PERCENTAGE_SUM_TOLERANCE = new Decimal("0.000001");
const PERCENTAGE_SUM_REGEX = /^\s*sum\(\s*[\w.\[\]]+\s*\.\s*percentage\s*\)\s*==\s*(\d+(?:\.\d+)?)\s*$/;

export class TemplateValidationError extends Error {
  constructor(public readonly fieldErrors: Array<{ key: string; message: string }>) {
    // رسالة مفصّلة قابلة للقراءة مباشرة على واجهة المستخدم (رسالة عربية لكل حقل)
    super(
      `فشل التحقق من ${fieldErrors.length} حقل/حقول: ${fieldErrors.map((e) => e.message).join(" | ")}`
    );
    this.name = "TemplateValidationError";
  }
}

export class TemplateValidator {
  validate(template: TemplateDefinition, payload: Record<string, unknown>): void {
    const errors: Array<{ key: string; message: string }> = [];
    const context = { fields: payload, computed: {} };

    for (const field of template.fields) {
      if (this.isHiddenByVisibility(field, context)) continue;

      const value = payload[field.key];
      const isEmpty = value === undefined || value === null || value === "";

      if (field.required && isEmpty) {
        errors.push({ key: field.key, message: `الحقل "${field.label_ar}" مطلوب` });
        continue;
      }

      if (!isEmpty && field.validation) {
        const isValid = this.isValid(field.validation, context);
        if (!isValid) {
          errors.push({ key: field.key, message: `قيمة الحقل "${field.label_ar}" غير صحيحة` });
        }
      }

      // حارس خيارات select الثابتة: قيمة خارج القائمة ⇒ قيد على حساب غير متوقع (سلامة مالية).
      // تُقبل الخيارات المعبّأة ديناميكيًا بـ options_source (مثل قائمة الفواتير المفتوحة) بلا فحص.
      if (!isEmpty && field.type === "select" && Array.isArray(field.options) && field.options.length > 0) {
        const allowed = field.options.map((o) =>
          typeof o === "string" ? o : (o as { value: string }).value
        );
        if (!allowed.includes(String(value))) {
          errors.push({
            key: field.key,
            message: `قيمة الحقل "${field.label_ar}" غير مسموحة — اختر واحدة من: ${allowed.join(", ")}`,
          });
        }
      }
    }

    if (errors.length > 0) {
      throw new TemplateValidationError(errors);
    }
  }

  /**
   * تنفيذ التحقق مع تسامح خاص لصيغ "sum(...percentage) == N" لتفادي هوامش IEEE-754
   * في مجموع النسب العشرية المولّدة من واجهة المستخدم.
   */
  private isValid(validation: string, context: ExpressionContext): boolean {
    const match = PERCENTAGE_SUM_REGEX.exec(validation);
    if (match) {
      try {
        const sum = ExpressionEngine.evaluateAsDecimal(validation.replace(/==.*$/, ""), context);
        return sum.minus(new Decimal(match[1] as string)).abs().lessThanOrEqualTo(PERCENTAGE_SUM_TOLERANCE);
      } catch {
        // إن تعذّر التقييم بالتسامح، نعود للمسار القياسي لإظهار الخطأ بشكل صحيح
      }
    }
    return ExpressionEngine.evaluateAsBoolean(validation, context);
  }

  private isHiddenByVisibility(
    field: FieldDefinition,
    context: { fields: Record<string, unknown>; computed: Record<string, never> }
  ): boolean {
    if (!field.visible_when) return false;
    return !ExpressionEngine.evaluateAsBoolean(field.visible_when, context);
  }
}
