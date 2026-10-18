import { JournalEntry, JournalEntrySourceType } from "../domain/entities/JournalEntry";
import { EntrySide } from "../domain/entities/JournalLine";
import { AccountRepository } from "../domain/ports/AccountRepository";
import { JournalRepository } from "../domain/ports/JournalRepository";
import { ApplicationError } from "./errors/ApplicationErrors";
/** العملية لا تحمل معرف عملية مصدرية (قيد يدوي عام) — لا شيء لعكسه على مستوى العملية */
export declare class TransactionNotReversibleError extends ApplicationError {
    constructor(transactionId: string);
}
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
     * التراجع الكامل عن عملية مصدرية (Undo/التصحيح بدل الحذف — متطلب PRD §العمليات).
     * يعكس كل قيود العملية غير المعكوسة (primary + secondary إن وُجدت) بقيود عكسية
     * متوازنة بنفس تاريخ العملية الأصلية. الرفض عند: لا قيود، كلها معكوسة، أو الفترة مقفلة.
     * حارس الذمم (assertReversible على الفواتير ذات التخصيصات) يُستدعى من طبقة الخدمة
     * المستدعية (SubledgerService عبر RecordTransactionService/reverse use-case) —
     * المحرك لا يعرف الذمم، احترامًا لنقاء طبقة النطاق.
     */
    reverseTransaction(tenantId: string, transactionId: string, reason: string): Promise<JournalEntry[]>;
    /**
     * توليد الملخص المبسّط لغير المحاسب - يحقق فلسفة "لا مصطلحات محاسبية"
     * المصممة في وحدة القوالب سابقًا.
     */
    renderSimpleSummary(entry: JournalEntry, tenantId: string): Promise<string>;
}
