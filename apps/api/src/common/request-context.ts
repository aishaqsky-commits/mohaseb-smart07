// src/common/request-context.ts
// ===== جسر قراءة سياق الطلب: حاوية المنشأة من المعالجات =====
// مبدأ معماري (docs/02-architecture/api-specifications.md): الحاوية الصحيحة تُختار
// من سياق الطلب (الـ middleware حقنها بعد التحقق من JWT) — لا من DI الثابت.
// التراجع الآمن للحاوية الافتراضية يبقي سلوك MVP أحادي المنشأة قائمًا في المسارات
// العامة والاختبارات القديمة بدون أي كسر.

import type { Request } from 'express';
import type { CoreContainer } from '@platform/core-accounting';

/** الحقل الذي يحقنه TenantContextMiddleware بعد جلب حاوية المنشأة */
declare module 'express-serve-static-core' {
  interface Request {
    coreContainer?: CoreContainer;
    /** هوية المنشأة المستخرجة حصريًا من claim `tid` الموقّع */
    tenantId?: string;
  }
}

/**
 * إعادة نوع express المحلي بدون الاعتماد على @types/express في كل معالج:
 * أي كائن طلب يحمل coreContainer اختياريًا.
 */
export interface ContainerAwareRequest {
  coreContainer?: CoreContainer;
  tenantId?: string;
}

/**
 * حاوية هذا الطلب: req.coreContainer إن حقنها الـ middleware، وإلا الحاوية
 * الافتراضية من DI (وضع MVP أحادي المنشأة / مسارات عامة).
 */
export function containerFromRequest(
  req: ContainerAwareRequest,
  fallback: CoreContainer,
): CoreContainer {
  return req.coreContainer ?? fallback;
}

/** هوية المنشأة لهذا الطلب (قد تكون undefined في المسارات العامة غير الموثّقة) */
export function tenantIdFromRequest(req: ContainerAwareRequest): string | undefined {
  return req.tenantId;
}
