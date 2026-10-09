import { JournalEntry, JournalEntrySourceType } from "../domain/entities/JournalEntry";
import { EntrySide } from "../domain/entities/JournalLine";
import { AccountRepository } from "../domain/ports/AccountRepository";
import { JournalRepository } from "../domain/ports/JournalRepository";
export interface PostLineRequest {
    accountCode: string;
    side: EntrySide;
    amount: string;
    currencyCode: string;
    exchangeRateUsed: string;
    contactId?: string | undefined;
    memoAr?: string | undefined;
}
export interface PostJournalEntryRequest {
    tenantId: string;
    entryDate: Date;
    descriptionSimple: string;
    sourceType: JournalEntrySourceType;
    sourceTransactionId?: string | undefined;
    baseCurrencyCode: string;
    lines: PostLineRequest[];
}
/**
 * الواجهة الوحيدة المعتمدة لترحيل أي قيد في كامل النظام.
 * كل القوالب (بيع/شراء/تالف...) يجب أن تمر عبر هذه الدالة فقط، لا بناء JournalEntry يدويًا في مكان آخر.
 */
export declare class JournalEngine {
    private readonly accountRepo;
    private readonly journalRepo;
    constructor(accountRepo: AccountRepository, journalRepo: JournalRepository);
    postEntry(request: PostJournalEntryRequest): Promise<JournalEntry>;
    reverseEntry(tenantId: string, entryId: string, reason: string): Promise<JournalEntry>;
    /**
     * توليد الملخص المبسّط لغير المحاسب - يحقق فلسفة "لا مصطلحات محاسبية"
     * المصممة في وحدة القوالب سابقًا.
     */
    renderSimpleSummary(entry: JournalEntry, tenantId: string): Promise<string>;
}
