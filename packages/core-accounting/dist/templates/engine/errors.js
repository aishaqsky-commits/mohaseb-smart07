"use strict";
// src/templates/engine/errors.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnknownFunctionError = exports.ExpressionEvaluationError = exports.ExpressionSyntaxError = void 0;
class ExpressionSyntaxError extends Error {
    constructor(message, position) {
        super(`خطأ في تحليل الصيغة عند الموضع ${position}: ${message}`);
        this.name = "ExpressionSyntaxError";
    }
}
exports.ExpressionSyntaxError = ExpressionSyntaxError;
class ExpressionEvaluationError extends Error {
    constructor(message) {
        super(message);
        this.name = "ExpressionEvaluationError";
    }
}
exports.ExpressionEvaluationError = ExpressionEvaluationError;
class UnknownFunctionError extends ExpressionEvaluationError {
    constructor(name) {
        super(`الدالة "${name}" غير معروفة أو غير مسموح باستخدامها`);
        this.name = "UnknownFunctionError";
    }
}
exports.UnknownFunctionError = UnknownFunctionError;
//# sourceMappingURL=errors.js.map