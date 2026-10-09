// src/modules/transactions/transactions.module.ts
// ===== وحدة العمليات: نقطة الدخول الوحيدة لتسجيل أي حركة مالية =====

import { Module, Controller, Post, Body, Inject } from '@nestjs/common';
import { z } from 'zod';
import { RecordTransactionService } from '@platform/core-accounting';
import { SERVICES } from '../../core/core.module';
import { toApiError } from '../../common/api-errors';

/** عقد الاستجابة — يضمن أن payload حقول بسيطة فقط (القيم المركّبة تُرفض صراحة) */
const RecordTransactionDto = z.object({
  templateCode: z.string().min(1).max(64),
  payload: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  warehouseId: z.string().max(64).optional(),
});

@Controller('api/v1/transactions')
export class TransactionsController {
  constructor(
    @Inject(SERVICES.RECORD_TX)
    private readonly recordTransaction: RecordTransactionService,
  ) {}

  /** POST /api/v1/transactions — تنفيذ قالب عملية وتوليد القيد المزدوج المتوازن ذرياً */
  @Post()
  async record(@Body() body: unknown) {
    const parsed = RecordTransactionDto.safeParse(body);
    if (!parsed.success) {
      throw toApiError(
        Object.assign(new Error(this.describeZod(parsed.error)), { name: 'InvalidTemplatePayloadError' }),
      );
    }
    try {
      const result = await this.recordTransaction.execute(parsed.data);
      return {
        transactionId: result.transactionId,
        summary: result.simpleSummary,
        primaryEntry: this.mapEntry(result.primaryEntry),
        secondaryEntry: result.secondaryEntry ? this.mapEntry(result.secondaryEntry) : null,
      };
    } catch (err) {
      throw toApiError(err);
    }
  }

  private mapEntry(entry: import('@platform/core-accounting').JournalEntry) {
    return {
      id: entry.id,
      date: entry.entryDate.toISOString(),
      description: entry.descriptionSimple,
      sourceType: entry.sourceType,
      baseCurrencyCode: entry.baseCurrencyCode,
      lines: entry.lines.map((l) => ({
        order: l.lineOrder,
        accountId: l.accountId,
        side: l.side,
        amount: l.amount.toString(),
        baseAmount: l.baseAmount.toString(),
        memoAr: l.memoAr,
      })),
    };
  }

  private describeZod(error: z.ZodError): string {
    const first = error.errors[0];
    if (!first) return 'بيانات غير صالحة';
    return `الحقل "${first.path.join('.')}" غير صالح: ${first.message}`;
  }
}

@Module({
  controllers: [TransactionsController],
})
export class TransactionsModule {}
