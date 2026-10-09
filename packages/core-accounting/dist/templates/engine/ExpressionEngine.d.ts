import Decimal from "decimal.js";
/**
 * أنواع القيم المقبولة. يُستخدم `unknown` بدل `number` صراحةً لأن:
 * 1) قيم JSON القادمة من واجهات الإدخال تكون أرقامًا JS عادية (number).
 * 2) المصفوفات داخل payload غير معروفة البنية مسبقًا، والـ collect ([]) يعيد مصفوفات قيم خام.
 */
export type ExprValue = Decimal | string | boolean | number | null | unknown[];
export interface ExpressionContext {
    /** بيانات الحقول الخام المُدخَلة من المستخدم، بالإضافة لأي نطاقات مُحقَنة مثل job/tenant */
    fields: Record<string, unknown>;
    /** فهرس حلقة التكرار الحالية عند معالجة repeat_for، غير موجود خارج هذا السياق */
    loopIndex?: number;
    /** قيم محسوبة مسبقًا بشكل غير متزامن (تكلفة المخزون، إجمالي الأصناف...) */
    computed: Record<string, Decimal | string>;
}
export declare class ExpressionEngine {
    private static readonly functionRegistry;
    /** يقيِّم صيغة ويعيد القيمة الخام كما هي دون إجبار نوع معيّن */
    static evaluateRaw(expr: string, context: ExpressionContext): ExprValue;
    static evaluateAsDecimal(expr: string, context: ExpressionContext): Decimal;
    static evaluateAsString(expr: string, context: ExpressionContext): string;
    static evaluateAsBoolean(expr: string, context: ExpressionContext): boolean;
    private static evalNode;
    private static evalBinary;
    private static looseEquals;
    private static isNumericLike;
    /**
     * حلّ مسار مثل: distribution[i].percentage أو distribution[].percentage أو customers[2].amount
     * نمط collect ([]) يُطبَّق على باقي المسار على كل عنصر في المصفوفة ويُعيد مصفوفة نتائج.
     */
    private static resolvePath;
    private static resolveSegments;
    static toDecimal(value: ExprValue): Decimal;
    static toStringValue(value: ExprValue): string;
    static toBoolean(value: ExprValue): boolean;
}
