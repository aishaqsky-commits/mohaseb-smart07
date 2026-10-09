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
    // أخطاء صحة القالب (حقول مطلوبة/قيمة غير صحيحة) خطأ مستخدم واضح — 400 لا 500
    name === 'TemplateValidationError' ||
    name === 'InvalidDateError' ||
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
  // أخطاء صحة القيمة النقدية من النواة (InvalidMoneyOperationError) → خطأ تحقق 400
  // مثال: مبلغ سالب في عملية بيع — يجب رفضه عند الحافة قبل لمس محرك القيود
  if (name === 'InvalidMoneyOperationError' || message.includes('غير صالحة')) {
    return new HttpException(
      { error: 'VALIDATION_ERROR', message: `قيمة مالية غير صالحة في الطلب (${message})` },
      HttpStatus.BAD_REQUEST
    );
  }
  return new HttpException({ error: 'INTERNAL_ERROR', message }, HttpStatus.INTERNAL_SERVER_ERROR);
}
