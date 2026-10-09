// src/common/api-errors.ts
// ===== توحيد أخطاء الـ API إلى استجابات HTTP مفهومة بالعربية =====

import { HttpException, HttpStatus } from '@nestjs/common';

/** تحويل أي استثناء من النواة إلى HttpException برسالة عربية واضحة */
export function toApiError(err: unknown): HttpException {
  if (err instanceof HttpException) return err;

  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';

  // أخطاء النواة المعروفة → رمز الحالة المناسب
  if (name === 'TemplateNotFoundError') {
    return new HttpException({ error: 'TEMPLATE_NOT_FOUND', message }, HttpStatus.NOT_FOUND);
  }
  if (
    name === 'MissingTenantContextError' ||
    name === 'InvalidTemplatePayloadError' ||
    name === 'ValidationError'
  ) {
    return new HttpException({ error: 'VALIDATION_ERROR', message }, HttpStatus.BAD_REQUEST);
  }
  if (
    name === 'ImbalancedJournalEntryError' ||
    name === 'ClosedPeriodError' ||
    name === 'AccountNotPostableError' ||
    message.includes('لا يمكن الترحيل') ||
    message.includes('مغلقة')
  ) {
    return new HttpException({ error: 'ACCOUNTING_RULE_VIOLATION', message }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  return new HttpException({ error: 'INTERNAL_ERROR', message }, HttpStatus.INTERNAL_SERVER_ERROR);
}
