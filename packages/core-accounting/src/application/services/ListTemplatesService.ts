// src/application/services/ListTemplatesService.ts

import { TemplateRegistry } from "../../templates/registry/TemplateRegistry";
import { TenantContextProvider } from "../ports/TenantContextProvider";
import { MissingTenantContextError } from "../errors/ApplicationErrors";

export interface TemplateListItemDto {
  templateCode: string;
  displayNameAr: string;
  descriptionAr: string;
  buttonGroupAr: string | null;
  icon: string;
  category: string;
  sortOrder: number;
}

/**
 * حالة استخدام: قائمة القوالب المتاحة لمنشأة حسب نطاق نشاطها (retail/clinic/workshop...).
 * تُغذّي شاشة "ايش صاير؟" — أزرار العمليات اليومية السريعة في تطبيق Flutter.
 */
export class ListTemplatesService {
  constructor(
    private readonly registry: TemplateRegistry,
    private readonly tenantContextProvider: TenantContextProvider,
    private readonly tenantScopeResolver: (tenantId: string) => Promise<string> = async () => "core"
  ) {}

  async execute(): Promise<TemplateListItemDto[]> {
    const ctx = await this.tenantContextProvider.getCurrentContext();
    if (!ctx?.tenantId) throw new MissingTenantContextError();

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
