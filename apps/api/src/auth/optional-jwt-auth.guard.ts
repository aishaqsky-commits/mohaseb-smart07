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
import { multiTenancyEnabled, authEnforceEnabled } from '../common/feature-flags';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const hasAuthHeader = typeof req.headers.authorization === 'string' && req.headers.authorization.length > 0;

    // لا توكن + وضع MVP (غير مفروض الصرامة) → اسمح بالمجهول فورًا (الحاوية الافتراضية عبر containerFromRequest)
    if (!authEnforceEnabled() && !hasAuthHeader) {
      return true;
    }

    // الوضع الصارم أو وجود هيدر توكن → تفويض لـ Passport ليتحقق من التوكن
    return (await super.canActivate(context)) as boolean;
  }

  handleRequest<TUser = AuthenticatedUser | false>(
    err: unknown,
    user: false | AuthenticatedUser,
    info: unknown,
    context: ExecutionContext,
    _status?: unknown,
  ): TUser {
    if (err) throw err instanceof Error ? err : new Error(String(err));
    if (!user) {
      const req = context.switchToHttp().getRequest<Request>();
      const hasAuthHeader = typeof req.headers.authorization === 'string' && req.headers.authorization.length > 0;
      if (authEnforceEnabled() || hasAuthHeader) {
        const reason = info instanceof Error ? info.message : String((info as any)?.name ?? info ?? '');
        if (
          reason.includes('expired') ||
          reason.includes('TokenExpiredError') ||
          (info as any)?.name === 'TokenExpiredError'
        ) {
          throw new UnauthorizedException({
            error: 'TOKEN_EXPIRED',
            message: 'انتهت صلاحية الجلسة — حدّث التوكن أو سجّل الدخول',
          });
        }
        throw new UnauthorizedException({
          error: 'UNAUTHORIZED',
          message: 'الوصول غير مصرّح — توكن مفقود أو غير صالح',
        });
      }
      return false as TUser;
    }
    const req = context.switchToHttp().getRequest<Request>();
    return { ...user, ip: req.ip ?? '' } as TUser;
  }
}
