// src/modules/accounts/accounts.module.ts
// ===== وحدة الحسابات: قوائم الاختيار وشجرة الأرصدة =====

import { Module, Controller, Get, Inject } from '@nestjs/common';
import { ListAccountsService } from '@platform/core-accounting';
import { SERVICES } from '../../core/core.module';

@Controller('api/v1/accounts')
export class AccountsController {
  constructor(
    @Inject(SERVICES.LIST_ACCOUNTS)
    private readonly listAccounts: ListAccountsService,
  ) {}

  /** كل حسابات المنشأة مععلماً بقابلية الترحيل — الواجهة تُخفي غير القابل للترحيل تلقائياً */
  @Get()
  async list() {
    return this.listAccounts.execute();
  }
}

@Module({
  controllers: [AccountsController],
})
export class AccountsModule {}
