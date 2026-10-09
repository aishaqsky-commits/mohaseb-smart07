import { Money } from "../value-objects/Money";
import { JournalLine } from "./JournalLine";
export type JournalEntrySourceType = "manual" | "sale" | "purchase" | "return" | "settlement" | "damage" | "opening_balance" | "expense" | "owner" | "system_adjustment";
export interface CreateJournalEntryInput {
    tenantId: string;
    entryDate: Date;
    descriptionSimple: string;
    sourceType: JournalEntrySourceType;
    sourceTransactionId?: string | null | undefined;
    baseCurrencyCode: string;
    lines: JournalLine[];
}
/**
 * الكيان الجذري (Aggregate Root) لقيد اليومية.
 * القاعدة غير القابلة للتفاوض: لا يُسمح بإنشاء كائن JournalEntry غير متوازن في الذاكرة إطلاقًا.
 * التحقق يحدث في المُنشئ الثابت (Factory) قبل استدعاء أي منشئ خاص.
 */
export declare class JournalEntry {
    readonly id: string;
    readonly tenantId: string;
    readonly entryDate: Date;
    readonly descriptionSimple: string;
    readonly sourceType: JournalEntrySourceType;
    readonly sourceTransactionId: string | null;
    readonly baseCurrencyCode: string;
    readonly lines: ReadonlyArray<JournalLine>;
    readonly isReversed: boolean;
    readonly reversalOfEntryId: string | null;
    readonly createdAt: Date;
    private constructor();
    /**
     * نقطة الدخول الوحيدة لإنشاء قيد جديد.
     * يفرض: وجود سطرين على الأقل، وتوازن تام بعملة الأساس.
     */
    static create(input: CreateJournalEntryInput): JournalEntry;
    /**
     * القاعدة الأهم في كامل النظام المحاسبي.
     * تُحسب دائمًا بعملة الأساس (baseAmount) بغض النظر عن عملة كل سطر على حدة.
     */
    static assertBalanced(lines: JournalLine[], baseCurrencyCode: string): void;
    /** ينتج قيدًا عكسيًا جديدًا (التصحيح الوحيد المسموح به، بدل التعديل أو الحذف) */
    createReversal(reason: string): JournalEntry;
    markAsReversed(): JournalEntry;
    totalDebitBase(): Money;
}
