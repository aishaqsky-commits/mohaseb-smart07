// src/templates/ports/PostActionPort.ts

import type { JournalEntry } from "../../domain/entities/JournalEntry";

export interface PostActionContext {
  tenantId: string;
  transactionId: string;
  payload: Record<string, unknown>;
  /** قيد العملية الرئيسي — متاح لمعالجات post_actions (أساس الذمم الفرعية والتخصيصات) */
  primaryEntry?: JournalEntry | undefined;
  baseCurrencyCode?: string | undefined;
}

export type PostActionHandler = (args: unknown[], context: PostActionContext) => Promise<void>;

/**
 * سجل معالجات ما بعد التنفيذ (مثل allocatePayment, apply_fx_gain_loss_if_needed
 * المصمَّمة في وحدة الذمم سابقًا). يُسجَّل كل معالج مرة واحدة عند إقلاع التطبيق.
 */
export class PostActionRegistry {
  private readonly handlers = new Map<string, PostActionHandler>();

  register(name: string, handler: PostActionHandler): void {
    this.handlers.set(name, handler);
  }

  async execute(actionExpression: string, context: PostActionContext): Promise<void> {
    // الصيغة المعتمدة في مكتبة القوالب: name(args) أو name بلا أقواس (إجراء بدون معاملات)
    const match = actionExpression.match(/^(\w+)(?:\((.*)\))?$/);
    if (!match) {
      throw new Error(`صيغة post_action غير صالحة: "${actionExpression}"`);
    }
    const [, name, rawArgs] = match;
    const handler = this.handlers.get(name!);
    if (!handler) {
      console.warn(`[PostActionRegistry] لا معالج مسجَّل للإجراء "${name}" - تم تجاهله`);
      return;
    }
    const args = (rawArgs ?? "").split(",").map((a) => a.trim().replace(/[{}]/g, "")).filter(Boolean);
    await handler(args, context);
  }
}
