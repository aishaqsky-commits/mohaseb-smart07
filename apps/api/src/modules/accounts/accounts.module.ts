// src/modules/accounts/accounts.module.ts
// ===== وحدة الحسابات: قوائم الاختيار وشجرة الأرصدة =====

import { Module, Controller, Get, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ListAccountsService, type CoreContainer } from '@platform/core-accounting';
import { SERVICES, CORE_CONTAINER } from '../../core/core.module';
import { containerFromRequest } from '../../common/request-context';

@Controller('api/v1/accounts')
export class AccountsController {
  constructor(
    @Inject(SERVICES.LIST_ACCOUNTS)
    private readonly listAccounts: ListAccountsService,
    @Inject(CORE_CONTAINER)
    private readonly defaultContainer: CoreContainer,
  ) {}

  /** كل حسابات المنشأة مععلماً بقابلية الترحيل — الواجهة تُخفي غير القابل للترحيل تلقائياً */
  @Get()
  async list(@Req() req: Request) {
    // تعدد المستأجرين: حاوية سياق الطلب إن حقنها الـ middleware، وإلا الافتراضية (MVP)
    return await containerFromRequest(req, this.defaultContainer).listAccountsService.execute();
  }
}

@Module({
  controllers: [AccountsController],
})
export class AccountsModule {}
