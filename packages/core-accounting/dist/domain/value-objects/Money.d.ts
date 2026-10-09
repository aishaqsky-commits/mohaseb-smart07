export declare class InvalidMoneyOperationError extends Error {
    constructor(message: string);
}
/**
 * كائن قيمة (Value Object) غير قابل للتغيير (Immutable) يمثل مبلغًا ماليًا مرتبطًا بعملته.
 * القاعدة الذهبية: لا تُجرَ عملية حسابية بين Money بعملتين مختلفتين مباشرة أبدًا.
 */
export declare class Money {
    private readonly amount;
    readonly currencyCode: string;
    private static readonly DISPLAY_DECIMALS;
    static readonly STORAGE_DECIMALS = 4;
    private constructor();
    static fromDecimalString(value: string, currencyCode: string): Money;
    static fromNumber(value: number, currencyCode: string): Money;
    static zero(currencyCode: string): Money;
    private assertSameCurrency;
    add(other: Money): Money;
    subtract(other: Money): Money;
    multiply(factor: number | string): Money;
    /** يُستخدم لتحويل العملة بسعر صرف معين، وينتج عملة جديدة صراحةً */
    convertTo(targetCurrencyCode: string, exchangeRate: string | number): Money;
    isZero(): boolean;
    isNegative(): boolean;
    isGreaterThan(other: Money): boolean;
    equals(other: Money): boolean;
    /** القيمة الرقمية الخام للتخزين في قاعدة البيانات (كنص لتفادي فقد الدقة) */
    toStorageString(): string;
    toNumber(): number;
    /** تنسيق للعرض البشري مع فواصل الآلاف (يُستخدم في الواجهة) */
    toDisplayString(locale?: string): string;
    static sum(amounts: Money[], currencyCode: string): Money;
}
