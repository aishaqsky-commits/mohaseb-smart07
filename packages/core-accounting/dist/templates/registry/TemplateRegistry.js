"use strict";
// src/templates/registry/TemplateRegistry.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplateRegistry = exports.TemplateNotFoundError = void 0;
class TemplateNotFoundError extends Error {
    constructor(code) {
        super(`القالب "${code}" غير مسجَّل أو غير متاح`);
        this.name = "TemplateNotFoundError";
    }
}
exports.TemplateNotFoundError = TemplateNotFoundError;
class TemplateRegistry {
    templates = new Map();
    register(definition) {
        this.assertStructuralValidity(definition);
        this.templates.set(definition.template_code, definition);
    }
    registerMany(definitions) {
        definitions.forEach((d) => this.register(d));
    }
    resolve(code) {
        const tpl = this.templates.get(code);
        if (!tpl)
            throw new TemplateNotFoundError(code);
        return tpl;
    }
    listByScope(scope) {
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
    assertStructuralValidity(def) {
        if (!def.template_code)
            throw new Error("template_code مطلوب");
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
exports.TemplateRegistry = TemplateRegistry;
//# sourceMappingURL=TemplateRegistry.js.map