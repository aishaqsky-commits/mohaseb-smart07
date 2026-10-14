// src/core/tenant-container-resolver.ts
// ===== محلّك حاويات المنشآت (Multi-tenant CoreContainer Resolver) =====
//
// القرار المعماري (docs/02-architecture/architecture.md — تعدد المستأجرين):
// - كل منشأة (tenant) تحصل على حاوية نواة خاصة بها فوق **نفس ملف SQLite**:
//   العزل يتم بمفتاح tenant_id في كل جداول النواة (accounts/journal_entries/...)
//   وليس بقواعد منفصلة — وهذا يطابق مخطط Postgres المهيّج بنفس الأعمدة.
// - الهوية (tenantId) تُقرأ حصريًا من claim `tid` الموقع داخل JWT (لا من العميل أبدًا).
// - الحاوية "رقيقة": المستودعات مُعامَلة SQL مشتركة آمنة، والسياق فقط يختلف.
//   لذلك التكلفة لكل منشأة جديدة = كائنات صغيرة + زرع شجرة حسابات idempotent مرة واحدة.
//
// حدود MVP المعروف والموثّق:
// - قاعدة واحدة لكل العقدة (vertical scaling)؛ التقسيم الأفقي لاحقًا عبر
//   TenantShardResolver بدون تغيير واجهة هذا المحلّل.

import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import {
  createCoreContainer,
  type CoreContainer,
  type TenantContext,
} from '@platform/core-accounting';
import type Database from 'better-sqlite3';
import { CORE_CONTAINER } from './core.module';
import { loadBundledTemplates } from '../common/load-templates';
import { seedAccountsIntoSqlite } from '../common/load-accounts-seed';

/** نشاط افتراضي لمنشأة نشأت قبل نظام النطاقات — آمن: الشجرة الأساسية فقط */
const DEFAULT_SCOPE_BY_TYPE: Record<string, string> = {
  retail: 'retail',
  clinic: 'clinic',
  workshop: 'workshop',
  law_office: 'law_office',
  service_office: 'service_office',
};

@Injectable()
export class TenantContainerResolver implements OnApplicationShutdown {
  /** خريطة الحاويات الحية — مفتاحها tenantId (محدودة بعدد المنشآت المسجلة فعليًا) */
  private readonly containers = new Map<string, CoreContainer>();
  private readonly inflight = new Map<string, Promise<CoreContainer>>();

  constructor(@Inject(CORE_CONTAINER) private readonly defaultContainer: CoreContainer) {}

  /**
   * جلب حاوية المنشأة — تبنيها عند الطلب (lazy) مع منع سباق البناء المزدوج:
   * طلبان متزامنان لنفس tenant يحصلان على نفس الحاوية (promise dedup).
   */
  async forTenant(tenant: TenantContext & { scope?: string }): Promise<CoreContainer> {
    const existing = this.containers.get(tenant.tenantId);
    if (existing) return existing;

    const pending = this.inflight.get(tenant.tenantId);
    if (pending) return pending;

    const build = this.build(tenant).finally(() => this.inflight.delete(tenant.tenantId));
    this.inflight.set(tenant.tenantId, build);
    const container = await build;
    // الحاوية الافتراضية (منشأة البيئة) لا تُسجَّل مكررة
    if (container !== this.defaultContainer) this.containers.set(tenant.tenantId, container);
    return container;
  }

  /** بناء حاوية منشأة على نفس القاعدة المشتركة — ذري: الفشل لا يترك نصفي حالة */
  private async build(tenant: TenantContext & { scope?: string }): Promise<CoreContainer> {
    const scope = tenant.scope ?? 'core';
    const dbPath = process.env.DB_PATH ?? ':memory:';
    const container = createCoreContainer({
      tenantId: tenant.tenantId,
      baseCurrencyCode: tenant.baseCurrencyCode,
      dbPath,
      scope,
      templates: loadBundledTemplates(),
    });
    try {
      // زرع شجرة الحسابات لنشاط المنشأة (idempotent — INSERT OR IGNORE)
      seedAccountsIntoSqlite(container.db as unknown as Database.Database, tenant.tenantId, scope);
    } catch (err) {
      container.db.close();
      throw err;
    }
    return container;
  }

  /** إغلاق نظيف لكل حاويات المنشآت (الحاوية الافتراضية يديرها CoreModule) */
  onApplicationShutdown(): void {
    for (const c of this.containers.values()) {
      try {
        c.db.close();
      } catch {
        /* إغلاق مضاعف غير ضار */
      }
    }
    this.containers.clear();
  }
}

@Global()
@Module({
  providers: [TenantContainerResolver],
  exports: [TenantContainerResolver],
})
export class TenantResolverModule {}

/** استخراج نطاق النشاط من سجل المنشأة — مع تراجع آمن للشجرة الأساسية */
export function scopeForBusinessType(businessTypeCode: string | null | undefined): string {
  if (!businessTypeCode) return 'core';
  return DEFAULT_SCOPE_BY_TYPE[businessTypeCode] ?? 'core';
}
