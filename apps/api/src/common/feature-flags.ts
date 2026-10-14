// src/common/feature-flags.ts
// ===== أعلام الميزات — بوابة التدرّج الآمن لتفعيل تعدد المستأجرين =====
// مبدأ النشر (docs/02-architecture): لا يُفعَّل عزل الحاويات لكل منشأة إلا صراحةً؛
// افتراضيًا يبقى وضع MVP أحادي المنشأة (الحاوية الافتراضية من DI) حتى في وجود توكن.
// هذا يجعل تفعيل المرحلة آمنًا على بيئة قائمة ويُبقي اختبارات e2e القديمة خضراء.

/** هل حاويات المنشآت (TenantContainerResolver) مفعّلة لهذا التشغيل؟ */
export function multiTenancyEnabled(): boolean {
  return isTruthyEnv(process.env.MULTI_TENANCY);
}

/**
 * هل فرض المصادقة على مسارات البيانات (/transactions و/accounts) إلزامي؟
 * القرار المعماري (البند #3 في خطة المرحلة 1): الحماية الصارمة تُفرض عند تشغيل
 * تعدد المستأجرين أو صراحةً عبر AUTH_ENFORCE=1 — بينما وضع MVP التطويري يبقى
 * مفتوحًا للحاوية الافتراضية حتى لا تنكسر suite الاختبارات القديمة دفعة واحدة.
 * في الإنتاج: JwtAuthGuard يُستخدم مباشرة بدل OptionalJwtAuthGuard (الحارس نفسه
 * صارم تحت MULTI_TENANCY كما هو موثّق هناك).
 */
export function authEnforceEnabled(): boolean {
  return isTruthyEnv(process.env.AUTH_ENFORCE) || multiTenancyEnabled();
}

function isTruthyEnv(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}
