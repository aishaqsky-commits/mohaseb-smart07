export declare class UnbalancedJournalEntryError extends Error {
    constructor(totalDebit: string, totalCredit: string);
}
export declare class FiscalPeriodClosedError extends Error {
    constructor(entryDate: string);
}
export declare class AccountNotFoundError extends Error {
    constructor(accountId: string);
}
export declare class EntryAlreadyReversedError extends Error {
    constructor(entryId: string);
}
