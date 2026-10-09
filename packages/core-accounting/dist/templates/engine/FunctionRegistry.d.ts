import { ExprValue, ExpressionContext } from "./ExpressionEngine";
/**
 * سجل الدوال المغلق (Whitelist) - هذه القائمة فقط هي ما يمكن استدعاؤه من أي قالب.
 * إضافة دالة جديدة تتطلب تعديل هذا الملف صراحة (لا امتداد ديناميكي من القوالب نفسها).
 */
export declare class FunctionRegistry {
    private readonly functions;
    constructor();
    private register;
    call(name: string, args: ExprValue[], context: ExpressionContext): ExprValue;
    private registerBuiltins;
    private readComputed;
}
