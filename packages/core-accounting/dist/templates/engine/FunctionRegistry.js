"use strict";
// src/templates/engine/FunctionRegistry.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FunctionRegistry = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
const errors_1 = require("./errors");
function toDecimalStrict(value, fnName, argIndex) {
    if (value === undefined) {
        throw new errors_1.ExpressionEvaluationError(`الدالة "${fnName}": المعطى رقم ${argIndex + 1} مفقود`);
    }
    if (value instanceof decimal_js_1.default)
        return value;
    if (typeof value === "number")
        return new decimal_js_1.default(value);
    if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value))) {
        return new decimal_js_1.default(value);
    }
    throw new errors_1.ExpressionEvaluationError(`الدالة "${fnName}": المعطى رقم ${argIndex + 1} ليس رقمًا صالحًا`);
}
/** خريطة توزيع التالف - ثابتة ومطابقة لشجرة الحسابات المصمَّمة سابقًا */
const DAMAGE_TARGET_ACCOUNT_MAP = {
    shop_loss: "5701",
    supplier: "2110",
    other_receivable: "1230",
};
/**
 * سجل الدوال المغلق (Whitelist) - هذه القائمة فقط هي ما يمكن استدعاؤه من أي قالب.
 * إضافة دالة جديدة تتطلب تعديل هذا الملف صراحة (لا امتداد ديناميكي من القوالب نفسها).
 */
class FunctionRegistry {
    functions = new Map();
    constructor() {
        this.registerBuiltins();
    }
    register(name, impl) {
        this.functions.set(name, impl);
    }
    call(name, args, context) {
        const fn = this.functions.get(name);
        if (!fn)
            throw new errors_1.UnknownFunctionError(name);
        return fn(args, context);
    }
    registerBuiltins() {
        this.register("remaining", (args) => {
            const total = toDecimalStrict(args[0], "remaining", 0);
            const paid = toDecimalStrict(args[1], "remaining", 1);
            return total.minus(paid);
        });
        this.register("apportion", (args) => {
            const total = toDecimalStrict(args[0], "apportion", 0);
            const percentage = toDecimalStrict(args[1], "apportion", 1);
            return total.times(percentage).dividedBy(100);
        });
        this.register("sum", (args) => {
            const arr = args[0];
            if (!Array.isArray(arr)) {
                throw new errors_1.ExpressionEvaluationError('الدالة "sum" تتطلب مصفوفة كمعطى (استخدم نمط [] في المسار)');
            }
            return arr.reduce(
            // عناصر المصفوفة من payload لها نوع unknown، وتُتحقق منها toDecimalStrict أثناء التحويل
            (acc, v) => acc.plus(toDecimalStrict(v, "sum", 0)), new decimal_js_1.default(0));
        });
        this.register("map_target_to_account", (args) => {
            const targetType = String(args[0]);
            const accountCode = DAMAGE_TARGET_ACCOUNT_MAP[targetType];
            if (!accountCode) {
                throw new errors_1.ExpressionEvaluationError(`نوع جهة توزيع غير معروف: "${targetType}"`);
            }
            return accountCode;
        });
        /** القيم المحسوبة مسبقًا (Async) تُحقَن في context.computed قبل التقييم - انظر TemplateExecutionEngine */
        this.register("cogs_amount", (_args, context) => this.readComputed(context, "cogs_amount"));
        this.register("total_or_items_sum", (_args, context) => this.readComputed(context, "total_or_items_sum"));
        this.register("items_cost_sum", (_args, context) => this.readComputed(context, "cogs_amount"));
    }
    readComputed(context, key) {
        const value = context.computed[key];
        if (value === undefined) {
            throw new errors_1.ExpressionEvaluationError(`القيمة المحسوبة "${key}" غير متوفرة - تأكد من حسابها مسبقًا قبل تنفيذ القالب`);
        }
        return value instanceof decimal_js_1.default ? value : new decimal_js_1.default(value);
    }
}
exports.FunctionRegistry = FunctionRegistry;
//# sourceMappingURL=FunctionRegistry.js.map