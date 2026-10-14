// src/common/feature-flags.ts
// ===== أعلام الميزات — بوابة التدرّج الآمن لتفعيل تعدد المستأجرين =====
// مبدأ النشر (docs/02-architecture): لا يُفعَّل عزل الحاويات لكل منشأة إلا صراحةً؛
// افتراضيًا يبقى وضع MVP أحادي المنشأة (الحاوية الافتراضية من DI) حتى في وجود توكن.
// هذا يجعل تفعيل المرحلة آمنًا على بيئة قائمة ويُبقي اختبارات e2e القديمة خضراء.

/** هل حاويات المنشآت (TenantContainerResolver) مفعّلة لهذا التشغيل؟ */
export function multiTenancyEnabled(): boolean {
  return process.env.MULTI_TENANCY === '1' || process.env.MULTI_TENANCY === 'true';
}
