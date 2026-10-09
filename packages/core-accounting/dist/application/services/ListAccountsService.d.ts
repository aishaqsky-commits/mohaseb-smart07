import { AccountRepository } from "../../domain/ports/AccountRepository";
import { TenantContextProvider } from "../ports/TenantContextProvider";
export interface AccountListItemDto {
    code: string;
    nameArSimple: string;
    accountType: string;
    isPostable: boolean;
}
/**
 * حالة استخدام (Use Case): قائمة الحسابات القابلة للترحيل للمستأجر النشط.
 * تُستخدم لبناء قوائم الاختيار في الواجهة ولوحة شجرة الحسابات.
 */
export declare class ListAccountsService {
    private readonly accountRepo;
    private readonly tenantContextProvider;
    constructor(accountRepo: AccountRepository, tenantContextProvider: TenantContextProvider);
    execute(): Promise<AccountListItemDto[]>;
}
