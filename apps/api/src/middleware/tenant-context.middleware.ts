// src/middleware/tenant-context.middleware.ts
// ===== سياق المنشأة لكل طلب =====
// في وضع MVP أحادي المنشأة: يُقرأ TENANT_ID من البيئة.
// مع تعدد المستأجرين: يستبدل باستخراج tenantId من JWT/الهيدر — بدون تغيير باقي الكود.

import { Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { CoreContainer } from '@platform/core-accounting';
import { CORE_CONTAINER } from '../core/core.module';

/** حقول التوجيه النقدي التي يحقها الوضع السريع تلقائياً بحساب الصندوق */
const CASH_TARGET_FIELDS = ['received_to_account', 'deposit_to_account', 'paid_from_account'];

/**
 * سياق المنشأة لكل طلب + حقن "الوضع السريع":
 * في MVP أحادي المنشأة نحدّد حساب الصندوق الافتراضي من الشجرة المزروعة مرة واحدة،
 * ونحقنه في الحقول النقدية المطلوبة عند غيابها — تماماً كسلوك شاشة العمليات السريعة.
 * مع تعدد المستأجرين: تُقرأ الهوية من JWT عبر x-tenant-id بدون تغيير باقي الكود.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware, OnApplicationBootstrap {
  private cashAccountCode: string | null = null;

  constructor(@Inject(CORE_CONTAINER) private readonly container: CoreContainer) {}

  async onApplicationBootstrap(): Promise<void> {
    const ctx = await this.container.tenantContextProvider.getCurrentContext();
    const accounts = await this.container.listAccountsService.execute();
    const postableCash = accounts
      .filter((a) => a.isPostable && /^110/.test(a.code)) // فئة النقدية/الصندوق
      .sort((a, b) => a.code.localeCompare(b.code));
    if (postableCash.length === 0) {
      throw new NotFoundException(
        `لا توجد حسابات نقدية قابلة للترحيل للمنشأة ${ctx.tenantId} — تحقق من زرع شجرة الحسابات`
      );
    }
    this.cashAccountCode = postableCash[0]!.code;
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    const body = req.body as Record<string, unknown> | undefined;
    if (body && typeof body === 'object' && body.payload && typeof body.payload === 'object') {
      const payload = body.payload as Record<string, unknown>;
      const hasAnyTarget = CASH_TARGET_FIELDS.some((f) => payload[f] !== undefined);
      if (!hasAnyTarget && this.cashAccountCode) {
        // ملاحظة: نحقق فقط الحقول المرتبطة بنوع القالب عند التنفيذ؛ الحقن الزائد يُتجاهل بأمان
        payload.received_to_account = this.cashAccountCode;
        payload.deposit_to_account = this.cashAccountCode;
        payload.paid_from_account = this.cashAccountCode;
      }
    }
    next();
  }
}
