// src/core/tenant-container-resolver.ts
// ===== محلّك حاويات CoreContainer لكل منشأة فوق نفس قاعدة SQLite =====
// قرارات معمارية موثّقة:
// - عزل بـ tenant_id مطابق لمخطط Postgres المهيّج (كل الجداول تحمل عمود tenant_id؛
//   الاستعلامات في النواة مُفلترة به أصلًا) — قاعدة واحدة، حاوية لكل منشأة.
//   عند الانتقال لـ Postgres/split DB يُستبدل createCoreContainer فقط داخل هذا الملف.
// - بناء Lazy + منع سباق البناء المزدوج: خريطة Promise dedup — طلبان متزامنان
//   لنفس tid يبنيان حاوية واحدة لا اثنتين.
// - فشل ذرّي: إذا رمى البناء (زرع/تحميل قوالب) يُحذف المسار من الخريطة ليعاد
//   بناؤه نظيفًا في الطلب التالي — لا تبقى حاوية نصف-مبنيّة مسجّلة.
// - زرع شجرة الحسابات حسب نشاط المنشأة idempotent (INSERT OR IGNORE في المشغّل).
// - إغلاق نظيف عبر OnApplicationShutdown: close() لكل حاوية بُنيت فعليًا.

import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  createCoreContainer,
  type CoreContainer,
} from '@platform/core-accounting';
import { loadBundledTemplates } from '../common/load-templates';
import { seedAccountsIntoSqlite } from '../common/load-accounts-seed';

/** إعدادات افتراضية يرثها كل منشأة جديدة (قاعدة مشتركة + عملة أساس النشاط) */
export interface TenantDefaults {
  dbPath: string;
  baseCurrencyCode: string;
}

@Injectable()
export class TenantContainerResolver implements OnApplicationShutdown {
  /** tid → Promise الحاوية (dedup ضد السباق المزدوج) */
  private readonly building = new Map<string, Promise<CoreContainer>>();
  /** tid → الحاوية الجاهزة */
  private readonly ready = new Map<string, CoreContainer>();
  /** tid → نطاق النشاط (للتشخيص والاختبارات) */
  private readonly scopes = new Map<string, string>();

  constructor(private readonly defaults: TenantDefaults) {}

  /** نطاق نشاط المنشأة المسجَّل عند أول طلب لها (retail/clinic/workshop/law_office/service_office) */
  scopeOf(tenantId: string): string | undefined {
    return this.scopes.get(tenantId);
  }

  /**
   * جلب حاوية المنشأة — تبنيها عند الحاجة بشكل آمن ضد التزامن.
   * @param tenantId هوية المنشأة (claim `tid` الموقّع حصريًا — لا من العميل)
   * @param scope نشاط المنشأة؛ يُستخدم فقط عند البناء الأولي ثم يُثبَّت
   */
  async resolve(tenantId: string, scope?: string): Promise<CoreContainer> {
    const existing = this.building.get(tenantId);
    if (existing) return existing;

    const effectiveScope = scope ?? this.scopes.get(tenantId) ?? 'retail';
    const promise = this.build(tenantId, effectiveScope);
    this.building.set(tenantId, promise);
    try {
      const container = await promise;
      this.ready.set(tenantId, container);
      this.scopes.set(tenantId, effectiveScope);
      return container;
    } catch (err) {
      // ذرية: لا نُبقي Promise فاشلًا معلقًا — الطلب التالي يعيد المحاولة بنظافة
      this.building.delete(tenantId);
      throw err;
    } finally {
      // بعد النجاح لم نعد بحاجة لمسار الـ dedup (ready هو المرجع)
      if (this.ready.has(tenantId)) this.building.delete(tenantId);
    }
  }

  /** حاوية جاهزة مباشرة إن وُجدت (مسار سريع للمعالجات التي تعرف أن المنشأة حُمّلت) */
  peek(tenantId: string): CoreContainer | undefined {
    return this.ready.get(tenantId);
  }

  /** عدد الحاويات المبنية — للتشخيص/health */
  get size(): number {
    return this.ready.size;
  }

  private async build(tenantId: string, scope: string): Promise<CoreContainer> {
    // بناء متزامن ثقيل (SQLite + زرع) داخل try/catch — فشل أي خطوة يمنع التسجيل
    const container = createCoreContainer({
      tenantId,
      baseCurrencyCode: this.defaults.baseCurrencyCode,
      dbPath: this.defaults.dbPath,
      scope,
      templates: loadBundledTemplates(),
    });
    // زرع شجرة حسابات النشاط للمنشأة — idempotent تمامًا (INSERT OR IGNORE)
    seedAccountsIntoSqlite(container.db, tenantId, scope);
    return container;
  }

  /** إغلاق نظيف لكل قواعد الحاويات (WAL checkpoint عبر close في better-sqlite3) */
  async onApplicationShutdown(): Promise<void> {
    for (const container of this.ready.values()) {
      try {
        container.db.close();
      } catch {
        // إغلاق قاعدة أُغلقت مسبقًا/تالفة لا يجب أن يفشل عملية الإيقاف
      }
    }
    this.ready.clear();
    this.building.clear();
  }
}
