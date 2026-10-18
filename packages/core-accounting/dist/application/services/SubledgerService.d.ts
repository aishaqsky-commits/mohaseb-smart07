import type Database from "better-sqlite3";
import { JournalEngine } from "../JournalEngine";
import { SqliteSubledgerRepository, SettleOutcome, SubledgerType } from "../../infrastructure/sqlite/SqliteSubledgerRepository";
import { AccountRepository } from "../../domain/ports/AccountRepository";
import { PostActionContext } from "../../templates/ports/PostActionPort";
export interface AgingBucketRow {
    contactId: string;
    current: string;
    days_1_30: string;
    days_31_60: string;
    days_61_90: string;
    over_90: string;
    total: string;
}
export interface StatementLine {
    date: string;
    type: "invoice" | "settlement";
    description: string;
    debit: string;
    credit: string;
    running_balance: string;
}
export interface ContactStatement {
    contactId: string;
    lines: StatementLine[];
    closingBalance: string;
}
/**
 * خدمة التطبيق للذمم الفرعية: بنود مفتوحة، تسويات FIFO، أعمار الديون، كشف الحساب، الشطب، ومنع العكس.
 * تستقر في طبقة التطبيق وتتحدث إلى المنافذ والمحركات فقط (نفس نمط RecordTransactionService).
 */
export declare class SubledgerService {
    private readonly journalEngine;
    private readonly accountRepo;
    /** عملة الأساس للمنشأة — تُحقن من مركّب الاعتماديات (لا استنتاج حرفي داخل الخدمة) */
    private readonly baseCurrencyCode;
    readonly repo: SqliteSubledgerRepository;
    constructor(db: Database.Database, journalEngine: JournalEngine, accountRepo: AccountRepository, 
    /** عملة الأساس للمنشأة — تُحقن من مركّب الاعتماديات (لا استنتاج حرفي داخل الخدمة) */
    baseCurrencyCode: string);
    /**
     * تسجيل معالجات post_actions في السجل العام. الأسماء مطابقة لاستخدامات مكتبة القوالب:
     * - createOpenItem(customer_id | supplier_id)     ← قوالب البيع/الشراء الآجل والجزئي
     * - allocate_to_invoice({{invoice_ref}})          ← قوالب التحصيل/السداد
     * - apply_fx_gain_loss_if_needed                  ← no-op موثّق (§4: أُدمج داخل التخصيص نفسه)
     */
    registerPostActions(registry: {
        register(name: string, handler: (args: unknown[], ctx: PostActionContext) => Promise<void>): void;
    }): void;
    /**
     * إنشاء بند مفتوح من سطر القيد ذي الصلة بالطرف (سطر يحمل contact_ref في القالب).
     * البند يُقيَّم بعملة السطر وسعره المثبَّت وقت الإنشاء — أساس حساب فروق العملة لاحقًا (§3.2).
     */
    createFromEntry(ctx: PostActionContext, contactKey: string): Promise<void>;
    /**
     * تسوية دفعة انطلاقًا من قيد التسوية نفسه (customer_collection / supplier_payment):
     * سطر الطرف يحدد النوع (دائن على حساب الطرف ⇒ AR)، والسطر النقدي المقابل يحدد المبلغ بسعر اليوم.
     */
    settleFromEntry(ctx: PostActionContext): Promise<SettleOutcome | null>;
    /**
     * قيد فرق العملة (§3.2) بالعملة الأساسية مباشرة (فرق الصرف مُعبَّر عنه بالأساس أصلًا).
     * الاشتقاق (open-item القياسي): الدين الأصلي بالأساس D، قيمة التحصيل الفعلية بالأساس C.
     * netFx = C − D. قيد التسوية سجّل النقد بقيمة C كاملًا وأغلق الذمم بقيمة D فقط،
     * فالفرق يُعترف به مستقلًا:
     *   ربح (C>D):  مدين حساب التحكم (استكمال إغلاق المستحق الزائد عن المخزَّن) / دائن 4900 أرباح FX
     *   خسارة (C<D): دائن حساب التحكم / مدين 5900 خسائر FX
     * (كشف الحساب والتسويات يعتمدان جدول التخصيصات لا هذه القيود، فلا يتأثر الرصيد الفرعي.)
     */
    private postFxEntry;
    findUnsettledItems(tenantId: string, contactId: string, category?: SubledgerType): import("../../infrastructure/sqlite/SqliteSubledgerRepository").OpenItemRow[];
    /**
     * أعمار الديون (§5.1): المرجع = due_date ?? invoice_date، والتجميع بعملة الأساس.
     * age <= 0 ⇒ current (لم يستحق بعد).
     */
    calculateAging(tenantId: string, category: SubledgerType, asOfDate?: string): AgingBucketRow[];
    /** ملخص الأعمار للوحة الرئيسية (§6.2 /reports/aging/summary): إجمالي كل Bucket عبر كل الأطراف */
    agingSummary(tenantId: string, category: SubledgerType, asOfDate?: string): {
        current: string;
        days_1_30: string;
        days_31_60: string;
        days_61_90: string;
        over_90: string;
        total: string;
    };
    /**
     * قائمة البنود المفتوحة (غير المسدَّدة/غير المشطوبة) للطرف — نقطة قراءة موحّدة للـ API.
     * category اختياري: AR أو AP؛ بدونه يُرجع النوعان معًا.
     */
    listOpenItems(tenantId: string, contactId: string, category?: SubledgerType): import("../../infrastructure/sqlite/SqliteSubledgerRepository").OpenItemRow[];
    /**
     * كشف حساب الطرف (§6.1): فواتير بتواريخها ثم تسوياتها (من جدول التخصيصات) بالترتيب الزمني،
     * والرصيد الجاري بمعنى «المستحق الصافي على الطرف»: الفواتير تزيد والتحصيلات تنقص (AR)،
     * وعكس الاتجاه يُقرأ من الإشارة نفسها في AP (التزام علينا).
     */
    buildStatement(tenantId: string, contactId: string): ContactStatement;
    /** شطب دين معدوم (§6.1 — صلاحية المالك تُفرض في طبقة العرض/الـ Controller) */
    writeOff(tenantId: string, openItemId: string, reason: string): import("../../infrastructure/sqlite/SqliteSubledgerRepository").OpenItemRow | null;
    /** منع عكس فاتورة لها تخصيصات (§7 — قيد تطبيقي صارم يمنع كسر تكامل البيانات) */
    assertReversible(tenantId: string, sourceTransactionId: string): void;
    /** رصيد الطرف الفوري (§6.1 /contacts/{id}/balance) */
    getBalance(tenantId: string, contactId: string): {
        ar: string;
        ap: string;
    };
    /** فشل سريع برسالة عربية واضحة بدل AccountNotFoundError الغامضة في عمق المحرك */
    private assertAccountsExist;
}
