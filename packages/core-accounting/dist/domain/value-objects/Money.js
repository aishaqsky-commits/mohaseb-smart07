"use strict";
// src/domain/value-objects/Money.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Money = exports.InvalidMoneyOperationError = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
// ضبط دقة الحساب الداخلي (أعلى من دقة العرض لتفادي تراكم أخطاء التقريب)
decimal_js_1.default.set({ precision: 28, rounding: decimal_js_1.default.ROUND_HALF_UP });
class InvalidMoneyOperationError extends Error {
    constructor(message) {
        super(message);
        this.name = "InvalidMoneyOperationError";
    }
}
exports.InvalidMoneyOperationError = InvalidMoneyOperationError;
/**
 * كائن قيمة (Value Object) غير قابل للتغيير (Immutable) يمثل مبلغًا ماليًا مرتبطًا بعملته.
 * القاعدة الذهبية: لا تُجرَ عملية حسابية بين Money بعملتين مختلفتين مباشرة أبدًا.
 */
class Money {
    amount;
    currencyCode;
    // عدد الخانات العشرية المعتمد للعرض والتخزين النهائي (قابل للتهيئة لاحقًا حسب العملة)
    static DISPLAY_DECIMALS = 4;
    // عدد الخانات العشرية المعتمد للتخزين (يُستخدم من محرك القوالب لتقريب المبالغ)
    static STORAGE_DECIMALS = 4;
    constructor(amount, currencyCode) {
        if (!currencyCode || currencyCode.length !== 3) {
            throw new InvalidMoneyOperationError(`رمز عملة غير صالح: "${currencyCode}"`);
        }
        this.amount = amount;
        this.currencyCode = currencyCode.toUpperCase();
    }
    static fromDecimalString(value, currencyCode) {
        const decimal = new decimal_js_1.default(value);
        return new Money(decimal, currencyCode);
    }
    static fromNumber(value, currencyCode) {
        if (!Number.isFinite(value)) {
            throw new InvalidMoneyOperationError(`قيمة رقمية غير صالحة: ${value}`);
        }
        return new Money(new decimal_js_1.default(value), currencyCode);
    }
    static zero(currencyCode) {
        return new Money(new decimal_js_1.default(0), currencyCode);
    }
    assertSameCurrency(other, operation) {
        if (this.currencyCode !== other.currencyCode) {
            throw new InvalidMoneyOperationError(`لا يمكن إجراء عملية "${operation}" بين عملتين مختلفتين: ${this.currencyCode} و ${other.currencyCode}. يجب التحويل أولًا عبر سعر الصرف.`);
        }
    }
    add(other) {
        this.assertSameCurrency(other, "جمع");
        return new Money(this.amount.plus(other.amount), this.currencyCode);
    }
    subtract(other) {
        this.assertSameCurrency(other, "طرح");
        return new Money(this.amount.minus(other.amount), this.currencyCode);
    }
    multiply(factor) {
        return new Money(this.amount.times(factor), this.currencyCode);
    }
    /** يُستخدم لتحويل العملة بسعر صرف معين، وينتج عملة جديدة صراحةً */
    convertTo(targetCurrencyCode, exchangeRate) {
        const rate = new decimal_js_1.default(exchangeRate);
        if (rate.lessThanOrEqualTo(0)) {
            throw new InvalidMoneyOperationError("سعر الصرف يجب أن يكون أكبر من صفر");
        }
        return new Money(this.amount.times(rate), targetCurrencyCode);
    }
    isZero() {
        return this.amount.isZero();
    }
    isNegative() {
        return this.amount.isNegative();
    }
    isGreaterThan(other) {
        this.assertSameCurrency(other, "مقارنة");
        return this.amount.greaterThan(other.amount);
    }
    equals(other) {
        return (this.currencyCode === other.currencyCode &&
            this.amount.equals(other.amount));
    }
    /** القيمة الرقمية الخام للتخزين في قاعدة البيانات (كنص لتفادي فقد الدقة) */
    toStorageString() {
        return this.amount.toFixed(Money.DISPLAY_DECIMALS);
    }
    toNumber() {
        return this.amount.toNumber();
    }
    /** تنسيق للعرض البشري مع فواصل الآلاف (يُستخدم في الواجهة) */
    toDisplayString(locale = "ar") {
        const formatted = this.amount.toFixed(2);
        const [intPart, decPart] = formatted.split(".");
        const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return `${withThousands}.${decPart} ${this.currencyCode}`;
    }
    static sum(amounts, currencyCode) {
        return amounts.reduce((acc, m) => acc.add(m), Money.zero(currencyCode));
    }
}
exports.Money = Money;
//# sourceMappingURL=Money.js.map