"use strict";
// src/domain/errors/AccountingErrors.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntryAlreadyReversedError = exports.AccountNotFoundError = exports.FiscalPeriodClosedError = exports.UnbalancedJournalEntryError = void 0;
class UnbalancedJournalEntryError extends Error {
    constructor(totalDebit, totalCredit) {
        super(`القيد غير متوازن: إجمالي المدين (${totalDebit}) لا يساوي إجمالي الدائن (${totalCredit})`);
        this.name = "UnbalancedJournalEntryError";
    }
}
exports.UnbalancedJournalEntryError = UnbalancedJournalEntryError;
class FiscalPeriodClosedError extends Error {
    constructor(entryDate) {
        super(`الفترة المحاسبية لتاريخ ${entryDate} مُقفَلة، لا يمكن الترحيل فيها`);
        this.name = "FiscalPeriodClosedError";
    }
}
exports.FiscalPeriodClosedError = FiscalPeriodClosedError;
class AccountNotFoundError extends Error {
    constructor(accountId) {
        super(`الحساب غير موجود: ${accountId}`);
        this.name = "AccountNotFoundError";
    }
}
exports.AccountNotFoundError = AccountNotFoundError;
class EntryAlreadyReversedError extends Error {
    constructor(entryId) {
        super(`القيد ${entryId} معكوس مسبقًا، لا يمكن عكسه مرة أخرى`);
        this.name = "EntryAlreadyReversedError";
    }
}
exports.EntryAlreadyReversedError = EntryAlreadyReversedError;
//# sourceMappingURL=AccountingErrors.js.map