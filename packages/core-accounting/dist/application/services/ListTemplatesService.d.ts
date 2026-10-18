import { TemplateRegistry } from "../../templates/registry/TemplateRegistry";
import { TenantContextProvider } from "../ports/TenantContextProvider";
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
export declare class ListTemplatesService {
    private readonly registry;
    private readonly tenantContextProvider;
    private readonly tenantScopeResolver;
    constructor(registry: TemplateRegistry, tenantContextProvider: TenantContextProvider, tenantScopeResolver?: (tenantId: string) => Promise<string>);
    execute(): Promise<TemplateListItemDto[]>;
}
