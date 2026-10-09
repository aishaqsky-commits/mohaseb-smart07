"use strict";
// src/application/errors/ApplicationErrors.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidTemplatePayloadError = exports.TemplateNotFoundError = exports.MissingTenantContextError = exports.ApplicationError = void 0;
/** خطأ تطبيقي قابل للقراءة الآمنة (لعرض رسالة عربية واضحة للمستخدم النهائي) */
class ApplicationError extends Error {
    statusCode;
    errorCode;
    constructor(message, statusCode, errorCode) {
        super(message);
        this.statusCode = statusCode;
        this.errorCode = errorCode;
        this.name = new.target.name;
    }
}
exports.ApplicationError = ApplicationError;
class MissingTenantContextError extends ApplicationError {
    constructor() {
        super("سياق المنشأة (Tenant) مفقود — يجب إرفاق هوية المنشأة مع الطلب", 401, "MISSING_TENANT_CONTEXT");
    }
}
exports.MissingTenantContextError = MissingTenantContextError;
class TemplateNotFoundError extends ApplicationError {
    constructor(templateKey) {
        super(`لم يتم العثور على قالب العملية: "${templateKey}"`, 404, "TEMPLATE_NOT_FOUND");
    }
}
exports.TemplateNotFoundError = TemplateNotFoundError;
class InvalidTemplatePayloadError extends ApplicationError {
    constructor(details) {
        super(`بيانات العملية غير مكتملة أو غير صالحة: ${details}`, 422, "INVALID_TEMPLATE_PAYLOAD");
    }
}
exports.InvalidTemplatePayloadError = InvalidTemplatePayloadError;
//# sourceMappingURL=ApplicationErrors.js.map