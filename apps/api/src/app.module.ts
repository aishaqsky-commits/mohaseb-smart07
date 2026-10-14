// src/app.module.ts
// ===== وحدة الجذر: ربط النواة والوحدات الوظيفية =====

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { AuthModule } from './auth/auth.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { ReportsModule } from './modules/reports/reports.module';
import { HealthController } from './health.controller';
import { TenantContextMiddleware, TenantResolverBridgeMiddleware } from './middleware/tenant-context.middleware';

@Module({
  imports: [CoreModule.forRoot(), AuthModule, TemplatesModule, AccountsModule, TransactionsModule, ReportsModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // جسر المحلّك لكل الطلبات — يفعّل توجيه /accounts و/reports لحاوية المنشأة
    // من claim tid (البند #2: العزل الفعلي لا يقتصر على مسار العمليات)
    consumer.apply(TenantResolverBridgeMiddleware).forRoutes('*');
    // حقن "الوضع السريع" (حساب الصندوق الافتراضي) لطلبات العمليات فقط
    consumer.apply(TenantContextMiddleware).forRoutes('api/v1/transactions');
  }
}
