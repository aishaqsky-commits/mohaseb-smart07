export interface PostActionContext {
    tenantId: string;
    transactionId: string;
    payload: Record<string, unknown>;
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
