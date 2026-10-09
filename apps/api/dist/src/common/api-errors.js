"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toApiError = toApiError;
const common_1 = require("@nestjs/common");
function toApiError(err) {
    if (err instanceof common_1.HttpException)
        return err;
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : '';
    if (name === 'TemplateNotFoundError') {
        return new common_1.HttpException({ error: 'TEMPLATE_NOT_FOUND', message }, common_1.HttpStatus.NOT_FOUND);
    }
    if (name === 'MissingTenantContextError' ||
        name === 'InvalidTemplatePayloadError' ||
        name === 'ValidationError') {
        return new common_1.HttpException({ error: 'VALIDATION_ERROR', message }, common_1.HttpStatus.BAD_REQUEST);
    }
    if (name === 'ImbalancedJournalEntryError' ||
        name === 'ClosedPeriodError' ||
        name === 'AccountNotPostableError' ||
        message.includes('لا يمكن الترحيل') ||
        message.includes('مغلقة')) {
        return new common_1.HttpException({ error: 'ACCOUNTING_RULE_VIOLATION', message }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (name === 'InvalidMoneyOperationError' || message.includes('غير صالحة')) {
        return new common_1.HttpException({ error: 'VALIDATION_ERROR', message: `قيمة مالية غير صالحة في الطلب (${message})` }, common_1.HttpStatus.BAD_REQUEST);
    }
    return new common_1.HttpException({ error: 'INTERNAL_ERROR', message }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
}
//# sourceMappingURL=api-errors.js.map