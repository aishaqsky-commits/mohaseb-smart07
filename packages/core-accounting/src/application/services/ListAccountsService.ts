// src/application/services/ListAccountsService.ts

import { AccountRepository } from "../../domain/ports/AccountRepository";
import { TenantContextProvider } from "../ports/TenantContextProvider";
import { MissingTenantContextError } from "../errors/ApplicationErrors";

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
export class ListAccountsService {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly tenantContextProvider: TenantContextProvider
  ) {}

  async execute(): Promise<AccountListItemDto[]> {
    const ctx = await this.tenantContextProvider.getCurrentContext();
    if (!ctx?.tenantId) throw new MissingTenantContextError();

    const accounts = await this.accountRepo.listByTenant(ctx.tenantId);
    return accounts.map((a) => ({
      code: a.code,
      nameArSimple: a.nameArSimple,
      accountType: a.accountType,
      // الحساب التجميعي (Header) غير قابل للترحيل بحكم قاعدة Domain الصارمة assertIsPostable
      isPostable: a.isPostableSafe(),
    }));
  }
}
