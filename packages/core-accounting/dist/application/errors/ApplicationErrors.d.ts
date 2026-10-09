/** خطأ تطبيقي قابل للقراءة الآمنة (لعرض رسالة عربية واضحة للمستخدم النهائي) */
export declare class ApplicationError extends Error {
    readonly statusCode: number;
    readonly errorCode: string;
    constructor(message: string, statusCode: number, errorCode: string);
}
export declare class MissingTenantContextError extends ApplicationError {
    constructor();
}
export declare class TemplateNotFoundError extends ApplicationError {
    constructor(templateKey: string);
}
export declare class InvalidTemplatePayloadError extends ApplicationError {
    constructor(details: string);
}
