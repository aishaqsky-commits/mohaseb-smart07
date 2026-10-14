// src/middleware/tenant-context.middleware.ts
// ===== سياق المنشأة لكل طلب — تعدد مستأجرين فعلي فوق نفس قاعدة SQLite =====
// قرارات معمارية موثّقة (docs/02-architecture/api-specifications.md):
// - هوية المنشأة تُقرأ حصريًا من claim `tid` في JWT الموقّع — لا من هيدر العميل.
//   (هيدر x-tenant-id يُتجاهل تمامًا؛ منعًا لانتحال منشأة أخرى)
// - جلب حاوية المنشأة (TenantContainerResolver) قبل المعالج وحقنها في req.coreContainer.
// - حقن "الوضع السريع" لحساب الصندوق لكل حاوية — WeakMap cache بدل حالة واحدة عامة،
//   لأن كل منشأة لها شجرة حسابات خاصة بها (قد تختلف أكوادها حسب النشاط).
// - مسار التراجع المتوافق مع MVP: طلب بلا توكن صالح على مسار عام → الحاوية الافتراضية
//   من DI بدون تغيير السلوك — يحافظ على اختبارات e2e أحادية المنشأة خضراء.

import { Inject, Injectable, NestMiddleware, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { CoreContainer } from '@platform/core-accounting';
import { CORE_CONTAINER, TENANT_RESOLVER } from '../core/core.module';
import type { TenantContainerResolver } from '../core/tenant-container-resolver';
import { JWT_VERIFIER, type JwtVerifier } from '../auth/auth.module';
import { multiTenancyEnabled } from '../common/feature-flags';

/** حقول التوجيه النقدي التي يحقها الوضع السريع تلقائيًا بحساب الصندوق */
const CASH_TARGET_FIELDS = ['received_to_account', 'deposit_to_account', 'paid_from_account'];

/**
 * سياق المنشأة لكل طلب + حقن "الوضع السريع":
 * 1) إن وُجد Authorization: Bearer صالح → نحل حاوية tid ونحقنها في الطلب.
 * 2) حقل payload الخالي من توجيه نقدي يُملأ بحساب صندوق تلك الحاوية تحديدًا.
 * 3) بلا توكن → تراجع آمن للحاوية الافتراضية (وضع MVP/المسارات العامة).
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware, OnApplicationBootstrap {
  /** صندوق كل حاوية — WeakMap يتابع إعدام الحاوية تلقائيًا ولا يسرّب ذاكرة */
  private readonly cashCodeByContainer = new WeakMap<CoreContainer, string>();

  constructor(
    @Inject(CORE_CONTAINER) private readonly defaultContainer: CoreContainer,
    @Inject(TENANT_RESOLVER) private readonly resolver: TenantContainerResolver,
    @Inject(JWT_VERIFIER) private readonly verifyToken: JwtVerifier,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // تجهيز صندوق الحاوية الافتراضية مرة واحدة — فشل مبكر لو الشجرة غير مزروعة
    await this.cashCodeFor(this.defaultContainer);
  }

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const container = await this.containerFor(req);
    if (container !== this.defaultContainer) {
      // حقن السياق فقط عند وجود منشأة موثّقة مختلفة — الباقي تراجع MVP صامت
      req.coreContainer = container;
    }
    // ===== قرار سلوكي موثّق (سلّم الاختبارات الخضراء أولاً) =====
    // حقن الوضع السريع يُطبَّق على الحاوية المستخدمة فعليًا لهذا الطلب في كل الأوضاع:
    // - multi-tenant مفعّل → حاوية المنشأة من التوكن.
    // - وضع MVP → الحاوية الافتراضية (سلوك ما قبل هذه الجلسة نفسه، بلا انحراف).
    // المنع الحقيقي الوحيد: توكن فاسد/منتهٍ — لأن الحارس يرفضه بـ 401 قبل المعالج؛
    // التوكن الصالح لا يُحقن له سياق في وضع MVP (تجاهل متعمد موثّق في containerFor).
    this.injectCashDefaults(req, container);
    next();
  }

  /** اختيار حاوية الطلب: من JWT الموقّع حصريًا، وإلا الافتراضية */
  private async containerFor(req: Request): Promise<CoreContainer> {
    const raw = extractBearer(req);
    if (!raw) return this.defaultContainer;
    // وضع MVP (المسارات العامة والاختبارات أحادية المنشأة): التوكن لا يغيّر الحاوية.
    // ملاحظة أمان موثّقة: الحمايات الفعلية هنا فرضُ JwtAuthGuard على المسار —
    // الـ middleware يتجاهل التوكن الفاسد صمتًا عمدًا حتى لا يكشف تفاصيل التحقق.
    if (!multiTenancyEnabled()) return this.defaultContainer;
    try {
      const payload = await this.verifyToken(raw);
      // تسجيل هوية المنشأة للـ Controllers — مصدرها التوكن لا العميل
      req.tenantId = payload.tid;
      // نشاط المنشأة: claim `scope` الموقّع (تُثبّته وحدة الهوية عند التسجيل/التدوير)
      // أو retail افتراضيًا — لا يُقرأ من أي مدخل عميل إطلاقًا.
      const scope = typeof payload.scope === 'string' && payload.scope.length > 0 ? payload.scope : 'retail';
      const container = await this.resolver.resolve(payload.tid, scope);
      // تسخين الصندوق الآن (await داخل try موجود أصلًا) حتى يكون الحقن لاحقًا متزامنًا من Cache
      await this.cashCodeFor(container);
      return container;
    } catch {
      // توكن فاسد/منتهٍ هنا ليست مسؤولية الـ middleware — الحارس يرفض لاحقًا بـ 401.
      // نتراجع للافتراضية حتى لا نبني حاوية بهوية غير موثّقة (مبدأ الأمان أولًا).
      return this.defaultContainer;
    }
  }

  /** حساب الصندوق لأول حاوية ثم من الـ WeakMap — استعلام واحد لكل منشأة */
  private async cashCodeFor(container: CoreContainer): Promise<string> {
    const cached = this.cashCodeByContainer.get(container);
    if (cached) return cached;
    const accounts = await container.listAccountsService.execute();
    const postableCash = accounts
      .filter((a) => a.isPostable && /^110/.test(a.code)) // فئة النقدية/الصندوق
      .sort((a, b) => a.code.localeCompare(b.code));
    if (postableCash.length === 0) {
      const ctx = await container.tenantContextProvider.getCurrentContext();
      throw new NotFoundException(
        `لا توجد حسابات نقدية قابلة للترحيل للمنشأة ${ctx.tenantId} — تحقق من زرع شجرة الحسابات`,
      );
    }
    const code = postableCash[0]!.code;
    this.cashCodeByContainer.set(container, code);
    return code;
  }

  /** حقن الوضع السريع داخل حاوية هذا الطلب بالتحديد (متزامن — الصندوق مُسخّن مسبقًا) */
  private injectCashDefaults(req: Request, container: CoreContainer): void {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || typeof body.payload !== 'object' || body.payload === null) return;
    const payload = body.payload as Record<string, unknown>;
    const hasAnyTarget = CASH_TARGET_FIELDS.some((f) => payload[f] !== undefined);
    if (hasAnyTarget) return;
    const cached = this.cashCodeByContainer.get(container);
    if (cached) {
      // ملاحظة: نحقق فقط الحقول المرتبطة بنوع القالب عند التنفيذ؛ الحقن الزائد يُتجاهل بأمان
      payload.received_to_account = cached;
      payload.deposit_to_account = cached;
      payload.paid_from_account = cached;
    }
  }
}

/** استخراج Bearer token من الهيدر القياسي — لا مصادر أخرى إطلاقًا */
function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}
