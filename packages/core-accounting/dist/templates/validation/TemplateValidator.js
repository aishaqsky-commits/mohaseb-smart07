"use strict";
// src/templates/validation/TemplateValidator.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplateValidator = exports.TemplateValidationError = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
const ExpressionEngine_1 = require("../engine/ExpressionEngine");
/**
 * تسامح مقارنات النسب المئوية (بالـ point): عند توزيع مبلغ على أطراف بنسب عشرية،
 * قد يصل مجموع النسب إلى 100.000000000000002 بسبب تمثيل الأرقام العشرية في IEEE-754
 * قبل تحويلها إلى Decimal. التسامح 1e-6 يغطي هذه الهوامش دون إضعاف صحة التحقق.
 */
const PERCENTAGE_SUM_TOLERANCE = new decimal_js_1.default("0.000001");
const PERCENTAGE_SUM_REGEX = /^\s*sum\(\s*[\w.\[\]]+\s*\.\s*percentage\s*\)\s*==\s*(\d+(?:\.\d+)?)\s*$/;
class TemplateValidationError extends Error {
    fieldErrors;
    constructor(fieldErrors) {
        // رسالة مفصّلة قابلة للقراءة مباشرة على واجهة المستخدم (رسالة عربية لكل حقل)
        super(`فشل التحقق من ${fieldErrors.length} حقل/حقول: ${fieldErrors.map((e) => e.message).join(" | ")}`);
        this.fieldErrors = fieldErrors;
        this.name = "TemplateValidationError";
    }
}
exports.TemplateValidationError = TemplateValidationError;
class TemplateValidator {
    validate(template, payload) {
        const errors = [];
        const context = { fields: payload, computed: {} };
        for (const field of template.fields) {
            if (this.isHiddenByVisibility(field, context))
                continue;
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
        }
        if (errors.length > 0) {
            throw new TemplateValidationError(errors);
        }
    }
    /**
     * تنفيذ التحقق مع تسامح خاص لصيغ "sum(...percentage) == N" لتفادي هوامش IEEE-754
     * في مجموع النسب العشرية المولّدة من واجهة المستخدم.
     */
    isValid(validation, context) {
        const match = PERCENTAGE_SUM_REGEX.exec(validation);
        if (match) {
            try {
                const sum = ExpressionEngine_1.ExpressionEngine.evaluateAsDecimal(validation.replace(/==.*$/, ""), context);
                return sum.minus(new decimal_js_1.default(match[1])).abs().lessThanOrEqualTo(PERCENTAGE_SUM_TOLERANCE);
            }
            catch {
                // إن تعذّر التقييم بالتسامح، نعود للمسار القياسي لإظهار الخطأ بشكل صحيح
            }
        }
        return ExpressionEngine_1.ExpressionEngine.evaluateAsBoolean(validation, context);
    }
    isHiddenByVisibility(field, context) {
        if (!field.visible_when)
            return false;
        return !ExpressionEngine_1.ExpressionEngine.evaluateAsBoolean(field.visible_when, context);
    }
}
exports.TemplateValidator = TemplateValidator;
//# sourceMappingURL=TemplateValidator.js.map