"use strict";
// src/application/services/ListAccountsService.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListAccountsService = void 0;
const ApplicationErrors_1 = require("../errors/ApplicationErrors");
/**
 * حالة استخدام (Use Case): قائمة الحسابات القابلة للترحيل للمستأجر النشط.
 * تُستخدم لبناء قوائم الاختيار في الواجهة ولوحة شجرة الحسابات.
 */
class ListAccountsService {
    accountRepo;
    tenantContextProvider;
    constructor(accountRepo, tenantContextProvider) {
        this.accountRepo = accountRepo;
        this.tenantContextProvider = tenantContextProvider;
    }
    async execute() {
        const ctx = await this.tenantContextProvider.getCurrentContext();
        if (!ctx?.tenantId)
            throw new ApplicationErrors_1.MissingTenantContextError();
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
exports.ListAccountsService = ListAccountsService;
//# sourceMappingURL=ListAccountsService.js.map