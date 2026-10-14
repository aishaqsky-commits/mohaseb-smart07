// src/templates/registry/TemplateRegistry.ts

import { TemplateDefinition } from "../types/TemplateDefinition";

export class TemplateNotFoundError extends Error {
  constructor(code: string) {
    super(`القالب "${code}" غير مسجَّل أو غير متاح`);
    this.name = "TemplateNotFoundError";
  }
}

/** خطأ نشاط: القالب موجود في المكتبة لكنه خارج نطاق نشاط المنشأة — 422 واضح بدل رفض غامض */
export class TemplateScopeMismatchError extends Error {
  constructor(code: string, scope: string) {
    super(`القالب "${code}" غير متاح لنشاط "${scope}" — اختر عملية مناسبة لطبيعة منشأتك`);
    this.name = "TemplateScopeMismatchError";
  }
}

export class TemplateRegistry {
  private readonly templates = new Map<string, TemplateDefinition>();
  /**
   * نطاق نشاط المنشأة المالكة لهذا السجل (core/retail/clinic/workshop...).
   * "core" أو undefined = بلا تقييد — سلوك كل الاستدعاءات القائمة بالضبط،
   * فلا كسر لاختبارات النواة والحاوية الافتراضية أحادية الوضع.
   */
  private tenantScope?: string;

  setTenantScope(scope: string | undefined): void {
    this.tenantScope = scope && scope !== "core" ? scope : undefined;
  }

  register(definition: TemplateDefinition): void {
    this.assertStructuralValidity(definition);
    this.templates.set(definition.template_code, definition);
  }

  registerMany(definitions: TemplateDefinition[]): void {
    definitions.forEach((d) => this.register(d));
  }

  resolve(code: string): TemplateDefinition {
    const tpl = this.templates.get(code);
    if (!tpl) throw new TemplateNotFoundError(code);
    // بوابة النشاط (خطة المرحلة 1 / البند #2): منع ترحيل قوالب نشاطٍ على شجرة
    // حسابات نشاطٍ آخر — مثال: sale_cash (قالب retail يرحل على الحساب 4150) لا
    // يعمل في عيادة زُرعت شجرتها clinic ولا تحتوي 4150. بدون هذه البوابة كان
    // يفشل بـ "الحساب غير موجود" (500). الخطأ هنا name مطابق لنمط الأخطاء الأخرى
    // في api-errors (مطابقة الاسم قناة معتمدة عبر حدود الحزمة).
    if (this.tenantScope && !tpl.scope.includes(this.tenantScope) && !tpl.scope.includes("core")) {
      throw new TemplateScopeMismatchError(code, this.tenantScope);
    }
    return tpl;
  }

  listByScope(scope: string): TemplateDefinition[] {
    // "core" هو النطاق الشامل: يرى كل قوالب النظام (يُستخدم في التهيئة والاختبارات)
    if (scope === "core") {
      return [...this.templates.values()].sort((a, b) => a.ui.sort_order - b.ui.sort_order);
    }
    // نطاقات النشاط (retail/clinic/workshop...): قوالب النشاط + القوالب العامة core فقط
    return [...this.templates.values()]
      .filter((t) => t.scope.includes(scope) || t.scope.includes("core"))
      .sort((a, b) => a.ui.sort_order - b.ui.sort_order);
  }

  /**
   * تحقق بنيوي أساسي. في بيئة CI/CD الفعلية يُستبدَل/يُكمَّل بتحقق AJV
   * الكامل مقابل JSON Meta-Schema المصمَّم في مرحلة تصميم القوالب.
   */
  private assertStructuralValidity(def: TemplateDefinition): void {
    if (!def.template_code) throw new Error("template_code مطلوب");
    if (!def.journal_rules || def.journal_rules.length === 0) {
      throw new Error(`القالب "${def.template_code}" لا يحتوي journal_rules`);
    }
    for (const rule of def.journal_rules) {
      if (!rule.account_code_ref || !rule.side || !rule.amount_formula) {
        throw new Error(`سطر قيد غير مكتمل في القالب "${def.template_code}"`);
      }
    }
  }
}
