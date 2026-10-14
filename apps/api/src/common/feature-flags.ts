// src/common/feature-flags.ts
// ===== أعلام الميزات — بوابة التدرّج الآمن لتفعيل تعدد المستأجرين =====
// مبدأ النشر (docs/02-architecture): لا يُفعَّل عزل الحاويات لكل منشأة إلا صراحةً؛
// افتراضيًا يبقى وضع MVP أحادي المنشأة (الحاوية الافتراضية من DI) حتى في وجود توكن.
// هذا يجعل تفعيل المرحلة آمنًا على بيئة قائمة ويُبقي اختبارات e2e القديمة خضراء.

/** هل حاويات المنشآت (TenantContainerResolver) مفعّلة لهذا التشغيل؟ */
export function multiTenancyEnabled(): boolean {
  return process.env.MULTI_TENANCY === '1' || process.env.MULTI_TENANCY === 'true';
}

/**
 * هل فرض JWT إلزامي على مسارات العمليات/الحسابات (البند #3 في خطة المرحلة 1)؟
 * يتفعّل صراحةً بإحدى طريقتين:
 * - AUTH_ENFORCE=1|true → فرض حماية حتى مع بقاء عزل الحاويات أحادي الوضع (MVP).
 * - MULTI_TENANCY مفعّل → الفرض لازم ضمنيًا (لا معنى لسياق منشأة بلا هوية موثّقة).
 * افتراضيًا (بدون الأعلام) يبقى وضع MVP الاختياري كما هو — لا كسر لسلوك قائم.
 */
export function authEnforceEnabled(): boolean {
  if (process.env.AUTH_ENFORCE === '1' || process.env.AUTH_ENFORCE === 'true') return true;
  return multiTenancyEnabled();
}
