// src/application/errors/ApplicationErrors.ts

/** خطأ تطبيقي قابل للقراءة الآمنة (لعرض رسالة عربية واضحة للمستخدم النهائي) */
export class ApplicationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly errorCode: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class MissingTenantContextError extends ApplicationError {
  constructor() {
    super(
      "سياق المنشأة (Tenant) مفقود — يجب إرفاق هوية المنشأة مع الطلب",
      401,
      "MISSING_TENANT_CONTEXT"
    );
  }
}

export class TemplateNotFoundError extends ApplicationError {
  constructor(templateKey: string) {
    super(`لم يتم العثور على قالب العملية: "${templateKey}"`, 404, "TEMPLATE_NOT_FOUND");
  }
}

export class InvalidTemplatePayloadError extends ApplicationError {
  constructor(details: string) {
    super(`بيانات العملية غير مكتملة أو غير صالحة: ${details}`, 422, "INVALID_TEMPLATE_PAYLOAD");
  }
}
