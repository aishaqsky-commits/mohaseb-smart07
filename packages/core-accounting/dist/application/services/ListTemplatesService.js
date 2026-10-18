"use strict";
// src/application/services/ListTemplatesService.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListTemplatesService = void 0;
const ApplicationErrors_1 = require("../errors/ApplicationErrors");
/**
 * حالة استخدام: قائمة القوالب المتاحة لمنشأة حسب نطاق نشاطها (retail/clinic/workshop...).
 * تُغذّي شاشة "ايش صاير؟" — أزرار العمليات اليومية السريعة في تطبيق Flutter.
 */
class ListTemplatesService {
    registry;
    tenantContextProvider;
    tenantScopeResolver;
    constructor(registry, tenantContextProvider, tenantScopeResolver = async () => "core") {
        this.registry = registry;
        this.tenantContextProvider = tenantContextProvider;
        this.tenantScopeResolver = tenantScopeResolver;
    }
    async execute() {
        const ctx = await this.tenantContextProvider.getCurrentContext();
        if (!ctx?.tenantId)
            throw new ApplicationErrors_1.MissingTenantContextError();
        const scope = await this.tenantScopeResolver(ctx.tenantId);
        return this.registry.listByScope(scope).map((t) => ({
            templateCode: t.template_code,
            displayNameAr: t.ui.display_name_ar,
            descriptionAr: t.ui.description_ar,
            buttonGroupAr: t.ui.button_group_ar,
            icon: t.ui.icon,
            category: t.category,
            sortOrder: t.ui.sort_order,
        }));
    }
}
exports.ListTemplatesService = ListTemplatesService;
//# sourceMappingURL=ListTemplatesService.js.map