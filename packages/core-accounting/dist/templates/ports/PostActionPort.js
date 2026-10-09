"use strict";
// src/templates/ports/PostActionPort.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostActionRegistry = void 0;
/**
 * سجل معالجات ما بعد التنفيذ (مثل allocatePayment, apply_fx_gain_loss_if_needed
 * المصمَّمة في وحدة الذمم سابقًا). يُسجَّل كل معالج مرة واحدة عند إقلاع التطبيق.
 */
class PostActionRegistry {
    handlers = new Map();
    register(name, handler) {
        this.handlers.set(name, handler);
    }
    async execute(actionExpression, context) {
        const match = actionExpression.match(/^(\w+)\((.*)\)$/);
        if (!match) {
            throw new Error(`صيغة post_action غير صالحة: "${actionExpression}"`);
        }
        const [, name, rawArgs] = match;
        const handler = this.handlers.get(name);
        if (!handler) {
            console.warn(`[PostActionRegistry] لا معالج مسجَّل للإجراء "${name}" - تم تجاهله`);
            return;
        }
        const args = rawArgs.split(",").map((a) => a.trim().replace(/[{}]/g, "")).filter(Boolean);
        await handler(args, context);
    }
}
exports.PostActionRegistry = PostActionRegistry;
//# sourceMappingURL=PostActionPort.js.map