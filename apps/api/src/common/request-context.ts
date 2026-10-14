// src/common/request-context.ts
// ===== جسر قراءة سياق الطلب: حاوية المنشأة من المعالجات =====
// مبدأ معماري (docs/02-architecture/api-specifications.md): الحاوية الصحيحة تُختار
// من سياق الطلب (الـ middleware حقنها بعد التحقق من JWT) — لا من DI الثابت.
// التراجع الآمن للحاوية الافتراضية يبقي سلوك MVP أحادي المنشأة قائمًا في المسارات
// العامة والاختبارات القديمة بدون أي كسر.

import type { Request } from 'express';
import type { CoreContainer } from '@platform/core-accounting';
import type { TenantContainerResolver } from '../core/tenant-container-resolver';

/** الحقل الذي يحقنه TenantContextMiddleware بعد جلب حاوية المنشأة */
declare module 'express-serve-static-core' {
  interface Request {
    coreContainer?: CoreContainer;
    /** هوية المنشأة المستخرجة حصريًا من claim `tid` الموقّع */
    tenantId?: string;
    /**
     * جسر محلّك الحاويات — تحقنه طبقة middleware عامة لكل المسارات، لأن
     * middleware المسجّل بـ forRoutes('...transactions') يعمل فقط على ذلك
     * المسار؛ بدونه كانت /accounts و/reports تُوجَّه للحاوية الافتراضية
     * (ثغرة عزل فعلية اكتُشفت في اختبار البند #2).
     */
    tenantResolver?: TenantContainerResolver;
  }
}

/**
 * إعادة نوع express المحلي بدون الاعتماد على @types/express في كل معالج:
 * أي كائن طلب يحمل coreContainer اختياريًا.
 */
export interface ContainerAwareRequest {
  coreContainer?: CoreContainer;
  tenantId?: string;
  tenantResolver?: TenantContainerResolver;
}

/**
 * حاوية هذا الطلب بالأولويات الموثّقة:
 * 1) req.coreContainer إن حقنها الـ middleware (مسار العمليات — مع حقن الوضع السريع).
 * 2) حاوية منشأة مُحمَّلة مسبقًا من المحلّك وفق claim `tid` الذي أضافه الحارس على
 *    user الطلب (المسارات المحمية التي لا يمر عليها middleware العمليات) —
 *    resolveLoaded يمنع البناء الكسول وأي لمس لحاوية منشأة أخرى غير موثّقة.
 * 3) الحاوية الافتراضية من DI (وضع MVP أحادي المنشأة / مسارات عامة بلا توكن).
 */
export function containerFromRequest(
  req: ContainerAwareRequest,
  fallback: CoreContainer,
): CoreContainer {
  if (req.coreContainer) return req.coreContainer;
  const resolver = req.tenantResolver;
  // tid يُقرأ حصريًا من كائن المستخدم الذي وضعه الحارس بعد التحقق من التوقيع —
  // لا من هيدر العميل إطلاقًا (منع انتحال x-tenant-id)
  const user = (req as { user?: { tid?: unknown } }).user;
  const tid = typeof user?.tid === 'string' && user.tid.length > 0 ? user.tid : undefined;
  if (resolver && tid) {
    const tenantContainer = resolver.resolveLoaded(tid);
    if (tenantContainer) return tenantContainer;
  }
  return fallback;
}

/** هوية المنشأة لهذا الطلب (قد تكون undefined في المسارات العامة غير الموثّقة) */
export function tenantIdFromRequest(req: ContainerAwareRequest): string | undefined {
  return req.tenantId;
}
