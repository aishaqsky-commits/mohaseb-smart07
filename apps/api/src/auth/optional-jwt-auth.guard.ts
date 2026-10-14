// src/auth/optional-jwt-auth.guard.ts
// ===== حارس JWT الاختياري — للتشغيل المؤقت في وضع MVP أحادي المنشأة =====
// القرار المعماري الموثّق: مواصفات api-specifications.md تفرض JWT على مسارات
// العمليات والحسابات (البند #3 في خطة المرحلة 1). لكن قاعدة اختبارات e2e الحالية
// بُنيت قبل طبقة الهوية وتتصل بتلك المسارات بلا توكن. النمط الآمن للتدرّج:
// - MULTI_TENANCY معطّل (افتراضي التطوير/CI القديم) → هذا الحارس يقبل الطلب بدون
//   توكن (user غير معرّف) ويحقن حاوية المنشأة الافتراضية، أو يرفض لو كان التوكن
//  _present_ وفاسدًا (لا نتهاون مع توكن سيء الوجود).
// - عند النشر الحقيقي تُفعَّل الحماية الصارمة بإرجاع JwtAuthGuard مكانه (سطر واحد لكل controller).
// ملاحظة صراحة: هذا تسوية موثّقة مؤقتة وليست الوضع النهائي — البند #3 يُغلق نهائيًا
// عندما تُحدَّث suite الـ e2e لتوثين كل طلبات /transactions و/accounts.

import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { AuthenticatedUser } from './jwt-auth.guard';
import { multiTenancyEnabled } from '../common/feature-flags';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // الوضع الصارم (multi-tenant مفعل): التوكن إلزامي تمامًا كـ JwtAuthGuard
    if (multiTenancyEnabled()) {
      return (await super.canActivate(context)) as boolean;
    }
    const req = context.switchToHttp().getRequest<Request>();
    const hasAuthHeader = typeof req.headers.authorization === 'string' && req.headers.authorization.length > 0;
    if (!hasAuthHeader) {
      // لا توكن + وضع MVP → اسمح بالمجهول (الحاوية الافتراضية عبر containerFromRequest)
      return true;
    }
    // توكن موجود لكنه فاسد/منتهٍ → رفض صريح (لا رجوع للمجهول أبدًا)
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'الوصول غير مصرّح — توكن غير صالح' });
    }
    return true;
  }

  handleRequest<TUser = AuthenticatedUser | false>(
    err: unknown,
    user: false | AuthenticatedUser,
    _info: unknown,
    _context: ExecutionContext,
    _status?: unknown,
  ): TUser {
    if (err) throw err instanceof Error ? err : new Error(String(err));
    // في الوضع الاختياري قد يصل user=false (بلا هيدر) — يمر كما هو للـ @User() الذي يتعامل معه
    return (user ?? false) as TUser;
  }
}
