// src/app.module.ts
// ===== وحدة الجذر: ربط النواة والوحدات الوظيفية =====

import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { HealthController } from './health.controller';

@Module({
  imports: [CoreModule.forRoot(), TemplatesModule, AccountsModule, TransactionsModule],
  controllers: [HealthController],
})
export class AppModule {}
