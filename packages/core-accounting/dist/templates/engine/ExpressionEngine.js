"use strict";
// src/templates/engine/ExpressionEngine.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpressionEngine = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
const Parser_1 = require("./Parser");
const FunctionRegistry_1 = require("./FunctionRegistry");
const errors_1 = require("./errors");
/** يحذف أقواس {{ }} الزخرفية فقط (اتفاقية التصميم المعتمدة في القسم 0.2) */
function stripBraces(expr) {
    return expr.replace(/\{\{/g, "").replace(/\}\}/g, "");
}
class ExpressionEngine {
    static functionRegistry = new FunctionRegistry_1.FunctionRegistry();
    /** يقيِّم صيغة ويعيد القيمة الخام كما هي دون إجبار نوع معيّن */
    static evaluateRaw(expr, context) {
        const ast = Parser_1.Parser.parse(stripBraces(expr));
        return this.evalNode(ast, context);
    }
    static evaluateAsDecimal(expr, context) {
        return this.toDecimal(this.evaluateRaw(expr, context));
    }
    static evaluateAsString(expr, context) {
        return this.toStringValue(this.evaluateRaw(expr, context));
    }
    static evaluateAsBoolean(expr, context) {
        return this.toBoolean(this.evaluateRaw(expr, context));
    }
    // ===================== المُقيِّم الداخلي =====================
    static evalNode(node, context) {
        switch (node.type) {
            case "Number": return new decimal_js_1.default(node.value);
            case "String": return node.value;
            case "Bool": return node.value;
            case "Null": return null;
            case "Path":
                return this.resolvePath(context.fields, node.segments, context.loopIndex);
            case "Call": {
                const args = node.args.map((a) => this.evalNode(a, context));
                return this.functionRegistry.call(node.name, args, context);
            }
            case "Unary": {
                const operand = this.evalNode(node.operand, context);
                if (node.op === "!")
                    return !this.toBoolean(operand);
                return this.toDecimal(operand).negated();
            }
            case "Binary":
                return this.evalBinary(node.op, node.left, node.right, context);
        }
    }
    static evalBinary(op, leftNode, rightNode, context) {
        // التقييم الكسول (Short-circuit) للعوامل المنطقية
        if (op === "&&") {
            return this.toBoolean(this.evalNode(leftNode, context)) &&
                this.toBoolean(this.evalNode(rightNode, context));
        }
        if (op === "||") {
            return this.toBoolean(this.evalNode(leftNode, context)) ||
                this.toBoolean(this.evalNode(rightNode, context));
        }
        const left = this.evalNode(leftNode, context);
        const right = this.evalNode(rightNode, context);
        switch (op) {
            case "+": return this.toDecimal(left).plus(this.toDecimal(right));
            case "-": return this.toDecimal(left).minus(this.toDecimal(right));
            case "*": return this.toDecimal(left).times(this.toDecimal(right));
            case "/": return this.toDecimal(left).dividedBy(this.toDecimal(right));
            case "<": return this.toDecimal(left).lessThan(this.toDecimal(right));
            case ">": return this.toDecimal(left).greaterThan(this.toDecimal(right));
            case "<=": return this.toDecimal(left).lessThanOrEqualTo(this.toDecimal(right));
            case ">=": return this.toDecimal(left).greaterThanOrEqualTo(this.toDecimal(right));
            case "==": return this.looseEquals(left, right);
            case "!=": return !this.looseEquals(left, right);
            default:
                throw new errors_1.ExpressionEvaluationError(`عامل غير مدعوم: "${op}"`);
        }
    }
    static looseEquals(a, b) {
        if (a === null || b === null)
            return a === b;
        if (a instanceof decimal_js_1.default && this.isNumericLike(b))
            return a.equals(this.toDecimal(b));
        if (b instanceof decimal_js_1.default && this.isNumericLike(a))
            return this.toDecimal(a).equals(b);
        if (typeof a === "boolean" || typeof b === "boolean")
            return this.toBoolean(a) === this.toBoolean(b);
        return String(a) === String(b);
    }
    static isNumericLike(v) {
        return v instanceof decimal_js_1.default || typeof v === "number" ||
            (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)));
    }
    /**
     * حلّ مسار مثل: distribution[i].percentage أو distribution[].percentage أو customers[2].amount
     * نمط collect ([]) يُطبَّق على باقي المسار على كل عنصر في المصفوفة ويُعيد مصفوفة نتائج.
     */
    static resolvePath(root, segments, loopIndex) {
        return this.resolveSegments(root, segments, loopIndex);
    }
    static resolveSegments(value, segments, loopIndex) {
        if (segments.length === 0)
            return value;
        const [seg, ...rest] = segments;
        if (seg.kind === "prop") {
            const next = value == null ? undefined : value[seg.name];
            return this.resolveSegments(next, rest, loopIndex);
        }
        if (seg.kind === "index") {
            if (!Array.isArray(value)) {
                throw new errors_1.ExpressionEvaluationError(`استُخدم [${seg.value}] على قيمة ليست مصفوفة`);
            }
            return this.resolveSegments(value[seg.value], rest, loopIndex);
        }
        if (seg.kind === "indexVar") {
            if (loopIndex === undefined) {
                throw new errors_1.ExpressionEvaluationError('استُخدم [i] خارج سياق تكرار (repeat_for)');
            }
            if (!Array.isArray(value)) {
                throw new errors_1.ExpressionEvaluationError("استُخدم [i] على قيمة ليست مصفوفة");
            }
            return this.resolveSegments(value[loopIndex], rest, loopIndex);
        }
        // collect: [] - يُطبَّق باقي المسار على كل عنصر، يُعيد مصفوفة
        if (!Array.isArray(value)) {
            throw new errors_1.ExpressionEvaluationError("استُخدم [] على قيمة ليست مصفوفة");
        }
        return value.map((item) => this.resolveSegments(item, rest, loopIndex));
    }
    // ===================== دوال التحويل (Coercion Helpers) =====================
    static toDecimal(value) {
        if (value instanceof decimal_js_1.default)
            return value;
        if (typeof value === "number" && Number.isFinite(value)) {
            return new decimal_js_1.default(value);
        }
        if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value))) {
            return new decimal_js_1.default(value);
        }
        if (value === null || value === undefined)
            return new decimal_js_1.default(0);
        throw new errors_1.ExpressionEvaluationError(`لا يمكن تحويل القيمة إلى رقم: ${JSON.stringify(value)}`);
    }
    static toStringValue(value) {
        if (typeof value === "string")
            return value;
        if (value instanceof decimal_js_1.default)
            return value.toString();
        if (typeof value === "boolean")
            return String(value);
        throw new errors_1.ExpressionEvaluationError(`القيمة فارغة أو غير صالحة كمرجع نصي: ${JSON.stringify(value)}`);
    }
    static toBoolean(value) {
        if (typeof value === "boolean")
            return value;
        if (value === null || value === undefined)
            return false;
        if (value instanceof decimal_js_1.default)
            return !value.isZero();
        if (typeof value === "string")
            return value.length > 0;
        if (Array.isArray(value))
            return value.length > 0;
        return Boolean(value);
    }
}
exports.ExpressionEngine = ExpressionEngine;
//# sourceMappingURL=ExpressionEngine.js.map