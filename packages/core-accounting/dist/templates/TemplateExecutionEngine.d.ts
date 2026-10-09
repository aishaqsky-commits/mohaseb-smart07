import { JournalEngine } from "../application/JournalEngine";
import { JournalEntry } from "../domain/entities/JournalEntry";
import { TemplateValidator } from "./validation/TemplateValidator";
import { TemplateRegistry } from "./registry/TemplateRegistry";
import { InventoryCostingPort } from "./ports/InventoryCostingPort";
import { ExchangeRateProviderPort } from "./ports/ExchangeRateProviderPort";
import { PostActionRegistry } from "./ports/PostActionPort";
import { AccountRepository } from "../domain/ports/AccountRepository";
export interface ExecuteTemplateRequest {
    templateCode: string;
    tenantId: string;
    baseCurrencyCode: string;
    warehouseId?: string;
    payload: Record<string, unknown>;
}
export interface ExecuteTemplateResult {
    transactionId: string;
    primaryEntry: JournalEntry;
    secondaryEntry: JournalEntry | null;
    simpleSummary: string;
}
/**
 * نقطة الدخول الوحيدة لتنفيذ أي قالب في كامل التطبيق.
 * تُترجم تعريف JSON الوصفي إلى استدعاء فعلي لـ JournalEngine، مع ضمان التوازن
 * عبر "قاعدة التقريب الإلزامية" (آخر سطر = الباقي الدقيق) في كل توزيع.
 */
export declare class TemplateExecutionEngine {
    private readonly registry;
    private readonly journalEngine;
    private readonly inventoryPort;
    private readonly exchangeRateProvider;
    private readonly postActionRegistry;
    private readonly validator;
    /** مستودع الحسابات — اختياري حقنًا للتوافق؛ يلزم لعرض أسماء الحسابات في الملخص المبسّط */
    private accountRepo?;
    constructor(registry: TemplateRegistry, journalEngine: JournalEngine, inventoryPort: InventoryCostingPort, exchangeRateProvider: ExchangeRateProviderPort, postActionRegistry: PostActionRegistry, validator?: TemplateValidator, accountRepo?: AccountRepository | undefined);
    /** ربط مستودع الحسابات بعد الإنشاء (يُستخدم من مركّب الاعتماديات لتفادي توسيع توقيع المُنشئ) */
    setAccountRepository(accountRepo: AccountRepository): void;
    /**
     * إسقاط القيم الافتراضية المعرفة في القالب لأي حقل غير مُرسَل من الواجهة.
     * يعمل على نسخة جديدة من الـ payload (عدم تعديل مدخلات المستدعي).
     * القيم الحية تُحل هنا لا في الواجهة: "today" → تاريخ اليوم بصيغة ISO،
     * و "{{tenant.base_currency}}" → عملة المنشأة الأساسية من سياق الاستدعاء.
     */
    private applyFieldDefaults;
    execute(request: ExecuteTemplateRequest): Promise<ExecuteTemplateResult>;
    private buildLines;
    private buildSingleRuleLine;
    private buildRepeatedLines;
    /** يقرّب مبلغًا إلى دقة التخزين المعتمدة (نفس دقة toStorageString في Money) */
    private clampToStorage;
    private buildPostLineRequest;
    /** الفرق المطلق بين إجمالي المدين والدائن للأسطر المبنية حتى الآن - أساس plug_balance() */
    private computePlugAmount;
    private tryEvaluateOptionalString;
    private safeInterpolateMemo;
    private computeDerivedValues;
    private templateReferencesFunction;
    private resolveEntryDate;
    private buildSimpleSummary;
    /** يحوّل أسطر القيد إلى جمل عربية مبسّطة عبر ربط accountId بالحساب ثم جلب الأسماء دفعة واحدة */
    private describeEntryLines;
}
