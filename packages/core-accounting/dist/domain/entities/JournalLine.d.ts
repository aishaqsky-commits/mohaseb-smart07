import { Money } from "../value-objects/Money";
export type EntrySide = "debit" | "credit";
export interface CreateJournalLineInput {
    accountId: string;
    side: EntrySide;
    amount: Money;
    exchangeRateUsed: string;
    baseCurrencyCode: string;
    contactId?: string | null;
    memoAr?: string | null;
    lineOrder: number;
}
export declare class JournalLine {
    readonly id: string;
    readonly accountId: string;
    readonly side: EntrySide;
    readonly amount: Money;
    readonly baseAmount: Money;
    readonly exchangeRateUsed: string;
    readonly contactId: string | null;
    readonly memoAr: string | null;
    readonly lineOrder: number;
    private constructor();
    static create(input: CreateJournalLineInput): JournalLine;
    /** إعادة بناء من صف قاعدة بيانات (لا يُعيد حساب baseAmount، يثق بالمخزَّن) */
    static reconstruct(props: {
        id: string;
        accountId: string;
        side: EntrySide;
        amount: Money;
        baseAmount: Money;
        exchangeRateUsed: string;
        contactId: string | null;
        memoAr: string | null;
        lineOrder: number;
    }): JournalLine;
}
