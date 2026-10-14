// src/modules/reports/reports.module.ts
// ===== وحدة التقارير المالية: ميزان المراجعة وقائمة الدخل (محمية بـ JWT) =====
// مواصفات: docs/04-modules/financial-reporting.md §6 — ونقطة الدخول الآمنة وفق
// api-specifications.md: tenantId يُقرأ حصريًا من claim `tid` الموقع (لا من العميل).

import { Controller, Get, Module, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/jwt-auth.guard';
import { User } from '../../auth/jwt-auth.guard';
import { toApiError } from '../../common/api-errors';
import { ReportEngineService } from './report-engine';

@Controller('api/v1/reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly engine: ReportEngineService) {}

  /** GET /reports/trial-balance?as_of_date=YYYY-MM-DD — §6.1 */
  @Get('trial-balance')
  trialBalance(@User() user: AuthenticatedUser, @Query('as_of_date') asOfDateRaw?: string) {
    try {
      const asOfDate = asOfDateRaw ?? new Date().toISOString().slice(0, 10);
      return { data: this.engine.trialBalance(user.tid, asOfDate) };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** GET /reports/income-statement?date_from=&date_to= — §6.2 (date_to غير شامل) */
  @Get('income-statement')
  incomeStatement(
    @User() user: AuthenticatedUser,
    @Query('date_from') dateFromRaw?: string,
    @Query('date_to') dateToRaw?: string,
  ) {
    try {
      // افتراضي سليم: الشهر الميلادي الجاري [أوله، أول الغد)
      const today = new Date();
      const monthStart = `${today.toISOString().slice(0, 7)}-01`;
      const tomorrow = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
      return {
        data: this.engine.incomeStatement(user.tid, dateFromRaw ?? monthStart, dateToRaw ?? tomorrow),
      };
    } catch (err) {
      throw toApiError(err);
    }
  }
}

@Module({
  controllers: [ReportsController],
  providers: [ReportEngineService],
  exports: [ReportEngineService],
})
export class ReportsModule {}
