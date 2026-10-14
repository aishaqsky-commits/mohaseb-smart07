// src/middleware/tenant-context.middleware.ts
// ===== سياق المنشأة لكل طلب — متعدد المستأجرين فعليًا عبر JWT =====
// المصدر الوحيد لهوية المنشأة: claim `tid` الموقع داخل access token (لا هيدر من العميل).
// المسارات غير المحمية (health / تجريب أحادي المنشأة): تتراجع للحاوية الافتراضية من البيئة.

import { Inject, Injectable, NestMiddleware, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { JWT_VERIFIER } from '../auth/auth.module';
import type { Request, Response, NextFunction } from 'express';
import type { CoreContainer, TenantContext } from '@platform/core-accounting';
import { CORE_CONTAINER } from '../core/core.module';
import { TenantContainerResolver, scopeForBusinessType } from '../core/tenant-container-resolver';
import { IdentityRepository } from '../auth/identity.repository';
import type { AccessPayload } from '../auth/token.service';

/** حقول التوجيه النقدي التي يحقها الوضع السريع تلقائياً بحساب الصندوق */
const CASH_TARGET_FIELDS = ['received_to_account', 'deposit_to_account', 'paid_from_account'];

/** امتداد سياق الطلب — ترى بقية الطبقات الحاوية الصحيحة دون معرفة مصدرها */
declare module 'http' {
  interface IncomingMessage {
    tenant?: TenantContext;
    coreContainer?: CoreContainer;
    authUser?: AccessPayload;
  }
}

@Injectable()
export class TenantContextMiddleware implements NestMiddleware, OnApplicationBootstrap {
  /** مخزن حساب الصندوق الافتراضي لكل حاوية — يُحسب مرة واحدة لكل منشأة */
  private readonly cashCache = new WeakMap<CoreContainer, string>();

  constructor(
    @Inject(CORE_CONTAINER) private readonly defaultContainer: CoreContainer,
    private readonly resolver: TenantContainerResolver,
    private readonly identity: IdentityRepository,
    @Inject(JWT_VERIFIER) private readonly jwtVerifier: JwtService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // فحص إقلاع صارم: الحاوية الافتراضية يجب أن تملك شجرة حسابات بها نقدية قابلة للترحيل
    await this.cashCodeFor(this.defaultContainer);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      // مسار عام/تجريبي: الحاوية الافتراضية من البيئة (سلوك MVP أحادي المنشأة كما هو)
      req.coreContainer = this.defaultContainer;
      this.injectCashDefaults(req);
      next();
      return;
    }

    // Middleware يسبق الحراس: نتحقق من توقيع التوكن (بنفس سر JwtModule) لتحديد
    // حاوية المنشأة مبكرًا. التوكن غير الصالح لا نرفضه هنا — الـ Guard يرفضه برسالة موحّدة،
    // لكننا نحتاجه صالحًا لنوجّه الطلب للحاوية الصحيحة قبل وصول المعالج.
    void this.attachTenantContext(req, authHeader.slice(7).trim()).then(
      () => {
        this.injectCashDefaults(req);
        next();
      },
      (err: unknown) => {
        if (err instanceof NotFoundException) {
          res.status(404).json({ error: 'TENANT_NOT_FOUND', message: err.message });
          return;
        }
        next(err as Error);
      },
    );
  }

  /** قراءة tid من التوكن الموقّع ثم جلب/بناء حاوية المنشأة */
  private async attachTenantContext(req: Request, rawToken: string): Promise<void> {
    let payload: AccessPayload;
    try {
      payload = await this.jwtVerifier.verifyAsync<AccessPayload>(rawToken);
      if (payload.typ !== 'access' || !payload.tid) throw new Error('invalid access token');
    } catch {
      // توكن غير صالح/منتهي: نترك المسار يفشل لاحقًا في Guard برسالة موحّدة — بلا حاوية خاصة
      return;
    }
    req.authUser = payload;
    const tenantRow = this.identity.findTenantById(payload.tid);
    if (!tenantRow || tenantRow.is_active !== 1) {
      throw new NotFoundException('المنشأة غير موجودة أو غير نشطة');
    }
    const tenant: TenantContext = {
      tenantId: tenantRow.id,
      baseCurrencyCode: tenantRow.base_currency_code,
    };
    req.tenant = tenant;
    req.coreContainer = await this.resolver.forTenant({
      ...tenant,
      scope: scopeForBusinessType(tenantRow.business_type_code),
    });
  }

  /** حقن "الوضع السريع": حساب الصندوق الافتراضي لحاوية هذا الطلب */
  private injectCashDefaults(req: Request): void {
    const container = req.coreContainer;
    if (!container) return;
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || !body.payload || typeof body.payload !== 'object') return;
    const payload = body.payload as Record<string, unknown>;
    const hasAnyTarget = CASH_TARGET_FIELDS.some((f) => payload[f] !== undefined);
    if (hasAnyTarget) return;
    const cashCode = this.cashCache.get(container);
    if (cashCode) {
      // ملاحظة: تحقق النواة فقط الحقول المرتبطة بنوع القالب؛ الحقن الزائد يُتجاهل بأمان
      payload.received_to_account = cashCode;
      payload.deposit_to_account = cashCode;
      payload.paid_from_account = cashCode;
    }
  }

  private async cashCodeFor(container: CoreContainer): Promise<string> {
    const cached = this.cashCache.get(container);
    if (cached) return cached;
    const accounts = await container.listAccountsService.execute();
    const postableCash = accounts
      .filter((a) => a.isPostable && /^110/.test(a.code)) // فئة النقدية/الصندوق
      .sort((a, b) => a.code.localeCompare(b.code));
    if (postableCash.length === 0) {
      throw new NotFoundException('لا توجد حسابات نقدية قابلة للترحيل — تحقق من زرع شجرة الحسابات');
    }
    const code = postableCash[0]!.code;
    this.cashCache.set(container, code);
    return code;
  }
}
