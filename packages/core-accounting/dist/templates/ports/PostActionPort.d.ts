import type { ExchangeRateProviderPort } from "./ExchangeRateProviderPort";
import type { JournalEntry } from "../../domain/entities/JournalEntry";
export interface PostActionContext {
    tenantId: string;
    transactionId: string;
    payload: Record<string, unknown>;
    /** قيد العملية الرئيسي — متاح لمعالجات post_actions (أساس الذمم الفرعية والتخصيصات) */
    primaryEntry?: JournalEntry | undefined;
    baseCurrencyCode?: string | undefined;
    /**
     * مزوّد أسعار الصرف بسعر اليوم — يُمرَّر لمعالجات التسوية حتى تُطبع مبالغ التسوية
     * بعملة البنود المفتوحة فعليًا بسعر السوق، لا بافتراض ثبات سعر سطر القيد.
     */
    exchangeRateProvider?: ExchangeRateProviderPort | undefined;
}
export type PostActionHandler = (args: unknown[], context: PostActionContext) => Promise<void>;
/**
 * سجل معالجات ما بعد التنفيذ (مثل allocatePayment, apply_fx_gain_loss_if_needed
 * المصمَّمة في وحدة الذمم سابقًا). يُسجَّل كل معالج مرة واحدة عند إقلاع التطبيق.
 */
export declare class PostActionRegistry {
    private readonly handlers;
    register(name: string, handler: PostActionHandler): void;
    execute(actionExpression: string, context: PostActionContext): Promise<void>;
}
