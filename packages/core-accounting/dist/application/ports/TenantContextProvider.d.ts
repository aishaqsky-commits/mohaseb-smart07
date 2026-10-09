/**
 * منفذ (Port) توفير سياق المستأجر النشط لكل طلب.
 * في وضع Local-First: يُقرأ من قاعدة SQLite المحلية المشفرة (Tenant الوحيد على الجهاز).
 * في وضع الخادم السحابي: يُستخرج من رمز JWT بعد التحقق من التوقيع والصلاحيات.
 * هذا الفصل يسمح باختبار طبقة التطبيق بالكامل دون أي اعتماد على وسيلة المصادقة.
 */
export interface TenantContext {
    readonly tenantId: string;
    readonly baseCurrencyCode: string;
}
export interface TenantContextProvider {
    /** يجب أن يرمي خطأ صريحًا إذا غاب سياق المستأجر — لا قيم افتراضية أبدًا */
    getCurrentContext(): Promise<TenantContext>;
}
export declare const TENANT_CONTEXT_PROVIDER: "TENANT_CONTEXT_PROVIDER";
