// src/common/request-context.ts
// ===== جسر سياق الطلب متعدد المنشآت إلى المعالجين =====
// المعالج يقرأ req.coreContainer (الحاوية الصحيحة للمنشأة من claim tid) أو يتراجع
// للحاوية الافتراضية من DI — فيبقى سلوك تجريب أحادي المنشأة كما هو بلا أي تغيير.

import type { Request } from 'express';
import { ExecutionContext } from '@nestjs/common';
import type { CoreContainer } from '@platform/core-accounting';

export function containerFromRequest(
  req: { coreContainer?: CoreContainer } | undefined,
  fallback: CoreContainer,
): CoreContainer {
  return req?.coreContainer ?? fallback;
}

/** استخراج كائن الطلب من ExecutionContext داخل حارس/محوّل */
export function requestOf(ctx: ExecutionContext): Request {
  return ctx.switchToHttp().getRequest<Request>();
}
