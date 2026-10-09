// src/middleware/tenant-context.middleware.ts
// ===== سياق المنشأة لكل طلب =====
// في وضع MVP أحادي المنشأة: يُقرأ TENANT_ID من البيئة.
// مع تعدد المستأجرين: يستبدل باستخراج tenantId من JWT/الهيدر — بدون تغيير باقي الكود.

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { CoreContainer } from '@platform/core-accounting';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly container: CoreContainer) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    // MVP: منشأة واحدة لكل نسخة API — السياق ثابت ويُمرَّر عبر النواة مباشرة.
    //req.headers['x-tenant-id'] سيُستخدم لاحقًا لتبديل السياق لكل طلب.
    void req;
    next();
  }
}
