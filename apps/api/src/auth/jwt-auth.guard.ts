// src/auth/jwt-auth.guard.ts
// ===== حارس JWT: يفرض التوكن الصالح، ويستخرج سياق المنشأة من التوكن حصريًا =====
// مبدأ أمني (docs/02-architecture/api-specifications.md): tenantId لا يُقرأ أبدًا
// من هيدر العميل في المسارات المحمية — المصدر الوحيد هو claim `tid` الموقّع.

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { AccessPayload } from './token.service';

/** شكل المستخدم بعد الحارس — متاح للـ Controllers عبر @User() */
export interface AuthenticatedUser extends AccessPayload {
  /** request.ip لقرارات الحد/التدقيق */
  ip: string;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(
    err: unknown,
    user: false | AuthenticatedUser,
    info: unknown,
    context: ExecutionContext,
    _status?: unknown,
  ): AuthenticatedUser {
    if (err || !user) {
      const reason = info instanceof Error ? info.message : String(info ?? '');
      // رسائل موحّدة لا تفرّق بين منتهٍ/مزوّر تفصيليًا للعميل
      if (reason.includes('expired')) {
        throw new UnauthorizedException({ error: 'TOKEN_EXPIRED', message: 'انتهت صلاحية الجلسة — حدّث التوكن أو سجّل الدخول' });
      }
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'الوصول غير مصرّح — توكن غير صالح' });
    }
    const req = context.switchToHttp().getRequest<Request>();
    // نسخة جديدة بدل تعديل كائن الـ payload الأصلي المشترك (ip حقن إضافي للقرارات الأمنية)
    return { ...user, ip: req.ip ?? '' };
  }
}

/** حارس أدوار: @Roles('owner') + هذا الحارس يقيد الوصول حسب دور العضوية في التوكن */
export const ROLES_KEY = 'auth:roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const role = req.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException({ error: 'FORBIDDEN', message: 'لا تملك صلاحية هذا الإجراء' });
    }
    return true;
  }
}

/** مُزخرف @Roles — يحدد الأدوار المسموح لها بالمسار */
export function Roles(...roles: string[]): ReturnType<typeof SetMetadata> {
  return SetMetadata(ROLES_KEY, roles);
}

/** مُزخرف @User — حقن هوية الجلسة في الـ Controller */
export const User = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const req = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
  return req.user;
});
