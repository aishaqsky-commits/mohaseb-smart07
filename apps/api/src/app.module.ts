// src/app.module.ts
// ===== وحدة الجذر: ربط النواة والوحدات الوظيفية =====

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { HealthController } from './health.controller';
import { TenantContextMiddleware } from './middleware/tenant-context.middleware';

@Module({
  imports: [CoreModule.forRoot(), TemplatesModule, AccountsModule, TransactionsModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // حقن "الوضع السريع" (حساب الصندوق الافتراضي) لطلبات العمليات فقط
    consumer.apply(TenantContextMiddleware).forRoutes('api/v1/transactions');
  }
}
